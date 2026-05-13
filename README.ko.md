# opencode-resolve — OpenCode용 가벼운 해결사(resolver) 플러그인

**[English](./README.md) | [한국어](./README.ko.md)**

[![npm version](https://img.shields.io/npm/v/opencode-resolve.svg)](https://www.npmjs.com/package/opencode-resolve)
[![CI](https://github.com/jshsakura/opencode-resolve/actions/workflows/publish.yml/badge.svg)](https://github.com/jshsakura/opencode-resolve/actions/workflows/publish.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

> **opencode-resolve**는 **[OpenCode](https://opencode.ai)용 가벼운 해결사(resolver) 플러그인**입니다. OpenCode 세션 _내부_ 에서 동작하며, 하나의 지시를 완성되고 검증된 변경으로 만듭니다 — 이것이 여기서 말하는 _해결(resolve)_ 의 의미입니다.
>
> 독립 실행형 애플리케이션이 아니며, 모델 프로바이더도, 매일 실행하는 별도 CLI도, `opencode.json` 설정을 대체하는 것도 아닙니다. OpenCode 플러그인이며 그 이상도 이하도 아닙니다.

**고정 역할(fixed-role) 검증 해결 루프**를 제공합니다 — **resolver**(컨텍스트 효율적 플래너/판정자)와 **coder**(집중된 구현자)가 자동 승인 권한으로 실행되어 매 단계마다 프롬프트를 띄우지 않고 작업을 완료합니다. Resolver는 관련 파일만 검사하고, 가장 작은 패치를 계획하고, 정확한 지시와 함께 coder를 디스패치하며, 검증된 체크포인트를 통해 반복합니다. 각 체크포인트는 실패 시 최대 3회 재시도되며, 그 후 resolver는 다음 단계로 진행합니다. 내부 전문가 서브에이전트(**explorer**, **reviewer**, **deep-reviewer**)는 OpenCode 네이티브 서브에이전트로 기본 주입됩니다 — resolver가 필요하다고 판단할 때 디스패치되지만, 핵심 경로의 일부가 아니며 사용자 대면 기본 역할이 아닙니다. 역할을 정의할 뿐 모델 프로바이더를 정의하지 않습니다: 에이전트는 사용자가 지정하지 않는 한 OpenCode 기본 모델을 상속합니다.

```
# AI 코딩 어시스턴트에 붙여넣기만 하면 전체 설정이 자동으로 완료됩니다
Install and configure opencode-resolve by following the instructions here:
https://github.com/jshsakura/opencode-resolve#drop-in-setup-give-to-an-llm
```

---

## 이것은 무엇이고, 무엇이 아닌가

| ✅ 이것은 | ❌ 이것은 아닙니다 |
|---|---|
| `opencode plugin opencode-resolve`로 설치하는 **OpenCode용 가벼운 해결사(resolver) 플러그인** | 독립 실행형 앱 또는 별도 CLI |
| OpenCode에 주입되는 고정 역할(fixed-role) 검증 루프(resolver + coder) | 모델 프로바이더 또는 API 키 관리자 |
| Context7 MCP 자동 등록 훅 | `opencode.json` 설정을 대체하는 것 |
| OpenCode 설정과 함께 위치하는 설정 파일(`resolve.json`) | 코딩할 때마다 직접 실행해야 하는 것 |
| 한 번 설치 후 OpenCode 내부에서 자동으로 실행 | OpenCode 자체를 대체하는 것 |

OpenCode가 설치되어 있지 않거나 실행 중이 아니면 opencode-resolve는 아무것도 하지 않습니다.

---

## 목차

- [기능](#기능)
- [AI 기반 설정](#ai-기반-설정)
- [사전 요구 사항](#사전-요구-사항)
- [빠른 시작](#빠른-시작)
- [드롭인 설정 (LLM에 전달)](#드롭인-설정-llm에-전달)
- [기본 동작](#기본-동작)
- [설정](#설정)
- [설정 참조](#설정-참조)
- [자동 승인](#자동-승인)
- [병렬 서브에이전트 제한](#병렬-서브에이전트-제한)
- [업그레이드 및 마이그레이션](#업그레이드-및-마이그레이션)
- [모델 설정](#모델-설정)
- [에이전트 참조](#에이전트-참조)
- [선택적 명령어](#선택적-명령어)
- [Context7 통합](#context7-통합)
- [최신 상태 유지](#최신-상태-유지)
- [로컬 개발](#로컬-개발)
- [검증](#검증)
- [릴리스](#릴리스)
- [설계 규칙](#설계-규칙)
- [라이선스](#라이선스)

---

## 기능

- **고정 역할(fixed-role) 검증 해결 루프** — `resolver`(컨텍스트 효율적 플래너/판정자) + `coder`(집중된 구현자)
- **기본적으로 컨텍스트 효율적** — 최소 파일 읽기, 가장 작은 패치, 대상 검증, 체크포인트 실행으로 실패한 체크포인트당 최대 3회 재시도
- **OpenCode 네이티브 내부 전문가 서브에이전트** — `reviewer`(검증 갭 감사), `explorer`(코드베이스 스카우트), `deep-reviewer`(위험/보안 리뷰) — 서브에이전트로 기본 주입되지만 핵심 경로가 아님; resolver가 필요할 때만 디스패치
- **자동 승인 권한** — coder와 resolver는 작업별 프롬프트 없이 동작
- **Context7 MCP** — `context7: true` 시 [Context7](https://context7.com) 문서 조회를 자동 등록
- **모델 핀닝** — 이점을 측정한 경우 역할별로 다른 모델 지정 가능; 기본적으로 모든 역할이 OpenCode 기본 모델을 상속
- **소프트 병렬 상한** — `maxParallelSubagents`가 resolver의 coder 동시 실행 수를 제어
- **엄격한 검증** — 알 수 없는 키, 오타, 잘못된 모드, 잘못된 타입은 로드 시 즉시 실패
- **추가적 마이그레이션** — 업그레이드 시 기존 설정을 덮어쓰지 않음
- **`@opencode-ai/plugin` 외의 종속성 없음** — 추가로 설치할 것이 없음

---

## AI 기반 설정

> **한 줄. 어떤 AI 코딩 어시스턴트든. 모든 것이 자동으로 구성됩니다.**

Claude Code, Cursor, Codex, OpenCode, Windsurf, VS Code Copilot, 또는 Gemini CLI에 붙여넣으세요:

```
Install and configure opencode-resolve by following the instructions here:
https://github.com/jshsakura/opencode-resolve#drop-in-setup-give-to-an-llm
```

AI가 자동으로:

1. `opencode plugin opencode-resolve --global --force`로 플러그인을 설치
2. `opencode-resolve`를 `opencode.json` 플러그인 배열에 병합
3. 동작하는 설정으로 `resolve.json` 생성
4. OpenCode 재시작 안내

수동 설정 편집이 필요 없습니다. macOS, Linux, Windows에서 작동합니다.

> 수동 설정은 아래 [사전 요구 사항](#사전-요구-사항)과 [빠른 시작](#빠른-시작)을 참조하세요.

---

## 사전 요구 사항

### 1. OpenCode

opencode-resolve는 **OpenCode 플러그인**입니다. [OpenCode](https://opencode.ai)가 설치되어 실행 중이어야 합니다.

확인:

```sh
opencode --version
```

### 2. Node.js ≥ 20

플러그인과 OpenCode 자체는 Node.js 20 이상이 필요합니다.

확인:

```sh
node --version   # v20.x 이상이어야 함
```

### 3. 설정된 모델 프로바이더

OpenCode는 `~/.config/opencode/opencode.json`에 유효한 API 키와 함께 최소 하나의 모델 프로바이더가 설정되어야 합니다. opencode-resolve 에이전트는 핀닝하지 않는 한 기본 모델을 상속합니다.

최소 프로바이더 설정 예:

```json
{
  "model": "openai/gpt-4o",
  "provider": {
    "openai": {
      "name": "OpenAI"
    }
  }
}
```

> 추가 API 키나 MCP 서버는 필요 없습니다. Context7은 플러그인이 자동으로 등록합니다.

---

## 빠른 시작

### npm에서 설치

```sh
npm install -g opencode-resolve
```

`postinstall` 스크립트가 자동으로:

1. `opencode-resolve`를 `~/.config/opencode/opencode.json`의 `plugin` 배열에 추가 (이미 없는 경우).
2. `~/.config/opencode/resolve.json`을 배포된 [`opencode-resolve.example.json`](./opencode-resolve.example.json)에서 생성 (파일이 존재하지 않는 경우).

자동 등록을 건너뛰려면:

```sh
OPENCODE_RESOLVE_SKIP_POSTINSTALL=1 npm install -g opencode-resolve
```

### 플러그인 캐시 새로고침

> **중요 — OpenCode가 플러그인을 자체적으로 캐시합니다.** OpenCode는 전역 설치된 npm 패키지를 직접 사용하지 않습니다. `~/.cache/opencode/packages/`에 자체 캐시를 유지합니다. 최초 설치 후 (또는 향후 업그레이드 시) 캐시를 새로고침하세요:

```sh
opencode plugin opencode-resolve --global --force
```

### 수동 대안

`postinstall`이 플러그인을 등록하지 않았다면, `~/.config/opencode/opencode.json`에 직접 추가:

```json
{
  "plugin": ["opencode-resolve"]
}
```

### OpenCode 재시작

```sh
opencode
```

`resolver`, `coder` 에이전트가 사용 가능한지 확인합니다.

---

## 드롭인 설정 (LLM에 전달)

아래 블록을 능력 있는 LLM에 _"이 머신에 opencode-resolve를 설정해줘"_ 지시와 함께 전달하면 설치를 끝까지 완료할 수 있습니다. 아래가 전체 필요 설정이며 — 다른 MCP 서버, 환경 변수, 파일은 필요 없습니다.

### 1단계 — 설치 및 캐시 준비

```sh
opencode plugin opencode-resolve --global --force
```

플러그인을 다운로드하고, OpenCode 패키지 캐시(`~/.cache/opencode/packages/`)에 설치하며, 사용 가능하게 만듭니다.

### 2단계 — `~/.config/opencode/opencode.json`에 플러그인 등록

기존 파일에 병합; **교체하지 마세요**:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "<사용자-기본-모델-id>",
  "plugin": ["opencode-resolve"]
}
```

> 이미 다른 플러그인이 있다면, 기존 `plugin` 배열에 `"opencode-resolve"`를 추가하세요.

### 3단계 — `~/.config/opencode/resolve.json` 생성

이 파일은 `postinstall`에 의해 자동 생성됩니다. 생성되지 않았거나, 권장 설정을 원하면 아래 블록을 복사하세요. 기본적으로 모든 역할이 OpenCode 기본 모델을 상속합니다 — `models` 블록이 필요 없습니다.

```json
{
  "enabled": ["coder", "resolver", "explorer", "reviewer", "deep-reviewer"],
  "preserveNative": true,
  "context7": true,
  "commands": false,
  "models": {},
  "agents": {
    "coder":    { "mode": "all" },
    "resolver": { "enabled": true },
    "explorer":      { "mode": "subagent" },
    "reviewer":      { "mode": "subagent" },
    "deep-reviewer": { "mode": "subagent" },
    "architect":  { "enabled": false },
    "gpt-coder":  { "enabled": false },
    "debugger":   { "enabled": false },
    "researcher": { "enabled": false }
  },
  "autoApprove": true,
  "maxParallelSubagents": 2
}
```

> **역할별 모델을 원하나요?** `models` 블록에 역할을 원하는 모델 ID로 핀닝하세요. 자세한 내용은 [모델 설정](#모델-설정)을 참조하세요. 권장 기본값은 모든 역할에 하나의 효율적인 모델을 사용하는 것 — `models`를 비워두세요.

### 4단계 — OpenCode 재시작

OpenCode를 닫았다가 다시 여세요. 핵심 에이전트는 `resolver`와 `coder`입니다. 내부 전문가 서브에이전트(`explorer`, `reviewer`, `deep-reviewer`)는 기본적으로 서브에이전트로 사용 가능하며, resolver가 필요하다고 판단할 때 디스패치됩니다 — 사용자 대면 기본 역할이 아닙니다.

### 이 템플릿을 사용하는 이유

| 설정 | 이유 |
|---|---|
| `enabled: ["coder", "resolver", "explorer", "reviewer", "deep-reviewer"]` | 고정 핵심 경로(resolver→coder) + OpenCode 네이티브 내부 전문가 서브에이전트 기본 주입 |
| `autoApprove: true` | Coder와 resolver가 작업별 프롬프트 없이 동작 |
| `maxParallelSubagents: 2` | 최대 2개의 coder가 독립 작업에 병렬 실행 가능 |
| `agents.coder.mode = "all"` | Coder가 에이전트 선택기에 표시됨 (서브에이전트 전용이 아님) |
| `agents.{explorer,reviewer,deep-reviewer}.mode = "subagent"` | 내부 전문가는 서브에이전트 전용 — 사용자 대면 기본 역할이 아님 |
| `context7: true` | 플러그인이 Context7 MCP를 자동 등록 — 수동 MCP 설정 불필요 |
| `models` 별칭 | 기본적으로 비어있음 — 모든 역할이 OpenCode 기본 모델을 상속. 이점을 측정한 경우에만 역할별 모델 핀닝 |
| 다른 에이전트 비활성화 | `architect`, `gpt-coder`, `debugger`, `researcher`는 기본 꺼짐. 필요 시 활성화 |

### resolver를 호출하면 어떤 일이 일어나는가

1. **분류** — Resolver가 작업을 quick, normal, deep, risky로 분류합니다.
2. **검사** — 로컬 도구로 관련 파일만 읽습니다. 광범위한 탐색 없음.
3. **사소한 작업** — Resolver가 직접 작은 편집을 적용합니다. 서브에이전트 불필요.
4. **구현** — 정확한 파일 경로와 집중된 지시와 함께 `coder`를 디스패치합니다.
5. **검증** — 가장 저렴한 의미 있는 검증을 먼저 실행합니다 (대상 테스트, 타입 체크, 린트).
6. **재시도** — 문제가 남아있으면, 검증 로그에서 집중적인 수정과 함께 `coder`를 다시 디스패치합니다. 실패한 체크포인트당 최대 3회 재시도. 검증 통과 시 다음 체크포인트로 진행.
7. **보고** — 변경 사항, 검증 결과, 남은 차단 사항의 간결한 증거 요약을 반환합니다.
8. **내부 전문가** — 필요 시: `explorer`(범위가 불명확할 때), `reviewer`(비사소한 변경에 검증 갭), `deep-reviewer`(위험/보안/고영향도만). 서브에이전트로 기본 사용 가능하지만 핵심 경로가 아님.

---

## 기본 동작

| 항목 | 기본값 |
|---|---|
| 활성화된 에이전트 | `coder`, `resolver`, `explorer`, `reviewer`, `deep-reviewer` |
| 핵심 경로 | `resolver` → `coder` (고정 역할 검증 루프) |
| 내부 서브에이전트 | `explorer`, `reviewer`, `deep-reviewer` (서브에이전트 전용, 필요 시 디스패치) |
| 새 작업의 기본 에이전트 | `resolver` (`mode: "all"`) |
| 에이전트 모델 | 최상위 OpenCode `model` 상속 |
| 네이티브 `plan` / `build` | 그대로 보존 |
| Context7 MCP 프리셋 | `context7: true` 시 자동 추가 |
| 선택적 명령어 | 비활성화 |
| `autoApprove` | `true` (coder/resolver에 작업별 프롬프트 없음) |
| 체크포인트당 최대 재시도 | 3회 (resolver 프롬프트를 통해) |

---

## 설정

플러그인은 찾은 첫 번째 설정 파일을 읽습니다:

| 우선순위 | 경로 |
|---:|---|
| 1 | `.opencode/resolve.json` (프로젝트) |
| 2 | `opencode-resolve.json` (프로젝트) |
| 3 | `~/.config/opencode/resolve.json` |
| 4 | `~/.config/opencode/opencode-resolve.json` |

`opencode.json`의 인라인 플러그인 옵션이 파일 설정을 재정의합니다.

설정 우선순위:

```text
기본 제공 기본값 → 찾은 첫 번째 설정 파일 → 인라인 플러그인 옵션
```

최소 설정 (기본값과 동일):

```json
{
  "enabled": ["coder", "resolver", "explorer", "reviewer", "deep-reviewer"],
  "autoApprove": true,
  "context7": true,
  "commands": false
}
```

`opencode.json` 내의 인라인 형식:

```json
{
  "plugin": [
    [
      "opencode-resolve",
      {
        "enabled": ["coder", "resolver", "explorer", "reviewer", "deep-reviewer"],
        "autoApprove": true,
        "context7": true,
        "commands": false
      }
    ]
  ]
}
```

엄격한 검증은 알 수 없는 에이전트 이름, 잘못된 키, 잘못된 모드, 잘못된 권한 값, 잘못된 값 타입을 거부합니다 — 오타는 즉시 실패합니다.

---

## 설정 참조

모든 허용되는 최상위 옵션:

| 키 | 타입 | 기본값 | 용도 |
|---|---|---|---|
| `enabled` | `string[]` | `["coder", "resolver", "explorer", "reviewer", "deep-reviewer"]` | 주입할 resolve 에이전트. 핵심 경로: resolver→coder. 내부 전문가(explorer, reviewer, deep-reviewer)는 서브에이전트 전용. 에이전트별 `agents.<name>.enabled`가 이것을 재정의. |
| `preserveNative` | `boolean` | `true` | 네이티브 `plan`/`build`는 항상 보존됨. 가독성을 위해 허용됨. |
| `context7` | `boolean` | `true` | true인 경우, 이미 구성되지 않았으면 Context7 MCP 서버를 등록. |
| `commands` | `boolean` | `false` | true인 경우, `resolve`, `resolve-code`, `resolve-review` 명령어 추가. |
| `autoApprove` | `boolean` | `true` | 활성화된 에이전트의 기본 `"ask"` 권한을 `"allow"`로 전환. `"deny"`나 사용자가 설정한 키는 건드리지 않음. |
| `maxParallelSubagents` | `positive integer` | `2` | resolver가 역할당 동시에 디스패치하는 서브에이전트의 상한. |
| `models` | `object` | `{}` | 별칭 맵. 키는 에이전트 이름 또는 `fast`/`strong`/`mini`/`codex`/`quick`/`deep`/`glm`/`gpt`. 값은 모델 id 또는 다른 별칭. 기본적으로 비어있음 — 모든 역할이 OpenCode 기본 모델을 상속. |
| `agents` | `object` | `{}` | 에이전트별 재정의 (아래 참조). |
| `config` | `string` | _없음_ | 설정 파일의 사용자 정의 경로 (프로젝트 상대경로 또는 절대경로). |

`agents.<name>` 내의 에이전트별 옵션:

| 키 | 타입 | 참고 |
|---|---|---|
| `enabled` | `boolean` | 최상위 `enabled`와 관계없이 이 에이전트를 강제 활성화/비활성화. |
| `model` | `string` | 모델 id 또는 별칭. 최상위 `models` 맵에 대해 해석됨. |
| `mode` | `"subagent" \| "primary" \| "all"` | OpenCode 에이전트 모드. |
| `description` | `string` | 다른 에이전트에게 표시되는 기본 설명을 재정의. |
| `prompt` | `string` | 기본 시스템 프롬프트를 재정의. (`resolver`의 경우 템플릿된 병렬 규칙 프롬프트도 비활성화.) |
| `color` | `string` | UI 색상. |
| `maxSteps` | `positive integer` | 호출당 단계 예산. |
| `tools` | `Record<string, boolean>` | 개별 OpenCode 도구 토글. |
| `permission` | `object` | 권한 재정의 — 아래 참조. |

권한 키 (각각 `"ask"`, `"allow"`, 또는 `"deny"`):

`edit`, `bash`, `webfetch`, `doom_loop`, `external_directory`.

`permission.bash`는 명령별 맵일 수도 있습니다:

```json
{
  "permission": {
    "bash": { "npm test": "allow", "rm -rf": "deny" }
  }
}
```

완전히 주석이 달린 참조 설정이 [`opencode-resolve.reference.jsonc`](./opencode-resolve.reference.jsonc)로 패키지에 포함되어 있습니다 — 필요한 키를 `resolve.json`에 복사하세요 (주석 제외).

---

## 자동 승인

`autoApprove` (기본값 `true`)는 **활성화된** 에이전트의 모든 `"ask"` 권한을 `"allow"`로 전환하여, coder와 resolver가 작업별 프롬프트 없이 계속 작동합니다. `"deny"`는 건드리지 않으며, 사용자가 명시적으로 설정한 권한 키도 재정의하지 않습니다.

| 권한 상태 | autoApprove: true | autoApprove: false |
|---|---|---|
| 기본 `"ask"` | `"allow"`가 됨 | `"ask"` 유지 |
| 기본 `"deny"` | `"deny"` 유지 | `"deny"` 유지 |
| 사용자 명시 `"ask"` | `"ask"` 유지 | `"ask"` 유지 |
| 사용자 명시 `"allow"` | `"allow"` 유지 | `"allow"` 유지 |
| 사용자 명시 `"deny"` | `"deny"` 유지 | `"deny"` 유지 |

`"deny"` 기본값을 가진 에이전트(예: reviewer의 `edit` 및 `bash`)는 `autoApprove: true`에서도 거부가 유지됩니다. Reviewer는 내부 서브에이전트로 기본 활성화됩니다 — deny 권한은 읽기 전용을 보장합니다.

보수적인 매번-묻기 동작을 원할 때 끄세요:

```json
{
  "autoApprove": false
}
```

> **신뢰 참고:** `autoApprove: true`는 작업공간과 구성된 모델을 신뢰한다고 가정합니다. 신뢰할 수 없는 코드의 경우 샌드박스나 VM을 사용하고, 모든 작업을 검사하려면 `autoApprove: false`로 유지하세요.

---

## 병렬 서브에이전트 제한

`maxParallelSubagents` (기본값 `2`)는 **resolver**가 **역할당** 동시에 디스패치할 수 있는 서브에이전트 수를 제한합니다. 기본값 `2`는 최대 2개의 coder가 독립 작업에 병렬로 실행됨을 의미합니다.

| 값 | 동작 |
|---|---|
| `1` | 한 번에 하나의 coder만. |
| `2` (기본값) | 최대 2개의 coder 동시 실행. 독립 작업 분산에 유용. |
| `N > 2` | 최대 N개의 coder 동시 실행. 컨텍스트 낭비를 피하기 위해 신중하게 사용. |

프로젝트별 또는 사용자별 재정의:

```json
{ "maxParallelSubagents": 1 }
{ "maxParallelSubagents": 2 }
{ "maxParallelSubagents": 4 }
```

> **중요 — 소프트 제한, 하드 캡이 아님.** 제한은 resolver의 시스템 프롬프트에만 반영됩니다. 초과 디스패치를 차단하는 런타임 인터셉터는 없습니다. 지시를 잘 따르는 코딩 모델은 일반적으로 이 규칙을 준수하지만, 모델이 오동작하면 제한을 초과하는 디스패치가 통과합니다. 더 엄격한 상한을 원하면 `maxSteps`와 함께 사용하세요.

제한은 설정 로드 시 프롬프트에 템플릿되므로, 새 값을 적용하려면 OpenCode를 재시작하세요. 사용자 정의 `agents.resolver.prompt`를 제공하면 템플릿된 규칙이 건너뛰어지고 프롬프트가 전적으로 적용됩니다.

---

## 업그레이드 및 마이그레이션

`opencode-resolve`의 새 버전으로 업그레이드하면, `postinstall` 스크립트가 기존 `~/.config/opencode/resolve.json`에 **추가적 마이그레이션**을 실행합니다:

- 새 최상위 키(예: `autoApprove`, `maxParallelSubagents`)를 기본값과 함께 추가 (없는 경우).
- 이미 설정한 키는 **절대** 수정하지 않음.
- `enabled` 목록, `models` 맵, 또는 `agents` 재정의를 **절대** 다시 쓰지 않음.
- `enabled`가 설정되어 있고 `"resolver"`를 포함하지 않으면, 추가를 제안하는 한 줄 팁을 출력. 파일은 그대로 유지.

마이그레이션을 완전히 건너뛰려면:

```sh
OPENCODE_RESOLVE_SKIP_POSTINSTALL=1 npm install -g opencode-resolve
```

---

## 모델 설정

`opencode-resolve`는 기본적으로 어떤 프로바이더별 모델도 핀닝하지 않습니다. 모든 resolve 에이전트는 최상위 OpenCode `model`을 상속합니다 — 토큰당 결과 효율이 가장 좋은 하나의 효율적인 모델을 사용하세요. 이점을 측정한 경우에만 역할별 모델을 핀닝하세요.

각 resolve 에이전트에 대한 모델 해석 순서:

1. `agents.<name>.model`
2. `models.<name>` 별칭 매핑
3. 최상위 OpenCode `model`
4. 모델이 구성되지 않은 경우 OpenCode 자체의 폴백

### 모든 것에 기본 모델 사용 (권장)

```json
{
  "enabled": ["coder", "resolver", "explorer", "reviewer", "deep-reviewer"],
  "models": {}
}
```

### 역할별 별칭 (이점을 측정한 경우)

```json
{
  "enabled": ["coder", "resolver", "explorer", "reviewer", "deep-reviewer"],
  "models": {
    "fast": "openai/gpt-5-mini",
    "strong": "openai/gpt-5.3-codex",
    "coder": "fast",
    "resolver": "strong"
  }
}
```

### 하나의 역할을 직접 핀닝

```json
{
  "agents": {
    "resolver": {
      "model": "openai/gpt-5.3-codex"
    }
  }
}
```

### 혼합 설정 (OpenCode 설정 + resolve 모델)

`plan` 및 `build`와 같은 네이티브 OpenCode 에이전트는 `opencode-resolve`가 아닌 최상위 OpenCode `agent`를 통해 구성됩니다.

```json
{
  "model": "openai/gpt-5-mini",
  "agent": {
    "plan": {
      "model": "openai/gpt-5.3-codex"
    }
  },
  "plugin": [
    [
      "opencode-resolve",
      {
        "enabled": ["coder", "resolver", "explorer", "reviewer", "deep-reviewer"]
      }
    ]
  ]
}
```

이 설정에서 `plan`은 `openai/gpt-5.3-codex`를 사용; 네이티브 `build`, resolve `coder`, resolve `resolver`는 모두 `openai/gpt-5-mini`를 사용합니다.

### 지원되는 모델 별칭 키

| 별칭 | 용도 |
|---|---|
| `fast` | 빠른/저렴한 모델의 프로바이더 중립적 별칭 |
| `strong` | 강력한/비싼 모델의 프로바이더 중립적 별칭 |
| `mini` | 미니/효율적 모델의 프로바이더 중립적 별칭 |
| `codex` | 코덱스 스타일 코딩 모델의 프로바이더 중립적 별칭 |
| `quick` | 레거시 별칭 (`fast`와 동등) |
| `deep` | 레거시 별칭 (`strong`과 동등) |
| `glm` | 레거시 별칭 (하위 호환성) |
| `gpt` | 레거시 별칭 (하위 호환성) |

별칭은 `models`에 정의된 경우에만 해석됩니다. 에이전트 이름(`coder`, `resolver` 등)도 유효한 별칭 키입니다.

---

## 에이전트 참조

| 에이전트 | 기본 | 모드 | Edit | Bash | WebFetch | 용도 |
|---|:---:|---|---|---|---|---|
| `resolver` | 예 (핵심) | `all` | ask → allow | ask → allow | ask → allow | 컨텍스트 효율적 오케스트레이터. 작업을 검증된 체크포인트로 분해, coder 디스패치, 각각 검증, 진행 상황 전달. 실패한 체크포인트당 최대 3회 재시도. |
| `coder` | 예 (핵심) | `subagent` | ask → allow | ask → allow | ask → allow | 집중된 구현자. 가장 작은 올바른 패치. 필요한 파일만 읽음. |
| `explorer` | 예 (서브에이전트) | `subagent` | **deny** | ask → allow | ask → allow | 내부 빠른 코드베이스 스카우트. Resolver가 범위가 불명확할 때만 디스패치; 좁은 범위는 로컬 read/grep/glob 선호. |
| `reviewer` | 예 (서브에이전트) | `subagent` | **deny** | **deny** | ask → allow | 내부 검증 갭 감사자. 비사소한 변경에 검증 갭이 있을 때 디스패치. |
| `deep-reviewer` | 예 (서브에이전트) | `subagent` | **deny** | **deny** | ask → allow | 내부 위험/보안/아키텍처 변경에 대한 철저한 리뷰. 고영향도 작업에만 디스패치. |
| `architect` | 아니오 | `subagent` | deny | ask → allow | ask → allow | 설계 및 작업 분해. |
| `gpt-coder` | 아니오 | `subagent` | ask → allow | ask → allow | ask → allow | 더 강력한 추론 구현 폴백. |
| `debugger` | 아니오 | `subagent` | ask → allow | ask → allow | ask → allow | 재현 및 근본 원인 분석. |
| `researcher` | 아니오 | `subagent` | deny | ask → allow | ask → allow | 코드베이스 및 문서 연구. |

`ask → allow`는 기본이 `"ask"`이며 `autoApprove` (기본 켜짐)가 `"allow"`로 전환함을 의미합니다. `"ask"`로 유지하려면 `autoApprove: false`로 설정하세요.

지원되는 모드:

| 모드 | 의미 |
|---|---|
| `subagent` | 서브에이전트로만 사용 가능 |
| `primary` | 기본 에이전트로 사용 가능 |
| `all` | 기본 및 서브에이전트 모두로 사용 가능 |

지원되는 권한 값: `ask`, `allow`, `deny`.

지원되는 모델 별칭 키: `fast`, `strong`, `mini`, `codex`, `quick`, `deep`, `glm`, `gpt`, 그리고 지원되는 모든 에이전트 이름. 별칭은 `models`에 정의된 경우에만 해석됩니다.

`preserveNative`은 가독성을 위해 허용되지만, 네이티브 `plan`과 `build`는 항상 보존됩니다. 플러그인은 빌트인 OpenCode 에이전트를 절대 다시 쓰지 않습니다.

### Resolver 오케스트레이션 규칙

Resolver는 컨텍스트 효율적 접근과 체크포인트 실행(실패한 체크포인트당 최대 3회 재시도)을 사용합니다:

- 계획 전에 작업을 **quick**, **normal**, **deep**, **risky**로 **분류**.
- **관련 파일만 검사** — 로컬 도구 사용, 광범위한 탐색 지양.
- 사소한 작업은 직접 편집 적용 — 서브에이전트 불필요.
- 집중된 파일/동작 지시와 함께 **coder** 디스패치.
- **가장 저렴한 의미 있는 검증**을 먼저 실행.
- 문제가 남아있으면 검증 로그에서 재시도. 실패한 체크포인트당 최대 3회 재시도; 그 후 진행하거나 차단 사항 보고.
- 범위가 불명확하고 로컬 read/grep/glob이 불충분할 때만 **explorer** 사용 (내부 서브에이전트, 핵심 경로 아님).
- 비사소한 변경에 검증 갭이 있을 때만 **reviewer** 사용 (내부 서브에이전트, 핵심 경로 아님).
- 위험, 보안, 아키텍처, 고영향도 변경에만 **deep-reviewer** 사용 (내부 서브에이전트, 핵심 경로 아님).
- 해결되거나 차단되면 간결한 증거 요약 반환.
- `maxParallelSubagents` 역할별 제한을 컨텍스트 효율을 위해 준수.

---

## 선택적 명령어

`commands: true`로 설정하면 도우미 서브태스크 명령어가 추가됩니다:

| 명령어 | 설명 |
|---|---|
| `resolve` | 현재 작업에 대해 `resolver` 에이전트를 엔드투엔드로 실행 |
| `resolve-code` | 집중된 구현을 위해 `coder` 에이전트를 실행 |
| `resolve-review` | 읽기 전용 감사를 위해 `reviewer` 에이전트를 실행 |

---

## Context7 통합

`context7: true` (기본값)인 경우, 플러그인이 시작 시 [Context7](https://context7.com) MCP 서버를 자동으로 등록합니다:

```json
{
  "type": "remote",
  "url": "https://mcp.context7.com/mcp"
}
```

이를 통해 모든 resolve 에이전트가 `resolve-library-id` 및 `query-docs` 도구를 통해 최신 라이브러리 및 프레임워크 문서에 접근할 수 있습니다 — 수동 MCP 설정이 필요 없습니다.

Context7 등록을 비활성화하려면 (예: 이미 구성되어 있거나 원하지 않는 경우):

```json
{
  "context7": false
}
```

OpenCode 설정에 `mcp.context7`이 이미 있는 경우, 플러그인은 덮어쓰지 않습니다.

---

## 최신 상태 유지

> **OpenCode는 마지막으로 다운로드한 버전을 캐시합니다.** 새 릴리스를 받으려면 명시적으로 새로고침해야 합니다.

```sh
# npm을 통한 업그레이드
npm install -g opencode-resolve@latest

# OpenCode 캐시 새로고침
opencode plugin opencode-resolve --global --force

# OpenCode 재시작
```

업그레이드 후 `postinstall`이 `resolve.json`에 추가적 마이그레이션을 실행합니다 — 새 키가 추가되고, 기존 키는 절대 수정되지 않습니다.

### 특정 버전 고정

```sh
npm install -g opencode-resolve@0.1.3
opencode plugin opencode-resolve --global --force
```

---

## 로컬 개발

이 저장소에서:

```sh
npm install
npm test
npm run install:local
```

`install:local`은 플러그인을 빌드하고, OpenCode 전역 플러그인 디렉토리에 링크하며, `~/.config/opencode/resolve.json`이 없으면 생성합니다.

수동 로컬 설치:

```sh
npm run build
mkdir -p ~/.config/opencode/plugins
ln -sf "$PWD/dist/index.js" ~/.config/opencode/plugins/opencode-resolve.js
```

로컬 플러그인 파일은 OpenCode가 자동으로 로드합니다.

---

## 검증

일반 검사 실행:

```sh
npm run typecheck
npm test
npm run build
```

테스트 스위트는 빌드된 플러그인을 실행하고 기본 에이전트 주입, `autoApprove` 동작, 모델 별칭, 파일 설정, 플러그인 옵션 재정의, 선택적 명령어, Context7 보존, 네이티브 `plan`/`build` 보존을 검증합니다.

게시 전:

```sh
npm run typecheck
npm test
npm audit --audit-level=moderate
npm publish --dry-run
```

`npm pack`과 `npm publish`는 `prepack` 스크립트를 통해 먼저 `npm test`를 실행합니다.

---

## 릴리스

릴리스는 버전 태그가 푸시될 때 GitHub Actions에 의해 게시됩니다.

필요한 저장소 시크릿:

| 시크릿 | 설명 |
|---|---|
| `NPM_TOKEN` | 게시 권한이 있는 npm 자동화 토큰 |

태그 릴리스 흐름:

```sh
npm version patch
git push origin main --follow-tags
```

GitHub Actions에서 `Publish to npm` 워크플로우를 수동으로 실행하고 `patch`, `minor`, `major` 또는 특정 버전을 선택할 수도 있습니다.

릴리스 워크플로우는 `npm ci`, `npm run typecheck`, `npm test`, `npm publish --access public --provenance`를 실행합니다.

---

## 설계 규칙

- 네이티브 `plan` 또는 `build` 에이전트를 덮어쓰지 않음.
- 핵심 경로는 고정: `resolver`(컨텍스트 효율적 플래너/판정자) → `coder`(구현자).
- 내부 전문가 서브에이전트(`explorer`, `reviewer`, `deep-reviewer`)는 OpenCode 네이티브 서브에이전트로 기본 주입 — OpenCode의 컴포지션 철학을 계승 — 하지만 기본 실행 경로가 아니며 사용자 대면 기본 역할이 아님.
- Resolver는 좁은 범위에 로컬 read/grep/glob을 선호; 범위가 불명확할 때만 `explorer` 디스패치.
- Resolver는 비사소한 변경에 검증 갭이 있을 때만 `reviewer` 디스패치.
- Resolver는 위험, 보안, 아키텍처, 고영향도 변경에만 `deep-reviewer` 디스패치.
- Reviewer와 deep-reviewer는 읽기 전용 — 수정은 항상 `coder` 또는 `resolver`를 거침.
- 실패한 체크포인트당 최대 3회 재시도로 컨텍스트 낭비 방지. 대규모 작업은 검증된 체크포인트로 분해됨.
- Resolver는 컨텍스트 효율을 위해 `maxParallelSubagents`를 준수.
- 편집 전에 검색하고 검사. 가장 작은 올바른 변경. 실용적인 경우 검증.
- 필요한 파일만 읽음. 광범위한 탐색 지양. 대상 검증, 전체 스위트 아님.

---

## 라이선스

[MIT](./LICENSE)
