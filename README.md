# LSPA VS Code Extension

LSPA is a Python-first component language for `.lspa` files.
This extension provides a modern authoring experience inspired by Vue/Svelte/Astro workflows, built on top of a Language Server Protocol architecture.

## What This Extension Supports

Core language surface (only these directives/events are valid):

- `@import`
- `<python>`
- `<template>`
- `<style>`
- `i-for`
- `i-if`
- `i-else`
- `i-elif`
- `i-model`
- `@click`

## Features

- Syntax highlighting (TextMate grammar + template injection)
- IntelliSense and autocomplete
- Semantic highlighting (semantic tokens)
- Hover information
- Go to Definition
- Find References
- Rename Symbol (cross-block)
- Diagnostics and Quick Fixes
- Auto import suggestions for components
- Formatter
- Document symbols
- Folding ranges
- Snippets
- Full LSP client/server integration

## Professional Architecture

```text
/packages
  /language-server
  /parser
  /python-analyzer
  /template-analyzer
  /css-analyzer
/src
  extension.ts (LSP client bootstrap)
```

### Cross Semantic Graph

The language server builds a cross semantic graph that connects:

- template <-> python
- style <-> template
- imports <-> components

This graph drives completions, diagnostics, definitions, references, and rename flows.

## Parsing Layers

### Parser (`packages/parser`)

Parses `.lspa` into a structured AST-like model:

- imports
- python/template/style blocks
- methods
- state/props keys
- directives/events
- interpolations
- component usages
- CSS and template class names

### Python Analyzer (`packages/python-analyzer`)

Provides semantic model for:

- methods from setup scope
- reactive `state`
- `props`
- lifecycle docs (`mounted`, `unmounted`, `hydrated`, `updated`)

### Template Analyzer (`packages/template-analyzer`)

Validates and classifies:

- allowed directives
- allowed events
- component usage set

### CSS Analyzer (`packages/css-analyzer`)

Provides:

- CSS class map from `<style>` block
- template class usages
- Tailwind utility completion seed list

## LSP Features Implemented

The server in `packages/language-server` implements:

- completion
- hover
- diagnostics
- formatting
- references
- rename
- semantic tokens
- folding ranges
- document symbols
- code actions

## Diagnostics and Code Actions

Diagnostics include:

- invalid imports
- unused imports
- missing component imports
- invalid directives/events
- invalid `i-for` expressions
- missing methods for `@click`
- missing `state.*` and `props.*` references
- unknown CSS classes in template

Quick fixes include:

- import missing component
- remove unused import
- create missing method
- create missing state field

## Formatter

The formatter normalizes:

- import ordering
- spacing and blank lines
- trailing spaces

It is designed to coexist with external formatters such as Black/Ruff/Prettier in mixed workflows.

## Snippets

Included snippets:

- `lspa-component`
- `lspa-state`
- `i-for`
- `i-if`
- `@click`

## Development

### Install

```bash
npm install
```

### Build

```bash
npm run compile
```

### Watch

```bash
npm run watch
```

### Run extension

Press `F5` in VS Code to launch an Extension Development Host.
