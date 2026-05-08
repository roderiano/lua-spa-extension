import type { ClassUse, LspaAst } from '../../parser/src';
import { TAILWIND_SAMPLE } from './core/constants';

export type CssAnalysis = {
    cssClassMap: Map<string, ClassUse>;
    templateClassUses: ClassUse[];
    tailwindClasses: string[];
};

export function analyzeCss(ast: LspaAst): CssAnalysis {
    const cssClassMap = new Map<string, ClassUse>();
    for (const cls of ast.cssClasses) {
        cssClassMap.set(cls.name, cls);
    }

    return {
        cssClassMap,
        templateClassUses: ast.templateClasses,
        tailwindClasses: TAILWIND_SAMPLE
    };
}
