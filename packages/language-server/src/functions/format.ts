export function formatLspaDocument(input: string): string {
    const lines = input.split(/\r?\n/).map((line) => line.replace(/[ \t]+$/g, ''));
    const importLines = lines.filter((line) => /^\s*@import\s+/.test(line));
    const bodyLines = lines.filter((line) => !/^\s*@import\s+/.test(line));

    const dedupedImports = [...new Set(importLines)].sort((a, b) => a.localeCompare(b));
    const output: string[] = [];

    for (const imp of dedupedImports) {
        output.push(imp.trim());
    }

    if (dedupedImports.length > 0) {
        output.push('');
    }

    let blankCount = 0;
    for (const line of bodyLines) {
        if (line.trim().length === 0) {
            blankCount++;
            if (blankCount <= 1) {
                output.push('');
            }
            continue;
        }

        blankCount = 0;
        output.push(line);
    }

    return output.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
