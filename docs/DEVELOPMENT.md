# Development Guide

This page is for maintainers working on the plugin itself.

## Setup

```sh
npm install
npm run build
```

## Test

```sh
npm test
npm run coverage
```

The test suite covers:

- default agent injection
- config discovery and overrides
- model alias resolution
- permission hook behavior
- optional commands
- Context7 preservation
- native OpenCode agent preservation
- postinstall behavior

## Local Install

Install this checkout into OpenCode's plugin cache:

```sh
npm run install:local
```

Restart OpenCode after installing locally.

## Git Hooks

```sh
npm run hooks:install
```

Tracked hooks run strict validation before commit and push.

## Release

```sh
npm run prepush
npm version patch
git push --follow-tags
```

The publish workflow runs typecheck/test and publishes to npm when a `v*` tag is pushed.

## Documentation Site

Docs live in:

```text
docs/
website/
```

Build locally:

```sh
python -m pip install -r website/requirements.txt
cd website
rm -rf docs/docs
cp -r ../docs docs/docs
mkdocs build --clean
```

GitHub Pages deploys when `docs/**`, `website/**`, README files, or the deploy workflow change on `main`.
