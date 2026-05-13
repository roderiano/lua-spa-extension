import * as assert from 'assert';
import * as vscode from 'vscode';
import { parseLspaDocument } from '../../packages/parser/src';
import { analyzePython } from '../../packages/python-analyzer/src';

const featuresComponentSource = `@import FeatureCard from './FeatureCard/FeatureCard.lspa'

<python>
import json
import re

try:
	import requests
except Exception:
	requests = None

class Features(Component):
	def fetch_pypi_versions(self, package_name, package_owner, limit):
		return {}

	def setup(self, props):
		props = {
			"title": "moon-spa",
			"subtitle": "Python Framework for Single Page Applications",
			"tagline": "Combine Server Rendering with Client Hydration to build modern, fast SPAs with pure Python.",
			"package_name": "moon-spa",
			"package_owner": "roderiano",
			"versions_limit": 8,
			"features": [
				{
					"icon": "python",
					"title": "Pure Python",
					"description": "Write component logic in Python while moon-spa handles runtime behavior."
				}
			],
			**props,
		}

		state = {
			"mounted": False,
			"reload_count": 0,
			"status": "idle",
		}

		data = {}
		data["pypi"] = {
			"available": False,
			"latest": "",
			"author": "",
		}

		def reload_packages():
			state["reload_count"] += 1
			data["pypi"] = self.fetch_pypi_versions(
				props["package_name"],
				props["package_owner"],
				props["versions_limit"],
			)

		def mounted():
			state["mounted"] = True
			reload_packages()
</python>

<template>
	<section class="hero-route">
		<button type="button" class="hero-route__btn" @click="reload_packages">Reload</button>
		<code>pip install moon-spa=={{ py.pypi.latest }}</code>
		<p>{{ py.pypi.author }}</p>
		<p>{{ state.status }} | {{ state.mounted }} | {{ state.reload_count }}</p>

		<FeatureCard
			i-for="feature in props.features"
			icon="{{ feature.icon }}"
			title="{{ feature.title }}"
			description="{{ feature.description }}"
		/>
	</section>
</template>

<style src="./Features.css"></style>
`;

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('parses complex Features component semantics', () => {
        const ast = parseLspaDocument(featuresComponentSource);

        assert.strictEqual(ast.imports.length, 1);
        assert.strictEqual(ast.imports[0]?.name, 'FeatureCard');
        assert.strictEqual(ast.imports[0]?.path, './FeatureCard/FeatureCard.lspa');

        const methodNames = new Set(ast.methods.map((entry) => entry.name));
        assert.ok(methodNames.has('fetch_pypi_versions'));
        assert.ok(methodNames.has('reload_packages'));
        assert.ok(methodNames.has('mounted'));

        const propsNames = new Set(ast.props.map((entry) => entry.name));
        assert.ok(propsNames.has('title'));
        assert.ok(propsNames.has('subtitle'));
        assert.ok(propsNames.has('tagline'));
        assert.ok(propsNames.has('features'));
        assert.ok(!propsNames.has('icon'));

        const pyNames = new Set(ast.pyData.map((entry) => entry.name));
        assert.ok(pyNames.has('pypi'));

        const clickEvent = ast.events.find((entry) => entry.name === '@click');
        assert.strictEqual(clickEvent?.handler, 'reload_packages');

        const loopDirective = ast.directives.find((entry) => entry.name === 'i-for');
        assert.strictEqual(loopDirective?.value, 'feature in props.features');

        const interpolationExpressions = new Set(ast.interpolations.map((entry) => entry.expression));
        assert.ok(interpolationExpressions.has('py.pypi.latest'));
        assert.ok(interpolationExpressions.has('py.pypi.author'));
        assert.ok(interpolationExpressions.has('state.status'));
    });

    test('analyzes py, state and props maps', () => {
        const ast = parseLspaDocument(featuresComponentSource);
        const analysis = analyzePython(ast);

        assert.ok(analysis.methods.has('reload_packages'));
        assert.ok(analysis.state.has('status'));
        assert.ok(analysis.props.has('features'));
        assert.ok(analysis.pyData.has('pypi'));
    });
});
