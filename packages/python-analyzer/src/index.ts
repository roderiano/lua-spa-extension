import type { DataField, LspaAst, PythonSymbol } from '../../parser/src';

const FRAMEWORK_METHOD_DOCS = new Map<string, string>([
    ['mounted', 'Lifecycle hook called when the component is mounted.'],
    ['unmounted', 'Lifecycle hook called when the component is unmounted.'],
    ['hydrated', 'Lifecycle hook called after client hydration.'],
    ['updated', 'Lifecycle hook called after reactive updates.']
]);

export type PythonAnalysis = {
    methods: Map<string, PythonSymbol>;
    state: Map<string, DataField>;
    props: Map<string, DataField>;
    pyData: Map<string, DataField>;
    frameworkMethodDocs: Map<string, string>;
};

export function analyzePython(ast: LspaAst): PythonAnalysis {
    const methods = new Map<string, PythonSymbol>();
    for (const method of ast.methods) {
        methods.set(method.name, method);
    }

    const state = new Map<string, DataField>();
    for (const field of ast.state) {
        state.set(field.name, field);
    }

    const props = new Map<string, DataField>();
    for (const field of ast.props) {
        props.set(field.name, field);
    }

    const pyData = new Map<string, DataField>();
    for (const field of ast.pyData) {
        pyData.set(field.name, field);
    }

    return {
        methods,
        state,
        props,
        pyData,
        frameworkMethodDocs: FRAMEWORK_METHOD_DOCS
    };
}
