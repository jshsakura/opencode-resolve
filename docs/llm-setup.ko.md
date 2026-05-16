# opencode-resolve — CLI 설치

설치는 LLM에 맡기지 않습니다. 셸에서 직접 설치해야 npm 설치기가 OpenCode 등록, `resolve.json`, 오래된 플러그인 캐시 갱신을 처리할 수 있습니다.

```sh
npm install -g opencode-resolve
opencode
```

모델 핀만 다시 잡으려면:

```sh
opencode-resolve setup --models
```

기존 모델 핀을 유지한 채 `resolve.json`을 다시 생성하려면:

```sh
opencode-resolve setup --fresh
```

필요할 때 수동 캐시 갱신도 가능합니다.

```sh
opencode plugin opencode-resolve --global --force
```
