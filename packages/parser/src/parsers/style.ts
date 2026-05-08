import type { BlockNode, ClassUse } from '../types';

export function parseCssClasses(block: BlockNode): ClassUse[] {
    const classes: ClassUse[] = [];
    const regex = /\.([A-Za-z_-][\w-]*)\s*\{/g;

    for (const match of block.content.matchAll(regex)) {
        const name = match[1];
        const localStart = (match.index ?? 0) + 1;
        const absoluteStart = block.contentRange.start + localStart;
        classes.push({
            name,
            range: { start: absoluteStart, end: absoluteStart + name.length }
        });
    }

    return classes;
}
