import type { ClassUse, LspaAst } from '../../parser/src';

const TAILWIND_SAMPLE = [
    'bg-red-500',
    'bg-blue-600',
    'text-white',
    'text-slate-900',
    'rounded-lg',
    'px-4',
    'py-2',
    'font-semibold',
    'shadow',
    'flex',
    'grid',
    'gap-4'
];

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
