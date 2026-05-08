import {
    Definition,
    Location,
    Range,
    TextDocumentPositionParams,
    TextDocuments
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import {
    collectWorkspaceComponents,
    resolveImportPath
} from './workspace';
import { getGraph } from './graph';
import {
    collectSymbolReferences,
    containsOffset,
    toLspRange
} from './symbols';
import type {
    ComponentCache,
    GraphCache
} from './types';

export async function handleDefinition(
    params: TextDocumentPositionParams,
    documents: TextDocuments<TextDocument>,
    graphCache: GraphCache,
    workspaceRoots: string[],
    componentCache: ComponentCache
): Promise<Definition | null> {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return null;
    }

    const graph = getGraph(document, graphCache);
    const offset = document.offsetAt(params.position);

    const isSameRange = (a: { start: number; end: number }, b: { start: number; end: number }): boolean => {
        return a.start === b.start && a.end === b.end;
    };

    const resolveDefinitionOrOccurrences = (): Definition | null => {
        const refs = collectSymbolReferences(graph, offset);
        if (refs.length === 0) {
            return null;
        }

        for (const methodEntry of graph.ast.methods) {
            if (refs.some((range) => isSameRange(range, methodEntry.range))) {
                return Location.create(document.uri, toLspRange(document, methodEntry.range));
            }
        }
        for (const stateEntry of graph.ast.state) {
            if (refs.some((range) => isSameRange(range, stateEntry.nameRange))) {
                return Location.create(document.uri, toLspRange(document, stateEntry.nameRange));
            }
        }
        for (const propsEntry of graph.ast.props) {
            if (refs.some((range) => isSameRange(range, propsEntry.nameRange))) {
                return Location.create(document.uri, toLspRange(document, propsEntry.nameRange));
            }
        }
        for (const pyEntry of graph.ast.pyData) {
            if (refs.some((range) => isSameRange(range, pyEntry.nameRange))) {
                return Location.create(document.uri, toLspRange(document, pyEntry.nameRange));
            }
        }

        return refs.map((range) => Location.create(document.uri, toLspRange(document, range)));
    };

    const styleBlock = graph.ast.styleBlock;
    if (styleBlock?.src && styleBlock.srcRange && containsOffset(styleBlock.srcRange, offset)) {
        const resolvedCssPath = resolveImportPath(document.uri, styleBlock.src, workspaceRoots);
        if (resolvedCssPath) {
            return Location.create(URI.file(resolvedCssPath).toString(), Range.create(0, 0, 0, 0));
        }
    }

    for (const imp of graph.ast.imports) {
        if (imp.pathRange && containsOffset(imp.pathRange, offset) && imp.path) {
            const resolvedPath = resolveImportPath(document.uri, imp.path, workspaceRoots);
            if (resolvedPath) {
                return Location.create(URI.file(resolvedPath).toString(), Range.create(0, 0, 0, 0));
            }
        }
        if (imp.nameRange && containsOffset(imp.nameRange, offset) && imp.path) {
            const resolvedPath = resolveImportPath(document.uri, imp.path, workspaceRoots);
            if (resolvedPath) {
                return Location.create(URI.file(resolvedPath).toString(), Range.create(0, 0, 0, 0));
            }
        }
    }

    const directive = graph.ast.directives.find((entry) => containsOffset(entry.range, offset));
    if (directive) {
        return Location.create(document.uri, toLspRange(document, directive.range));
    }

    const event = graph.ast.events.find((entry) => containsOffset(entry.range, offset));
    if (event) {
        const targetMethod = graph.ast.methods.find((entry) => entry.name === event.handler);
        if (targetMethod) {
            return Location.create(document.uri, toLspRange(document, targetMethod.range));
        }
        return resolveDefinitionOrOccurrences() ?? Location.create(document.uri, toLspRange(document, event.range));
    }

    const interpolation = graph.ast.interpolations.find((entry) => containsOffset(entry.expressionRange, offset));
    if (interpolation) {
        return resolveDefinitionOrOccurrences() ?? Location.create(document.uri, toLspRange(document, interpolation.expressionRange));
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
            if (styleBlock?.src && cssDef.range.start === 0 && cssDef.range.end === 0) {
                const resolvedCssPath = resolveImportPath(document.uri, styleBlock.src, workspaceRoots);
                if (resolvedCssPath) {
                    return Location.create(URI.file(resolvedCssPath).toString(), Range.create(0, 0, 0, 0));
                }
            }
            return Location.create(document.uri, toLspRange(document, cssDef.range));
        }
    }

    const cssClass = graph.ast.cssClasses.find((entry) => containsOffset(entry.range, offset));
    if (cssClass) {
        return Location.create(document.uri, toLspRange(document, cssClass.range));
    }

    const definitionOrOccurrences = resolveDefinitionOrOccurrences();
    if (definitionOrOccurrences) {
        return definitionOrOccurrences;
    }

    return null;
}
