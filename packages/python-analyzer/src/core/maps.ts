import type { DataField, PythonSymbol } from '../../../parser/src';

export function toSymbolMap<T extends DataField | PythonSymbol>(items: T[]): Map<string, T> {
    const map = new Map<string, T>();
    for (const item of items) {
        map.set(item.name, item);
    }
    return map;
}
