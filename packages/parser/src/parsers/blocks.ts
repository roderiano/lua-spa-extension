import type { BlockNode } from '../types';

function extractSrc(openingTag: string): string | undefined {
    const m = openingTag.match(/\bsrc\s*=\s*["']([^"']*)["']/);
    return m?.[1];
}

export function parseBlock(text: string, tag: 'python' | 'template' | 'style'): BlockNode | undefined {
    // Try paired open/close tag first
    const pairedRegex = new RegExp(`(<${tag}\\b[^>]*>)([\\s\\S]*?)<\\/${tag}>`, 'm');
    const pairedMatch = text.match(pairedRegex);
    if (pairedMatch && pairedMatch.index !== undefined) {
        const whole = pairedMatch[0];
        const openingTag = pairedMatch[1];
        const content = pairedMatch[2] ?? '';
        const start = pairedMatch.index;
        const end = start + whole.length;
        const contentStart = start + openingTag.length;
        const contentEnd = contentStart + content.length;
        const src = extractSrc(openingTag);
        return {
            tag,
            range: { start, end },
            contentRange: { start: contentStart, end: contentEnd },
            content,
            ...(src ? { src } : {})
        };
    }

    // Try self-closing tag (e.g. <style src="..."/>)
    const selfClosingRegex = new RegExp(`(<${tag}\\b[^>]*?\\/>)`, 'm');
    const selfMatch = text.match(selfClosingRegex);
    if (selfMatch && selfMatch.index !== undefined) {
        const whole = selfMatch[1];
        const start = selfMatch.index;
        const end = start + whole.length;
        const src = extractSrc(whole);
        return {
            tag,
            range: { start, end },
            contentRange: { start: end, end },
            content: '',
            ...(src ? { src } : {})
        };
    }

    return undefined;
}
