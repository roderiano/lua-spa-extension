import type { BlockNode, ClassUse } from '../types';

export function parseCssClasses(block: BlockNode, externalContent?: string): ClassUse[] {
    const classes: ClassUse[] = [];
    const regex = /\.([A-Za-z_-][\w-]*)\s*\{/g;

    if (externalContent !== undefined) {
        // External CSS file: positions are not meaningful within the .lspa document
        for (const match of externalContent.matchAll(regex)) {
            classes.push({
                name: match[1],
                range: { start: 0, end: 0 }
            });
        }
        return classes;
    }

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
