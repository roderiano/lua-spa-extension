import * as path from 'path';
import * as vscode from 'vscode';
import { spawnSync } from 'node:child_process';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';
import { parseLspaDocument } from '../packages/parser/src';
import { registerLspaPythonFeatures } from './lspa-python/pythonFeatureBridge';

let client: LanguageClient | undefined;
let importedComponentDecoration: vscode.TextEditorDecorationType | undefined;

function hasBlackInstalled(): boolean {
    try {
        const result = spawnSync('python', ['-m', 'black', '--version'], { encoding: 'utf8' });
        return result.status === 0;
    } catch {
        return false;
    }
}

async function promptBlackInstall(): Promise<void> {
    const installAction = 'Install Black';
    const selected = await vscode.window.showErrorMessage(
        'LUA-SPA Clean requires Python Black. Install it using `python -m pip install black` and reload VS Code.',
        installAction
    );

    if (selected !== installAction) {
        return;
    }

    const terminal = vscode.window.createTerminal('LSPA Setup');
    terminal.show(true);
    terminal.sendText('python -m pip install black');
    void vscode.window.showInformationMessage('Black installation started. Reload VS Code after it finishes.');
}

function applyImportedComponentDecorations(editor: vscode.TextEditor): void {
    if (!importedComponentDecoration) {
        return;
    }

    if (editor.document.languageId !== 'lspa') {
        editor.setDecorations(importedComponentDecoration, []);
        return;
    }

    const ast = parseLspaDocument(editor.document.getText());
    const importedNames = new Set(
        ast.imports
            .map((entry) => entry.name)
            .filter((name): name is string => Boolean(name))
    );

    const ranges = ast.components
        .filter((component) => importedNames.has(component.name))
        .map((component) => {
            const start = editor.document.positionAt(component.range.start);
            const end = editor.document.positionAt(component.range.end);
            return new vscode.Range(start, end);
        });

    editor.setDecorations(importedComponentDecoration, ranges);
}

function refreshImportedComponentDecorations(): void {
    for (const editor of vscode.window.visibleTextEditors) {
        applyImportedComponentDecorations(editor);
    }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    if (!hasBlackInstalled()) {
        await promptBlackInstall();
        throw new Error('Black is required but not installed.');
    }

    const serverModule = context.asAbsolutePath(path.join('out', 'packages', 'language-server', 'src', 'server.js'));
    const runOptions = { module: serverModule, transport: TransportKind.ipc };
    const debugOptions = {
        module: serverModule,
        transport: TransportKind.ipc,
        options: { execArgv: ['--nolazy', "--inspect=6010"] }
    };

    const serverOptions: ServerOptions = {
        run: runOptions,
        debug: debugOptions
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ language: 'lspa', scheme: 'file' }],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.lspa')
        }
    };

    client = new LanguageClient('lspaLanguageServer', 'LSPA Language Server', serverOptions, clientOptions);
    await client.start();
    context.subscriptions.push({
        dispose: () => {
            void client?.stop();
        }
    });

    // Register Python feature bridge for <python> blocks
    registerLspaPythonFeatures(context);

    importedComponentDecoration = vscode.window.createTextEditorDecorationType({
        color: new vscode.ThemeColor('symbolIcon.classForeground')
    });

    context.subscriptions.push(importedComponentDecoration);
    context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(() => {
        refreshImportedComponentDecorations();
    }));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
            applyImportedComponentDecorations(editor);
        }
    }));
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
        for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.uri.toString() === event.document.uri.toString()) {
                applyImportedComponentDecorations(editor);
            }
        }
    }));
    refreshImportedComponentDecorations();

    context.subscriptions.push(
        vscode.commands.registerCommand('lspa.restartLanguageServer', async () => {
            if (!client) {
                return;
            }
            await client.stop();
            await client.start();
            vscode.window.showInformationMessage('LSPA Language Server restarted.');
        })
    );
}

export async function deactivate(): Promise<void> {
    if (client) {
        await client.stop();
    }

    importedComponentDecoration = undefined;
}
