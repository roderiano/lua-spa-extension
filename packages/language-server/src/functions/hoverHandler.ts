import {
    Hover,
    TextDocumentPositionParams,
    TextDocuments
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getGraph } from './graph';
import { containsOffset } from './symbols';
import type { GraphCache } from './types';

export function handleHover(
    params: TextDocumentPositionParams,
    documents: TextDocuments<TextDocument>,
    graphCache: GraphCache
): Hover | null {
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
}
