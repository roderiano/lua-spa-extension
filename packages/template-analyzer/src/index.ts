import type { DirectiveUse, EventUse, LspaAst } from '../../parser/src';

export const ALLOWED_DIRECTIVES = new Set(['i-for', 'i-if', 'i-else', 'i-elif', 'i-model']);
export const ALLOWED_EVENTS = new Set(['@click']);

export type TemplateAnalysis = {
    components: Set<string>;
    directives: DirectiveUse[];
    events: EventUse[];
};

export function analyzeTemplate(ast: LspaAst): TemplateAnalysis {
    return {
        components: new Set(ast.components.map((entry) => entry.name)),
        directives: ast.directives,
        events: ast.events
    };
}
