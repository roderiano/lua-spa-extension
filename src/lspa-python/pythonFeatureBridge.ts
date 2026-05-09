
import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { LSPAVirtualPythonProvider, LSPA_PYTHON_SCHEME } from './embeddedProvider';
import { isInPythonBlock, mapLspaPositionToPython, mapPythonRangeToLspa } from './mapper';

const LSPA_SELECTOR: vscode.DocumentSelector = [{ language: 'lspa', scheme: 'file' }];

function mapHover(hover: vscode.Hover, snapshot: ReturnType<LSPAVirtualPythonProvider['getSnapshotBySource']>, sourceDoc: vscode.TextDocument): vscode.Hover {
    if (!snapshot || !hover.range) {
        return hover;
    }

    const mappedRange = mapPythonRangeToLspa(hover.range, snapshot, sourceDoc);
    return mappedRange ? new vscode.Hover(hover.contents, mappedRange) : hover;
}

function mapDiagnostics(
    diagnostics: readonly vscode.Diagnostic[],
    snapshot: NonNullable<ReturnType<LSPAVirtualPythonProvider['getSnapshotBySource']>>,
    sourceDoc: vscode.TextDocument
): vscode.Diagnostic[] {
    const mapped: vscode.Diagnostic[] = [];

    for (const diagnostic of diagnostics) {
        const mappedRange = mapPythonRangeToLspa(diagnostic.range, snapshot, sourceDoc);
        if (!mappedRange) {
            continue;
        }

        const next = new vscode.Diagnostic(mappedRange, diagnostic.message, diagnostic.severity);
        next.code = diagnostic.code;
        next.source = diagnostic.source ?? 'python';
        next.tags = diagnostic.tags;
        next.relatedInformation = diagnostic.relatedInformation;
        mapped.push(next);
    }

    return mapped;
}

export function registerLspaPythonFeatures(context: vscode.ExtensionContext): void {
    console.log('[LSPA Python Bridge] Initializing...');
    const virtualProvider = new LSPAVirtualPythonProvider();
    const diagnosticsCollection = vscode.languages.createDiagnosticCollection('lspa-python');

    const mirrorDirPath = path.join(context.globalStorageUri.fsPath, 'python-mirror');
    const mirrorDir = vscode.Uri.file(mirrorDirPath);
    const mirrorBySource = new Map<string, vscode.Uri>();
    const sourceByMirror = new Map<string, vscode.Uri>();

    const getMirrorUri = (sourceUri: vscode.Uri): vscode.Uri => {
        const sourceKey = sourceUri.toString();
        const existing = mirrorBySource.get(sourceKey);
        if (existing) {
            return existing;
        }

        const hash = createHash('sha1').update(sourceKey).digest('hex').slice(0, 16);
        const filename = `${hash}.py`;
        const mirrorUri = vscode.Uri.file(path.join(mirrorDirPath, filename));
        mirrorBySource.set(sourceKey, mirrorUri);
        sourceByMirror.set(mirrorUri.toString(), sourceUri);
        return mirrorUri;
    };

    const ensureMirrorPythonDoc = async (sourceDoc: vscode.TextDocument) => {
        console.log('[LSPA Python Bridge] ensureMirrorPythonDoc for', sourceDoc.fileName);
        const snapshot = virtualProvider.ensureSnapshot(sourceDoc);
        if (!snapshot) {
            console.log('[LSPA Python Bridge] No snapshot for', sourceDoc.fileName);
            diagnosticsCollection.delete(sourceDoc.uri);
            return undefined;
        }

        const mirrorUri = getMirrorUri(sourceDoc.uri);
        console.log('[LSPA Python Bridge] Mirror URI:', mirrorUri.toString());

        try {
            await vscode.workspace.fs.createDirectory(mirrorDir);
            await vscode.workspace.fs.writeFile(mirrorUri, Buffer.from(snapshot.content, 'utf8'));
            console.log('[LSPA Python Bridge] Mirror file written');

            const mirrorDoc = await vscode.workspace.openTextDocument(mirrorUri);
            console.log('[LSPA Python Bridge] Mirror document opened');
            return { snapshot, mirrorUri: mirrorDoc.uri };
        } catch (error) {
            console.error('[LSPA Python Bridge] Error creating mirror:', error);
            return undefined;
        }
    };

    const syncDiagnosticsForSource = async (sourceDoc: vscode.TextDocument) => {
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
            async provideHover(document, position) {
                console.log('[LSPA Python Bridge] Hover requested at', position);
                const prepared = await ensureMirrorPythonDoc(document);
                if (!prepared || !isInPythonBlock(document, position, prepared.snapshot)) {
                    console.log('[LSPA Python Bridge] Not in python block');
                    return undefined;
                }

                const pythonPosition = mapLspaPositionToPython(document, position, prepared.snapshot);
                if (!pythonPosition) {
                    console.log('[LSPA Python Bridge] Could not map position');
                    return undefined;
                }

                console.log('[LSPA Python Bridge] Calling Python hover provider...');
                const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
                    'vscode.executeHoverProvider',
                    prepared.mirrorUri,
                    pythonPosition
                );

                if (!hovers || hovers.length === 0) {
                    console.log('[LSPA Python Bridge] No hovers from Python provider');
                    return undefined;
                }

                console.log('[LSPA Python Bridge] Got hover:', hovers[0]);
                return mapHover(hovers[0], prepared.snapshot, document);
            }
        }),

        vscode.languages.registerDefinitionProvider(LSPA_SELECTOR, {
            async provideDefinition(document, position) {
                const prepared = await ensureMirrorPythonDoc(document);
                if (!prepared || !isInPythonBlock(document, position, prepared.snapshot)) {
                    return undefined;
                }

                const pythonPosition = mapLspaPositionToPython(document, position, prepared.snapshot);
                if (!pythonPosition) {
                    return undefined;
                }

                const defs = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[] | undefined>(
                    'vscode.executeDefinitionProvider',
                    prepared.mirrorUri,
                    pythonPosition
                );

                if (!defs || defs.length === 0) {
                    return undefined;
                }

                if (defs.every((item) => item instanceof vscode.Location)) {
                    const mapped = (defs as vscode.Location[])
                        .map((loc) => {
                            if (loc.uri.toString() === prepared.mirrorUri.toString()) {
                                const mappedRange = mapPythonRangeToLspa(loc.range, prepared.snapshot, document);
                                return mappedRange ? new vscode.Location(document.uri, mappedRange) : undefined;
                            }
                            return loc;
                        })
                        .filter((loc): loc is vscode.Location => Boolean(loc));
                    return mapped.length > 0 ? mapped : undefined;
                }

                return defs as vscode.LocationLink[];
            }
        }),

        vscode.languages.registerReferenceProvider(LSPA_SELECTOR, {
            async provideReferences(document, position, contextRef) {
                const prepared = await ensureMirrorPythonDoc(document);
                if (!prepared || !isInPythonBlock(document, position, prepared.snapshot)) {
                    return undefined;
                }

                const pythonPosition = mapLspaPositionToPython(document, position, prepared.snapshot);
                if (!pythonPosition) {
                    return undefined;
                }

                const refs = await vscode.commands.executeCommand<vscode.Location[]>(
                    'vscode.executeReferenceProvider',
                    prepared.mirrorUri,
                    pythonPosition,
                    contextRef.includeDeclaration
                );

                if (!refs || refs.length === 0) {
                    return [];
                }

                return refs
                    .map((loc) => {
                        if (loc.uri.toString() === prepared.mirrorUri.toString()) {
                            const mappedRange = mapPythonRangeToLspa(loc.range, prepared.snapshot, document);
                            return mappedRange ? new vscode.Location(document.uri, mappedRange) : undefined;
                        }
                        return loc;
                    })
                    .filter((loc): loc is vscode.Location => Boolean(loc));
            }
        }),

        vscode.workspace.onDidOpenTextDocument((document) => {
            if (document.languageId !== 'lspa' || document.uri.scheme !== 'file') {
                return;
            }
            void syncDiagnosticsForSource(document);
        }),

        vscode.workspace.onDidChangeTextDocument((event) => {
            const { document } = event;
            if (document.languageId !== 'lspa' || document.uri.scheme !== 'file') {
                return;
            }
            virtualProvider.refresh(document);
            void syncDiagnosticsForSource(document);
        }),

        vscode.workspace.onDidCloseTextDocument((document) => {
            if (document.languageId !== 'lspa' || document.uri.scheme !== 'file') {
                return;
            }
            virtualProvider.clearForSource(document.uri);
            const mirrorUri = mirrorBySource.get(document.uri.toString());
            if (mirrorUri) {
                mirrorBySource.delete(document.uri.toString());
                sourceByMirror.delete(mirrorUri.toString());
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
        if (doc.languageId === 'lspa' && doc.uri.scheme === 'file') {
            virtualProvider.refresh(doc);
            void syncDiagnosticsForSource(doc);
        }
    }

    console.log('[LSPA Python Bridge] ✅ Initialization complete');
}
