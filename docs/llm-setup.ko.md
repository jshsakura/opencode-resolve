# opencode-resolve — LLM 설치 가이드

AI 코딩 어시스턴트가 사용자 머신에 `opencode-resolve`를 설치할 때 이 문서를 사용하세요. 순서를 그대로 따르고, 기존 OpenCode 설정을 보존하며, 모델 ID를 임의로 만들지 마세요.

## 목표

OpenCode 플러그인을 설치하고, OpenCode 플러그인 캐시를 새로고침하고, 없을 때만 최소 `resolve.json`을 만들고, OpenCode 재시작 후 `resolver` 에이전트가 보이는지 확인합니다.

## 규칙

- 기존 OpenCode 파일을 덮어쓰지 않습니다.
- 기존 플러그인, provider, model, MCP 서버, agent를 제거하지 않습니다.
- provider/model ID를 추측하지 않습니다.
- 모델 핀닝이 필요하면 먼저 사용자의 OpenCode provider registry를 읽고 어떤 모델을 쓸지 물어봅니다.
- `resolve.json`은 작게 유지합니다. 역할/모델 설정은 `opencode.json` 플러그인 튜플이 아니라 `resolve.json`에 둡니다.
- 변경 후 OpenCode 재시작을 안내합니다.

## 1단계 — 사전 조건 확인

실행:

```sh
opencode --version
node --version
```

요구 사항:

- OpenCode가 설치되어 있어야 합니다.
- Node.js 20 이상이어야 합니다.
- `~/.config/opencode/opencode.json`에 사용할 수 있는 provider/model이 최소 하나 있어야 합니다.

OpenCode나 Node.js가 없으면 중단하고 정확한 차단 사유를 보고하세요.

## 2단계 — 설치 및 캐시 새로고침

실행:

```sh
npm install -g opencode-resolve
opencode plugin opencode-resolve --global --force
```

OpenCode는 플러그인을 `~/.cache/opencode/packages/` 아래 자체 캐시에서 로드하므로 설치와 업그레이드 후 캐시 새로고침이 필요합니다.

OpenCode가 계속 오래된 플러그인을 로드하면 해당 플러그인 캐시만 새로고침합니다.

```sh
export OPENCODE_CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/opencode"
rm -rf "$OPENCODE_CACHE_ROOT/packages/opencode-resolve@latest"
opencode plugin opencode-resolve@latest --global --force
```

## 3단계 — 플러그인 등록

`~/.config/opencode/opencode.json`을 열고 최상위 `plugin` 배열에 `"opencode-resolve"`가 있는지 확인합니다.

권장 형태:

```json
{
  "plugin": ["opencode-resolve"]
}
```

이미 다른 플러그인이 있으면 아무것도 지우지 말고 `"opencode-resolve"`만 추가합니다.

사용자가 인라인 override를 명시적으로 원할 때만 아래 형태를 사용합니다.

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

## 4단계 — resolve 설정 생성

`~/.config/opencode/resolve.json`이 이미 있으면 교체하지 마세요. 읽은 뒤 현재 활성 에이전트만 보고합니다.

없으면 아래를 작성합니다.

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

`models`를 비워 두는 이유는 모든 resolve 에이전트가 OpenCode 기본 모델을 상속하게 하기 위해서입니다.

## 5단계 — 선택적 모델 핀닝

사용자가 요청했거나 비용/속도/reasoning split을 원할 때만 모델을 핀닝합니다.

`opencode.json`에서 설정된 provider와 model을 확인한 뒤, 사용자에게 정확한 ID를 물어봅니다.

권장 3-tier 매핑:

```json
{
  "models": {
    "bronze": "<provider>/<scout-model>",
    "silver": "<provider>/<coder-model>",
    "gold": "<provider>/<reasoning-model>",
    "explorer": "bronze",
    "coder": "silver",
    "resolver": "gold",
    "reviewer": "gold",
    "deep-reviewer": "gold",
    "planner": "gold"
  }
}
```

사용자의 설정에서 확인한 정확한 모델 ID만 사용합니다. 불명확하면 다시 물어보세요.

## 6단계 — 선택적 companion 플러그인

설치 전 사용자에게 물어봅니다.

- `@tarquinen/opencode-dcp@latest`: 긴 루프에서 오래된 tool output을 줄입니다.
- `@slkiser/opencode-quota@latest`: 컨텍스트 오염 없이 OpenCode에서 토큰/quota 사용량을 보여줍니다.
- `awesome-opencode-skills`: 도메인별 작업에 쓸 수 있는 OpenCode Skills 컬렉션을 설치합니다.

둘 다 독립 OpenCode 플러그인이며 필수는 아닙니다.

사용자가 스킬 컬렉션을 원하면:

```sh
curl -sL https://raw.githubusercontent.com/jshsakura/awesome-opencode-skills/main/install.sh | bash
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/jshsakura/awesome-opencode-skills/main/install.ps1 | iex
```

## 7단계 — 검증

사용자에게 OpenCode 재시작을 안내합니다.

```sh
opencode
```

재시작 후 확인:

- `resolver`가 primary agent로 보이는지
- `coder`, `explorer`, `reviewer`, `deep-reviewer`, `planner`가 subagent로 사용 가능한지
- `"context7": false`가 아니라면 Context7 MCP가 보이는지

검증이 실패하면 확인한 설정 경로와 실행한 OpenCode/plugin cache refresh 명령을 그대로 보고하세요.
