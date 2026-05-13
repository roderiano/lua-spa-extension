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
let importComponentNameDecoration: vscode.TextEditorDecorationType | undefined;
let importPathDecoration: vscode.TextEditorDecorationType | undefined;
let cssPathDecoration: vscode.TextEditorDecorationType | undefined;
let templateTagDecoration: vscode.TextEditorDecorationType | undefined;
let pythonTagDecoration: vscode.TextEditorDecorationType | undefined;

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
        'MOON-SPA requires Python Black. Install it using `python -m pip install black` and reload VS Code.',
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

function rangesFromRegex(document: vscode.TextDocument, pattern: RegExp): vscode.Range[] {
    const ranges: vscode.Range[] = [];
    const text = document.getText();

    for (const match of text.matchAll(pattern)) {
        if (match.index === undefined) {
            continue;
        }
        const start = document.positionAt(match.index);
        const end = document.positionAt(match.index + match[0].length);
        ranges.push(new vscode.Range(start, end));
    }

    return ranges;
}

function applyVisualDecorations(editor: vscode.TextEditor): void {
    if (!importedComponentDecoration || !importComponentNameDecoration || !importPathDecoration || !cssPathDecoration || !templateTagDecoration || !pythonTagDecoration) {
        return;
    }

    if (editor.document.languageId !== 'lspa') {
        editor.setDecorations(importedComponentDecoration, []);
        editor.setDecorations(importComponentNameDecoration, []);
        editor.setDecorations(importPathDecoration, []);
        editor.setDecorations(cssPathDecoration, []);
        editor.setDecorations(templateTagDecoration, []);
        editor.setDecorations(pythonTagDecoration, []);
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

    const importPathRanges = ast.imports
        .filter((entry) => entry.pathRange)
        .map((entry) => {
            const range = entry.pathRange!;
            const start = editor.document.positionAt(range.start);
            const end = editor.document.positionAt(range.end);
            return new vscode.Range(start, end);
        });

    const importComponentNameRanges = ast.imports
        .filter((entry) => entry.nameRange)
        .map((entry) => {
            const range = entry.nameRange!;
            const start = editor.document.positionAt(range.start);
            const end = editor.document.positionAt(range.end);
            return new vscode.Range(start, end);
        });

    const cssPathRanges = ast.styleBlock?.srcRange
        ? [new vscode.Range(editor.document.positionAt(ast.styleBlock.srcRange.start), editor.document.positionAt(ast.styleBlock.srcRange.end))]
        : [];

    const templateRanges = rangesFromRegex(editor.document, /<\/?template\b[^>]*>/g);
    const pythonRanges = rangesFromRegex(editor.document, /<\/?python\b[^>]*>/g);

    editor.setDecorations(importedComponentDecoration, ranges);
    editor.setDecorations(importComponentNameDecoration, importComponentNameRanges);
    editor.setDecorations(importPathDecoration, importPathRanges);
    editor.setDecorations(cssPathDecoration, cssPathRanges);
    editor.setDecorations(templateTagDecoration, templateRanges);
    editor.setDecorations(pythonTagDecoration, pythonRanges);
}

function refreshVisualDecorations(): void {
    for (const editor of vscode.window.visibleTextEditors) {
        applyVisualDecorations(editor);
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
        color: new vscode.ThemeColor('symbolIcon.classForeground'),
        fontWeight: '700',
        textDecoration: 'underline'
    });

    importComponentNameDecoration = vscode.window.createTextEditorDecorationType({
        color: new vscode.ThemeColor('symbolIcon.classForeground'),
        fontWeight: '700'
    });

    importPathDecoration = vscode.window.createTextEditorDecorationType({
        color: new vscode.ThemeColor('symbolIcon.classForeground'),
        textDecoration: 'underline'
    });

    cssPathDecoration = vscode.window.createTextEditorDecorationType({
        color: new vscode.ThemeColor('symbolIcon.fileForeground'),
        textDecoration: 'underline wavy'
    });

    templateTagDecoration = vscode.window.createTextEditorDecorationType({
        color: new vscode.ThemeColor('symbolIcon.colorForeground'),
        fontWeight: '700'
    });

    pythonTagDecoration = vscode.window.createTextEditorDecorationType({
        color: new vscode.ThemeColor('symbolIcon.namespaceForeground'),
        fontWeight: '700'
    });

    context.subscriptions.push(importedComponentDecoration);
    context.subscriptions.push(importComponentNameDecoration);
    context.subscriptions.push(importPathDecoration);
    context.subscriptions.push(cssPathDecoration);
    context.subscriptions.push(templateTagDecoration);
    context.subscriptions.push(pythonTagDecoration);
    context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(() => {
        refreshVisualDecorations();
    }));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
            applyVisualDecorations(editor);
        }
    }));
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
        for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.uri.toString() === event.document.uri.toString()) {
                applyVisualDecorations(editor);
            }
        }
    }));
    refreshVisualDecorations();

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
    importComponentNameDecoration = undefined;
    importPathDecoration = undefined;
    cssPathDecoration = undefined;
    templateTagDecoration = undefined;
    pythonTagDecoration = undefined;
}
