import * as path from 'path';
import * as vscode from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
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
}
