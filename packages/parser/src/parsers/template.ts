import type {
    BlockNode,
    ClassUse,
    ComponentUse,
    DirectiveUse,
    EventUse,
    InterpolationUse,
    OffsetRange
} from '../types';

export function parseComponents(block: BlockNode): ComponentUse[] {
    const components: ComponentUse[] = [];
    const regex = /<([A-Z][\w-]*)\b/g;

    for (const match of block.content.matchAll(regex)) {
        const name = match[1];
        const localStart = (match.index ?? 0) + 1;
        const absoluteStart = block.contentRange.start + localStart;
        components.push({
            name,
            range: { start: absoluteStart, end: absoluteStart + name.length }
        });
    }

    return components;
}

export function parseDirectives(block: BlockNode): DirectiveUse[] {
    const directives: DirectiveUse[] = [];
    const regex = /\b(i-[A-Za-z-]+)(?:\s*=\s*['"]([^'"]*)['"])?/g;

    for (const match of block.content.matchAll(regex)) {
        const name = match[1];
        const value = match[2];
        const start = block.contentRange.start + (match.index ?? 0);
        const range: OffsetRange = { start, end: start + name.length };
        let valueRange: OffsetRange | undefined;

        if (typeof value === 'string') {
            const valueStart = start + match[0].indexOf(value);
            valueRange = { start: valueStart, end: valueStart + value.length };
        }

        directives.push({ name, value, range, valueRange });
    }

    return directives;
}

export function parseEvents(block: BlockNode): EventUse[] {
    const events: EventUse[] = [];
    const regex = /(@[A-Za-z-]+)\s*=\s*['"]([^'"]+)['"]/g;

    for (const match of block.content.matchAll(regex)) {
        const name = match[1];
        const handler = match[2];
        const start = block.contentRange.start + (match.index ?? 0);
        const handlerStart = start + match[0].indexOf(handler);
        events.push({
            name,
            handler,
            range: { start, end: start + name.length },
            handlerRange: { start: handlerStart, end: handlerStart + handler.length }
        });
    }

    return events;
}

export function parseInterpolations(block: BlockNode): InterpolationUse[] {
    const values: InterpolationUse[] = [];
    const regex = /\{\{\s*([^}]+?)\s*\}\}/g;

    for (const match of block.content.matchAll(regex)) {
        const expression = (match[1] ?? '').trim();
        const start = block.contentRange.start + (match.index ?? 0);
        const expressionStart = start + match[0].indexOf(expression);
        values.push({
            expression,
            range: { start, end: start + match[0].length },
            expressionRange: { start: expressionStart, end: expressionStart + expression.length }
        });
    }

    return values;
}

export function parseTemplateClasses(block: BlockNode): ClassUse[] {
    const classes: ClassUse[] = [];
    const regex = /\bclass\s*=\s*['"]([^'"]+)['"]/g;

    for (const match of block.content.matchAll(regex)) {
        const classValue = match[1] ?? '';
        const start = block.contentRange.start + (match.index ?? 0) + match[0].indexOf(classValue);
        let cursor = 0;

        for (const cls of classValue.split(/\s+/).filter(Boolean)) {
            const clsStart = classValue.indexOf(cls, cursor);
            cursor = clsStart + cls.length;
            classes.push({
                name: cls,
                range: { start: start + clsStart, end: start + clsStart + cls.length }
            });
        }
    }

    return classes;
}
