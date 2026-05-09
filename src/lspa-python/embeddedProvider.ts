import * as vscode from 'vscode';
import { buildVirtualPythonSnapshot, type VirtualPythonSnapshot } from './virtualPython';

export const LSPA_PYTHON_SCHEME = 'lspa-python';

export class LSPAVirtualPythonProvider implements vscode.TextDocumentContentProvider {
    private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
    private readonly snapshotByVirtual = new Map<string, VirtualPythonSnapshot>();
    private readonly virtualBySource = new Map<string, vscode.Uri>();

    readonly onDidChange = this.emitter.event;

    provideTextDocumentContent(uri: vscode.Uri): string {
        const snapshot = this.snapshotByVirtual.get(uri.toString());
        if (snapshot) {
            return snapshot.content;
        }

        const sourceUri = this.getSourceUri(uri);
        if (!sourceUri) {
            return '';
        }

        const sourceDoc = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === sourceUri.toString());
        if (!sourceDoc) {
            return '';
        }

        const created = this.ensureSnapshot(sourceDoc);
        return created?.content ?? '';
    }

    getVirtualUri(sourceUri: vscode.Uri): vscode.Uri {
        const sourceKey = sourceUri.toString();
        const existing = this.virtualBySource.get(sourceKey);
        if (existing) {
            return existing;
        }

        const uri = vscode.Uri.parse(`${LSPA_PYTHON_SCHEME}:///virtual.py?${encodeURIComponent(sourceKey)}`);
        this.virtualBySource.set(sourceKey, uri);
        return uri;
    }

    getSnapshotBySource(sourceUri: vscode.Uri): VirtualPythonSnapshot | undefined {
        const virtualUri = this.virtualBySource.get(sourceUri.toString());
        if (!virtualUri) {
            return undefined;
        }
        return this.snapshotByVirtual.get(virtualUri.toString());
    }

    getSnapshotByVirtual(virtualUri: vscode.Uri): VirtualPythonSnapshot | undefined {
        return this.snapshotByVirtual.get(virtualUri.toString());
    }

    getSourceUri(virtualUri: vscode.Uri): vscode.Uri | undefined {
        try {
            return vscode.Uri.parse(decodeURIComponent(virtualUri.query));
        } catch {
            return undefined;
        }
    }

    ensureSnapshot(sourceDocument: vscode.TextDocument): VirtualPythonSnapshot | null {
        const virtualUri = this.getVirtualUri(sourceDocument.uri);
        const existing = this.snapshotByVirtual.get(virtualUri.toString());
        if (existing && existing.sourceVersion === sourceDocument.version) {
            return existing;
        }

        const snapshot = buildVirtualPythonSnapshot(sourceDocument, virtualUri);
        if (!snapshot) {
            this.snapshotByVirtual.delete(virtualUri.toString());
            return null;
        }

        this.snapshotByVirtual.set(virtualUri.toString(), snapshot);
        this.emitter.fire(virtualUri);
        return snapshot;
    }

    refresh(sourceDocument: vscode.TextDocument): void {
        this.ensureSnapshot(sourceDocument);
    }

    clearForSource(sourceUri: vscode.Uri): void {
        const sourceKey = sourceUri.toString();
        const virtualUri = this.virtualBySource.get(sourceKey);
        if (!virtualUri) {
            return;
        }

        this.snapshotByVirtual.delete(virtualUri.toString());
        this.virtualBySource.delete(sourceKey);
    }
}
