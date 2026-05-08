import {
    Diagnostic,
    DiagnosticSeverity,
    Range
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ALLOWED_DIRECTIVES, ALLOWED_EVENTS } from '../../../template-analyzer/src';
import { getGraph } from './graph';
import { toLspRange } from './symbols';
import type { GraphCache } from './types';
import { resolveImportPath } from './workspace';

export function computeDiagnostics(
    document: TextDocument,
    graphCache: GraphCache,
    workspaceRoots: string[]
): Diagnostic[] {
    const graph = getGraph(document, graphCache);
    const diagnostics: Diagnostic[] = [];

    for (const imp of graph.ast.imports) {
        if (!imp.path || !imp.pathRange) {
            continue;
        }
        if (!resolveImportPath(document.uri, imp.path, workspaceRoots)) {
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
        if (graph.css.cssClassMap.has(classUse.name)) {
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

    return diagnostics;
}
