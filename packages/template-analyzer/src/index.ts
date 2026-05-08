import type { DirectiveUse, EventUse, LspaAst } from '../../parser/src';
import { ALLOWED_DIRECTIVES, ALLOWED_EVENTS } from './core/constants';

export { ALLOWED_DIRECTIVES, ALLOWED_EVENTS };

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
