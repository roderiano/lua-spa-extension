import * as assert from 'assert';
import { parseLspaDocument } from '../../packages/parser/src';

suite('Parser Tests', () => {
    test('parses imports correctly', () => {
        const doc = `@import FeatureCard from './FeatureCard/FeatureCard.lspa'
@import Button from './Button.lspa'

<python></python>
<template></template>`;
        const ast = parseLspaDocument(doc);
        assert.strictEqual(ast.imports.length, 2);
        assert.strictEqual(ast.imports[0]?.name, 'FeatureCard');
        assert.strictEqual(ast.imports[0]?.path, './FeatureCard/FeatureCard.lspa');
        assert.strictEqual(ast.imports[1]?.name, 'Button');
        assert.strictEqual(ast.imports[1]?.path, './Button.lspa');
    });

    test('extracts Python block content', () => {
        const doc = `<python>
import json

def foo():
  pass
</python>

<template></template>`;
        const ast = parseLspaDocument(doc);
        assert.ok(ast.pythonBlock);
        assert.ok(ast.pythonBlock?.content.includes('import json'));
        assert.ok(ast.pythonBlock?.content.includes('def foo'));
    });

    test('parses methods from Python block', () => {
        const doc = `<python>
def method_one(self):
  pass

def method_two(self, arg):
  return arg

class Features:
  def method_three(self):
    pass
</python>

<template></template>`;
        const ast = parseLspaDocument(doc);
        const methodNames = new Set(ast.methods.map(m => m.name));
        assert.ok(methodNames.has('method_one'));
        assert.ok(methodNames.has('method_two'));
        assert.ok(methodNames.has('method_three'));
    });

    test('parses state object', () => {
        const doc = `<python>
state = {
  "count": 0,
  "name": "test",
  "items": [],
  "active": True
}
</python>

<template></template>`;
        const ast = parseLspaDocument(doc);
        const stateNames = new Set(ast.state.map(s => s.name));
        assert.ok(stateNames.has('count'));
        assert.ok(stateNames.has('name'));
        assert.ok(stateNames.has('items'));
        assert.ok(stateNames.has('active'));

        const countField = ast.state.find(s => s.name === 'count');
        assert.strictEqual(countField?.type, 'int');

        const nameField = ast.state.find(s => s.name === 'name');
        assert.strictEqual(nameField?.type, 'str');

        const itemsField = ast.state.find(s => s.name === 'items');
        assert.strictEqual(itemsField?.type, 'list');

        const activeField = ast.state.find(s => s.name === 'active');
        assert.strictEqual(activeField?.type, 'bool');
    });

    test('parses props object', () => {
        const doc = `<python>
props = {
  "title": "Hello",
  "count": 42,
  "items": [1, 2, 3]
}
</python>

<template></template>`;
        const ast = parseLspaDocument(doc);
        const propNames = new Set(ast.props.map(p => p.name));
        assert.ok(propNames.has('title'));
        assert.ok(propNames.has('count'));
        assert.ok(propNames.has('items'));
    });

    test('parses data object for py namespace', () => {
        const doc = `<python>
data = {}
data["pypi"] = {
  "latest": "1.0.0",
  "author": "John"
}
data["other"] = "value"
</python>

<template></template>`;
        const ast = parseLspaDocument(doc);
        const dataNames = new Set(ast.pyData.map(d => d.name));
        assert.ok(dataNames.has('pypi'));
        assert.ok(dataNames.has('other'));
    });

    test('parses state mutations', () => {
        const doc = `<python>
state = {"count": 0}

state["count"] = 5
state["new_key"] = "value"
</python>

<template></template>`;
        const ast = parseLspaDocument(doc);
        const stateNames = new Set(ast.state.map(s => s.name));
        assert.ok(stateNames.has('count'));
        assert.ok(stateNames.has('new_key'));
    });

    test('parses data mutations', () => {
        const doc = `<python>
data = {}

data["cache"] = {}
data["result"] = "done"
</python>

<template></template>`;
        const ast = parseLspaDocument(doc);
        const dataNames = new Set(ast.pyData.map(d => d.name));
        assert.ok(dataNames.has('cache'));
        assert.ok(dataNames.has('result'));
    });

    test('parses template components', () => {
        const doc = `<python></python>

<template>
  <Card />
  <Button title="Click me" />
  <div>
    <Feature />
  </div>
  <MyComponent i-for="item in items" />
</template>`;
        const ast = parseLspaDocument(doc);
        const componentNames = new Set(ast.components.map(c => c.name));
        assert.ok(componentNames.has('Card'));
        assert.ok(componentNames.has('Button'));
        assert.ok(componentNames.has('Feature'));
        assert.ok(componentNames.has('MyComponent'));
    });

    test('parses directives', () => {
        const doc = `<python></python>

<template>
  <div i-if="condition">
    <p i-for="item in items">{{ item }}</p>
    <input i-model="text" />
    <div i-else></div>
  </div>
</template>`;
        const ast = parseLspaDocument(doc);
        const directiveNames = new Set(ast.directives.map(d => d.name));
        assert.ok(directiveNames.has('i-if'));
        assert.ok(directiveNames.has('i-for'));
        assert.ok(directiveNames.has('i-model'));
        assert.ok(directiveNames.has('i-else'));

        const forDirective = ast.directives.find(d => d.name === 'i-for');
        assert.strictEqual(forDirective?.value, 'item in items');
    });

    test('parses events', () => {
        const doc = `<python></python>

<template>
  <button @click="handleClick">Click</button>
  <div @click="other_handler">Div</div>
</template>`;
        const ast = parseLspaDocument(doc);
        assert.strictEqual(ast.events.length, 2);
        assert.strictEqual(ast.events[0]?.name, '@click');
        assert.strictEqual(ast.events[0]?.handler, 'handleClick');
        assert.strictEqual(ast.events[1]?.handler, 'other_handler');
    });

    test('parses interpolations', () => {
        const doc = `<python></python>

<template>
  <p>{{ state.count }}</p>
  <p>{{ props.title }}</p>
  <p>{{ py.data.value }}</p>
  <p>{{ state.items[0] }}</p>
</template>`;
        const ast = parseLspaDocument(doc);
        assert.strictEqual(ast.interpolations.length, 4);
        const expressions = ast.interpolations.map(i => i.expression);
        assert.ok(expressions.includes('state.count'));
        assert.ok(expressions.includes('props.title'));
        assert.ok(expressions.includes('py.data.value'));
        assert.ok(expressions.includes('state.items[0]'));
    });

    test('parses CSS classes', () => {
        const doc = `<python></python>

<template></template>

<style>
.header { color: blue; }
.btn-primary { background: blue; }
.card-container { padding: 10px; }
</style>`;
        const ast = parseLspaDocument(doc);
        const classNames = new Set(ast.cssClasses.map(c => c.name));
        assert.ok(classNames.has('header'));
        assert.ok(classNames.has('btn-primary'));
        assert.ok(classNames.has('card-container'));
    });

    test('parses template class usage', () => {
        const doc = `<python></python>

<template>
  <div class="header btn-primary">
    <p class="title text-center">Hello</p>
  </div>
</template>`;
        const ast = parseLspaDocument(doc);
        const classNames = new Set(ast.templateClasses.map(c => c.name));
        assert.ok(classNames.has('header'));
        assert.ok(classNames.has('btn-primary'));
        assert.ok(classNames.has('title'));
        assert.ok(classNames.has('text-center'));
    });

    test('parses style src attribute', () => {
        const doc = `<python></python>

<template></template>

<style src="./styles.css"></style>`;
        const ast = parseLspaDocument(doc);
        assert.ok(ast.styleBlock);
    });

    test('handles nested objects in state/props', () => {
        const doc = `<python>
props = {
  "user": {
    "name": "John",
    "age": 30
  },
  "settings": {
    "theme": "dark"
  }
}
</python>

<template></template>`;
        const ast = parseLspaDocument(doc);
        const propNames = new Set(ast.props.map(p => p.name));
        assert.ok(propNames.has('user'));
        assert.ok(propNames.has('settings'));
    });

    test('handles list values in state', () => {
        const doc = `<python>
state = {
  "items": [1, 2, 3, 4, 5],
  "tags": ["python", "spa", "backend"]
}
</python>

<template></template>`;
        const ast = parseLspaDocument(doc);
        const stateNames = new Set(ast.state.map(s => s.name));
        assert.ok(stateNames.has('items'));
        assert.ok(stateNames.has('tags'));

        const itemsField = ast.state.find(s => s.name === 'items');
        assert.strictEqual(itemsField?.type, 'list');
    });

    test('handles complex method signatures', () => {
        const doc = `<python>
def method_one(self):
  pass

def method_with_args(self, a, b, c=None, *args, **kwargs):
  pass

def async_like(self):
  return await something()
</python>

<template></template>`;
        const ast = parseLspaDocument(doc);
        const methodNames = new Set(ast.methods.map(m => m.name));
        assert.ok(methodNames.has('method_one'));
        assert.ok(methodNames.has('method_with_args'));
        assert.ok(methodNames.has('async_like'));
    });

    test('handles multiple blocks', () => {
        const doc = `@import Card from './Card.lspa'

<python>
state = {"visible": True}

def toggle():
  state["visible"] = not state["visible"]
</python>

<template>
  <Card i-if="state.visible" @click="toggle" />
</template>

<style>
.card { padding: 10px; }
</style>`;
        const ast = parseLspaDocument(doc);
        assert.ok(ast.pythonBlock);
        assert.ok(ast.templateBlock);
        assert.ok(ast.styleBlock);
        assert.strictEqual(ast.imports.length, 1);
        assert.ok(ast.state.length > 0);
        assert.ok(ast.methods.length > 0);
        assert.ok(ast.components.length > 0);
    });
});
