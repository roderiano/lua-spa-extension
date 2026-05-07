import * as fs from 'fs';
import * as path from 'path';
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
import { analyzeCss } from '../../css-analyzer/src';
import { parseLspaDocument, type LspaAst, type OffsetRange } from '../../parser/src';
import { analyzePython } from '../../python-analyzer/src';
import { ALLOWED_DIRECTIVES, ALLOWED_EVENTS, analyzeTemplate } from '../../template-analyzer/src';

type CrossSemanticGraph = {
    ast: LspaAst;
    python: ReturnType<typeof analyzePython>;
    template: ReturnType<typeof analyzeTemplate>;
    css: ReturnType<typeof analyzeCss>;
    importMap: Map<string, string>;
};

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let workspaceRoots: string[] = [];
let hasConfigurationCapability = false;
const graphCache = new Map<string, { version: number; graph: CrossSemanticGraph }>();
const componentCache = new Map<string, { expiresAt: number; map: Map<string, string> }>();

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
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }

    const graph = getGraph(document);
    const offset = document.offsetAt(params.position);
    const linePrefix = document.getText(Range.create(Position.create(params.position.line, 0), params.position));
    const inTemplate = isOffsetInBlock(graph.ast.templateBlock, offset);

    if (/@click\s*=\s*['"][A-Za-z_\w-]*$/.test(linePrefix)) {
        return [...graph.python.methods.keys()].map((methodName) => ({
            label: methodName,
            kind: CompletionItemKind.Function,
            detail: 'Method in <python> setup scope'
        }));
    }

    if (inTemplate && /(?:\s|<)(i-|@)\w*$/.test(linePrefix)) {
        const directives = [...ALLOWED_DIRECTIVES].map<CompletionItem>((directive) => ({
            label: directive,
            kind: CompletionItemKind.Keyword,
            detail: 'LSPA directive'
        }));
        const events = [...ALLOWED_EVENTS].map<CompletionItem>((eventName) => ({
            label: eventName,
            kind: CompletionItemKind.Event,
            detail: 'LSPA event'
        }));
        return [...directives, ...events];
    }

    if (inTemplate && /\bclass\s*=\s*['"][^'"]*$/.test(linePrefix)) {
        const classSet = new Set<string>([
            ...graph.css.cssClassMap.keys(),
            ...graph.css.tailwindClasses
        ]);
        return [...classSet].map((className) => ({
            label: className,
            kind: CompletionItemKind.Color,
            detail: graph.css.cssClassMap.has(className) ? 'Class from <style>' : 'Tailwind utility class'
        }));
    }

    if (inTemplate && /\b(state|props|py)\.[A-Za-z_\w]*$/.test(linePrefix)) {
        const onState = /state\.[A-Za-z_\w]*$/.test(linePrefix);
        const onProps = /props\.[A-Za-z_\w]*$/.test(linePrefix);
        const source = onState ? graph.python.state : onProps ? graph.python.props : graph.python.pyData;
        return [...source.values()].map((entry) => ({
            label: entry.name,
            kind: CompletionItemKind.Field,
            detail: `${onState ? 'state' : onProps ? 'props' : 'py'} (${entry.type})`
        }));
    }

    if (/@import\s+[A-Za-z_\w-]*\s+from\s+['"][^'"]*$/.test(linePrefix)) {
        const files = listImportCandidates(document.uri);
        return files.map((item) => ({
            label: item,
            kind: CompletionItemKind.File,
            insertText: item
        }));
    }

    if (inTemplate && /<[A-Z][\w-]*$/.test(linePrefix)) {
        const knownComponents = await collectWorkspaceComponents(document.uri);
        const items: CompletionItem[] = [];
        for (const [name, componentUri] of knownComponents) {
            const imported = graph.importMap.has(name);
            const completion: CompletionItem = {
                label: name,
                kind: CompletionItemKind.Class,
                detail: imported ? 'Imported component' : 'Component (auto import available)'
            };
            if (!imported) {
                completion.additionalTextEdits = [
                    TextEdit.insert(Position.create(0, 0), `@import ${name} from '${relativeImportPath(document.uri, componentUri)}'\n`)
                ];
            }
            items.push(completion);
        }
        return items;
    }

    return [];
});

connection.onHover((params): Hover | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return null;
    }
    const graph = getGraph(document);
    const offset = document.offsetAt(params.position);

    const stateEntry = graph.ast.state.find((entry) => containsOffset(entry.nameRange, offset));
    if (stateEntry) {
        return {
            contents: {
                kind: 'markdown',
                value: `state.${stateEntry.name}: ${stateEntry.type}\n\nreactive state`
            }
        };
    }

    const propsEntry = graph.ast.props.find((entry) => containsOffset(entry.nameRange, offset));
    if (propsEntry) {
        return {
            contents: {
                kind: 'markdown',
                value: `props.${propsEntry.name}: ${propsEntry.type}\n\ncomponent prop`
            }
        };
    }

    const pyEntry = graph.ast.pyData.find((entry) => containsOffset(entry.nameRange, offset));
    if (pyEntry) {
        return {
            contents: {
                kind: 'markdown',
                value: `py.${pyEntry.name}: ${pyEntry.type}\n\nvalue exposed from data object`
            }
        };
    }

    const method = graph.ast.methods.find((entry) => containsOffset(entry.range, offset));
    if (method && graph.python.frameworkMethodDocs.has(method.name)) {
        return {
            contents: {
                kind: 'markdown',
                value: `**${method.name}()**\n\n${graph.python.frameworkMethodDocs.get(method.name)}`
            }
        };
    }

    const directive = graph.ast.directives.find((entry) => containsOffset(entry.range, offset));
    if (directive) {
        return {
            contents: {
                kind: 'markdown',
                value: `**${directive.name}** directive for .lspa template control flow`
            }
        };
    }

    const event = graph.ast.events.find((entry) => containsOffset(entry.range, offset));
    if (event) {
        return {
            contents: {
                kind: 'markdown',
                value: `**${event.name}** event bound to method \`${event.handler}\``
            }
        };
    }

    const interpolation = graph.ast.interpolations.find((entry) => containsOffset(entry.expressionRange, offset));
    if (interpolation) {
        return {
            contents: {
                kind: 'markdown',
                value: `Interpolation expression: \`${interpolation.expression}\``
            }
        };
    }

    return null;
});

connection.onDefinition(async (params): Promise<Definition | null> => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return null;
    }
    const graph = getGraph(document);
    const offset = document.offsetAt(params.position);

    for (const imp of graph.ast.imports) {
        // Allows clicking the import path
        if (imp.pathRange && containsOffset(imp.pathRange, offset) && imp.path) {
            const resolvedPath = resolveImportPath(document.uri, imp.path);
            if (resolvedPath) {
                return Location.create(URI.file(resolvedPath).toString(), Range.create(0, 0, 0, 0));
            }
        }
        // Allows clicking the imported component name to navigate to the file
        if (imp.nameRange && containsOffset(imp.nameRange, offset) && imp.path) {
            const resolvedPath = resolveImportPath(document.uri, imp.path);
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
            const resolvedPath = resolveImportPath(document.uri, importedPath);
            if (resolvedPath) {
                return Location.create(URI.file(resolvedPath).toString(), Range.create(0, 0, 0, 0));
            }
        }
        const catalog = await collectWorkspaceComponents(document.uri);
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
    const graph = getGraph(document);
    const offset = document.offsetAt(params.position);
    const refs = collectSymbolReferences(graph, offset);
    return refs.map((range) => Location.create(document.uri, toLspRange(document, range)));
});

connection.onPrepareRename((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return null;
    }
    const graph = getGraph(document);
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
    const graph = getGraph(document);
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

    const formatted = formatLspaDocument(document.getText());
    if (formatted === document.getText()) {
        return [];
    }

    const lastLine = document.lineCount - 1;
    const wholeRange = Range.create(0, 0, lastLine, document.getText(Range.create(lastLine, 0, lastLine, Number.MAX_SAFE_INTEGER)).length);
    return [TextEdit.replace(wholeRange, formatted)];
});

connection.onDocumentSymbol((params: DocumentSymbolParams): DocumentSymbol[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }
    const graph = getGraph(document);

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
    const graph = getGraph(document);
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
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }
    const graph = getGraph(document);
    const actions: CodeAction[] = [];

    for (const diagnostic of params.context.diagnostics) {
        if (diagnostic.code === 'lspa.missingImport') {
            const componentName = document.getText(diagnostic.range);
            const catalog = await collectWorkspaceComponents(document.uri);
            const fileUri = catalog.get(componentName);
            const importPath = fileUri ? relativeImportPath(document.uri, fileUri) : `./${componentName}/${componentName}.lspa`;
            actions.push({
                title: `Import ${componentName}`,
                kind: CodeActionKind.QuickFix,
                diagnostics: [diagnostic],
                edit: {
                    documentChanges: [
                        TextDocumentEdit.create({ uri: document.uri, version: document.version }, [
                            TextEdit.insert(Position.create(0, 0), `@import ${componentName} from '${importPath}'\n`)
                        ])
                    ]
                }
            });
        }

        if (diagnostic.code === 'lspa.unusedImport') {
            actions.push({
                title: 'Remove unused import',
                kind: CodeActionKind.QuickFix,
                diagnostics: [diagnostic],
                edit: {
                    documentChanges: [
                        TextDocumentEdit.create({ uri: document.uri, version: document.version }, [
                            TextEdit.del(fullLineRange(document, diagnostic.range.start.line))
                        ])
                    ]
                }
            });
        }

        if (diagnostic.code === 'lspa.missingMethod') {
            const methodName = document.getText(diagnostic.range);
            const pythonBlock = graph.ast.pythonBlock;
            if (pythonBlock) {
                actions.push({
                    title: `Create method ${methodName}`,
                    kind: CodeActionKind.QuickFix,
                    diagnostics: [diagnostic],
                    edit: {
                        documentChanges: [
                            TextDocumentEdit.create({ uri: document.uri, version: document.version }, [
                                TextEdit.insert(document.positionAt(pythonBlock.contentRange.end), `\n\n  def ${methodName}(self):\n    pass\n`)
                            ])
                        ]
                    }
                });
            }
        }

        if (diagnostic.code === 'lspa.missingState') {
            const missing = extractMissingMember(document.getText(diagnostic.range), 'state');
            const pythonBlock = graph.ast.pythonBlock;
            if (missing && pythonBlock) {
                actions.push({
                    title: `Create state['${missing}']`,
                    kind: CodeActionKind.QuickFix,
                    diagnostics: [diagnostic],
                    edit: {
                        documentChanges: [
                            TextDocumentEdit.create({ uri: document.uri, version: document.version }, [
                                TextEdit.insert(document.positionAt(pythonBlock.contentRange.end), `\n    state['${missing}'] = None\n`)
                            ])
                        ]
                    }
                });
            }
        }
    }

    return actions;
});

connection.languages.semanticTokens.on((params: SemanticTokensParams): SemanticTokens => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return { data: [] };
    }
    const graph = getGraph(document);
    const builder = new SemanticTokensBuilder();

    for (const component of graph.ast.components) {
        pushSemantic(builder, document, component.range, 'class');
    }
    for (const field of graph.ast.state) {
        pushSemantic(builder, document, field.nameRange, 'property');
    }
    for (const field of graph.ast.props) {
        pushSemantic(builder, document, field.nameRange, 'property');
    }
    for (const field of graph.ast.pyData) {
        pushSemantic(builder, document, field.nameRange, 'variable');
    }
    for (const method of graph.ast.methods) {
        pushSemantic(builder, document, method.range, 'method');
    }
    for (const directive of graph.ast.directives) {
        pushSemantic(builder, document, directive.range, 'keyword');
    }
    for (const event of graph.ast.events) {
        pushSemantic(builder, document, event.range, 'function');
    }
    for (const interpolation of graph.ast.interpolations) {
        pushSemantic(builder, document, interpolation.expressionRange, 'variable');
    }

    return builder.build();
});

async function validateTextDocument(document: TextDocument): Promise<void> {
    const graph = getGraph(document);
    const diagnostics: Diagnostic[] = [];

    for (const imp of graph.ast.imports) {
        if (!imp.path || !imp.pathRange) {
            continue;
        }
        if (!resolveImportPath(document.uri, imp.path)) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: toLspRange(document, imp.pathRange),
                message: `Import path not found: ${imp.path}`,
                code: 'lspa.invalidImport',
                source: 'lspa'
            });
        }
    }

    for (const imp of graph.ast.imports) {
        if (!imp.name || !imp.nameRange) {
            continue;
        }
        if (!graph.template.components.has(imp.name)) {
            diagnostics.push({
                severity: DiagnosticSeverity.Warning,
                range: toLspRange(document, imp.nameRange),
                message: `Unused import: ${imp.name}`,
                code: 'lspa.unusedImport',
                source: 'lspa'
            });
        }
    }

    for (const component of graph.ast.components) {
        if (graph.importMap.has(component.name)) {
            continue;
        }
        diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: toLspRange(document, component.range),
            message: `Component ${component.name} is not imported`,
            code: 'lspa.missingImport',
            source: 'lspa'
        });
    }

    for (const directive of graph.ast.directives) {
        if (!ALLOWED_DIRECTIVES.has(directive.name)) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: toLspRange(document, directive.range),
                message: `Directive ${directive.name} is not supported in .lspa`,
                code: 'lspa.invalidDirective',
                source: 'lspa'
            });
            continue;
        }

        if ((directive.name === 'i-if' || directive.name === 'i-elif' || directive.name === 'i-model' || directive.name === 'i-for') && !directive.valueRange) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: toLspRange(document, directive.range),
                message: `${directive.name} requires an expression`,
                code: 'lspa.invalidDirectiveSyntax',
                source: 'lspa'
            });
        }

        if (directive.name === 'i-for' && directive.value && !/^\s*[A-Za-z_][\w]*\s+in\s+.+$/.test(directive.value)) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: toLspRange(document, directive.valueRange ?? directive.range),
                message: 'i-for expression must match "item in items" syntax',
                code: 'lspa.invalidForExpression',
                source: 'lspa'
            });
        }
    }

    for (const event of graph.ast.events) {
        if (!ALLOWED_EVENTS.has(event.name)) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: toLspRange(document, event.range),
                message: `Event ${event.name} is not supported in .lspa`,
                code: 'lspa.invalidEvent',
                source: 'lspa'
            });
            continue;
        }

        if (!graph.python.methods.has(event.handler)) {
            diagnostics.push({
                severity: DiagnosticSeverity.Warning,
                range: toLspRange(document, event.handlerRange),
                message: `Method ${event.handler} not found in <python> block`,
                code: 'lspa.missingMethod',
                source: 'lspa'
            });
        }
    }

    for (const interpolation of graph.ast.interpolations) {
        const stateMatch = interpolation.expression.match(/state\.([A-Za-z_][\w]*)/);
        if (stateMatch?.[1] && !graph.python.state.has(stateMatch[1])) {
            diagnostics.push({
                severity: DiagnosticSeverity.Warning,
                range: toLspRange(document, interpolation.range),
                message: `state.${stateMatch[1]} is not declared`,
                code: 'lspa.missingState',
                source: 'lspa'
            });
        }

        const propsMatch = interpolation.expression.match(/props\.([A-Za-z_][\w]*)/);
        if (propsMatch?.[1] && !graph.python.props.has(propsMatch[1])) {
            diagnostics.push({
                severity: DiagnosticSeverity.Warning,
                range: toLspRange(document, interpolation.range),
                message: `props.${propsMatch[1]} is not declared`,
                code: 'lspa.missingProp',
                source: 'lspa'
            });
        }

        const pyMatch = interpolation.expression.match(/py\.([A-Za-z_][\w]*)/);
        if (pyMatch?.[1] && !graph.python.pyData.has(pyMatch[1])) {
            diagnostics.push({
                severity: DiagnosticSeverity.Warning,
                range: toLspRange(document, interpolation.range),
                message: `py.${pyMatch[1]} is not declared`,
                code: 'lspa.missingPy',
                source: 'lspa'
            });
        }
    }

    for (const classUse of graph.ast.templateClasses) {
        if (graph.css.cssClassMap.has(classUse.name) || classUse.name.includes('-')) {
            continue;
        }
        diagnostics.push({
            severity: DiagnosticSeverity.Information,
            range: toLspRange(document, classUse.range),
            message: `Class "${classUse.name}" has no declaration in <style>`,
            code: 'lspa.unknownClass',
            source: 'lspa'
        });
    }

    connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

function getGraph(document: TextDocument): CrossSemanticGraph {
    const cached = graphCache.get(document.uri);
    if (cached && cached.version === document.version) {
        return cached.graph;
    }

    const ast = parseLspaDocument(document.getText());
    const python = analyzePython(ast);
    const template = analyzeTemplate(ast);
    const css = analyzeCss(ast);
    const importMap = new Map<string, string>();
    for (const imp of ast.imports) {
        if (imp.name && imp.path) {
            importMap.set(imp.name, imp.path);
        }
    }

    const graph: CrossSemanticGraph = { ast, python, template, css, importMap };
    graphCache.set(document.uri, { version: document.version, graph });
    return graph;
}

function extractWorkspaceRoots(params: InitializeParams): string[] {
    const roots = new Set<string>();
    if (params.workspaceFolders?.length) {
        for (const folder of params.workspaceFolders) {
            if (folder.uri.startsWith('file://')) {
                roots.add(URI.parse(folder.uri).fsPath);
            }
        }
    }
    if (params.rootUri?.startsWith('file://')) {
        roots.add(URI.parse(params.rootUri).fsPath);
    }
    if (params.rootPath) {
        roots.add(params.rootPath);
    }
    return [...roots];
}

function toLspRange(document: TextDocument, range: OffsetRange): Range {
    return Range.create(document.positionAt(range.start), document.positionAt(range.end));
}

function containsOffset(range: OffsetRange, offset: number): boolean {
    return offset >= range.start && offset <= range.end;
}

function isOffsetInBlock(block: LspaAst['templateBlock'], offset: number): boolean {
    if (!block) {
        return false;
    }
    return offset >= block.contentRange.start && offset <= block.contentRange.end;
}

function resolveImportPath(documentUri: string, importPath: string): string | undefined {
    const docPath = URI.parse(documentUri).fsPath;
    const baseDir = path.dirname(docPath);
    const normalized = importPath.replace(/[?#].*$/, '').trim();

    const candidateRoots = normalized.startsWith('.') ? [baseDir] : [baseDir, ...workspaceRoots];
    for (const root of candidateRoots) {
        const absolute = path.resolve(root, normalized);
        for (const candidate of expandCandidates(absolute)) {
            if (isExistingFile(candidate)) {
                return candidate;
            }
        }
    }

    return undefined;
}

function expandCandidates(filePath: string): string[] {
    if (path.extname(filePath)) {
        return [filePath];
    }
    return [
        `${filePath}.lspa`,
        `${filePath}.py`,
        path.join(filePath, 'index.lspa'),
        path.join(filePath, 'index.py')
    ];
}

function isExistingFile(filePath: string): boolean {
    try {
        return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    } catch {
        return false;
    }
}

function relativeImportPath(fromUri: string, toUri: string): string {
    const fromPath = URI.parse(fromUri).fsPath;
    const toPath = URI.parse(toUri).fsPath;
    const rel = path.relative(path.dirname(fromPath), toPath).replace(/\\/g, '/');
    return rel.startsWith('.') ? rel : `./${rel}`;
}

function listImportCandidates(documentUri: string): string[] {
    const docPath = URI.parse(documentUri).fsPath;
    const baseDir = path.dirname(docPath);
    const candidates = new Map<string, number>(); // path -> distance

    // Collects all candidates and computes path distance
    for (const root of workspaceRoots) {
        for (const abs of findFilesByExtensions(root, ['.lspa', '.py'])) {
            if (abs === docPath) {
                continue;
            }

            const rel = path.relative(baseDir, abs).replace(/\\/g, '/');
            const importPath = rel.startsWith('.') ? rel : `./${rel}`;

            // Computes distance as the difference in directory depth
            const baseDepth = baseDir.split(path.sep).length;
            const targetDepth = path.dirname(abs).split(path.sep).length;
            const distance = Math.abs(baseDepth - targetDepth);

            if (!candidates.has(importPath) || candidates.get(importPath)! > distance) {
                candidates.set(importPath, distance);
            }
        }
    }

    // Sorts by distance (closest first)
    return [...candidates.entries()]
        .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
        .map(([path]) => path);
}

async function collectWorkspaceComponents(documentUri: string): Promise<Map<string, string>> {
    const rootKey = workspaceRoots.join('|');
    const now = Date.now();
    const cached = componentCache.get(rootKey);
    if (cached && cached.expiresAt > now) {
        return cached.map;
    }

    const map = new Map<string, string>();
    for (const root of workspaceRoots) {
        for (const filePath of findFilesByExtensions(root, ['.lspa'])) {
            if (filePath === URI.parse(documentUri).fsPath) {
                continue;
            }
            const parsed = path.parse(filePath);
            map.set(parsed.name, URI.file(filePath).toString());
        }
    }

    componentCache.set(rootKey, { expiresAt: now + 5000, map });
    return map;
}

function findFilesByExtensions(root: string, extensions: string[]): string[] {
    const files: string[] = [];
    if (!fs.existsSync(root)) {
        return files;
    }

    const ignore = new Set(['node_modules', '.git', 'out', 'dist']);
    const queue = [root];

    while (queue.length > 0) {
        const current = queue.pop();
        if (!current) {
            continue;
        }

        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (!ignore.has(entry.name)) {
                    queue.push(fullPath);
                }
                continue;
            }
            if (extensions.includes(path.extname(entry.name))) {
                files.push(fullPath);
            }
        }
    }

    return files;
}

function collectSymbolReferences(graph: CrossSemanticGraph, offset: number): OffsetRange[] {
    for (const method of graph.ast.methods) {
        if (containsOffset(method.range, offset)) {
            const refs: OffsetRange[] = [method.range];
            // Adds references in @click handlers
            for (const event of graph.ast.events) {
                if (event.handler === method.name) {
                    refs.push(event.handlerRange);
                }
            }
            // Adds references in interpolations (self.method())
            for (const interp of graph.ast.interpolations) {
                if (interp.expression.includes(`self.${method.name}`) || interp.expression.includes(`${method.name}(`)) {
                    refs.push(interp.expressionRange);
                }
            }
            return refs;
        }
    }

    for (const stateEntry of graph.ast.state) {
        if (containsOffset(stateEntry.nameRange, offset)) {
            const refs = collectFromInterpolationsAndMutations(graph.ast, `state.${stateEntry.name}`, `state['${stateEntry.name}']`, stateEntry.nameRange);
            // Adds self.state[...] references
            for (const interp of graph.ast.interpolations) {
                if (interp.expression.includes(`self.state['${stateEntry.name}']`) || interp.expression.includes(`self.state["${stateEntry.name}"]`)) {
                    refs.push(interp.expressionRange);
                }
            }
            return refs;
        }
    }

    for (const propsEntry of graph.ast.props) {
        if (containsOffset(propsEntry.nameRange, offset)) {
            const refs = collectFromInterpolationsAndMutations(graph.ast, `props.${propsEntry.name}`, `props['${propsEntry.name}']`, propsEntry.nameRange);
            // Adds self.props[...] references
            for (const interp of graph.ast.interpolations) {
                if (interp.expression.includes(`self.props['${propsEntry.name}']`) || interp.expression.includes(`self.props["${propsEntry.name}"]`)) {
                    refs.push(interp.expressionRange);
                }
            }
            return refs;
        }
    }

    for (const pyEntry of graph.ast.pyData) {
        if (containsOffset(pyEntry.nameRange, offset)) {
            const refs = collectFromInterpolationsAndMutations(graph.ast, `py.${pyEntry.name}`, `py['${pyEntry.name}']`, pyEntry.nameRange);
            // Adds self.data[...] references (py is based on data)
            for (const interp of graph.ast.interpolations) {
                if (interp.expression.includes(`self.data['${pyEntry.name}']`) || interp.expression.includes(`self.data["${pyEntry.name}"]`)) {
                    refs.push(interp.expressionRange);
                }
            }
            return refs;
        }
    }

    for (const component of graph.ast.components) {
        if (containsOffset(component.range, offset)) {
            const refs: OffsetRange[] = [component.range];
            for (const imp of graph.ast.imports) {
                if (imp.name === component.name && imp.nameRange) {
                    refs.push(imp.nameRange);
                }
            }
            for (const other of graph.ast.components) {
                if (other.name === component.name && other.range.start !== component.range.start) {
                    refs.push(other.range);
                }
            }
            return refs;
        }
    }

    for (const classUse of graph.ast.templateClasses) {
        if (containsOffset(classUse.range, offset)) {
            const refs: OffsetRange[] = [classUse.range];
            for (const cssClass of graph.ast.cssClasses) {
                if (cssClass.name === classUse.name) {
                    refs.push(cssClass.range);
                }
            }
            for (const tplClass of graph.ast.templateClasses) {
                if (tplClass.name === classUse.name && tplClass.range.start !== classUse.range.start) {
                    refs.push(tplClass.range);
                }
            }
            return refs;
        }
    }

    for (const event of graph.ast.events) {
        if (containsOffset(event.handlerRange, offset)) {
            const method = graph.ast.methods.find((entry) => entry.name === event.handler);
            return [
                event.handlerRange,
                ...graph.ast.events.filter((entry) => entry.handler === event.handler).map((entry) => entry.handlerRange),
                ...(method ? [method.range] : [])
            ];
        }
    }

    return [];
}

function collectFromInterpolationsAndMutations(ast: LspaAst, dotted: string, bracketed: string, declaration: OffsetRange): OffsetRange[] {
    const refs: OffsetRange[] = [declaration];
    for (const interpolation of ast.interpolations) {
        if (interpolation.expression.includes(dotted)) {
            refs.push(interpolation.expressionRange);
        }
    }
    for (const directive of ast.directives) {
        if (directive.value && (directive.value.includes(dotted) || directive.value.includes(bracketed)) && directive.valueRange) {
            refs.push(directive.valueRange);
        }
    }
    return refs;
}

function fullLineRange(document: TextDocument, line: number): Range {
    const start = Position.create(line, 0);
    const end = line + 1 < document.lineCount ? Position.create(line + 1, 0) : Position.create(line, Number.MAX_SAFE_INTEGER);
    return Range.create(start, end);
}

function extractMissingMember(text: string, objectName: 'state' | 'props'): string | undefined {
    const match = text.match(new RegExp(`${objectName}\\.([A-Za-z_][\\w]*)`));
    return match?.[1];
}

function pushSemantic(builder: SemanticTokensBuilder, document: TextDocument, range: OffsetRange, tokenType: string): void {
    const start = document.positionAt(range.start);
    const end = document.positionAt(range.end);
    if (start.line !== end.line) {
        return;
    }
    const length = Math.max(end.character - start.character, 1);
    builder.push(start.line, start.character, length, tokenTypes.indexOf(tokenType), 0);
}

function formatLspaDocument(input: string): string {
    const lines = input.split(/\r?\n/).map((line) => line.replace(/[ \t]+$/g, ''));
    const importLines = lines.filter((line) => /^\s*@import\s+/.test(line));
    const bodyLines = lines.filter((line) => !/^\s*@import\s+/.test(line));

    const dedupedImports = [...new Set(importLines)].sort((a, b) => a.localeCompare(b));
    const output: string[] = [];

    for (const imp of dedupedImports) {
        output.push(imp.trim());
    }

    if (dedupedImports.length > 0) {
        output.push('');
    }

    let blankCount = 0;
    for (const line of bodyLines) {
        if (line.trim().length === 0) {
            blankCount++;
            if (blankCount <= 1) {
                output.push('');
            }
            continue;
        }
        blankCount = 0;
        output.push(line);
    }

    return output.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

documents.listen(connection);
connection.listen();
