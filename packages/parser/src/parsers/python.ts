import { DATA_SET_REGEX, STATE_SET_REGEX } from '../constants';
import type { BlockNode, DataField, PythonSymbol } from '../types';

export function parseMethods(block: BlockNode): PythonSymbol[] {
    const methods: PythonSymbol[] = [];
    const regex = /^\s*def\s+([A-Za-z_][\w]*)\s*\(/gm;

    for (const match of block.content.matchAll(regex)) {
        const name = match[1];
        const localStart = (match.index ?? 0) + match[0].indexOf(name);
        const absoluteStart = block.contentRange.start + localStart;
        methods.push({
            name,
            range: { start: absoluteStart, end: absoluteStart + name.length }
        });
    }

    return methods;
}

export function parseObjectKeys(block: BlockNode, objectName: 'state' | 'props' | 'data'): DataField[] {
    const keys: DataField[] = [];
    const objectSegment = extractAssignedObjectLiteral(block.content, objectName);
    if (!objectSegment) {
        return keys;
    }

    const content = objectSegment.content;
    const contentStart = block.contentRange.start + objectSegment.contentStart;

    const keyLines = content
        .split(/\r?\n/)
        .map((line, index) => ({ line, index }));

    let baseIndent: number | undefined;
    for (const entry of keyLines) {
        const match = entry.line.match(/^(\s*)["']([A-Za-z_][\w]*)["']\s*:\s*(.+?)\s*,?\s*$/);
        if (!match) {
            continue;
        }
        baseIndent = match[1].length;
        break;
    }

    if (baseIndent === undefined) {
        return keys;
    }

    const lineOffsets: number[] = [];
    let running = 0;
    for (const line of content.split(/\r?\n/)) {
        lineOffsets.push(running);
        running += line.length + 1;
    }

    for (const entry of keyLines) {
        const keyMatch = entry.line.match(/^(\s*)["']([A-Za-z_][\w]*)["']\s*:\s*(.+?)\s*,?\s*$/);
        if (!keyMatch) {
            continue;
        }

        const indent = keyMatch[1].length;
        if (indent !== baseIndent) {
            continue;
        }

        const name = keyMatch[2];
        const value = keyMatch[3] ?? '';
        const localLineStart = lineOffsets[entry.index] ?? 0;
        const nameInLine = entry.line.indexOf(name);
        const absoluteNameStart = contentStart + localLineStart + nameInLine;
        const absoluteEntryStart = contentStart + localLineStart;
        keys.push({
            name,
            type: inferLiteralType(value),
            range: { start: absoluteEntryStart, end: absoluteEntryStart + entry.line.length },
            nameRange: { start: absoluteNameStart, end: absoluteNameStart + name.length }
        });
    }

    return keys;
}

export function parseStateMutations(block: BlockNode): DataField[] {
    return parseMutationsFromRegex(block, STATE_SET_REGEX);
}

export function parseDataMutations(block: BlockNode): DataField[] {
    return parseMutationsFromRegex(block, DATA_SET_REGEX);
}

function parseMutationsFromRegex(block: BlockNode, regex: RegExp): DataField[] {
    const keys: DataField[] = [];

    for (const match of block.content.matchAll(regex)) {
        const name = match[1];
        const value = match[2] ?? '';
        const localStart = (match.index ?? 0) + match[0].indexOf(name);
        const absoluteNameStart = block.contentRange.start + localStart;
        const absoluteEntryStart = block.contentRange.start + (match.index ?? 0);

        keys.push({
            name,
            type: inferLiteralType(value),
            range: { start: absoluteEntryStart, end: absoluteEntryStart + match[0].length },
            nameRange: { start: absoluteNameStart, end: absoluteNameStart + name.length }
        });
    }

    return keys;
}

function extractAssignedObjectLiteral(content: string, objectName: string): { content: string; contentStart: number } | undefined {
    const assignment = new RegExp(`${objectName}\\s*=\\s*\\{`, 'm');
    const match = assignment.exec(content);
    if (!match || match.index === undefined) {
        return undefined;
    }

    const openBrace = content.indexOf('{', match.index);
    if (openBrace < 0) {
        return undefined;
    }

    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let escaped = false;

    for (let i = openBrace; i < content.length; i++) {
        const ch = content[i];

        if (escaped) {
            escaped = false;
            continue;
        }

        if (ch === '\\') {
            escaped = true;
            continue;
        }

        if (!inDouble && ch === "'") {
            inSingle = !inSingle;
            continue;
        }

        if (!inSingle && ch === '"') {
            inDouble = !inDouble;
            continue;
        }

        if (inSingle || inDouble) {
            continue;
        }

        if (ch === '{') {
            depth++;
            continue;
        }

        if (ch === '}') {
            depth--;
            if (depth === 0) {
                return {
                    content: content.slice(openBrace + 1, i),
                    contentStart: openBrace + 1
                };
            }
        }
    }

    return undefined;
}

function inferLiteralType(value: string): string {
    const normalized = value.trim();
    if (/^[-+]?\d+$/.test(normalized)) {
        return 'int';
    }
    if (/^[-+]?\d+\.\d+$/.test(normalized)) {
        return 'float';
    }
    if (/^(True|False)$/.test(normalized)) {
        return 'bool';
    }
    if (/^['"].*['"]$/.test(normalized)) {
        return 'str';
    }
    if (/^\[/.test(normalized)) {
        return 'list';
    }
    if (/^\{/.test(normalized)) {
        return 'dict';
    }
    return 'unknown';
}
