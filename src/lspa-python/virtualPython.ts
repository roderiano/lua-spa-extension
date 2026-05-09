import * as path from 'path';
import * as vscode from 'vscode';
import { parseLspaDocument } from '../../packages/parser/src';

export type VirtualPythonSnapshot = {
    sourceUri: vscode.Uri;
    virtualUri: vscode.Uri;
    sourceVersion: number;
    content: string;
    userCodeStartOffset: number;
    blockStartOffset: number;
    blockEndOffset: number;
};

function toPythonModuleName(importPath: string): string {
    const cleanPath = importPath.replace(/[?#].*$/, '');
    const ext = path.extname(cleanPath);
    const base = ext ? cleanPath.slice(0, -ext.length) : cleanPath;
    const name = path.basename(base) || 'module';
    const normalized = name.replace(/[^A-Za-z0-9_]/g, '_');
    return /^[A-Za-z_]/.test(normalized) ? normalized : `_${normalized}`;
}

function buildPrelude(sourceText: string): string {
    const ast = parseLspaDocument(sourceText);
    const importLines: string[] = [];

    for (const imp of ast.imports) {
        if (!imp.name || !imp.path) {
            continue;
        }
        const moduleName = toPythonModuleName(imp.path);
        importLines.push(`from ${moduleName} import ${imp.name}`);
    }

    const lines = [
        'from typing import *',
        '',
        'class Component:',
        '    pass',
        '',
        'props: dict = {}',
        'state: dict = {}',
        'py: dict = {}'
    ];

    if (importLines.length > 0) {
        lines.push('', '# LSPA IMPORTS');
        lines.push(...importLines);
    }

    lines.push('', '# USER CODE START');

    return lines.join('\n');
}

export function extractPythonBlock(text: string): { content: string; start: number; end: number } | null {
    const match = /(<python\b[^>]*>)([\s\S]*?)<\/python>/im.exec(text);
    if (!match || match.index === undefined) {
        return null;
    }

    const opening = match[1] ?? '<python>';
    const content = match[2] ?? '';
    const start = match.index + opening.length;

    return {
        content,
        start,
        end: start + content.length
    };
}

export function buildVirtualPythonSnapshot(document: vscode.TextDocument, virtualUri: vscode.Uri): VirtualPythonSnapshot | null {
    const sourceText = document.getText();
    const block = extractPythonBlock(sourceText);
    if (!block) {
        return null;
    }

    const prelude = buildPrelude(sourceText);
    const content = `${prelude}\n${block.content}`;

    return {
        sourceUri: document.uri,
        virtualUri,
        sourceVersion: document.version,
        content,
        userCodeStartOffset: prelude.length + 1,
        blockStartOffset: block.start,
        blockEndOffset: block.end
    };
}
