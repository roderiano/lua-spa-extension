import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { LSPAVirtualPythonProvider, LSPA_PYTHON_SCHEME } from './embeddedProvider';
import { isInPythonBlock, mapLspaPositionToPython, mapPythonRangeToLspa } from './mapper';

const LSPA_SELECTOR: vscode.DocumentSelector = [{ language: 'lspa' }];
const PYTHON_COMPLETION_TRIGGERS = ['.', '"', "'", '(', ',', ' ', '[', '{', ':'];

const LSPA_SEMANTIC_TOKEN_TYPES = [
    'namespace',
    'type',
    'class',
    'enum',
    'interface',
    'struct',
    'typeParameter',
    'parameter',
    'variable',
    'property',
    'enumMember',
    'event',
    'function',
    'method',
    'macro',
    'keyword',
    'modifier',
    'comment',
    'string',
    'number',
    'regexp',
    'operator',
    'decorator'
] as const;

const LSPA_SEMANTIC_TOKEN_MODIFIERS = [
    'declaration',
    'definition',
    'readonly',
    'static',
    'deprecated',
    'abstract',
    'async',
    'modification',
    'documentation',
    'defaultLibrary'
] as const;

const LSPA_SEMANTIC_LEGEND = new vscode.SemanticTokensLegend(
    [...LSPA_SEMANTIC_TOKEN_TYPES],
    [...LSPA_SEMANTIC_TOKEN_MODIFIERS]
);

type Snapshot = NonNullable<ReturnType<LSPAVirtualPythonProvider['getSnapshotBySource']>>;
type PreparedMirror = {
    snapshot: Snapshot;
    mirrorUri: vscode.Uri;
};

type InsertReplaceLikeTextEdit = {
    newText: string;
    insert: unknown;
    replace: unknown;
};

type InsertReplaceLikeCompletionRange = {
    inserting: unknown;
    replacing: unknown;
};

function toPosition(value: unknown): vscode.Position | undefined {
    if (value instanceof vscode.Position) {
        return value;
    }

    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const candidate = value as { line?: unknown; character?: unknown };
    if (typeof candidate.line !== 'number' || typeof candidate.character !== 'number') {
        return undefined;
    }

    return new vscode.Position(Math.max(0, candidate.line), Math.max(0, candidate.character));
}

function toRange(value: unknown): vscode.Range | undefined {
    if (value instanceof vscode.Range) {
        return value;
    }

    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const candidate = value as { start?: unknown; end?: unknown };
    const start = toPosition(candidate.start);
    const end = toPosition(candidate.end);
    return start && end ? new vscode.Range(start, end) : undefined;
}

function mapHover(hover: vscode.Hover, snapshot: Snapshot, sourceDoc: vscode.TextDocument): vscode.Hover {
    if (!hover.range) {
        return hover;
    }

    const mappedRange = mapPythonRangeToLspa(hover.range, snapshot, sourceDoc);
    return mappedRange ? new vscode.Hover(hover.contents, mappedRange) : hover;
}

function mapDiagnostics(
    diagnostics: readonly vscode.Diagnostic[],
    snapshot: Snapshot,
    sourceDoc: vscode.TextDocument
): vscode.Diagnostic[] {
    return diagnostics
        .map((diagnostic) => {
            const mappedRange = mapPythonRangeToLspa(diagnostic.range, snapshot, sourceDoc);
            if (!mappedRange) {
                return undefined;
            }

            const next = new vscode.Diagnostic(mappedRange, diagnostic.message, diagnostic.severity);
            next.code = diagnostic.code;
            next.source = diagnostic.source ?? 'python';
            next.tags = diagnostic.tags;
            next.relatedInformation = diagnostic.relatedInformation;
            return next;
        })
        .filter((diagnostic): diagnostic is vscode.Diagnostic => Boolean(diagnostic));
}

function mapTextEditFromPython(edit: unknown, snapshot: Snapshot, sourceDoc: vscode.TextDocument): vscode.TextEdit | undefined {
    if (!edit || typeof edit !== 'object') {
        return undefined;
    }

    const candidate = edit as { newText?: unknown; range?: unknown };
    if (typeof candidate.newText !== 'string') {
        return undefined;
    }

    const range = toRange(candidate.range);
    if (!range) {
        return undefined;
    }

    const mappedRange = mapPythonRangeToLspa(range, snapshot, sourceDoc);
    return mappedRange ? new vscode.TextEdit(mappedRange, candidate.newText) : undefined;
}

function mapTextEditsFromPython(
    edits: readonly unknown[] | undefined,
    snapshot: Snapshot,
    sourceDoc: vscode.TextDocument
): vscode.TextEdit[] | undefined {
    if (!edits?.length) {
        return undefined;
    }

    const mapped = edits
        .map((edit) => mapTextEditFromPython(edit, snapshot, sourceDoc))
        .filter((edit): edit is vscode.TextEdit => Boolean(edit));

    return mapped.length > 0 ? mapped : undefined;
}

function isInsertReplaceLikeTextEdit(value: unknown): value is InsertReplaceLikeTextEdit {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as { newText?: unknown; insert?: unknown; replace?: unknown };
    return (
        typeof candidate.newText === 'string'
        && Boolean(toRange(candidate.insert))
        && Boolean(toRange(candidate.replace))
    );
}

function isInsertReplaceLikeCompletionRange(value: unknown): value is InsertReplaceLikeCompletionRange {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as { inserting?: unknown; replacing?: unknown };
    return Boolean(toRange(candidate.inserting)) && Boolean(toRange(candidate.replacing));
}

function mapCompletionRange(
    range: unknown,
    snapshot: Snapshot,
    sourceDoc: vscode.TextDocument
): vscode.Range | { inserting: vscode.Range; replacing: vscode.Range } | undefined {
    const regular = toRange(range);
    if (regular) {
        return mapPythonRangeToLspa(regular, snapshot, sourceDoc);
    }

    if (!isInsertReplaceLikeCompletionRange(range)) {
        return undefined;
    }

    const inserting = toRange(range.inserting);
    const replacing = toRange(range.replacing);
    if (!inserting || !replacing) {
        return undefined;
    }

    const mappedInserting = mapPythonRangeToLspa(inserting, snapshot, sourceDoc);
    const mappedReplacing = mapPythonRangeToLspa(replacing, snapshot, sourceDoc);
    if (!mappedInserting || !mappedReplacing) {
        return undefined;
    }

    return {
        inserting: mappedInserting,
        replacing: mappedReplacing
    };
}

function mapCompletionTextEdit(
    textEdit: unknown,
    snapshot: Snapshot,
    sourceDoc: vscode.TextDocument
): vscode.TextEdit | undefined {
    const regular = mapTextEditFromPython(textEdit, snapshot, sourceDoc);
    if (regular) {
        return regular;
    }

    if (!isInsertReplaceLikeTextEdit(textEdit)) {
        return undefined;
    }

    const insert = toRange(textEdit.insert);
    const replace = toRange(textEdit.replace);
    if (!insert || !replace) {
        return undefined;
    }

    const mappedInsert = mapPythonRangeToLspa(insert, snapshot, sourceDoc);
    const mappedReplace = mapPythonRangeToLspa(replace, snapshot, sourceDoc);
    if (!mappedInsert || !mappedReplace) {
        return undefined;
    }

    // Normalize Insert/Replace style edits into a regular TextEdit for LSPA docs.
    return new vscode.TextEdit(mappedReplace, textEdit.newText);
}

function mapCompletionList(list: vscode.CompletionList, snapshot: Snapshot, sourceDoc: vscode.TextDocument): vscode.CompletionList {
    const items = list.items.map((item) => {
        const mapped = new vscode.CompletionItem(item.label, item.kind);
        Object.assign(mapped, item);

        const mappedRange = mapCompletionRange((item as { range?: unknown }).range, snapshot, sourceDoc);
        (mapped as { range?: unknown }).range = mappedRange;

        if (item.textEdit) {
            const mappedTextEdit = mapCompletionTextEdit(item.textEdit, snapshot, sourceDoc);
            mapped.textEdit = mappedTextEdit;
        }

        if (item.additionalTextEdits?.length) {
            const mappedAdditionalTextEdits = mapTextEditsFromPython(item.additionalTextEdits, snapshot, sourceDoc);
            mapped.additionalTextEdits = mappedAdditionalTextEdits;
        }

        return mapped;
    });

    return new vscode.CompletionList(items, list.isIncomplete);
}

function mapLocationsOrLinks(
    items: vscode.Location[] | vscode.LocationLink[],
    snapshot: Snapshot,
    sourceDoc: vscode.TextDocument,
    mirrorUri: vscode.Uri
): vscode.Location[] | vscode.LocationLink[] | undefined {
    if (items.length === 0) {
        return undefined;
    }

    if (items.every((item) => item instanceof vscode.Location)) {
        const mapped = (items as vscode.Location[])
            .map((loc) => {
                if (loc.uri.toString() !== mirrorUri.toString()) {
                    return loc;
                }

                const mappedRange = mapPythonRangeToLspa(loc.range, snapshot, sourceDoc);
                return mappedRange ? new vscode.Location(sourceDoc.uri, mappedRange) : undefined;
            })
            .filter((loc): loc is vscode.Location => Boolean(loc));

        return mapped.length > 0 ? mapped : undefined;
    }

    const mappedLinks = (items as vscode.LocationLink[])
        .map((link) => {
            let targetUri = link.targetUri;
            let targetRange = link.targetRange;
            let targetSelectionRange = link.targetSelectionRange;
            let originSelectionRange = link.originSelectionRange;

            if (link.targetUri.toString() === mirrorUri.toString()) {
                const mappedTargetRange = mapPythonRangeToLspa(link.targetRange, snapshot, sourceDoc);
                const mappedSelectionRange = link.targetSelectionRange
                    ? mapPythonRangeToLspa(link.targetSelectionRange, snapshot, sourceDoc)
                    : mappedTargetRange;

                if (!mappedTargetRange || !mappedSelectionRange) {
                    return undefined;
                }

                targetUri = sourceDoc.uri;
                targetRange = mappedTargetRange;
                targetSelectionRange = mappedSelectionRange;
            }

            if (originSelectionRange) {
                originSelectionRange = mapPythonRangeToLspa(originSelectionRange, snapshot, sourceDoc) ?? originSelectionRange;
            }

            return {
                originSelectionRange,
                targetUri,
                targetRange,
                targetSelectionRange
            } as vscode.LocationLink;
        })
        .filter((link): link is vscode.LocationLink => Boolean(link));

    return mappedLinks.length > 0 ? mappedLinks : undefined;
}

function mapSemanticTokens(
    semanticTokens: vscode.SemanticTokens,
    providerLegend: vscode.SemanticTokensLegend,
    snapshot: Snapshot,
    sourceDoc: vscode.TextDocument
): vscode.SemanticTokens {
    const builder = new vscode.SemanticTokensBuilder(LSPA_SEMANTIC_LEGEND);
    const data = semanticTokens.data;

    let line = 0;
    let character = 0;

    for (let index = 0; index < data.length; index += 5) {
        const deltaLine = data[index];
        const deltaStart = data[index + 1];
        const length = data[index + 2];
        const tokenType = data[index + 3];
        const tokenModifiers = data[index + 4];

        line += deltaLine;
        character = deltaLine === 0 ? character + deltaStart : deltaStart;

        if (tokenType >= providerLegend.tokenTypes.length || length <= 0) {
            continue;
        }

        const tokenTypeName = providerLegend.tokenTypes[tokenType];
        const mappedTokenType = LSPA_SEMANTIC_TOKEN_TYPES.indexOf(tokenTypeName as (typeof LSPA_SEMANTIC_TOKEN_TYPES)[number]);
        if (mappedTokenType < 0) {
            continue;
        }

        const mappedTokenModifiers = providerLegend.tokenModifiers.reduce((bits, modifierName, modifierIndex) => {
            if ((tokenModifiers & (1 << modifierIndex)) === 0) {
                return bits;
            }

            const mappedModifierIndex = LSPA_SEMANTIC_TOKEN_MODIFIERS.indexOf(
                modifierName as (typeof LSPA_SEMANTIC_TOKEN_MODIFIERS)[number]
            );
            if (mappedModifierIndex < 0) {
                return bits;
            }

            return bits | (1 << mappedModifierIndex);
        }, 0);

        const sourceRange = mapPythonRangeToLspa(
            new vscode.Range(line, character, line, character + length),
            snapshot,
            sourceDoc
        );

        if (!sourceRange || sourceRange.start.line !== sourceRange.end.line) {
            continue;
        }

        const mappedLength = sourceRange.end.character - sourceRange.start.character;
        if (mappedLength <= 0) {
            continue;
        }

        builder.push(
            sourceRange.start.line,
            sourceRange.start.character,
            mappedLength,
            mappedTokenType,
            mappedTokenModifiers
        );
    }

    return builder.build();
}

function mapWorkspaceEditFromMirror(
    edit: vscode.WorkspaceEdit,
    snapshot: Snapshot,
    sourceDoc: vscode.TextDocument,
    mirrorUri: vscode.Uri
): vscode.WorkspaceEdit {
    const mappedEdit = new vscode.WorkspaceEdit();

    for (const [uri, textEdits] of edit.entries()) {
        if (uri.toString() !== mirrorUri.toString()) {
            mappedEdit.set(uri, textEdits);
            continue;
        }

        const mappedTextEdits = mapTextEditsFromPython(textEdits, snapshot, sourceDoc) ?? [];
        mappedEdit.set(sourceDoc.uri, mappedTextEdits);
    }

    return mappedEdit;
}

function mapPrepareRenameResultFromMirror(
    result: vscode.Range | { range: vscode.Range; placeholder: string },
    snapshot: Snapshot,
    sourceDoc: vscode.TextDocument
): vscode.Range | { range: vscode.Range; placeholder: string } | undefined {
    if (result instanceof vscode.Range) {
        return mapPythonRangeToLspa(result, snapshot, sourceDoc);
    }

    const mappedRange = mapPythonRangeToLspa(result.range, snapshot, sourceDoc);
    return mappedRange ? { range: mappedRange, placeholder: result.placeholder } : undefined;
}

export function registerLspaPythonFeatures(context: vscode.ExtensionContext): void {
    const virtualProvider = new LSPAVirtualPythonProvider();
    const diagnosticsCollection = vscode.languages.createDiagnosticCollection('lspa-python');

    const fallbackMirrorDir = vscode.Uri.file(path.join(context.globalStorageUri.fsPath, 'python-mirror'));
    const mirrorBySource = new Map<string, vscode.Uri>();
    const sourceByMirror = new Map<string, vscode.Uri>();
    const semanticLegendByMirror = new Map<string, vscode.SemanticTokensLegend>();

    const getMirrorBaseDir = (sourceUri: vscode.Uri): vscode.Uri => {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(sourceUri);
        if (workspaceFolder) {
            // Keep mirror files inside the same workspace to ensure Python uses the active interpreter/environment.
            return vscode.Uri.joinPath(workspaceFolder.uri, '.vscode');
        }
        return fallbackMirrorDir;
    };

    const getMirrorUri = (sourceUri: vscode.Uri): vscode.Uri => {
        const sourceKey = sourceUri.toString();
        const existing = mirrorBySource.get(sourceKey);
        if (existing) {
            return existing;
        }

        const hash = createHash('sha1').update(sourceKey).digest('hex').slice(0, 16);
        const filename = `${hash}.py`;
        const mirrorDir = getMirrorBaseDir(sourceUri);
        const mirrorUri = vscode.Uri.joinPath(mirrorDir, filename);

        mirrorBySource.set(sourceKey, mirrorUri);
        sourceByMirror.set(mirrorUri.toString(), sourceUri);
        return mirrorUri;
    };

    const ensureMirrorPythonDoc = async (sourceDoc: vscode.TextDocument): Promise<PreparedMirror | undefined> => {
        const snapshot = virtualProvider.ensureSnapshot(sourceDoc);
        if (!snapshot) {
            diagnosticsCollection.delete(sourceDoc.uri);
            return undefined;
        }

        const mirrorUri = getMirrorUri(sourceDoc.uri);
        const mirrorDir = vscode.Uri.file(path.dirname(mirrorUri.fsPath));

        try {
            await vscode.workspace.fs.createDirectory(mirrorDir);
            await vscode.workspace.fs.writeFile(mirrorUri, Buffer.from(snapshot.content, 'utf8'));
            const mirrorDoc = await vscode.workspace.openTextDocument(mirrorUri);
            return { snapshot, mirrorUri: mirrorDoc.uri };
        } catch {
            return undefined;
        }
    };

    const withPreparedPythonPosition = async <T>(
        document: vscode.TextDocument,
        position: vscode.Position,
        action: (prepared: PreparedMirror, pythonPosition: vscode.Position) => Promise<T> | T
    ): Promise<T | undefined> => {
        const prepared = await ensureMirrorPythonDoc(document);
        if (!prepared || !isInPythonBlock(document, position, prepared.snapshot)) {
            return undefined;
        }

        const pythonPosition = mapLspaPositionToPython(document, position, prepared.snapshot);
        if (!pythonPosition) {
            return undefined;
        }

        return action(prepared, pythonPosition);
    };

    const withPreparedPythonDocument = async <T>(
        document: vscode.TextDocument,
        action: (prepared: PreparedMirror) => Promise<T> | T
    ): Promise<T | undefined> => {
        const prepared = await ensureMirrorPythonDoc(document);
        if (!prepared) {
            return undefined;
        }

        return action(prepared);
    };

    const getPythonSemanticLegend = async (mirrorUri: vscode.Uri): Promise<vscode.SemanticTokensLegend> => {
        const key = mirrorUri.toString();
        const cached = semanticLegendByMirror.get(key);
        if (cached) {
            return cached;
        }

        try {
            const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend | undefined>(
                'vscode.provideDocumentSemanticTokensLegend',
                mirrorUri
            );
            if (legend) {
                semanticLegendByMirror.set(key, legend);
                return legend;
            }
        } catch {
            // Ignore and fallback below.
        }

        semanticLegendByMirror.set(key, LSPA_SEMANTIC_LEGEND);
        return LSPA_SEMANTIC_LEGEND;
    };

    const syncDiagnosticsForSource = async (sourceDoc: vscode.TextDocument): Promise<void> => {
        const prepared = await ensureMirrorPythonDoc(sourceDoc);
        if (!prepared) {
            return;
        }

        const mirrorDiagnostics = vscode.languages.getDiagnostics(prepared.mirrorUri);
        diagnosticsCollection.set(sourceDoc.uri, mapDiagnostics(mirrorDiagnostics, prepared.snapshot, sourceDoc));
    };

    context.subscriptions.push(
        diagnosticsCollection,
        vscode.workspace.registerTextDocumentContentProvider(LSPA_PYTHON_SCHEME, virtualProvider),

        vscode.languages.registerHoverProvider(LSPA_SELECTOR, {
            provideHover: (document, position) =>
                withPreparedPythonPosition(document, position, async (prepared, pythonPosition) => {
                    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
                        'vscode.executeHoverProvider',
                        prepared.mirrorUri,
                        pythonPosition
                    );

                    if (!hovers?.length) {
                        return undefined;
                    }

                    return mapHover(hovers[0], prepared.snapshot, document);
                })
        }),

        vscode.languages.registerDefinitionProvider(LSPA_SELECTOR, {
            provideDefinition: (document, position) =>
                withPreparedPythonPosition(document, position, async (prepared, pythonPosition) => {
                    const defs = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[] | undefined>(
                        'vscode.executeDefinitionProvider',
                        prepared.mirrorUri,
                        pythonPosition
                    );

                    if (!defs?.length) {
                        return undefined;
                    }

                    return mapLocationsOrLinks(defs, prepared.snapshot, document, prepared.mirrorUri);
                })
        }),

        vscode.languages.registerReferenceProvider(LSPA_SELECTOR, {
            provideReferences: (document, position, contextRef) =>
                withPreparedPythonPosition(document, position, async (prepared, pythonPosition) => {
                    const refs = await vscode.commands.executeCommand<vscode.Location[]>(
                        'vscode.executeReferenceProvider',
                        prepared.mirrorUri,
                        pythonPosition,
                        contextRef.includeDeclaration
                    );

                    if (!refs?.length) {
                        return [];
                    }

                    return refs
                        .map((loc) => {
                            if (loc.uri.toString() !== prepared.mirrorUri.toString()) {
                                return loc;
                            }

                            const mappedRange = mapPythonRangeToLspa(loc.range, prepared.snapshot, document);
                            return mappedRange ? new vscode.Location(document.uri, mappedRange) : undefined;
                        })
                        .filter((loc): loc is vscode.Location => Boolean(loc));
                })
        }),

        vscode.languages.registerCompletionItemProvider(
            LSPA_SELECTOR,
            {
                provideCompletionItems: (document, position, _token, completionContext) =>
                    withPreparedPythonPosition(document, position, async (prepared, pythonPosition) => {
                        const completion = await vscode.commands.executeCommand<vscode.CompletionList | undefined>(
                            'vscode.executeCompletionItemProvider',
                            prepared.mirrorUri,
                            pythonPosition,
                            completionContext.triggerCharacter,
                            500
                        );

                        if (!completion) {
                            return undefined;
                        }

                        return mapCompletionList(completion, prepared.snapshot, document);
                    })
            },
            ...PYTHON_COMPLETION_TRIGGERS
        ),

        vscode.languages.registerRenameProvider(LSPA_SELECTOR, {
            prepareRename: (document, position) =>
                withPreparedPythonPosition(document, position, async (prepared, pythonPosition) => {
                    const result = await vscode.commands.executeCommand<
                        vscode.Range | { range: vscode.Range; placeholder: string } | undefined
                    >(
                        'vscode.prepareRename',
                        prepared.mirrorUri,
                        pythonPosition
                    );

                    if (!result) {
                        return undefined;
                    }

                    return mapPrepareRenameResultFromMirror(result, prepared.snapshot, document);
                }),

            provideRenameEdits: (document, position, newName) =>
                withPreparedPythonPosition(document, position, async (prepared, pythonPosition) => {
                    const edits = await vscode.commands.executeCommand<vscode.WorkspaceEdit | undefined>(
                        'vscode.executeDocumentRenameProvider',
                        prepared.mirrorUri,
                        pythonPosition,
                        newName
                    );

                    if (!edits) {
                        return undefined;
                    }

                    return mapWorkspaceEditFromMirror(edits, prepared.snapshot, document, prepared.mirrorUri);
                })
        }),

        vscode.languages.registerDocumentSemanticTokensProvider(
            LSPA_SELECTOR,
            {
                provideDocumentSemanticTokens: (document) =>
                    withPreparedPythonDocument(document, async (prepared) => {
                        const semanticTokens = await vscode.commands.executeCommand<vscode.SemanticTokens | undefined>(
                            'vscode.provideDocumentSemanticTokens',
                            prepared.mirrorUri
                        );

                        if (!semanticTokens) {
                            return new vscode.SemanticTokens(new Uint32Array());
                        }

                        const providerLegend = await getPythonSemanticLegend(prepared.mirrorUri);
                        return mapSemanticTokens(semanticTokens, providerLegend, prepared.snapshot, document);
                    }) ?? new vscode.SemanticTokens(new Uint32Array())
            },
            LSPA_SEMANTIC_LEGEND
        ),

        vscode.workspace.onDidOpenTextDocument((document) => {
            if (document.languageId === 'lspa') {
                void syncDiagnosticsForSource(document);
            }
        }),

        vscode.workspace.onDidChangeTextDocument((event) => {
            const { document } = event;
            if (document.languageId === 'lspa') {
                virtualProvider.refresh(document);
                void syncDiagnosticsForSource(document);
            }
        }),

        vscode.workspace.onDidCloseTextDocument((document) => {
            if (document.languageId !== 'lspa') {
                return;
            }

            virtualProvider.clearForSource(document.uri);
            const mirrorUri = mirrorBySource.get(document.uri.toString());
            if (mirrorUri) {
                mirrorBySource.delete(document.uri.toString());
                sourceByMirror.delete(mirrorUri.toString());
                semanticLegendByMirror.delete(mirrorUri.toString());
                void vscode.workspace.fs.delete(mirrorUri, { useTrash: false }).then(undefined, () => undefined);
            }

            diagnosticsCollection.delete(document.uri);
        }),

        vscode.languages.onDidChangeDiagnostics((event) => {
            for (const changedUri of event.uris) {
                if (changedUri.scheme !== 'file') {
                    continue;
                }

                const sourceUri = sourceByMirror.get(changedUri.toString());
                if (!sourceUri) {
                    continue;
                }

                const sourceDoc = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === sourceUri.toString());
                if (!sourceDoc || sourceDoc.languageId !== 'lspa') {
                    continue;
                }

                void syncDiagnosticsForSource(sourceDoc);
            }
        })
    );

    for (const doc of vscode.workspace.textDocuments) {
        if (doc.languageId === 'lspa') {
            virtualProvider.refresh(doc);
            void syncDiagnosticsForSource(doc);
        }
    }
}
