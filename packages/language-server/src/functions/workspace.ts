import * as fs from 'fs';
import * as path from 'path';
import { InitializeParams } from 'vscode-languageserver/node';
import { URI } from 'vscode-uri';
import type { ComponentCache } from './types';

export function extractWorkspaceRoots(params: InitializeParams): string[] {
    const roots = new Set<string>();

    if (params.workspaceFolders?.length) {
        for (const folder of params.workspaceFolders) {
            if (folder.uri.startsWith('file://')) {
                roots.add(URI.parse(folder.uri).fsPath);
            }
        }
    }

    if (params.rootUri?.startsWith('file://')) {
        roots.add(URI.parse(params.rootUri).fsPath);
    }

    if (params.rootPath) {
        roots.add(params.rootPath);
    }

    return [...roots];
}

export function resolveImportPath(documentUri: string, importPath: string, workspaceRoots: string[]): string | undefined {
    const docPath = URI.parse(documentUri).fsPath;
    const baseDir = path.dirname(docPath);
    const normalized = importPath.replace(/[?#].*$/, '').trim();

    const candidateRoots = normalized.startsWith('.') ? [baseDir] : [baseDir, ...workspaceRoots];
    for (const root of candidateRoots) {
        const absolute = path.resolve(root, normalized);
        for (const candidate of expandCandidates(absolute)) {
            if (isExistingFile(candidate)) {
                return candidate;
            }
        }
    }

    return undefined;
}

export function relativeImportPath(fromUri: string, toUri: string): string {
    const fromPath = URI.parse(fromUri).fsPath;
    const toPath = URI.parse(toUri).fsPath;
    const rel = path.relative(path.dirname(fromPath), toPath).replace(/\\/g, '/');
    return rel.startsWith('.') ? rel : `./${rel}`;
}

export function listImportCandidates(documentUri: string, workspaceRoots: string[]): string[] {
    const docPath = URI.parse(documentUri).fsPath;
    const baseDir = path.dirname(docPath);

    const ignoredDirs = new Set([
        'node_modules',
        '.git',
        '__pycache__',
        '.venv',
        'venv',
        'dist',
        'build',
        'tests'
    ]);

    const candidates = new Map<string, number>();

    for (const root of workspaceRoots) {
        for (const abs of findFilesByExtensions(root, ['.lspa'])) {
            if (abs === docPath) {
                continue;
            }

            if (abs.split(path.sep).some((part) => ignoredDirs.has(part))) {
                continue;
            }

            let rel = path.relative(baseDir, abs).replace(/\\/g, '/').replace(/\.lspa$/, '');
            if (!rel.startsWith('.')) {
                rel = `./${rel}`;
            }

            const distance = (rel.match(/\.\.\//g) || []).length;
            const current = candidates.get(rel);
            if (current === undefined || distance < current) {
                candidates.set(rel, distance);
            }
        }
    }

    return [...candidates.entries()]
        .sort((a, b) => {
            if (a[1] !== b[1]) {
                return a[1] - b[1];
            }
            return a[0].localeCompare(b[0]);
        })
        .map(([file]) => file);
}

export async function collectWorkspaceComponents(documentUri: string, workspaceRoots: string[], componentCache: ComponentCache): Promise<Map<string, string>> {
    const rootKey = workspaceRoots.join('|');
    const now = Date.now();
    const cached = componentCache.get(rootKey);
    if (cached && cached.expiresAt > now) {
        return cached.map;
    }

    const map = new Map<string, string>();
    const documentPath = URI.parse(documentUri).fsPath;

    for (const root of workspaceRoots) {
        for (const filePath of findFilesByExtensions(root, ['.lspa'])) {
            if (filePath === documentPath) {
                continue;
            }

            const parsed = path.parse(filePath);
            map.set(parsed.name, URI.file(filePath).toString());
        }
    }

    componentCache.set(rootKey, { expiresAt: now + 5000, map });
    return map;
}

export function findFilesByExtensions(root: string, extensions: string[]): string[] {
    const files: string[] = [];
    if (!fs.existsSync(root)) {
        return files;
    }

    const ignore = new Set(['node_modules', '.git', 'out', 'dist']);
    const queue = [root];

    while (queue.length > 0) {
        const current = queue.pop();
        if (!current) {
            continue;
        }

        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (!ignore.has(entry.name)) {
                    queue.push(fullPath);
                }
                continue;
            }

            if (extensions.includes(path.extname(entry.name))) {
                files.push(fullPath);
            }
        }
    }

    return files;
}

function expandCandidates(filePath: string): string[] {
    const ext = path.extname(filePath);
    if (ext) {
        const baseWithoutExt = filePath.slice(0, -ext.length);
        return [
            filePath,
            path.join(baseWithoutExt, `index${ext}`)
        ];
    }

    return [
        `${filePath}.lspa`,
        `${filePath}.py`,
        `${filePath}.css`,
        path.join(filePath, 'index.lspa'),
        path.join(filePath, 'index.py'),
        path.join(filePath, 'index.css')
    ];
}

function isExistingFile(filePath: string): boolean {
    try {
        return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    } catch {
        return false;
    }
}
