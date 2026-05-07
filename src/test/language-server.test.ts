import * as assert from 'assert';
import { parseLspaDocument } from '../../packages/parser/src';
import { analyzePython } from '../../packages/python-analyzer/src';
import { analyzeTemplate } from '../../packages/template-analyzer/src';
import { analyzeCss } from '../../packages/css-analyzer/src';
import { ALLOWED_DIRECTIVES, ALLOWED_EVENTS } from '../../packages/template-analyzer/src';

suite('Language Server Tests', () => {
    function buildGraph(doc: string) {
        const ast = parseLspaDocument(doc);
        const python = analyzePython(ast);
        const template = analyzeTemplate(ast);
        const css = analyzeCss(ast);
        const importMap = new Map<string, string>();
        for (const imp of ast.imports) {
            if (imp.name && imp.path) {
                importMap.set(imp.name, imp.path);
            }
        }
        return { ast, python, template, css, importMap };
    }

    test('validates allowed directives', () => {
        const doc = `<python></python>

<template>
  <div i-if="condition" i-for="item in items" i-model="value" i-else i-elif="other">
  </div>
</template>`;
        const graph = buildGraph(doc);

        for (const directive of graph.ast.directives) {
            const isValid = ALLOWED_DIRECTIVES.has(directive.name);
            assert.ok(isValid, `Directive ${directive.name} should be allowed`);
        }
    });

    test('validates allowed events', () => {
        const doc = `<python></python>

<template>
  <button @click="handleClick">Click</button>
</template>`;
        const graph = buildGraph(doc);

        for (const event of graph.ast.events) {
            const isValid = ALLOWED_EVENTS.has(event.name);
            assert.ok(isValid, `Event ${event.name} should be allowed`);
        }
    });

    test('detects missing methods in events', () => {
        const doc = `<python>
def existing_handler(self):
  pass
</python>

<template>
  <button @click="existing_handler">Click</button>
  <button @click="missing_handler">Click</button>
</template>`;
        const graph = buildGraph(doc);

        const missingEvents = graph.ast.events.filter(
            event => !graph.python.methods.has(event.handler)
        );

        assert.ok(missingEvents.length > 0);
        assert.strictEqual(missingEvents[0]?.handler, 'missing_handler');
    });

    test('detects missing state fields in interpolations', () => {
        const doc = `<python>
state = {
  "existing": 0
}
</python>

<template>
  <p>{{ state.existing }}</p>
  <p>{{ state.missing }}</p>
</template>`;
        const graph = buildGraph(doc);

        const missingStates = graph.ast.interpolations.filter(interp => {
            const match = interp.expression.match(/state\.([A-Za-z_][\w]*)/);
            return match && !graph.python.state.has(match[1]);
        });

        assert.ok(missingStates.length > 0);
    });

    test('detects missing props fields in interpolations', () => {
        const doc = `<python>
props = {
  "existing": ""
}
</python>

<template>
  <p>{{ props.existing }}</p>
  <p>{{ props.missing }}</p>
</template>`;
        const graph = buildGraph(doc);

        const missingProps = graph.ast.interpolations.filter(interp => {
            const match = interp.expression.match(/props\.([A-Za-z_][\w]*)/);
            return match && !graph.python.props.has(match[1]);
        });

        assert.ok(missingProps.length > 0);
    });

    test('detects missing py data fields in interpolations', () => {
        const doc = `<python>
data = {}
data["existing"] = {}
</python>

<template>
  <p>{{ py.existing }}</p>
  <p>{{ py.missing }}</p>
</template>`;
        const graph = buildGraph(doc);

        const missingPy = graph.ast.interpolations.filter(interp => {
            const match = interp.expression.match(/py\.([A-Za-z_][\w]*)/);
            return match && !graph.python.pyData.has(match[1]);
        });

        assert.ok(missingPy.length > 0);
    });

    test('detects unused imports', () => {
        const doc = `@import FeatureCard from './FeatureCard.lspa'
@import Button from './Button.lspa'

<python></python>

<template>
  <FeatureCard />
</template>`;
        const graph = buildGraph(doc);

        const unusedImports = graph.ast.imports.filter(
            imp => imp.name && !graph.template.components.has(imp.name)
        );

        assert.ok(unusedImports.length > 0);
        assert.strictEqual(unusedImports[0]?.name, 'Button');
    });

    test('detects missing imports for used components', () => {
        const doc = `<python></python>

<template>
  <FeatureCard />
  <Button />
</template>`;
        const graph = buildGraph(doc);

        const missingImports = graph.ast.components.filter(
            comp => !graph.importMap.has(comp.name)
        );

        assert.ok(missingImports.length === 2);
        assert.ok(missingImports.some(c => c.name === 'FeatureCard'));
        assert.ok(missingImports.some(c => c.name === 'Button'));
    });

    test('provides completion candidates for state', () => {
        const doc = `<python>
state = {
  "count": 0,
  "name": "test",
  "items": []
}
</python>

<template>
  <p>{{ state. }}</p>
</template>`;
        const graph = buildGraph(doc);

        const stateFields = Array.from(graph.python.state.values());
        assert.ok(stateFields.length >= 3);
        assert.ok(stateFields.some(f => f.name === 'count'));
        assert.ok(stateFields.some(f => f.name === 'name'));
    });

    test('provides completion candidates for props', () => {
        const doc = `<python>
props = {
  "title": "",
  "visible": True
}
</python>

<template>
  <p>{{ props. }}</p>
</template>`;
        const graph = buildGraph(doc);

        const propsFields = Array.from(graph.python.props.values());
        assert.ok(propsFields.length >= 2);
        assert.ok(propsFields.some(f => f.name === 'title'));
        assert.ok(propsFields.some(f => f.name === 'visible'));
    });

    test('provides completion candidates for py', () => {
        const doc = `<python>
data = {}
data["cache"] = {}
data["result"] = "done"
</python>

<template>
  <p>{{ py. }}</p>
</template>`;
        const graph = buildGraph(doc);

        const pyFields = Array.from(graph.python.pyData.values());
        assert.ok(pyFields.length >= 2);
        assert.ok(pyFields.some(f => f.name === 'cache'));
        assert.ok(pyFields.some(f => f.name === 'result'));
    });

    test('provides completion candidates for click handlers', () => {
        const doc = `<python>
def handle_click(self):
  pass

def reload(self):
  pass
</python>

<template>
  <button @click=""></button>
</template>`;
        const graph = buildGraph(doc);

        const handlers = Array.from(graph.python.methods.values());
        assert.ok(handlers.length >= 2);
        assert.ok(handlers.some(h => h.name === 'handle_click'));
        assert.ok(handlers.some(h => h.name === 'reload'));
    });

    test('provides completion candidates for CSS classes', () => {
        const doc = `<python></python>

<template>
  <div class=""></div>
</template>

<style>
.header { color: blue; }
.btn { padding: 10px; }
</style>`;
        const graph = buildGraph(doc);

        const cssClasses = Array.from(graph.css.cssClassMap.keys());
        assert.ok(cssClasses.length >= 2);
        assert.ok(cssClasses.includes('header'));
        assert.ok(cssClasses.includes('btn'));

        const tailwindClasses = graph.css.tailwindClasses;
        assert.ok(tailwindClasses.length > 0);
    });

    test('provides completion for allowed directives', () => {
        assert.ok(ALLOWED_DIRECTIVES.has('i-for'));
        assert.ok(ALLOWED_DIRECTIVES.has('i-if'));
        assert.ok(ALLOWED_DIRECTIVES.has('i-else'));
        assert.ok(ALLOWED_DIRECTIVES.has('i-elif'));
        assert.ok(ALLOWED_DIRECTIVES.has('i-model'));
    });

    test('provides completion for allowed events', () => {
        assert.ok(ALLOWED_EVENTS.has('@click'));
    });

    test('handles complex real-world component', () => {
        const doc = `@import FeatureCard from './FeatureCard/FeatureCard.lspa'

<python>
import json

class Features(Component):
  def fetch_data(self, name):
    return {}

  def setup(self, props):
    props = {
      "title": "Features",
      "features": []
    }

    state = {
      "loading": False,
      "error": None
    }

    data = {}
    data["cache"] = {}

    def reload():
      state["loading"] = True
      data["cache"] = self.fetch_data(props["title"])

    def mounted():
      reload()
</python>

<template>
  <section class="container">
    <h1>{{ props.title }}</h1>
    <div i-if="not state.loading">
      <FeatureCard
        i-for="feature in props.features"
        title="{{ feature.title }}"
        @click="reload"
      />
      <p>Cache: {{ py.cache }}</p>
    </div>
    <div i-if="state.error">Error: {{ state.error }}</div>
  </section>
</template>

<style>
.container { padding: 20px; }
</style>`;

        const graph = buildGraph(doc);

        // Validate imports
        assert.ok(graph.importMap.has('FeatureCard'));

        // Validate Python symbols
        assert.ok(graph.python.methods.has('fetch_data'));
        assert.ok(graph.python.methods.has('reload'));
        assert.ok(graph.python.methods.has('mounted'));

        // Validate state
        assert.ok(graph.python.state.has('loading'));
        assert.ok(graph.python.state.has('error'));

        // Validate props
        assert.ok(graph.python.props.has('title'));
        assert.ok(graph.python.props.has('features'));

        // Validate py/data
        assert.ok(graph.python.pyData.has('cache'));

        // Validate components
        assert.ok(graph.template.components.has('FeatureCard'));

        // Validate directives
        const directiveNames = graph.ast.directives.map(d => d.name);
        assert.ok(directiveNames.includes('i-if'));
        assert.ok(directiveNames.includes('i-for'));

        // Validate events
        const eventHandlers = graph.ast.events.map(e => e.handler);
        assert.ok(eventHandlers.includes('reload'));

        // Validate interpolations (note: directives like i-if are not captured as interpolations)
        const expressions = graph.ast.interpolations.map(i => i.expression);
        assert.ok(expressions.some(e => e.includes('props.title')));
        assert.ok(expressions.some(e => e.includes('state.error')));
        assert.ok(expressions.some(e => e.includes('py.cache')));

        // Validate CSS
        assert.ok(graph.css.cssClassMap.has('container'));
    });
});
