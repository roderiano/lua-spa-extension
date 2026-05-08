import { TextDocument } from 'vscode-languageserver-textdocument';
import { analyzeCss } from '../../../css-analyzer/src';
import { parseLspaDocument } from '../../../parser/src';
import { analyzePython } from '../../../python-analyzer/src';
import { analyzeTemplate } from '../../../template-analyzer/src';
import type { CrossSemanticGraph, GraphCache } from './types';

export function getGraph(document: TextDocument, graphCache: GraphCache): CrossSemanticGraph {
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
