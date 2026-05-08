import path from "path";
import { URI } from "vscode-uri";
import * as fs from 'fs';

export function listImportCandidates(documentUri: string, workspaceRoots: string[]): string[] {
    const docPath = URI.parse(documentUri).fsPath;
    const baseDir = path.dirname(docPath);

    const ignoredDirs = new Set([
        "node_modules",
        ".git",
        "__pycache__",
        ".venv",
        "venv",
        "dist",
        "build",
        "tests"
    ]);

    const candidates = new Map<string, number>();

    for (const root of workspaceRoots) {
        for (const abs of findFilesByExtensions(root, [".lspa"])) {
            if (abs === docPath) {
                continue;
            }

            if (
                abs.split(path.sep).some((part) => ignoredDirs.has(part))
            ) {
                continue;
            }

            let rel = path.relative(baseDir, abs)
                .replace(/\\/g, "/")

            if (!rel.startsWith(".")) {
                rel = "./" + rel;
            }

            // prioridade:
            // menos "../" = mais próximo
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
async function collectWorkspaceComponents(documentUri: string, workspaceRoots: string[], componentCache: Map<string, { expiresAt: number; map: Map<string, string> }>): Promise<Map<string, string>> {
    const rootKey = workspaceRoots.join('|');
    const now = Date.now();
    const cached = componentCache.get(rootKey);
    if (cached && cached.expiresAt > now) {
        return cached.map;
    }

    const map = new Map<string, string>();
    for (const root of workspaceRoots) {
        for (const filePath of findFilesByExtensions(root, ['.lspa'])) {
            if (filePath === URI.parse(documentUri).fsPath) {
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