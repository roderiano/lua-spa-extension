<div align="center">
  <img src="https://github.com/roderiano/lua-spa/raw/release/src/lua_template/static/logo.png" alt="lua-spa logo" width="120" height="120" />
  <h1><strong>LUA-SPA VS Code Extension</strong></h1>
</div>

<p align="center">
  <img src="https://img.shields.io/github/license/roderiano/lua-spa-extension" />
  <img src="https://img.shields.io/github/v/release/roderiano/lua-spa-extension" />
  <img src="https://img.shields.io/github/stars/roderiano/lua-spa-extension?style=flat" />
</p>

LUA-SPA adds complete language support for LSPA files with a custom Language Server and a Python bridge for embedded Python code inside the python block.

## What The Extension Offers

### Language support for LSPA files

- File association for .lspa
- TextMate grammar for LSPA
- HTML injection in template block
- Embedded language mapping:
  - python block -> Python
  - template block -> HTML
  - style block -> CSS

### Language Server features

- IntelliSense and contextual completion for:
  - @import lines
  - component tags in template
  - directives and events
  - state, props and py fields
  - class names from style and Tailwind seed list
- Hover information for symbols and framework concepts
- Go to Definition
- Find References
- Rename Symbol
- Formatting for LSPA documents
- Document symbols
- Folding ranges
- Semantic tokens
- Code actions (quick fixes)
- Document links for import and css paths

### Diagnostics

Diagnostics currently include:

- invalid import path
- unused import
- missing component import
- invalid directive
- invalid event
- invalid directive syntax
- invalid i-for expression
- missing method for events
- missing state field usage
- missing props field usage
- missing py field usage
- unknown css class used in template

### Quick fixes

- add missing component import
- remove unused import
- create missing method in python block
- create missing state key

### Python bridge inside the python block

The extension mirrors the python block and delegates to Python providers so users get Python-like behavior while editing LSPA.

Supported bridge capabilities include:

- completion
- hover
- definition
- references
- rename
- diagnostics mapping back to source LSPA
- semantic token mapping back to source LSPA

### Visual enhancements in editor

- imported component names highlighted in template
- import component name highlighted after @import
- import path highlighting
- css src path highlighting
- template and python tag highlighting

### Command

- LSPA: Restart Language Server

## Supported LSPA syntax surface

- @import
- python block
- template block
- style block
- i-for
- i-if
- i-else
- i-elif
- i-model
- @click

## Requirements

The extension checks for Python Black on activation.

If Black is missing, install it with:

```bash
python -m pip install black
```

## Project structure

```text
packages/
  language-server/
  parser/
  python-analyzer/
  template-analyzer/
  css-analyzer/
src/
  extension.ts
  lspa-python/
src/test/
```

## Development setup

Install dependencies:

```bash
npm install
```

Build extension and language server:

```bash
npm run compile
```

Watch mode:

```bash
npm run watch
```

Run in Extension Development Host:

- Open the workspace in VS Code
- Press F5

## How to run tests

Run full validation pipeline:

```bash
npm run compile
npm run lint
npm test
```

Or run the configured pretest plus tests:

```bash
npm test
```

Notes:

- pretest already runs compile and lint
- tests run with vscode-test in an Extension Host

## Contributing with trunk-based development on release

This repository uses trunk-based flow with release as the trunk branch.

### Branch strategy

- Trunk branch: release
- Work in short-lived branches created from release
- Open PRs back into release
- Merge small, frequent, and tested changes

### Typical workflow

1. Sync trunk locally

```bash
git checkout release
git pull origin release
```

2. Create a short-lived branch

```bash
git checkout -b feat/your-change-name
```

3. Implement and validate

```bash
npm run compile
npm run lint
npm test
```

4. Commit focused changes

```bash
git add .
git commit -m "feat(scope): short description"
```

5. Rebase on latest release before PR

```bash
git fetch origin
git rebase origin/release
```

6. Push and open PR to release

```bash
git push -u origin feat/your-change-name
```

### Trunk-based rules for contributors

- Keep branches short-lived
- Prefer small PRs
- Keep release always green
- Never merge without compile, lint and test passing
- Resolve conflicts by rebasing on release

### Hotfix flow

For urgent fixes, branch from release, validate quickly, and merge back to release as soon as tests pass.

## License

See repository license and project policies.
