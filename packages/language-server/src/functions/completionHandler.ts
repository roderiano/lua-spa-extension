import {
    CompletionItem,
    CompletionItemKind,
    CompletionParams,
    MarkupKind,
    Position,
    Range,
    TextDocuments,
    TextEdit
} from 'vscode-languageserver/node';
import path from 'path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ALLOWED_DIRECTIVES, ALLOWED_EVENTS } from '../../../template-analyzer/src';
import { getGraph } from './graph';
import { isOffsetInBlock } from './symbols';
import type { ComponentCache, GraphCache } from './types';
import { collectWorkspaceComponents, listImportCandidates, relativeImportPath } from './workspace';

type CompletionCandidate = {
    label: string;
    kind: CompletionItemKind;
    detail?: string;
    documentation?: { kind: MarkupKind; value: string };
    insertText?: string;
    additionalTextEdits?: TextEdit[];
};

type BuildCompletionOptions = {
    textEditRange?: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
};

function buildCompletions(
    candidates: CompletionCandidate[],
    options?: BuildCompletionOptions
): CompletionItem[] {
    return candidates.map(({ insertText, additionalTextEdits, ...rest }) => {
        const item: CompletionItem = { ...rest };
        if (insertText !== undefined && options?.textEditRange) {
            item.textEdit = {
                range: options.textEditRange,
                newText: insertText
            };
        } else if (insertText !== undefined) {
            item.insertText = insertText;
        }
        if (additionalTextEdits) {
            item.additionalTextEdits = additionalTextEdits;
        }
        return item;
    });
}

function textEditRangeFromPartial(params: CompletionParams, partial: string): BuildCompletionOptions {
    const start = params.position.character - partial.length;
    return {
        textEditRange: {
            start: {
                line: params.position.line,
                character: start
            },
            end: {
                line: params.position.line,
                character: params.position.character
            }
        }
    };
}

export async function handleCompletion(
    params: CompletionParams,
    documents: TextDocuments<TextDocument>,
    graphCache: GraphCache,
    workspaceRoots: string[],
    componentCache: ComponentCache
): Promise<CompletionItem[]> {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }

    const graph = getGraph(document, graphCache);
    const offset = document.offsetAt(params.position);
    const linePrefix = document.getText(Range.create(Position.create(params.position.line, 0), params.position));
    const inTemplate = isOffsetInBlock(graph.ast.templateBlock, offset);

    if (inTemplate && /@click\s*=\s*['"][A-Za-z_\w-]*$/.test(linePrefix)) {
        const match = linePrefix.match(/@click\s*=\s*['"]([A-Za-z_\w-]*)$/);
        const partial = match?.[1] ?? '';

        return buildCompletions(
            [...graph.python.methods.keys()].map((methodName) => {
                return {
                    label: methodName,

                    kind: CompletionItemKind.Function,

                    detail: 'Method in <python> setup scope',

                    insertText: methodName
                };
            }),
            textEditRangeFromPartial(params, partial)
        );
    }

    if (inTemplate && /(?:\s|<)(i-|@)\w*$/.test(linePrefix)) {
        const match = linePrefix.match(/((?:i-|@)[\w-]*)$/);
        const partial = match?.[1] ?? '';

        return buildCompletions(
            [
                ...[...ALLOWED_DIRECTIVES].map((directive) => {
                    return {
                        label: directive,

                        kind: CompletionItemKind.Function,

                        detail: 'LSPA directive',

                        insertText: directive
                    };
                }),
                ...[...ALLOWED_EVENTS].map((eventName) => {
                    return {
                        label: eventName,

                        kind: CompletionItemKind.Function,

                        detail: 'LSPA event',

                        insertText: eventName
                    };
                })
            ],
            textEditRangeFromPartial(params, partial)
        );
    }

    if (inTemplate && /\bclass\s*=\s*['"][^'"]*$/.test(linePrefix)) {
        const match = linePrefix.match(/([A-Za-z_-][\w-]*)$/);
        const partial = match?.[1] ?? '';

        const classSet = new Set<string>([
            ...graph.css.cssClassMap.keys(),
            ...graph.css.tailwindClasses
        ]);

        return buildCompletions(
            [...classSet].map((className) => {
                return {
                    label: className,

                    kind: CompletionItemKind.Color,

                    detail: graph.css.cssClassMap.has(className) ? 'Class from <style>' : 'Tailwind utility class',

                    insertText: className
                };
            }),
            textEditRangeFromPartial(params, partial)
        );
    }

    if (inTemplate && /\b(state|props|py)\.[A-Za-z_\w]*$/.test(linePrefix)) {
        const match = linePrefix.match(/\b(?:state|props|py)\.([A-Za-z_\w]*)$/);
        const partial = match?.[1] ?? '';

        const onState = /state\.[A-Za-z_\w]*$/.test(linePrefix);
        const onProps = /props\.[A-Za-z_\w]*$/.test(linePrefix);
        const prefix = onState ? 'state' : onProps ? 'props' : 'py';
        const source = onState ? graph.python.state : onProps ? graph.python.props : graph.python.pyData;

        return buildCompletions(
            [...source.values()].map((entry) => {
                return {
                    label: entry.name,

                    kind: CompletionItemKind.Field,

                    detail: `${prefix} (${entry.type})`,

                    insertText: entry.name
                };
            }),
            textEditRangeFromPartial(params, partial)
        );
    }

    const lines = document.getText().split(/\r?\n/);
    const currentLine = lines[params.position.line] ?? '';

    if (/^\s*@import\s+[A-Za-z_\w-]*$/.test(currentLine)) {
        const files = listImportCandidates(document.uri, workspaceRoots);
        const match =
            currentLine.match(/^\s*@import\s+([A-Za-z_\w-]*)$/);
        const partial = match?.[1] ?? '';

        return buildCompletions(
            files.map((file) => {
                const importName =
                    path.basename(file).split('.')[0];

                return {
                    label: importName,

                    kind: CompletionItemKind.Module,

                    detail: 'LSPA Component Import',

                    documentation: {
                        kind: MarkupKind.Markdown,

                        value:
                            `### Import component\n\n` +
                            `Component: \`${importName}\`\n\n` +
                            `Path: \`${file}\``
                    },

                    insertText:
                        `${importName} from '${file}'`
                };
            }),
            textEditRangeFromPartial(params, partial)
        );
    }

    if (inTemplate && /<[A-Z][\w-]*$/.test(linePrefix)) {
        const match = linePrefix.match(/<([A-Z][\w-]*)$/);
        const partial = match?.[1] ?? '';

        const knownComponents = await collectWorkspaceComponents(document.uri, workspaceRoots, componentCache);

        return buildCompletions(
            [...knownComponents.entries()].map(([name, componentUri]) => {
                return {
                    label: name,

                    kind: CompletionItemKind.Class,

                    detail: graph.importMap.has(name) ? 'Imported component' : 'Component (auto import available)',

                    insertText: name,

                    additionalTextEdits: !graph.importMap.has(name)
                        ? [TextEdit.insert(Position.create(0, 0), `@import ${name} from '${relativeImportPath(document.uri, componentUri)}'\n`)]
                        : undefined
                };
            }),
            textEditRangeFromPartial(params, partial)
        );
    }

    return [];
}
