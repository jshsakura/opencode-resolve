# opencode-resolve — OpenCode용 가벼운 해결사 플러그인

**[English](./README.md) | [한국어](./README.ko.md) | [문서 사이트](https://jshsakura.github.io/opencode-resolve/)**

[![npm version](https://img.shields.io/npm/v/opencode-resolve.svg)](https://www.npmjs.com/package/opencode-resolve)
[![CI](https://github.com/jshsakura/opencode-resolve/actions/workflows/publish.yml/badge.svg)](https://github.com/jshsakura/opencode-resolve/actions/workflows/publish.yml)
[![GitHub Pages](https://img.shields.io/badge/docs-live-blue?logo=github)](https://jshsakura.github.io/opencode-resolve/)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

`opencode-resolve`는 [OpenCode](https://opencode.ai)에 작은 고정 역할 해결 루프를 추가하는 플러그인입니다.

- `resolver`는 계획, 디스패치, 검증, 반복을 담당합니다.
- `coder`는 작은 구현 패치와 대상 검증을 담당합니다.
- `explorer`, `reviewer`, `deep-reviewer`, `planner`는 필요할 때 resolver가 부르는 내부 서브에이전트입니다.

독립 실행형 앱, 모델 프로바이더, API 키 관리자, `opencode.json` 대체물이 아닙니다.

```sh
npm install -g opencode-resolve@latest
opencode-resolve setup
```

## 목차

- [무엇을 추가하나](#무엇을-추가하나)
- [설치](#설치)
- [추천 스킬](#추천-스킬)
- [설정](#설정)
- [모델 설정](#모델-설정)
- [에이전트](#에이전트)
- [권한](#권한)
- [Context7](#context7)
- [프로젝트 컨텍스트](#프로젝트-컨텍스트)
- [업그레이드](#업그레이드)
- [개발](#개발)
- [릴리스](#릴리스)

## 무엇을 추가하나

- 작은 패치와 검증 증거를 중시하는 `resolver -> coder` 루프
- 코드베이스 탐색과 리뷰 갭 점검을 위한 읽기 전용 서브에이전트
- 선택적 명령어: `/resolve`, `/resolve-code`, `/resolve-review`
- 선택적 Context7 MCP 자동 등록
- 엄격한 설정 검증: 알 수 없는 키, 잘못된 모드, 잘못된 에이전트 이름, 잘못된 타입은 즉시 실패
- 보수적 마이그레이션: 기존 값은 동의 없이 덮어쓰지 않음

기본 활성 에이전트:

```json
["coder", "resolver", "explorer", "reviewer", "deep-reviewer", "planner"]
```

## 설치

### 한 줄 설치 (권장)

```sh
npm install -g opencode-resolve@latest
opencode-resolve setup
```

`opencode-resolve setup`이 `opencode.json`의 provider/model을 자동 감지하고, 합리적인 기본값으로 짧은 Q&A를 거친 뒤(엔터로 모두 통과 가능) `resolve.json`을 작성하고 OpenCode 플러그인 캐시를 새로고침합니다. 모델 핀을 보존한 채 언제든 다시 실행해 재설정할 수 있습니다.

### 요구 사항

- OpenCode 실행 가능: `opencode --version`
- Node.js 20 이상: `node --version`
- `~/.config/opencode/opencode.json`에 최소 하나의 OpenCode 모델 프로바이더 설정

### 설치

```sh
npm install -g opencode-resolve
opencode plugin opencode-resolve --global --force
opencode
```

npm `postinstall`이 `~/.config/opencode/opencode.json`에 플러그인을 등록하고, 없을 때만 `~/.config/opencode/resolve.json`을 만들고, 기존 모델 핀을 보존하며 (`--reset-config`로 명시 시 초기화), `~/.cache/opencode/packages/` 의 OpenCode 플러그인 캐시를 새로고침합니다.

### 다시 셋업하기

설치 이후 언제든 `opencode-resolve setup` CLI로 다시 실행할 수 있습니다.

| 명령 | 언제 사용 |
| --- | --- |
| `opencode-resolve setup --fresh` | `resolve.json` 재생성, 기존 모델 핀 유지 |
| `opencode-resolve setup --reset-config` | `resolve.json` 재생성 + 모델 핀 초기화 |
| `opencode-resolve setup --models` | 모델 핀만 다시 감지 |
| `opencode-resolve setup --force-cache` | OpenCode 플러그인 캐시만 새로고침 |

자동 설정을 건너뛰려면:

```sh
OPENCODE_RESOLVE_SKIP_POSTINSTALL=1 npm install -g opencode-resolve
```

### 선택적 companion 플러그인

- `@tarquinen/opencode-dcp@latest` — 긴 루프에서 오래된 tool output을 줄여 토큰 비용을 낮춥니다.
- `@slkiser/opencode-quota@latest` — 컨텍스트를 오염시키지 않고 토큰/quota 사용량을 보여줍니다.

### 수동 설정

`~/.config/opencode/opencode.json`에 플러그인을 추가합니다.

```json
{
  "plugin": ["opencode-resolve"]
}
```

`~/.config/opencode/resolve.json`을 만듭니다.

```json
{
  "enabled": ["coder", "resolver", "explorer", "reviewer", "deep-reviewer", "planner"],
  "preserveNative": true,
  "context7": true,
  "commands": false,
  "models": {},
  "agents": {
    "coder": { "enabled": true, "mode": "subagent" },
    "resolver": { "enabled": true },
    "explorer": { "enabled": true, "mode": "subagent" },
    "reviewer": { "enabled": true, "mode": "subagent" },
    "deep-reviewer": { "enabled": true, "mode": "subagent" },
    "planner": { "enabled": true, "mode": "subagent" }
  }
}
```

캐시를 새로고침하고 OpenCode를 재시작합니다.

```sh
opencode plugin opencode-resolve --global --force
opencode
```

OpenCode가 계속 오래된 플러그인을 로드하면:

```sh
export OPENCODE_CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/opencode"
rm -rf "$OPENCODE_CACHE_ROOT/packages/opencode-resolve@latest"
opencode plugin opencode-resolve@latest --global --force
```

## 추천 스킬

더 넓은 OpenCode 환경을 원하면 [awesome-opencode-skills](https://github.com/jshsakura/awesome-opencode-skills)를 같이 사용해 보세요. 개발, 인프라, 보안, 데이터, 문서화 등 특화 작업용 OpenCode Skills 컬렉션을 설치합니다.

macOS / Linux:

```sh
curl -sL https://raw.githubusercontent.com/jshsakura/awesome-opencode-skills/main/install.sh | bash
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/jshsakura/awesome-opencode-skills/main/install.ps1 | iex
```

## 설정

플러그인은 아래 파일 중 첫 번째로 발견한 설정을 읽습니다.

1. `.opencode/resolve.json`
2. `opencode-resolve.json`
3. `~/.config/opencode/resolve.json`
4. `~/.config/opencode/opencode-resolve.json`

`opencode.json`의 인라인 플러그인 옵션은 파일 설정보다 우선합니다. 사용자 지정 경로도 가능합니다.

```json
{
  "plugin": [
    [
      "opencode-resolve",
      { "config": ".opencode/resolve.json" }
    ]
  ]
}
```

우선순위:

```text
내장 기본값 -> 처음 발견한 설정 파일 -> 인라인 플러그인 옵션
```

전체 주석 설정 예시: [opencode-resolve.reference.jsonc](./opencode-resolve.reference.jsonc)

### 최상위 옵션

| 키 | 타입 | 기본값 | 용도 |
| --- | --- | --- | --- |
| `profile` | `mix` / `glm` / `gpt` | `mix` | 프롬프트/profile preset. |
| `tier` | `bronze` / `silver` / `gold` | 미설정 | 설정된 tier preset 활성화. |
| `enabled` | 에이전트 이름 배열 | 기본 에이전트 | 주입할 resolve 에이전트. |
| `models` | object | `{}` | 모델 별칭과 역할별 모델 핀. |
| `agents` | object | `{}` | 에이전트별 override. |
| `preserveNative` | boolean | `true` | 명시 override가 없으면 OpenCode 기본 에이전트 보존. |
| `context7` | boolean | `true` | 없을 때 Context7 MCP 등록. |
| `commands` | boolean | `false` | `/resolve`, `/resolve-code`, `/resolve-review` 추가. |
| `autoApprove` | boolean | `true` | 하위 호환용 플래그. 현재 권한은 명시 설정과 분류기가 제어. |
| `autoUpdate` | boolean | `true` | 설치/업데이트 시 추가적 설정 마이그레이션 허용. |
| `language` | `auto` / `en` / `ko` | `auto` | 프롬프트 언어 선호. |
| `maxParallelSubagents` | positive integer | 미설정 | 동시 coder 디스패치에 대한 선택적 프롬프트 수준 soft limit. |

### 에이전트 override

각 `agents.<name>` 항목은 다음 키를 받을 수 있습니다.

| 키 | 값 |
| --- | --- |
| `enabled` | boolean |
| `model` | 모델 id 또는 별칭 |
| `mode` | `subagent`, `primary`, `all` |
| `description` | string |
| `prompt` | string |
| `color` | string |
| `maxSteps` | positive integer |
| `tools` | tool boolean object |
| `permission` | `edit`, `bash`, `webfetch`, `doom_loop`, `external_directory` |

권한 값은 `ask`, `allow`, `deny`입니다. `permission.bash`는 명령 패턴별 맵도 받을 수 있습니다.

## 모델 설정

기본적으로 `models`는 비어 있고 resolve 에이전트는 OpenCode 최상위 `model`을 상속합니다. 비용, 속도, reasoning depth를 나눌 필요가 있을 때만 역할별 모델을 핀닝하세요.

각 에이전트의 모델 해석 순서:

1. `agents.<name>.model`
2. `models.<name>`
3. OpenCode 최상위 `model`
4. OpenCode 자체 fallback

3-tier 예시:

```json
{
  "models": {
    "bronze": "zai-coding-plan/glm-4.5",
    "silver": "zai-coding-plan/glm-5.1",
    "gold": "openai/gpt-5.5",
    "explorer": "bronze",
    "coder": "silver",
    "resolver": "gold",
    "reviewer": "gold",
    "deep-reviewer": "gold",
    "planner": "gold"
  }
}
```

지원 모델 별칭:

```text
fast, strong, mini, codex, quick, deep, glm, gpt,
bronze, silver, gold,
gpt-bronze, gpt-silver, gpt-gold,
glm-bronze, glm-silver, glm-gold,
모든 지원 에이전트 이름
```

## 에이전트

| 에이전트 | 기본 | 모드 | Edit | Bash | Web | 역할 |
| --- | --- | --- | --- | --- | --- | --- |
| `resolver` | yes | `all` | allow | ask | allow | 기본 오케스트레이터. |
| `coder` | yes | `subagent` | allow | ask | allow | 집중 구현과 검증. |
| `explorer` | yes | `subagent` | deny | deny | allow | 빠른 읽기 전용 코드베이스 탐색. |
| `reviewer` | yes | `subagent` | deny | deny | allow | 읽기 전용 검증 갭 리뷰. |
| `deep-reviewer` | yes | `subagent` | deny | deny | allow | 위험/고영향 변경 리뷰. |
| `planner` | yes | `subagent` | deny | deny | allow | 필요할 때만 읽기 전용 계획. |
| `gpt` | no | `all` | allow | ask | allow | GPT 최적화 primary resolver. |
| `glm` | no | `all` | allow | ask | allow | GLM/ZAI 최적화 primary resolver. |
| `codex` | no | `all` | allow | ask | allow | 레거시 Codex 최적화 primary resolver. |
| `architect` | no | `subagent` | deny | deny | allow | 설계/분해 보조. |
| `gpt-coder` | no | `subagent` | allow | ask | allow | 더 강한 구현 보조. |
| `debugger` | no | `subagent` | allow | ask | allow | 재현/root-cause 보조. |
| `researcher` | no | `subagent` | deny | deny | allow | 코드베이스/문서 리서치 보조. |

## 권한

resolve 에이전트의 bash는 기본적으로 `ask`입니다. 플러그인의 권한 훅은 흔한 읽기/테스트 명령은 자동 허용하고, force push, shell eval injection, remote script pipe 같은 위험 패턴은 거부합니다. 알 수 없는 명령은 계속 `ask`로 남습니다.

`autoApprove`는 오래된 설정과의 호환을 위해 허용되지만, 현재 동작은 명시적 에이전트 권한과 명령 분류기가 제어합니다.

신뢰할 수 없는 저장소에서는 샌드박스나 VM을 사용하세요.

## 병렬 서브에이전트

`maxParallelSubagents`는 선택 사항입니다. 생략하면 resolver는 soft guidance를 사용합니다. 진짜 독립적인 작업에만 coder를 분산하고, rate limit이 보이면 backoff합니다.

값을 설정하면 resolver 프롬프트에 삽입됩니다. 런타임 semaphore는 아닙니다. 변경 후 OpenCode를 재시작하세요. `agents.resolver.prompt`를 직접 지정하면 템플릿된 규칙은 대체됩니다.

## Context7

`context7: true`이면 `mcp.context7`이 없을 때 Context7 MCP를 등록합니다.

```json
{
  "mcp": {
    "context7": {
      "type": "remote",
      "url": "https://mcp.context7.com/mcp"
    }
  }
}
```

끄려면:

```json
{ "context7": false }
```

## 프로젝트 컨텍스트

플러그인은 repo 전체를 프롬프트에 밀어 넣지 않고, 커밋된 프로젝트 컨텍스트 위치만 노출합니다. 감지 대상:

- `HARNESS.md`
- `AGENTS.md`
- `.opencode/context`
- `.claude/context`
- `context/`
- `thoughts/`
- package manager와 흔한 검증 명령
- TypeScript 프로젝트 여부

resolver는 관련 있는 컨텍스트 문서만 읽도록 지시받습니다.

## 업그레이드

```sh
npm install -g opencode-resolve@latest
opencode plugin opencode-resolve@latest --global --force
```

특정 버전을 `opencode.json`에서 고정하고 해당 버전 캐시를 새로고침합니다.

```json
{ "plugin": ["opencode-resolve@<version>"] }
```

```sh
opencode plugin opencode-resolve@<version> --global --force
```

## 개발

```sh
npm install
npm run build
npm test
npm run coverage
```

이 checkout을 로컬 설치:

```sh
npm run install:local
```

Git hook:

```sh
npm run hooks:install
```

테스트는 에이전트 주입, 설정 로딩, 모델 별칭, 권한, 선택적 명령어, Context7 보존, 네이티브 에이전트 보존, postinstall 동작을 검증합니다.

## 릴리스

1. `package.json` 버전을 올립니다.
2. `npm run prepush`를 실행합니다.
3. 커밋하고 태그를 푸시합니다.

```sh
git add package.json package-lock.json README.md README.ko.md
git commit -m "release: vX.Y.Z"
git tag vX.Y.Z
git push origin main --tags
```

publish workflow가 테스트 후 npm에 배포합니다.

## 설계 규칙

- OpenCode 네이티브 에이전트를 기본적으로 대체하지 않습니다.
- 기본 설정은 작게 유지합니다.
- bash 권한은 보수적으로 유지합니다.
- 마이그레이션은 추가적으로만 수행합니다.
- 명확한 이점이 없으면 런타임 의존성을 늘리지 않습니다.

## 라이선스

MIT
