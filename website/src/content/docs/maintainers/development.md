---
title: Development
description: Build, test, release, and maintain the documentation site.
---

## Build

```sh
npm install
npm run build
```

## Test

```sh
npm test
npm run coverage
```

## Local Plugin Install

```sh
npm run install:local
```

Restart OpenCode after installing locally.

## Website

```sh
cd website
npm install
npm run build
```

GitHub Pages deploys when `website/**`, `docs/**`, README files, or the deploy workflow change on `main`.
