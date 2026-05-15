# 문제 해결

OpenCode가 `opencode-resolve`를 제대로 로드하지 않는 것 같을 때 이 문서를 사용하세요.

## Resolver가 보이지 않음

`opencode.json`을 확인합니다.

```sh
cat ~/.config/opencode/opencode.json
```

최상위 `plugin` 배열에 다음이 있어야 합니다.

```json
"opencode-resolve"
```

그다음 플러그인 캐시를 새로고침합니다.

```sh
opencode plugin opencode-resolve --global --force
```

OpenCode를 재시작하세요.

## 오래된 버전이 계속 로드됨

이 플러그인의 캐시 항목만 삭제합니다.

```sh
export OPENCODE_CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/opencode"
rm -rf "$OPENCODE_CACHE_ROOT/packages/opencode-resolve@latest"
opencode plugin opencode-resolve@latest --global --force
```

`~/.config/opencode/resolve.json`은 삭제하지 마세요.

## 설정 로드 실패

설정 검증은 의도적으로 엄격합니다. 흔한 원인:

- 알 수 없는 최상위 키
- 알 수 없는 에이전트 이름
- 잘못된 `mode`
- boolean이 아닌 `enabled`
- 양수가 아닌 `maxSteps` 또는 `maxParallelSubagents`
- 잘못된 permission 값

다음 파일과 비교하세요.

```text
opencode-resolve.reference.jsonc
```

## Context7이 보이지 않음

확인:

```json
{
  "context7": true
}
```

OpenCode 설정에 `mcp.context7`이 이미 있으면 플러그인은 그것을 보존하고 교체하지 않습니다.

## Bash가 계속 물어봄

알 수 없는 명령에서는 정상입니다. 플러그인은 흔한 안전 명령을 자동 허용하고 위험 패턴을 거부하지만, 모든 bash 명령을 `allow`로 바꾸지는 않습니다.

에이전트별 동작은 다음처럼 설정합니다.

```json
{
  "agents": {
    "coder": {
      "permission": {
        "bash": "ask"
      }
    }
  }
}
```

## 모델이 예상과 다름

모델 해석 순서:

1. `agents.<name>.model`
2. `models.<name>`
3. OpenCode 최상위 `model`
4. OpenCode fallback

`models`가 비어 있으면 OpenCode 기본 모델 상속이 정상입니다.

## 설치가 너무 많이 바뀐 것 같음

설치기는 추가적으로 동작해야 합니다. 설치 시 모든 설정 수정을 피하려면:

```sh
OPENCODE_RESOLVE_SKIP_POSTINSTALL=1 npm install -g opencode-resolve
```

그다음 [설치 가이드](INSTALL.ko.md)의 수동 설정을 적용하세요.
