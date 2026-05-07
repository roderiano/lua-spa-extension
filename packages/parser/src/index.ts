export type OffsetRange = {
    start: number;
    end: number;
};

export type ImportNode = {
    name?: string;
    path?: string;
    range: OffsetRange;
    nameRange?: OffsetRange;
    pathRange?: OffsetRange;
};

export type BlockNode = {
    tag: 'python' | 'template' | 'style';
    range: OffsetRange;
    contentRange: OffsetRange;
    content: string;
};

export type PythonSymbol = {
    name: string;
    range: OffsetRange;
};

export type DataField = {
    name: string;
    type: string;
    range: OffsetRange;
    nameRange: OffsetRange;
};

export type ComponentUse = {
    name: string;
    range: OffsetRange;
};

export type DirectiveUse = {
    name: string;
    value?: string;
    range: OffsetRange;
    valueRange?: OffsetRange;
};

export type EventUse = {
    name: string;
    handler: string;
    range: OffsetRange;
    handlerRange: OffsetRange;
};

export type InterpolationUse = {
    expression: string;
    range: OffsetRange;
    expressionRange: OffsetRange;
};

export type ClassUse = {
    name: string;
    range: OffsetRange;
};

export type LspaAst = {
    imports: ImportNode[];
    pythonBlock?: BlockNode;
    templateBlock?: BlockNode;
    styleBlock?: BlockNode;
    methods: PythonSymbol[];
    state: DataField[];
    props: DataField[];
    pyData: DataField[];
    components: ComponentUse[];
    directives: DirectiveUse[];
    events: EventUse[];
    interpolations: InterpolationUse[];
    cssClasses: ClassUse[];
    templateClasses: ClassUse[];
};

const STATE_SET_REGEX = /state\s*\[\s*["']([A-Za-z_][\w]*)["']\s*\]\s*=\s*([^\n]+)/g;
const DATA_SET_REGEX = /data\s*\[\s*["']([A-Za-z_][\w]*)["']\s*\]\s*=\s*([^\n]+)/g;

export function parseLspaDocument(text: string): LspaAst {
    const imports = parseImports(text);
    const pythonBlock = parseBlock(text, 'python');
    const templateBlock = parseBlock(text, 'template');
    const styleBlock = parseBlock(text, 'style');

    const methods = pythonBlock ? parseMethods(pythonBlock) : [];
    const state = pythonBlock ? parseObjectKeys(pythonBlock, 'state') : [];
    const props = pythonBlock ? parseObjectKeys(pythonBlock, 'props') : [];
    const pyData = pythonBlock ? parseObjectKeys(pythonBlock, 'data') : [];
    if (pythonBlock) {
        for (const mutation of parseStateMutations(pythonBlock)) {
            if (!state.some((entry) => entry.name === mutation.name)) {
                state.push(mutation);
            }
        }
        for (const mutation of parseDataMutations(pythonBlock)) {
            if (!pyData.some((entry) => entry.name === mutation.name)) {
                pyData.push(mutation);
            }
        }
    }

    const components = templateBlock ? parseComponents(templateBlock) : [];
    const directives = templateBlock ? parseDirectives(templateBlock) : [];
    const events = templateBlock ? parseEvents(templateBlock) : [];
    const interpolations = templateBlock ? parseInterpolations(templateBlock) : [];
    const templateClasses = templateBlock ? parseTemplateClasses(templateBlock) : [];
    const cssClasses = styleBlock ? parseCssClasses(styleBlock) : [];

    return {
        imports,
        pythonBlock,
        templateBlock,
        styleBlock,
        methods,
        state,
        props,
        pyData,
        components,
        directives,
        events,
        interpolations,
        cssClasses,
        templateClasses
    };
}

function parseImports(text: string): ImportNode[] {
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

function parseBlock(text: string, tag: 'python' | 'template' | 'style'): BlockNode | undefined {
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

function parseMethods(block: BlockNode): PythonSymbol[] {
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

function parseObjectKeys(block: BlockNode, objectName: 'state' | 'props' | 'data'): DataField[] {
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

function parseStateMutations(block: BlockNode): DataField[] {
    const keys: DataField[] = [];
    for (const match of block.content.matchAll(STATE_SET_REGEX)) {
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

function parseDataMutations(block: BlockNode): DataField[] {
    const keys: DataField[] = [];
    for (const match of block.content.matchAll(DATA_SET_REGEX)) {
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

function parseComponents(block: BlockNode): ComponentUse[] {
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

function parseDirectives(block: BlockNode): DirectiveUse[] {
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

function parseEvents(block: BlockNode): EventUse[] {
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

function parseInterpolations(block: BlockNode): InterpolationUse[] {
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

function parseCssClasses(block: BlockNode): ClassUse[] {
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

function parseTemplateClasses(block: BlockNode): ClassUse[] {
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
