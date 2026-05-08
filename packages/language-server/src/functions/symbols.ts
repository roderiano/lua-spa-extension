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
    const styleBlock = graph.ast.styleBlock;
    if (styleBlock?.srcRange && containsOffset(styleBlock.srcRange, offset)) {
        return [styleBlock.srcRange];
    }

    for (const imp of graph.ast.imports) {
        if (!imp.name || !imp.nameRange) {
            continue;
        }

        if (containsOffset(imp.nameRange, offset)) {
            const refs: OffsetRange[] = [imp.nameRange];
            for (const component of graph.ast.components) {
                if (component.name === imp.name) {
                    refs.push(component.range);
                }
            }
            for (const otherImport of graph.ast.imports) {
                if (otherImport !== imp && otherImport.name === imp.name && otherImport.nameRange) {
                    refs.push(otherImport.nameRange);
                }
            }
            return refs;
        }

        if (imp.pathRange && containsOffset(imp.pathRange, offset)) {
            return [imp.pathRange];
        }
    }

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
            if (styleBlock?.srcRange) {
                refs.push(styleBlock.srcRange);
            }
            return refs;
        }
    }

    for (const cssClass of graph.ast.cssClasses) {
        if (!containsOffset(cssClass.range, offset)) {
            continue;
        }

        const refs: OffsetRange[] = [cssClass.range];
        for (const classUse of graph.ast.templateClasses) {
            if (classUse.name === cssClass.name) {
                refs.push(classUse.range);
            }
        }
        for (const otherCssClass of graph.ast.cssClasses) {
            if (otherCssClass !== cssClass && otherCssClass.name === cssClass.name) {
                refs.push(otherCssClass.range);
            }
        }
        return refs;
    }

    for (const directive of graph.ast.directives) {
        if (directive.value && directive.valueRange && containsOffset(directive.valueRange, offset)) {
            const symbol = resolveExpressionSymbolAtOffset(directive.value, directive.valueRange.start, offset);
            if (!symbol) {
                return [directive.valueRange];
            }

            return collectReferencesForResolvedSymbol(graph, symbol, directive.valueRange);
        }

        if (!containsOffset(directive.range, offset)) {
            continue;
        }

        const refs: OffsetRange[] = [directive.range];
        for (const otherDirective of graph.ast.directives) {
            if (otherDirective !== directive && otherDirective.name === directive.name) {
                refs.push(otherDirective.range);
            }
        }
        return refs;
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

        if (containsOffset(event.range, offset)) {
            const refs: OffsetRange[] = [event.range];
            for (const otherEvent of graph.ast.events) {
                if (otherEvent !== event && otherEvent.name === event.name) {
                    refs.push(otherEvent.range);
                }
            }
            return refs;
        }
    }

    for (const interpolation of graph.ast.interpolations) {
        if (containsOffset(interpolation.expressionRange, offset)) {
            const symbol = resolveExpressionSymbolAtOffset(interpolation.expression, interpolation.expressionRange.start, offset);
            if (!symbol) {
                return [interpolation.expressionRange];
            }
            return collectReferencesForResolvedSymbol(graph, symbol, interpolation.expressionRange);
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

function resolveExpressionSymbolAtOffset(
    expression: string,
    expressionStart: number,
    offset: number
): { kind: 'state' | 'props' | 'py' | 'method'; name: string } | { kind: 'namespace'; objectName: 'state' | 'props' | 'py' } | undefined {
    const localOffset = offset - expressionStart;

    if (localOffset < 0 || localOffset > expression.length) {
        return undefined;
    }

    const namespaceRegex = /\b(state|props|py)\.(?:[A-Za-z_][\w]*)?/g;
    for (const match of expression.matchAll(namespaceRegex)) {
        if (!match[1]) {
            continue;
        }

        const objectName = match[1] as 'state' | 'props' | 'py';
        const matchStart = match.index ?? 0;
        const namespaceEnd = matchStart + objectName.length + 1;
        if (localOffset >= matchStart && localOffset <= namespaceEnd) {
            return { kind: 'namespace', objectName };
        }
    }

    const dottedRegex = /\b(state|props|py)\.([A-Za-z_][\w]*)\b/g;
    for (const match of expression.matchAll(dottedRegex)) {
        if (!match[1] || !match[2]) {
            continue;
        }

        const kind = match[1] as 'state' | 'props' | 'py';
        const name = match[2];
        const matchStart = match.index ?? 0;
        const nameStart = matchStart + kind.length + 1;
        const nameEnd = nameStart + name.length;
        if (localOffset >= nameStart && localOffset <= nameEnd) {
            return { kind, name };
        }
    }

    const bracketPatterns: Array<{ kind: 'state' | 'props' | 'py'; regex: RegExp }> = [
        { kind: 'state', regex: /\b(?:self\.)?state\[['"]([A-Za-z_][\w]*)['"]\]/g },
        { kind: 'props', regex: /\b(?:self\.)?props\[['"]([A-Za-z_][\w]*)['"]\]/g },
        { kind: 'py', regex: /\b(?:self\.)?data\[['"]([A-Za-z_][\w]*)['"]\]/g }
    ];

    for (const pattern of bracketPatterns) {
        for (const match of expression.matchAll(pattern.regex)) {
            const name = match[1];
            if (!name) {
                continue;
            }

            const matchStart = match.index ?? 0;
            const relativeNameStart = match[0].indexOf(name);
            if (relativeNameStart < 0) {
                continue;
            }

            const nameStart = matchStart + relativeNameStart;
            const nameEnd = nameStart + name.length;
            if (localOffset >= nameStart && localOffset <= nameEnd) {
                return { kind: pattern.kind, name };
            }
        }
    }

    const methodRegex = /\b(?:self\.)?([A-Za-z_][\w]*)\s*\(/g;
    for (const match of expression.matchAll(methodRegex)) {
        const name = match[1];
        if (!name || RESERVED_METHOD_LIKE_TOKENS.has(name)) {
            continue;
        }

        const matchStart = match.index ?? 0;
        const relativeNameStart = match[0].includes('self.') ? 5 : 0;
        const nameStart = matchStart + relativeNameStart;
        const nameEnd = nameStart + name.length;
        if (localOffset >= nameStart && localOffset <= nameEnd) {
            return { kind: 'method', name };
        }
    }

    return undefined;
}

function collectReferencesForResolvedSymbol(
    graph: CrossSemanticGraph,
    symbol: { kind: 'state' | 'props' | 'py' | 'method'; name: string } | { kind: 'namespace'; objectName: 'state' | 'props' | 'py' },
    fallback: OffsetRange
): OffsetRange[] {
    if (symbol.kind === 'namespace') {
        return collectNamespaceReferences(graph, symbol.objectName, fallback);
    }

    if (symbol.kind === 'method') {
        const method = graph.ast.methods.find((entry) => entry.name === symbol.name);
        if (method) {
            return collectSymbolReferences(graph, method.range.start);
        }

        const refs: OffsetRange[] = [];
        for (const event of graph.ast.events) {
            if (event.handler === symbol.name) {
                refs.push(event.handlerRange);
            }
        }
        for (const interpolation of graph.ast.interpolations) {
            if (interpolation.expression.includes(`self.${symbol.name}`) || interpolation.expression.includes(`${symbol.name}(`)) {
                refs.push(interpolation.expressionRange);
            }
        }
        for (const directive of graph.ast.directives) {
            if (directive.valueRange && directive.value && directive.value.includes(`${symbol.name}(`)) {
                refs.push(directive.valueRange);
            }
        }
        return refs.length > 0 ? refs : [fallback];
    }

    if (symbol.kind === 'state') {
        const stateEntry = graph.ast.state.find((entry) => entry.name === symbol.name);
        if (stateEntry) {
            return collectSymbolReferences(graph, stateEntry.nameRange.start);
        }
        return collectMissingObjectMemberOccurrences(graph.ast, 'state', symbol.name, fallback);
    }

    if (symbol.kind === 'props') {
        const propsEntry = graph.ast.props.find((entry) => entry.name === symbol.name);
        if (propsEntry) {
            return collectSymbolReferences(graph, propsEntry.nameRange.start);
        }
        return collectMissingObjectMemberOccurrences(graph.ast, 'props', symbol.name, fallback);
    }

    const pyEntry = graph.ast.pyData.find((entry) => entry.name === symbol.name);
    if (pyEntry) {
        return collectSymbolReferences(graph, pyEntry.nameRange.start);
    }
    return collectMissingObjectMemberOccurrences(graph.ast, 'py', symbol.name, fallback);
}

function collectNamespaceReferences(
    graph: CrossSemanticGraph,
    objectName: 'state' | 'props' | 'py',
    fallback: OffsetRange
): OffsetRange[] {
    const refs: OffsetRange[] = [];

    const dotted = `${objectName}.`;
    const bracketedSingle = `${objectName}['`;
    const bracketedDouble = `${objectName}["`;
    const selfSingle = objectName === 'py' ? "self.data['" : `self.${objectName}['`;
    const selfDouble = objectName === 'py' ? 'self.data["' : `self.${objectName}["`;

    for (const interpolation of graph.ast.interpolations) {
        if (
            interpolation.expression.includes(dotted)
            || interpolation.expression.includes(bracketedSingle)
            || interpolation.expression.includes(bracketedDouble)
            || interpolation.expression.includes(selfSingle)
            || interpolation.expression.includes(selfDouble)
        ) {
            refs.push(interpolation.expressionRange);
        }
    }

    for (const directive of graph.ast.directives) {
        if (!directive.value || !directive.valueRange) {
            continue;
        }
        if (
            directive.value.includes(dotted)
            || directive.value.includes(bracketedSingle)
            || directive.value.includes(bracketedDouble)
            || directive.value.includes(selfSingle)
            || directive.value.includes(selfDouble)
        ) {
            refs.push(directive.valueRange);
        }
    }

    const declarations = objectName === 'state'
        ? graph.ast.state
        : objectName === 'props'
            ? graph.ast.props
            : graph.ast.pyData;

    for (const declaration of declarations) {
        refs.push(declaration.nameRange);
    }

    return refs.length > 0 ? refs : [fallback];
}

function collectMissingObjectMemberOccurrences(
    ast: LspaAst,
    objectName: 'state' | 'props' | 'py',
    memberName: string,
    fallback: OffsetRange
): OffsetRange[] {
    const refs: OffsetRange[] = [];
    const dotted = `${objectName}.${memberName}`;
    const bracketedSingle = `${objectName}['${memberName}']`;
    const bracketedDouble = `${objectName}["${memberName}"]`;
    const selfSingle = objectName === 'py'
        ? `self.data['${memberName}']`
        : `self.${objectName}['${memberName}']`;
    const selfDouble = objectName === 'py'
        ? `self.data["${memberName}"]`
        : `self.${objectName}["${memberName}"]`;

    for (const interpolation of ast.interpolations) {
        if (
            interpolation.expression.includes(dotted)
            || interpolation.expression.includes(bracketedSingle)
            || interpolation.expression.includes(bracketedDouble)
            || interpolation.expression.includes(selfSingle)
            || interpolation.expression.includes(selfDouble)
        ) {
            refs.push(interpolation.expressionRange);
        }
    }

    for (const directive of ast.directives) {
        if (!directive.valueRange || !directive.value) {
            continue;
        }
        if (
            directive.value.includes(dotted)
            || directive.value.includes(bracketedSingle)
            || directive.value.includes(bracketedDouble)
            || directive.value.includes(selfSingle)
            || directive.value.includes(selfDouble)
        ) {
            refs.push(directive.valueRange);
        }
    }

    return refs.length > 0 ? refs : [fallback];
}

const RESERVED_METHOD_LIKE_TOKENS = new Set<string>([
    'if',
    'for',
    'while',
    'and',
    'or',
    'not',
    'in',
    'is',
    'return',
    'class',
    'def'
]);
