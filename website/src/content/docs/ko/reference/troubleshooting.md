---
title: 문제 해결
description: 플러그인 캐시, 설정, 모델, 권한 문제를 점검합니다.
---

## Resolver가 보이지 않음

`~/.config/opencode/opencode.json`에 `"opencode-resolve"`가 있는지 확인하고 실행합니다.

```sh
opencode plugin opencode-resolve --global --force
```

OpenCode를 재시작하세요.

## 오래된 버전이 계속 로드됨

```sh
export OPENCODE_CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/opencode"
rm -rf "$OPENCODE_CACHE_ROOT/packages/opencode-resolve@latest"
opencode plugin opencode-resolve@latest --global --force
```

`~/.config/opencode/resolve.json`은 삭제하지 마세요.

## Bash가 계속 물어봄

알 수 없는 명령에서는 정상입니다. 흔한 안전 명령은 자동 허용될 수 있고 위험 패턴은 거부될 수 있지만, 알 수 없는 명령은 계속 대화형입니다.
