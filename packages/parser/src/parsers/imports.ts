import type { ImportNode } from '../types';

export function parseImports(text: string): ImportNode[] {
    const output: ImportNode[] = [];
    const regex = /^\s*@import\s+([A-Za-z_][\w-]*)\s+from\s+['"]([^'"]+)['"].*$/gm;

    for (const match of text.matchAll(regex)) {
        const whole = match[0];
        const name = match[1];
        const importPath = match[2];
        const start = match.index ?? 0;
        const end = start + whole.length;
        const nameStart = start + whole.indexOf(name);
        const pathStart = start + whole.indexOf(importPath);

        output.push({
            name,
            path: importPath,
            range: { start, end },
            nameRange: { start: nameStart, end: nameStart + name.length },
            pathRange: { start: pathStart, end: pathStart + importPath.length }
        });
    }

    return output;
}
