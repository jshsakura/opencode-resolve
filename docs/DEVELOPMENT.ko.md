# 개발 가이드

플러그인 자체를 유지보수하는 사람을 위한 문서입니다.

## 설정

```sh
npm install
npm run build
```

## 테스트

```sh
npm test
npm run coverage
```

테스트 범위:

- 기본 에이전트 주입
- 설정 탐색과 override
- 모델 별칭 해석
- 권한 hook 동작
- 선택적 명령어
- Context7 보존
- OpenCode 네이티브 에이전트 보존
- postinstall 동작

## 로컬 설치

이 checkout을 OpenCode 플러그인 캐시에 설치합니다.

```sh
npm run install:local
```

로컬 설치 후 OpenCode를 재시작하세요.

## Git hook

```sh
npm run hooks:install
```

추적되는 hook은 commit/push 전에 엄격한 검증을 실행합니다.

## 릴리스

```sh
npm run prepush
npm version patch
git push --follow-tags
```

`v*` 태그가 푸시되면 publish workflow가 typecheck/test 후 npm에 배포합니다.

## 문서 사이트

문서는 아래에 있습니다.

```text
docs/
website/
```

로컬 빌드:

```sh
python -m pip install -r website/requirements.txt
cd website
rm -rf docs/docs
cp -r ../docs docs/docs
mkdocs build --clean
```

`main`에서 `docs/**`, `website/**`, README, deploy workflow가 바뀌면 GitHub Pages가 배포됩니다.
