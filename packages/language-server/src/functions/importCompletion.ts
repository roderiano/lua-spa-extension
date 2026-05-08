import path from "path";

import {
    CompletionItem,
    CompletionItemKind,
    CompletionParams,
    MarkupKind,
    Position,
    Range,
    TextEdit
} from "vscode-languageserver";

import { TextDocument } from "vscode-languageserver-textdocument";

import { listImportCandidates } from "./utils";

export function importCompletion(
    document: TextDocument,
    params: CompletionParams,
    workspaceRoots: string[]
): CompletionItem[] {
    const lines = document.getText().split(/\r?\n/);
    const currentLine = lines[params.position.line] ?? '';
    const files = listImportCandidates(document.uri, workspaceRoots);
    const match =
        currentLine.match(/^\s*@import\s+([A-Za-z_\w-]*)$/);
    const partial = match?.[1] ?? "";

    const start =
        params.position.character - partial.length;

    return files.map((file) => {
        const importName =
            path.basename(file).split(".")[0];

        return {
            label: importName,

            kind: CompletionItemKind.Module,

            detail: "LSPA Component Import",

            documentation: {
                kind: MarkupKind.Markdown,

                value:
                    `### Import component\n\n` +
                    `Component: \`${importName}\`\n\n` +
                    `Path: \`${file}\``
            },

            textEdit: {
                range: {
                    start: {
                        line: params.position.line,
                        character: start
                    },

                    end: {
                        line: params.position.line,
                        character: params.position.character
                    }
                },

                newText:
                    `${importName} from '${file}'`
            }
        };
    });
}