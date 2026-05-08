import {
    CodeAction,
    CodeActionKind,
    CodeActionParams,
    Position,
    TextDocuments,
    TextDocumentEdit,
    TextEdit
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getGraph } from './graph';
import { extractMissingMember, fullLineRange } from './symbols';
import type { ComponentCache, GraphCache } from './types';
import { collectWorkspaceComponents, relativeImportPath } from './workspace';

export async function handleCodeActions(
    params: CodeActionParams,
    documents: TextDocuments<TextDocument>,
    graphCache: GraphCache,
    workspaceRoots: string[],
    componentCache: ComponentCache
): Promise<CodeAction[]> {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }

    const graph = getGraph(document, graphCache);
    const actions: CodeAction[] = [];

    for (const diagnostic of params.context.diagnostics) {
        if (diagnostic.code === 'lspa.missingImport') {
            const componentName = document.getText(diagnostic.range);
            const catalog = await collectWorkspaceComponents(document.uri, workspaceRoots, componentCache);
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
                                TextEdit.insert(document.positionAt(pythonBlock.contentRange.end), `\n\t\tdef ${methodName}(self):\n\t\t\tpass\n`)
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
                                TextEdit.insert(document.positionAt(pythonBlock.contentRange.end), `\t\tstate['${missing}'] = None\n`)
                            ])
                        ]
                    }
                });
            }
        }
    }

    return actions;
}
