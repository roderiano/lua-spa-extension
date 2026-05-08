import type { BlockNode } from '../types';

export function parseBlock(text: string, tag: 'python' | 'template' | 'style'): BlockNode | undefined {
    const regex = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'm');
    const match = text.match(regex);
    if (!match || match.index === undefined) {
        return undefined;
    }

    const whole = match[0];
    const content = match[1] ?? '';
    const start = match.index;
    const end = start + whole.length;
    const contentStartInWhole = whole.indexOf(content);
    const contentStart = start + contentStartInWhole;
    const contentEnd = contentStart + content.length;

    return {
        tag,
        range: { start, end },
        contentRange: { start: contentStart, end: contentEnd },
        content
    };
}
