# 에이전트 가이드

`opencode-resolve`는 작은 OpenCode 에이전트 세트를 주입합니다. 기본 경로는 의도적으로 단순합니다. `resolver`가 오케스트레이션하고 `coder`가 구현합니다.

## 기본 에이전트

| 에이전트 | 모드 | Edit | Bash | Web | 목적 |
| --- | --- | --- | --- | --- | --- |
| `resolver` | `all` | allow | ask | allow | 기본 오케스트레이터. |
| `coder` | `subagent` | allow | ask | allow | 집중 구현과 검증. |
| `explorer` | `subagent` | deny | deny | allow | 빠른 읽기 전용 탐색. |
| `reviewer` | `subagent` | deny | deny | allow | 읽기 전용 검증 갭 리뷰. |
| `deep-reviewer` | `subagent` | deny | deny | allow | 위험/고영향 변경에 대한 강한 리뷰. |
| `planner` | `subagent` | deny | deny | allow | 명시적으로 유용할 때만 읽기 전용 구현 계획. |

## 선택 에이전트

| 에이전트 | 모드 | 목적 |
| --- | --- | --- |
| `gpt` | `all` | GPT 최적화 primary resolver. |
| `glm` | `all` | GLM/ZAI 최적화 primary resolver. |
| `codex` | `all` | 레거시 Codex 최적화 primary resolver. |
| `architect` | `subagent` | 설계/분해 보조. |
| `gpt-coder` | `subagent` | 더 강한 구현 보조. |
| `debugger` | `subagent` | 실패 재현과 root-cause 분석. |
| `researcher` | `subagent` | 코드베이스와 문서 리서치. |

선택 에이전트는 명시적으로 켭니다.

```json
{
  "agents": {
    "glm": { "enabled": true },
    "gpt": { "enabled": true },
    "debugger": { "enabled": true, "mode": "subagent" }
  }
}
```

## Resolver 루프

resolver는 다음을 수행하도록 프롬프트됩니다.

1. 요청을 이해하고 관련 파일만 검사합니다.
2. 탐색이 병목일 때만 `explorer`를 디스패치합니다.
3. 작은 패치를 위해 `coder`를 디스패치합니다.
4. 변경 경로를 검증합니다.
5. 위험이 있을 때만 `reviewer` 또는 `deep-reviewer`를 디스패치합니다.
6. 해결되거나 실제 차단 사유가 나올 때까지 반복합니다.

## 권한

Bash는 기본적으로 `ask`입니다. 플러그인의 분류기는 흔한 안전 명령을 자동 허용하고 위험 패턴을 거부할 수 있지만, 알 수 없는 명령은 계속 대화형입니다.

읽기 전용 에이전트는 edit와 bash를 거부합니다. web/documentation fetch는 활성화되어 있으면 사용할 수 있습니다.

## 병렬성

`maxParallelSubagents`는 `coder` fan-out에 대한 프롬프트 수준 soft limit입니다. 모델/provider가 burst traffic에 민감할 때 유용합니다.

예시:

```json
{
  "maxParallelSubagents": 1
}
```

런타임 lock은 아닙니다. resolver에게 동시 coder 디스패치를 제한하라고 지시합니다.
