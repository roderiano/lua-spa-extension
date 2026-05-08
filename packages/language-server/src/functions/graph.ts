import * as fs from 'fs';
import * as path from 'path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { analyzeCss } from '../../../css-analyzer/src';
import { parseLspaDocument } from '../../../parser/src';
import { parseCssClasses } from '../../../parser/src/parsers/style';
import { analyzePython } from '../../../python-analyzer/src';
import { analyzeTemplate } from '../../../template-analyzer/src';
import type { CrossSemanticGraph, GraphCache } from './types';

export function getGraph(document: TextDocument, graphCache: GraphCache): CrossSemanticGraph {
    const cached = graphCache.get(document.uri);
    if (cached && cached.version === document.version) {
        return cached.graph;
    }

    const ast = parseLspaDocument(document.getText());

    // Load external CSS when style block uses src attribute
    if (ast.styleBlock?.src) {
        try {
            const docPath = URI.parse(document.uri).fsPath;
            const cssPath = path.resolve(path.dirname(docPath), ast.styleBlock.src);
            const cssContent = fs.readFileSync(cssPath, 'utf-8');
            ast.cssClasses = parseCssClasses(ast.styleBlock, cssContent);
        } catch {
            // File not found or unreadable — cssClasses stays empty
        }
    }

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
