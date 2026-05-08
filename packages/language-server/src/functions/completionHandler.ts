import {
    CompletionItem,
    CompletionItemKind,
    CompletionParams,
    Position,
    Range,
    TextDocuments,
    TextEdit
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ALLOWED_DIRECTIVES, ALLOWED_EVENTS } from '../../../template-analyzer/src';
import { getGraph } from './graph';
import { importCompletion } from './importCompletion';
import { isOffsetInBlock } from './symbols';
import type { ComponentCache, GraphCache } from './types';
import { collectWorkspaceComponents, relativeImportPath } from './workspace';

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

    const lines = document.getText().split(/\r?\n/);
    const currentLine = lines[params.position.line] ?? '';

    if (/^\s*@import\s+[A-Za-z_][\w-]*$/.test(currentLine)) {
        return importCompletion(document, params, workspaceRoots);
    }

    if (inTemplate && /<[A-Z][\w-]*$/.test(linePrefix)) {
        const knownComponents = await collectWorkspaceComponents(document.uri, workspaceRoots, componentCache);
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
}
