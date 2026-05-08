type HtmlBeautifier = (source: string, options?: Record<string, unknown>) => string;

const beautifyHtml: HtmlBeautifier = require('js-beautify').html;
const { spawnSync } = require('node:child_process') as {
    spawnSync: (
        command: string,
        args?: string[],
        options?: { input?: string; encoding?: BufferEncoding; stdio?: 'pipe' | 'ignore' | Array<'pipe' | 'ignore'> }
    ) => { status: number | null; stdout: string };
};

function detectBlackTargetVersion(): string | null {
    try {
        const result = spawnSync('python', ['-c', 'import sys; print(f"py{sys.version_info[0]}{sys.version_info[1]}")'], {
            encoding: 'utf8'
        });
        if (result.status !== 0) {
            return null;
        }
        const target = (result.stdout ?? '').trim();
        return /^py\d+$/.test(target) ? target : null;
    } catch {
        return null;
    }
}

const BLACK_TARGET_VERSION = detectBlackTargetVersion();

function normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, '\n');
}

function unwrapBlockContent(content: string): { content: string; indent: string } {
    const normalized = normalizeLineEndings(content);
    const trimmed = normalized.replace(/^\s*\n/, '').replace(/\n\s*$/, '');
    const lines = trimmed.split('\n');
    const indents = lines
        .filter((line) => line.trim().length > 0)
        .map((line) => (line.match(/^[ \t]*/) ?? [''])[0]);
    const indent = indents.length > 0 ? indents.reduce((min, cur) => (cur.length < min.length ? cur : min), indents[0]) : '    ';
    const dedented = lines
        .map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line))
        .join('\n')
        .trim();
    return { content: dedented, indent };
}

function wrapBlockContent(content: string, indent: string): string {
    const normalized = normalizeLineEndings(content).trimEnd();
    if (!normalized) {
        return '\n';
    }
    const reindented = normalized
        .split('\n')
        .map((line) => (line.length > 0 ? `${indent}${line}` : ''))
        .join('\n');
    return `\n${reindented}\n`;
}

function formatPythonBlock(content: string): string {
    const normalized = normalizeLineEndings(content).trim();
    if (!normalized) {
        return '';
    }

    try {
        const blackArgs = ['-m', 'black', '--quiet', '--fast'];
        if (BLACK_TARGET_VERSION) {
            blackArgs.push('--target-version', BLACK_TARGET_VERSION);
        }
        blackArgs.push('-');

        const result = spawnSync('python', blackArgs, {
            input: `${normalized}\n`,
            encoding: 'utf8'
        });
        if (result.status === 0 && typeof result.stdout === 'string' && result.stdout.trim().length > 0) {
            return normalizeLineEndings(result.stdout).trimEnd();
        }
    } catch {
        // Keep original content when Black is unavailable or fails.
    }

    return normalized;
}

function formatTemplateBlock(content: string): string {
    try {
        return beautifyHtml(content, {
            indent_size: 4,
            inline: [],
            preserve_newlines: true,
            max_preserve_newlines: 2,
            wrap_line_length: 0,
            end_with_newline: false
        });
    } catch {
        return content;
    }
}

function formatNamedBlock(input: string, tag: 'python' | 'template', formatter: (content: string) => string): string {
    const regex = new RegExp(`(<${tag}\\b[^>]*>)([\\s\\S]*?)(<\\/${tag}>)`, 'g');
    return input.replace(regex, (_whole, openTag: string, rawContent: string, closeTag: string) => {
        const { content, indent } = unwrapBlockContent(rawContent);
        const formatted = formatter(content);
        const wrapped = wrapBlockContent(formatted, indent);
        return `${openTag}${wrapped}${closeTag}`;
    });
}

export function formatLspaDocument(input: string): string {
    if (input.trim().length === 0) {
        return '';
    }

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

    const normalizedBody = output.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
    const withFormattedPython = formatNamedBlock(normalizedBody, 'python', formatPythonBlock);
    const withFormattedTemplate = formatNamedBlock(withFormattedPython, 'template', formatTemplateBlock);
    return withFormattedTemplate.trimEnd() + '\n';
}
