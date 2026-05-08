import { analyzeCss } from '../../../css-analyzer/src';
import { parseLspaDocument, type LspaAst } from '../../../parser/src';
import { analyzePython } from '../../../python-analyzer/src';
import { analyzeTemplate } from '../../../template-analyzer/src';

export type CrossSemanticGraph = {
    ast: LspaAst;
    python: ReturnType<typeof analyzePython>;
    template: ReturnType<typeof analyzeTemplate>;
    css: ReturnType<typeof analyzeCss>;
    importMap: Map<string, string>;
};

export type GraphCache = Map<string, { version: number; graph: CrossSemanticGraph }>;

export type ComponentCache = Map<string, { expiresAt: number; map: Map<string, string> }>;
