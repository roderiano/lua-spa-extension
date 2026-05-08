import { parseBlock } from './parsers/blocks';
import { parseImports } from './parsers/imports';
import {
    parseDataMutations,
    parseMethods,
    parseObjectKeys,
    parseStateMutations
} from './parsers/python';
import {
    parseComponents,
    parseDirectives,
    parseEvents,
    parseInterpolations,
    parseTemplateClasses
} from './parsers/template';
import { parseCssClasses } from './parsers/style';
import type { LspaAst } from './types';

export type * from './types';

export function parseLspaDocument(text: string): LspaAst {
    const imports = parseImports(text);
    const pythonBlock = parseBlock(text, 'python');
    const templateBlock = parseBlock(text, 'template');
    const styleBlock = parseBlock(text, 'style');

    const methods = pythonBlock ? parseMethods(pythonBlock) : [];
    const state = pythonBlock ? parseObjectKeys(pythonBlock, 'state') : [];
    const props = pythonBlock ? parseObjectKeys(pythonBlock, 'props') : [];
    const pyData = pythonBlock ? parseObjectKeys(pythonBlock, 'data') : [];
    if (pythonBlock) {
        for (const mutation of parseStateMutations(pythonBlock)) {
            if (!state.some((entry) => entry.name === mutation.name)) {
                state.push(mutation);
            }
        }
        for (const mutation of parseDataMutations(pythonBlock)) {
            if (!pyData.some((entry) => entry.name === mutation.name)) {
                pyData.push(mutation);
            }
        }
    }

    const components = templateBlock ? parseComponents(templateBlock) : [];
    const directives = templateBlock ? parseDirectives(templateBlock) : [];
    const events = templateBlock ? parseEvents(templateBlock) : [];
    const interpolations = templateBlock ? parseInterpolations(templateBlock) : [];
    const templateClasses = templateBlock ? parseTemplateClasses(templateBlock) : [];
    const cssClasses = styleBlock ? parseCssClasses(styleBlock) : [];

    return {
        imports,
        pythonBlock,
        templateBlock,
        styleBlock,
        methods,
        state,
        props,
        pyData,
        components,
        directives,
        events,
        interpolations,
        cssClasses,
        templateClasses
    };
}
