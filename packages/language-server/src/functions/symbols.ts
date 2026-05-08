import {
    Position,
    Range,
    SemanticTokensBuilder
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { type LspaAst, type OffsetRange } from '../../../parser/src';
import type { CrossSemanticGraph } from './types';

export function toLspRange(document: TextDocument, range: OffsetRange): Range {
    return Range.create(document.positionAt(range.start), document.positionAt(range.end));
}

export function containsOffset(range: OffsetRange, offset: number): boolean {
    return offset >= range.start && offset <= range.end;
}

export function isOffsetInBlock(block: LspaAst['templateBlock'], offset: number): boolean {
    if (!block) {
        return false;
    }

    return offset >= block.contentRange.start && offset <= block.contentRange.end;
}

export function collectSymbolReferences(graph: CrossSemanticGraph, offset: number): OffsetRange[] {
    for (const method of graph.ast.methods) {
        if (containsOffset(method.range, offset)) {
            const refs: OffsetRange[] = [method.range];
            for (const event of graph.ast.events) {
                if (event.handler === method.name) {
                    refs.push(event.handlerRange);
                }
            }
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

export function fullLineRange(document: TextDocument, line: number): Range {
    const start = Position.create(line, 0);
    const end = line + 1 < document.lineCount ? Position.create(line + 1, 0) : Position.create(line, Number.MAX_SAFE_INTEGER);
    return Range.create(start, end);
}

export function extractMissingMember(text: string, objectName: 'state' | 'props'): string | undefined {
    const match = text.match(new RegExp(`${objectName}\\.([A-Za-z_][\\w]*)`));
    return match?.[1];
}

export function pushSemantic(builder: SemanticTokensBuilder, document: TextDocument, range: OffsetRange, tokenType: string, tokenTypes: string[]): void {
    const start = document.positionAt(range.start);
    const end = document.positionAt(range.end);
    if (start.line !== end.line) {
        return;
    }

    const length = Math.max(end.character - start.character, 1);
    builder.push(start.line, start.character, length, tokenTypes.indexOf(tokenType), 0);
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
