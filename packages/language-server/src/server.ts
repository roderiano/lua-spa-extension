import {
    CodeAction,
    CodeActionKind,
    CompletionItem,
    CompletionItemKind,
    CompletionParams,
    createConnection,
    Definition,
    Diagnostic,
    DiagnosticSeverity,
    DidChangeConfigurationNotification,
    DocumentFormattingParams,
    DocumentSymbol,
    DocumentSymbolParams,
    FoldingRange,
    FoldingRangeKind,
    Hover,
    InitializeParams,
    InitializeResult,
    Location,
    Position,
    ProposedFeatures,
    Range,
    ReferenceParams,
    RenameParams,
    SemanticTokens,
    SemanticTokensBuilder,
    SemanticTokensParams,
    SymbolKind,
    TextDocuments,
    TextDocumentSyncKind,
    TextDocumentEdit,
    TextEdit,
    WorkspaceEdit
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { handleCodeActions } from './functions/codeActionsHandler';
import { handleCompletion } from './functions/completionHandler';
import { computeDiagnostics } from './functions/diagnostics';
import { formatLspaDocument } from './functions/format';
import { getGraph } from './functions/graph';
import {
    collectSymbolReferences,
    containsOffset,
    isOffsetInBlock,
    pushSemantic,
    toLspRange
} from './functions/symbols';
import { type ComponentCache, type CrossSemanticGraph, type GraphCache } from './functions/types';
import {
    collectWorkspaceComponents,
    extractWorkspaceRoots,
    relativeImportPath,
    resolveImportPath
} from './functions/workspace';

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let workspaceRoots: string[] = [];
let hasConfigurationCapability = false;
const graphCache: GraphCache = new Map<string, { version: number; graph: CrossSemanticGraph }>();
const componentCache: ComponentCache = new Map<string, { expiresAt: number; map: Map<string, string> }>();

const tokenTypes = ['class', 'property', 'method', 'function', 'keyword', 'variable'];
const tokenModifiers: string[] = [];

connection.onInitialize((params: InitializeParams): InitializeResult => {
    const capabilities = params.capabilities;
    hasConfigurationCapability = Boolean(capabilities.workspace?.configuration);
    workspaceRoots = extractWorkspaceRoots(params);

    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            completionProvider: {
                triggerCharacters: ['<', '@', '.', '"', "'", '/']
            },
            hoverProvider: true,
            definitionProvider: true,
            referencesProvider: true,
            renameProvider: {
                prepareProvider: true
            },
            documentFormattingProvider: true,
            documentSymbolProvider: true,
            foldingRangeProvider: true,
            codeActionProvider: true,
            semanticTokensProvider: {
                legend: {
                    tokenTypes,
                    tokenModifiers
                },
                full: true
            }
        }
    };

    return result;
});

connection.onInitialized(() => {
    if (hasConfigurationCapability) {
        connection.client.register(DidChangeConfigurationNotification.type, undefined);
    }
});

documents.onDidClose((event) => {
    graphCache.delete(event.document.uri);
    connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

documents.onDidChangeContent(async (event) => {
    await validateTextDocument(event.document);
});

connection.onCompletion(async (params: CompletionParams): Promise<CompletionItem[]> => {
    return handleCompletion(params, documents, graphCache, workspaceRoots, componentCache);
});

connection.onHover((params): Hover | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return null;
    }
    const graph = getGraph(document, graphCache);
    const offset = document.offsetAt(params.position);

    const createHover = (value: string): Hover => ({
        contents: {
            kind: 'markdown',
            value
        }
    });

    const stateEntry = graph.ast.state.find((entry) => containsOffset(entry.nameRange, offset));
    if (stateEntry) {
        return createHover(`**Reactive state**\n\n\`state.${stateEntry.name}: ${stateEntry.type}\``);
    }

    const propsEntry = graph.ast.props.find((entry) => containsOffset(entry.nameRange, offset));
    if (propsEntry) {
        return createHover(`**Component prop**\n\n\`props.${propsEntry.name}: ${propsEntry.type}\``);
    }

    const pyEntry = graph.ast.pyData.find((entry) => containsOffset(entry.nameRange, offset));
    if (pyEntry) {
        return createHover(`**Python data value**\n\n\`py.${pyEntry.name}: ${pyEntry.type}\``);
    }

    const method = graph.ast.methods.find((entry) => containsOffset(entry.range, offset));
    if (method && graph.python.frameworkMethodDocs.has(method.name)) {
        return createHover(`**${method.name}()**\n\n${graph.python.frameworkMethodDocs.get(method.name)}`);
    }

    const directive = graph.ast.directives.find((entry) => containsOffset(entry.range, offset));
    if (directive) {
        return createHover(`**${directive.name}**\n\nTemplate control-flow directive (.lspa).`);
    }

    const event = graph.ast.events.find((entry) => containsOffset(entry.range, offset));
    if (event) {
        return createHover(`**${event.name}**\n\nEvent bound to method \`${event.handler}\`.`);
    }

    const interpolation = graph.ast.interpolations.find((entry) => containsOffset(entry.expressionRange, offset));
    if (interpolation) {
        return createHover(`**Interpolation expression**\n\n\`${interpolation.expression}\``);
    }

    return null;
});

connection.onDefinition(async (params): Promise<Definition | null> => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return null;
    }
    const graph = getGraph(document, graphCache);
    const offset = document.offsetAt(params.position);

    for (const imp of graph.ast.imports) {
        // Allows clicking the import path
        if (imp.pathRange && containsOffset(imp.pathRange, offset) && imp.path) {
            const resolvedPath = resolveImportPath(document.uri, imp.path, workspaceRoots);
            if (resolvedPath) {
                return Location.create(URI.file(resolvedPath).toString(), Range.create(0, 0, 0, 0));
            }
        }
        // Allows clicking the imported component name to navigate to the file
        if (imp.nameRange && containsOffset(imp.nameRange, offset) && imp.path) {
            const resolvedPath = resolveImportPath(document.uri, imp.path, workspaceRoots);
            if (resolvedPath) {
                return Location.create(URI.file(resolvedPath).toString(), Range.create(0, 0, 0, 0));
            }
        }
    }

    for (const component of graph.ast.components) {
        if (!containsOffset(component.range, offset)) {
            continue;
        }
        const importedPath = graph.importMap.get(component.name);
        if (importedPath) {
            const resolvedPath = resolveImportPath(document.uri, importedPath, workspaceRoots);
            if (resolvedPath) {
                return Location.create(URI.file(resolvedPath).toString(), Range.create(0, 0, 0, 0));
            }
        }
        const catalog = await collectWorkspaceComponents(document.uri, workspaceRoots, componentCache);
        const uri = catalog.get(component.name);
        if (uri) {
            return Location.create(uri, Range.create(0, 0, 0, 0));
        }
    }

    const method = graph.ast.methods.find((entry) => containsOffset(entry.range, offset));
    if (method) {
        return Location.create(document.uri, toLspRange(document, method.range));
    }

    const stateEntry = graph.ast.state.find((entry) => containsOffset(entry.nameRange, offset));
    if (stateEntry) {
        return Location.create(document.uri, toLspRange(document, stateEntry.nameRange));
    }

    const propsEntry = graph.ast.props.find((entry) => containsOffset(entry.nameRange, offset));
    if (propsEntry) {
        return Location.create(document.uri, toLspRange(document, propsEntry.nameRange));
    }

    const pyEntry = graph.ast.pyData.find((entry) => containsOffset(entry.nameRange, offset));
    if (pyEntry) {
        return Location.create(document.uri, toLspRange(document, pyEntry.nameRange));
    }

    const classUse = graph.ast.templateClasses.find((entry) => containsOffset(entry.range, offset));
    if (classUse) {
        const cssDef = graph.css.cssClassMap.get(classUse.name);
        if (cssDef) {
            return Location.create(document.uri, toLspRange(document, cssDef.range));
        }
    }

    return null;
});

connection.onReferences((params: ReferenceParams): Location[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }
    const graph = getGraph(document, graphCache);
    const offset = document.offsetAt(params.position);
    const refs = collectSymbolReferences(graph, offset);
    return refs.map((range) => Location.create(document.uri, toLspRange(document, range)));
});

connection.onPrepareRename((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return null;
    }
    const graph = getGraph(document, graphCache);
    const offset = document.offsetAt(params.position);
    const refs = collectSymbolReferences(graph, offset);
    if (refs.length === 0) {
        return null;
    }
    return toLspRange(document, refs[0]);
});

connection.onRenameRequest((params: RenameParams): WorkspaceEdit | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return null;
    }
    const graph = getGraph(document, graphCache);
    const offset = document.offsetAt(params.position);
    const refs = collectSymbolReferences(graph, offset);
    if (refs.length === 0) {
        return null;
    }

    const edits: TextEdit[] = refs.map((range) => TextEdit.replace(toLspRange(document, range), params.newName));
    return {
        documentChanges: [
            TextDocumentEdit.create({ uri: document.uri, version: document.version }, edits)
        ]
    };
});

connection.onDocumentFormatting((params: DocumentFormattingParams): TextEdit[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }

    const original = document.getText();
    const formatted = formatLspaDocument(original);
    if (formatted === original) {
        return [];
    }

    const end = document.positionAt(original.length);
    const wholeRange = Range.create(0, 0, end.line, end.character);
    return [TextEdit.replace(wholeRange, formatted)];
});

connection.onDocumentSymbol((params: DocumentSymbolParams): DocumentSymbol[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }
    const graph = getGraph(document, graphCache);

    const symbols: DocumentSymbol[] = [];
    for (const imp of graph.ast.imports) {
        if (!imp.name || !imp.nameRange) {
            continue;
        }
        symbols.push(DocumentSymbol.create(imp.name, 'component import', SymbolKind.Module, toLspRange(document, imp.range), toLspRange(document, imp.nameRange)));
    }
    for (const method of graph.ast.methods) {
        symbols.push(DocumentSymbol.create(method.name, 'python method', SymbolKind.Function, toLspRange(document, method.range), toLspRange(document, method.range)));
    }
    for (const field of graph.ast.state) {
        symbols.push(DocumentSymbol.create(`state.${field.name}`, field.type, SymbolKind.Variable, toLspRange(document, field.range), toLspRange(document, field.nameRange)));
    }
    for (const field of graph.ast.props) {
        symbols.push(DocumentSymbol.create(`props.${field.name}`, field.type, SymbolKind.Property, toLspRange(document, field.range), toLspRange(document, field.nameRange)));
    }
    for (const field of graph.ast.pyData) {
        symbols.push(DocumentSymbol.create(`py.${field.name}`, field.type, SymbolKind.Variable, toLspRange(document, field.range), toLspRange(document, field.nameRange)));
    }
    return symbols;
});

connection.onFoldingRanges((params): FoldingRange[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }
    const graph = getGraph(document, graphCache);
    const ranges: FoldingRange[] = [];
    for (const block of [graph.ast.pythonBlock, graph.ast.templateBlock, graph.ast.styleBlock]) {
        if (!block) {
            continue;
        }
        const start = document.positionAt(block.range.start).line;
        const end = document.positionAt(block.range.end).line;
        if (end > start) {
            ranges.push(FoldingRange.create(start, end, undefined, undefined, FoldingRangeKind.Region));
        }
    }
    return ranges;
});

connection.onCodeAction(async (params): Promise<CodeAction[]> => {
    return handleCodeActions(params, documents, graphCache, workspaceRoots, componentCache);
});

connection.languages.semanticTokens.on((params: SemanticTokensParams): SemanticTokens => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return { data: [] };
    }
    const graph = getGraph(document, graphCache);
    const builder = new SemanticTokensBuilder();

    for (const component of graph.ast.components) {
        pushSemantic(builder, document, component.range, 'class', tokenTypes);
    }
    for (const field of graph.ast.state) {
        pushSemantic(builder, document, field.nameRange, 'property', tokenTypes);
    }
    for (const field of graph.ast.props) {
        pushSemantic(builder, document, field.nameRange, 'property', tokenTypes);
    }
    for (const field of graph.ast.pyData) {
        pushSemantic(builder, document, field.nameRange, 'variable', tokenTypes);
    }
    for (const method of graph.ast.methods) {
        pushSemantic(builder, document, method.range, 'method', tokenTypes);
    }
    for (const directive of graph.ast.directives) {
        pushSemantic(builder, document, directive.range, 'keyword', tokenTypes);
    }
    for (const event of graph.ast.events) {
        pushSemantic(builder, document, event.range, 'function', tokenTypes);
    }
    for (const interpolation of graph.ast.interpolations) {
        pushSemantic(builder, document, interpolation.expressionRange, 'variable', tokenTypes);
    }

    return builder.build();
});

async function validateTextDocument(document: TextDocument): Promise<void> {
    const diagnostics = computeDiagnostics(document, graphCache, workspaceRoots);
    connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

documents.listen(connection);
connection.listen();
