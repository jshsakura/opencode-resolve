---
title: 설치
description: opencode-resolve를 설치하고 OpenCode에 등록합니다.
---

## 요구 사항

- OpenCode 실행 가능: `opencode --version`
- Node.js 20 이상: `node --version`
- `~/.config/opencode/opencode.json`에 동작하는 provider/model

## 표준 설치

```sh
npm install -g opencode-resolve
opencode plugin opencode-resolve --global --force
opencode
```

OpenCode는 플러그인을 `~/.cache/opencode/packages/` 아래 자체 캐시에서 로드합니다. 설치나 업그레이드 뒤 캐시 새로고침이 필요합니다.

> LLM에 설치를 맡기고 싶다면 [LLM-driven Install (Auto)](/opencode-resolve/start/llm-setup/) 참고 — 한 블록만 LLM에 던지면 provider/model을 자동 감지하고 추천 3-tier로 `resolve.json`까지 작성합니다.

## 모델 설정 / 재설치 모드

npm install script는 대화형 prompt를 안정적으로 보여 주기 어렵습니다. 모델/설정을 다시 고를 때는 패키지 CLI를 사용하세요.

```sh
opencode-resolve setup --models
opencode-resolve setup --fresh
opencode-resolve setup --update
```

`resolve.json`은 건드리지 않고 OpenCode 플러그인 캐시만 강제 재설치하려면:

```sh
opencode-resolve setup --force-cache
```

## 파일

| 파일 | 용도 |
| --- | --- |
| `~/.config/opencode/opencode.json` | `plugin` 목록에 `"opencode-resolve"` 추가 |
| `~/.config/opencode/resolve.json` | resolve agent, model, option 저장 |

## 검증

재시작 후:

- `resolver`가 primary agent로 보여야 합니다.
- `coder`가 subagent로 보여야 합니다.
- 비활성화하지 않았다면 Context7이 등록되어야 합니다.

## 추천 스킬

`opencode-resolve`는 resolve loop를 제공합니다. 작업별 OpenCode Skills를 넓게 쓰려면 [awesome-opencode-skills](https://github.com/jshsakura/awesome-opencode-skills)를 같이 사용해 보세요.

macOS / Linux:

```sh
curl -sL https://raw.githubusercontent.com/jshsakura/awesome-opencode-skills/main/install.sh | bash
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/jshsakura/awesome-opencode-skills/main/install.ps1 | iex
```
