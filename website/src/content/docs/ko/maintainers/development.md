---
title: 개발
description: 빌드, 테스트, 릴리스, 문서 사이트 유지보수.
---

## 빌드

```sh
npm install
npm run build
```

## 테스트

```sh
npm test
npm run coverage
```

## 웹사이트

```sh
cd website
npm install
npm run build
```

`main`에서 `website/**`, `docs/**`, README, deploy workflow가 바뀌면 GitHub Pages가 배포됩니다.
