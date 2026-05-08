import type { DataField, LspaAst, PythonSymbol } from '../../parser/src';
import { FRAMEWORK_METHOD_DOCS } from './core/constants';
import { toSymbolMap } from './core/maps';

export type PythonAnalysis = {
    methods: Map<string, PythonSymbol>;
    state: Map<string, DataField>;
    props: Map<string, DataField>;
    pyData: Map<string, DataField>;
    frameworkMethodDocs: Map<string, string>;
};

export function analyzePython(ast: LspaAst): PythonAnalysis {
    const methods = toSymbolMap<PythonSymbol>(ast.methods);
    const state = toSymbolMap<DataField>(ast.state);
    const props = toSymbolMap<DataField>(ast.props);
    const pyData = toSymbolMap<DataField>(ast.pyData);

    return {
        methods,
        state,
        props,
        pyData,
        frameworkMethodDocs: FRAMEWORK_METHOD_DOCS
    };
}
