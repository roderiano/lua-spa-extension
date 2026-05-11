import * as vscode from 'vscode';

export type VirtualPythonSnapshot = {
    sourceUri: vscode.Uri;
    virtualUri: vscode.Uri;
    sourceVersion: number;
    content: string;
    userCodeStartOffset: number;
    blockStartOffset: number;
    blockEndOffset: number;
};

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

    const content = block.content;

    return {
        sourceUri: document.uri,
        virtualUri,
        sourceVersion: document.version,
        content,
        userCodeStartOffset: 0,
        blockStartOffset: block.start,
        blockEndOffset: block.end
    };
}
