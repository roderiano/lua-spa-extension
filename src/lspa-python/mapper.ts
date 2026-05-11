import * as vscode from 'vscode';
import type { VirtualPythonSnapshot } from './virtualPython';

function lineOffsets(text: string): number[] {
    const offsets = [0];
    for (let i = 0; i < text.length; i += 1) {
        if (text[i] === '\n') {
            offsets.push(i + 1);
        }
    }
    return offsets;
}

function offsetAt(text: string, position: vscode.Position): number {
    const starts = lineOffsets(text);
    const line = Math.min(Math.max(position.line, 0), starts.length - 1);
    const lineStart = starts[line];
    const lineEnd = line + 1 < starts.length ? starts[line + 1] - 1 : text.length;
    return Math.min(lineStart + Math.max(position.character, 0), lineEnd);
}

function positionAt(text: string, offset: number): vscode.Position {
    const starts = lineOffsets(text);
    const safeOffset = Math.max(0, Math.min(offset, text.length));

    let low = 0;
    let high = starts.length - 1;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const start = starts[mid];
        const next = mid + 1 < starts.length ? starts[mid + 1] : text.length + 1;
        if (safeOffset < start) {
            high = mid - 1;
        } else if (safeOffset >= next) {
            low = mid + 1;
        } else {
            return new vscode.Position(mid, safeOffset - start);
        }
    }

    const fallbackLine = starts.length - 1;
    return new vscode.Position(fallbackLine, safeOffset - starts[fallbackLine]);
}

export function isInPythonBlock(document: vscode.TextDocument, position: vscode.Position, snapshot: VirtualPythonSnapshot): boolean {
    const sourceOffset = document.offsetAt(position);
    return sourceOffset >= snapshot.blockStartOffset && sourceOffset <= snapshot.blockEndOffset;
}

export function mapLspaPositionToPython(document: vscode.TextDocument, position: vscode.Position, snapshot: VirtualPythonSnapshot): vscode.Position | undefined {
    if (!isInPythonBlock(document, position, snapshot)) {
        return undefined;
    }

    const sourceOffset = document.offsetAt(position);
    const pythonOffset = snapshot.userCodeStartOffset + (sourceOffset - snapshot.blockStartOffset);
    return positionAt(snapshot.content, pythonOffset);
}

export function mapPythonRangeToLspa(range: vscode.Range, snapshot: VirtualPythonSnapshot, sourceDocument: vscode.TextDocument): vscode.Range | undefined {
    const lines = lineOffsets(snapshot.content);
    const maxLine = lines.length - 1;
    if (range.start.line < 0 || range.end.line < 0 || range.start.line > maxLine || range.end.line > maxLine) {
        return undefined;
    }

    const virtualStart = offsetAt(snapshot.content, range.start);
    const virtualEnd = offsetAt(snapshot.content, range.end);

    const userStart = snapshot.userCodeStartOffset;
    const userEnd = userStart + (snapshot.blockEndOffset - snapshot.blockStartOffset);

    if (virtualEnd < userStart || virtualStart > userEnd) {
        return undefined;
    }

    const clampedStart = Math.max(virtualStart, userStart);
    const clampedEnd = Math.min(virtualEnd, userEnd);

    const sourceStart = snapshot.blockStartOffset + (clampedStart - userStart);
    const sourceEnd = snapshot.blockStartOffset + (clampedEnd - userStart);

    return new vscode.Range(sourceDocument.positionAt(sourceStart), sourceDocument.positionAt(sourceEnd));
}
