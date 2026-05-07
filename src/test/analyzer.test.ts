import * as assert from 'assert';
import { parseLspaDocument } from '../../packages/parser/src';
import { analyzePython } from '../../packages/python-analyzer/src';
import { analyzeTemplate } from '../../packages/template-analyzer/src';
import { analyzeCss } from '../../packages/css-analyzer/src';

suite('Analyzer Tests', () => {
    test('Python analyzer extracts methods', () => {
        const doc = `<python>
def method_one(self):
  pass

def method_two(self):
  pass
</python>

<template></template>`;
        const ast = parseLspaDocument(doc);
        const analysis = analyzePython(ast);

        assert.ok(analysis.methods.has('method_one'));
        assert.ok(analysis.methods.has('method_two'));
        assert.strictEqual(analysis.methods.size, 2);
    });

    test('Python analyzer extracts state fields', () => {
        const doc = `<python>
state = {
  "count": 0,
  "name": "test"
}

state["dynamic"] = "added"
</python>

<template></template>`;
        const ast = parseLspaDocument(doc);
        const analysis = analyzePython(ast);

        assert.ok(analysis.state.has('count'));
        assert.ok(analysis.state.has('name'));
        assert.ok(analysis.state.has('dynamic'));
    });

    test('Python analyzer extracts props fields', () => {
        const doc = `<python>
props = {
  "title": "Hello",
  "visible": True,
  "items": []
}
</python>

<template></template>`;
        const ast = parseLspaDocument(doc);
        const analysis = analyzePython(ast);

        assert.ok(analysis.props.has('title'));
        assert.ok(analysis.props.has('visible'));
        assert.ok(analysis.props.has('items'));
    });

    test('Python analyzer extracts py data fields', () => {
        const doc = `<python>
data = {}
data["cache"] = {}
data["result"] = "value"
</python>

<template></template>`;
        const ast = parseLspaDocument(doc);
        const analysis = analyzePython(ast);

        assert.ok(analysis.pyData.has('cache'));
        assert.ok(analysis.pyData.has('result'));
    });

    test('Python analyzer includes framework method docs', () => {
        const doc = `<python>
def mounted(self):
  pass

def unmounted(self):
  pass

def custom(self):
  pass
</python>

<template></template>`;
        const ast = parseLspaDocument(doc);
        const analysis = analyzePython(ast);

        assert.ok(analysis.frameworkMethodDocs.has('mounted'));
        assert.ok(analysis.frameworkMethodDocs.has('unmounted'));
        assert.strictEqual(analysis.frameworkMethodDocs.get('mounted'), 'Lifecycle hook called when the component is mounted.');
    });

    test('Template analyzer extracts components', () => {
        const doc = `<python></python>

<template>
  <Card />
  <Button />
  <Card />
</template>`;
        const ast = parseLspaDocument(doc);
        const analysis = analyzeTemplate(ast);

        assert.ok(analysis.components.has('Card'));
        assert.ok(analysis.components.has('Button'));
    });

    test('Template analyzer validates directives', () => {
        const doc = `<python></python>

<template>
  <div i-if="x" i-for="item in items" i-model="text" />
</template>`;
        const ast = parseLspaDocument(doc);
        const analysis = analyzeTemplate(ast);

        const directiveNames = analysis.directives.map(d => d.name);
        assert.ok(directiveNames.includes('i-if'));
        assert.ok(directiveNames.includes('i-for'));
        assert.ok(directiveNames.includes('i-model'));
    });

    test('Template analyzer validates events', () => {
        const doc = `<python></python>

<template>
  <button @click="handle" />
</template>`;
        const ast = parseLspaDocument(doc);
        const analysis = analyzeTemplate(ast);

        assert.ok(analysis.events.length > 0);
        assert.strictEqual(analysis.events[0]?.name, '@click');
    });

    test('CSS analyzer extracts class definitions', () => {
        const doc = `<python></python>

<template></template>

<style>
.header { color: blue; }
.btn-primary { background: blue; }
</style>`;
        const ast = parseLspaDocument(doc);
        const analysis = analyzeCss(ast);

        assert.ok(analysis.cssClassMap.has('header'));
        assert.ok(analysis.cssClassMap.has('btn-primary'));
    });

    test('CSS analyzer extracts template class usage', () => {
        const doc = `<python></python>

<template>
  <div class="header btn-primary"></div>
</template>

<style></style>`;
        const ast = parseLspaDocument(doc);
        const analysis = analyzeCss(ast);

        const usedClasses = analysis.templateClassUses.map(c => c.name);
        assert.ok(usedClasses.includes('header'));
        assert.ok(usedClasses.includes('btn-primary'));
    });

    test('CSS analyzer includes Tailwind classes', () => {
        const doc = `<python></python>

<template></template>

<style></style>`;
        const ast = parseLspaDocument(doc);
        const analysis = analyzeCss(ast);

        assert.ok(analysis.tailwindClasses.includes('bg-red-500'));
        assert.ok(analysis.tailwindClasses.includes('text-white'));
    });

    test('Analyzers handle empty blocks', () => {
        const doc = `<python></python>

<template></template>`;
        const ast = parseLspaDocument(doc);

        const pyAnalysis = analyzePython(ast);
        assert.strictEqual(pyAnalysis.methods.size, 0);
        assert.strictEqual(pyAnalysis.state.size, 0);

        const tplAnalysis = analyzeTemplate(ast);
        assert.strictEqual(tplAnalysis.components.size, 0);

        const cssAnalysis = analyzeCss(ast);
        assert.strictEqual(cssAnalysis.cssClassMap.size, 0);
    });

    test('Type inference for state fields', () => {
        const doc = `<python>
state = {
  "int_val": 42,
  "float_val": 3.14,
  "str_val": "hello",
  "bool_val": True,
  "list_val": [1, 2, 3],
  "dict_val": {"a": 1}
}
</python>

<template></template>`;
        const ast = parseLspaDocument(doc);
        const analysis = analyzePython(ast);

        assert.strictEqual(analysis.state.get('int_val')?.type, 'int');
        assert.strictEqual(analysis.state.get('float_val')?.type, 'float');
        assert.strictEqual(analysis.state.get('str_val')?.type, 'str');
        assert.strictEqual(analysis.state.get('bool_val')?.type, 'bool');
        assert.strictEqual(analysis.state.get('list_val')?.type, 'list');
        assert.strictEqual(analysis.state.get('dict_val')?.type, 'dict');
    });
});
