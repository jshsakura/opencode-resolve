---
title: 설정
description: 설정 파일, 옵션, 모델, Context7 동작.
---

## 탐색 순서

처음 발견한 파일을 사용합니다.

1. `.opencode/resolve.json`
2. `opencode-resolve.json`
3. `~/.config/opencode/resolve.json`
4. `~/.config/opencode/opencode-resolve.json`

인라인 플러그인 옵션은 파일 설정보다 우선합니다.

## 주요 옵션

| 키 | 기본값 | 용도 |
| --- | --- | --- |
| `enabled` | 기본 에이전트 | 주입할 에이전트 |
| `models` | `{}` | 모델 별칭과 역할별 핀 |
| `agents` | `{}` | 에이전트별 override |
| `preserveNative` | `true` | OpenCode 네이티브 에이전트 보존 |
| `context7` | `true` | 없을 때 Context7 MCP 등록 |
| `commands` | `false` | `/resolve`, `/resolve-code`, `/resolve-review` 추가 |
| `maxParallelSubagents` | 미설정 | coder fan-out soft limit |

알 수 없는 키는 즉시 실패합니다.

## 모델

기본적으로 모든 resolve 에이전트는 OpenCode 최상위 모델을 상속합니다.

해석 순서:

1. `agents.<name>.model`
2. `models.<name>`
3. OpenCode 최상위 `model`
4. OpenCode fallback
