# 설정 레퍼런스

`opencode-resolve`는 설정을 `opencode.json`과 분리해서 OpenCode provider/plugin 설정을 읽기 쉽게 유지합니다.

## 설정 탐색 순서

처음 발견한 파일을 사용합니다.

1. `.opencode/resolve.json`
2. `opencode-resolve.json`
3. `~/.config/opencode/resolve.json`
4. `~/.config/opencode/opencode-resolve.json`

`opencode.json`의 인라인 플러그인 옵션은 파일 설정보다 우선합니다.

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

## 권장 기본 설정

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
  },
  "autoApprove": true,
  "autoUpdate": true
}
```

## 최상위 옵션

| 키 | 타입 | 기본값 | 용도 |
| --- | --- | --- | --- |
| `profile` | `mix`, `glm`, `gpt` | `mix` | 프롬프트/profile preset. |
| `tier` | `bronze`, `silver`, `gold` | 미설정 | 설정된 tier preset 활성화. |
| `enabled` | array | 기본 에이전트 | 주입할 에이전트. |
| `models` | object | `{}` | 모델 별칭과 역할별 핀. |
| `agents` | object | `{}` | 에이전트별 override. |
| `preserveNative` | boolean | `true` | OpenCode 네이티브 에이전트 보존. |
| `context7` | boolean | `true` | 없을 때 Context7 MCP 등록. |
| `commands` | boolean | `false` | `/resolve`, `/resolve-code`, `/resolve-review` 추가. |
| `autoApprove` | boolean | `true` | 하위 호환 플래그. 권한 동작은 명시 설정이 제어. |
| `autoUpdate` | boolean | `true` | 설치기 추가 마이그레이션 허용. |
| `language` | `auto`, `en`, `ko` | `auto` | 프롬프트 언어 선호. |
| `maxParallelSubagents` | positive integer | 미설정 | 동시 coder 디스패치에 대한 프롬프트 수준 soft limit. |
| `config` | string | 미설정 | 인라인 설정에서 사용하는 사용자 지정 config 경로. |

알 수 없는 키는 즉시 실패합니다.

## 에이전트 옵션

각 `agents.<name>`은 다음을 지원합니다.

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
| `permission` | permission object |

권한 키:

- `edit`
- `bash`
- `webfetch`
- `doom_loop`
- `external_directory`

권한 값:

- `ask`
- `allow`
- `deny`

`permission.bash`는 단일 값 또는 명령 패턴별 맵을 받을 수 있습니다.

## 모델

기본적으로 `models`는 비어 있고 모든 resolve 에이전트는 OpenCode 최상위 모델을 상속합니다.

해석 순서:

1. `agents.<name>.model`
2. `models.<name>`
3. OpenCode 최상위 `model`
4. OpenCode fallback

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

지원 별칭:

```text
fast, strong, mini, codex, quick, deep, glm, gpt,
bronze, silver, gold,
gpt-bronze, gpt-silver, gpt-gold,
glm-bronze, glm-silver, glm-gold,
모든 지원 에이전트 이름
```

## Context7

기본값:

```json
{ "context7": true }
```

플러그인은 다음 MCP를 추가합니다.

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

`mcp.context7`이 이미 있으면 보존합니다.

## 전체 레퍼런스 파일

주석이 달린 copy-and-edit 설정은 다음 파일을 사용하세요.

```text
opencode-resolve.reference.jsonc
```
