import * as assert from 'assert';
import * as vscode from 'vscode';
import { mapLspaPositionToPython, mapPythonRangeToLspa } from '../lspa-python/mapper';
import { buildVirtualPythonSnapshot, extractPythonBlock } from '../lspa-python/virtualPython';

async function openLspaDocument(content: string): Promise<vscode.TextDocument> {
    return vscode.workspace.openTextDocument({
        language: 'lspa',
        content
    });
}

suite('Python Bridge Mapping Tests', () => {
    test('extracts python block offsets and content', () => {
        const source = `<python>\nstate = {"count": 0}\n</python>\n<template></template>`;
        const block = extractPythonBlock(source);

        assert.ok(block);
        assert.strictEqual(block?.content.includes('state = {"count": 0}'), true);
        assert.ok((block?.start ?? 0) < (block?.end ?? 0));
    });

    test('returns null snapshot when python block is missing', async () => {
        const source = `<template><div /></template>`;
        const document = await openLspaDocument(source);
        const snapshot = buildVirtualPythonSnapshot(document, vscode.Uri.parse('lspa-python://test/no-python.py'));

        assert.strictEqual(snapshot, null);
    });

    test('maps positions from lspa to python only inside block', async () => {
        const source = `<python>\nstate = {"count": 0}\n</python>\n<template></template>`;
        const document = await openLspaDocument(source);
        const snapshot = buildVirtualPythonSnapshot(document, vscode.Uri.parse('lspa-python://test/map-inside.py'));

        assert.ok(snapshot);
        if (!snapshot) {
            return;
        }

        const inside = document.positionAt(snapshot.blockStartOffset + 1);
        const mappedInside = mapLspaPositionToPython(document, inside, snapshot);
        assert.ok(mappedInside);

        const outside = new vscode.Position(document.lineCount - 1, 0);
        const mappedOutside = mapLspaPositionToPython(document, outside, snapshot);
        assert.strictEqual(mappedOutside, undefined);
    });

    test('maps python ranges back to lspa and ignores out-of-bounds ranges', async () => {
        const source = `<python>\nstate = {"count": 0}\n</python>\n<template></template>`;
        const document = await openLspaDocument(source);
        const snapshot = buildVirtualPythonSnapshot(document, vscode.Uri.parse('lspa-python://test/map-range.py'));

        assert.ok(snapshot);
        if (!snapshot) {
            return;
        }

        const sourceStart = document.positionAt(snapshot.blockStartOffset + 1);
        const pythonStart = mapLspaPositionToPython(document, sourceStart, snapshot);
        assert.ok(pythonStart);
        if (!pythonStart) {
            return;
        }

        const roundTrip = mapPythonRangeToLspa(
            new vscode.Range(pythonStart, pythonStart.translate(0, 5)),
            snapshot,
            document
        );
        assert.ok(roundTrip);

        const outOfBounds = mapPythonRangeToLspa(
            new vscode.Range(new vscode.Position(999, 0), new vscode.Position(1000, 5)),
            snapshot,
            document
        );
        assert.strictEqual(outOfBounds, undefined);
    });
});
