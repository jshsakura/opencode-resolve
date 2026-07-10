---
title: 설정
description: 설정 파일, 옵션, 모델.
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
| `singleAgentMode` | `false` | `true`면 resolver가 `coder` subagent를 호출하지 않고 직접 편집합니다 (단순 작업에서 지연·토큰 비용 절감). |
| `commands` | `false` | `/resolve`, `/resolve-code`, `/resolve-review` 추가 |
| `maxParallelSubagents` | 미설정 | coder fan-out soft limit |
| `permissions` | `{}` | 옵트인 롤백 권한. 아래 참조. |

알 수 없는 키는 즉시 실패합니다.

## 롤백 권한

`git reset --hard` 와 `git clean -f` 는 기본적으로 차단됩니다. 커밋하지 않은 작업을 보호하지만, 동시에 디버깅 도중 작업트리가 꼬인 에이전트가 깨끗한 상태로 되돌아갈 방법이 없다는 뜻이기도 합니다 — 그대로 고립됩니다. 두 개의 옵트인 플래그가 이를 풀어주며, resolve 에이전트에만 적용됩니다.

```json
{
  "permissions": {
    "allowGitReset": true,
    "allowGitClean": true
  }
}
```

두 명령이 실행되기 전에, 플러그인은 **작업트리 전체** — 추적 중인 수정과 추적되지 않은 파일 모두 — 를 `refs/resolve-checkpoint/<timestamp>-<reset|clean>` 이라는 git ref 로 스냅샷합니다. 스냅샷은 임시 인덱스를 통해 기록되므로 실제 인덱스, 작업트리, 브랜치, `HEAD` 는 전혀 건드리지 않습니다. 스냅샷을 남기지 못하면 파괴적 명령은 무방비로 실행되는 대신 차단됩니다.

되돌린 것을 후회할 때 복구하려면:

```sh
git for-each-ref refs/resolve-checkpoint    # 체크포인트 목록
git restore --source=<ref> -- .             # 전부 복원
```

`git clean -x` 와 `-X` 는 이 플래그와 무관하게 계속 차단됩니다. gitignore 대상 파일을 삭제하는데, 체크포인트는 `.gitignore` 를 존중하는 `git add -A` 로 스냅샷하기 때문입니다 — 즉 `-x` clean 은 체크포인트가 되살릴 수 없는 파일(`.env`, 로컬 시크릿)을 파괴합니다.

체크포인트는 resolve 에이전트가 해당 명령을 실행할 때마다 생성됩니다 — 두 플래그를 `false` 로 둔 채 권한 프롬프트에서 직접 승인한 경우에도 마찬가지입니다. OpenCode 기본 에이전트(`build`/`plan`/chat)는 무조건 차단이 유지됩니다.


## 모델

기본적으로 모든 resolve 에이전트는 OpenCode 최상위 모델을 상속합니다.

해석 순서:

1. `agents.<name>.model`
2. `models.<name>`
3. OpenCode 최상위 `model`
4. OpenCode fallback
