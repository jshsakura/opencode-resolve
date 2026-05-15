# 설치 가이드

이 문서는 `opencode-resolve`를 운영자 관점에서 설치하는 경로입니다.

## 시작 전 확인

필요한 것:

- OpenCode 설치 및 실행 가능 상태
- Node.js 20 이상
- `~/.config/opencode/opencode.json`에 동작하는 OpenCode provider/model

확인:

```sh
opencode --version
node --version
```

## 표준 설치

```sh
npm install -g opencode-resolve
opencode plugin opencode-resolve --global --force
opencode
```

두 번째 명령이 중요합니다. OpenCode는 npm 전역 설치 위치가 아니라 자체 플러그인 캐시에서 플러그인을 로드합니다.

## 작성되는 파일

설치기는 두 OpenCode 파일을 갱신하려고 시도합니다.

| 파일 | 용도 |
| --- | --- |
| `~/.config/opencode/opencode.json` | plugin 목록에 `"opencode-resolve"` 추가 |
| `~/.config/opencode/resolve.json` | resolve 전용 agent, model, option 저장 |

기존 설정은 보존됩니다. `resolve.json`이 이미 있으면 명시적인 reinstall mode 없이는 교체하지 않습니다.

## 최소 수동 설정

플러그인을 추가합니다.

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

캐시를 새로고침하고 재시작합니다.

```sh
opencode plugin opencode-resolve --global --force
opencode
```

## Fresh reinstall

설치기가 fresh setup을 다시 묻게 하려면:

```sh
OPENCODE_RESOLVE_REINSTALL=fresh npm install -g opencode-resolve
```

추가적 마이그레이션만 원하면:

```sh
OPENCODE_RESOLVE_REINSTALL=update npm install -g opencode-resolve
```

## 자동화 건너뛰기

```sh
OPENCODE_RESOLVE_SKIP_POSTINSTALL=1 npm install -g opencode-resolve
```

## Companion 플러그인

선택 사항입니다.

```json
{
  "plugin": [
    "@tarquinen/opencode-dcp@latest",
    "@slkiser/opencode-quota@latest",
    "opencode-resolve"
  ]
}
```

필요할 때만 사용하세요.

- `opencode-dcp`: 긴 세션에서 오래된 tool output 부담을 줄입니다.
- `opencode-quota`: TUI에서 사용량/quota 가시성을 추가합니다.

## 추천 스킬

더 풍부한 OpenCode 환경을 원하면 [awesome-opencode-skills](https://github.com/jshsakura/awesome-opencode-skills)도 같이 사용해 보세요. 개발, 인프라, 보안, 데이터, 문서화 등 도메인별 작업에 쓸 수 있는 OpenCode Skills 컬렉션입니다.

macOS / Linux:

```sh
curl -sL https://raw.githubusercontent.com/jshsakura/awesome-opencode-skills/main/install.sh | bash
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/jshsakura/awesome-opencode-skills/main/install.ps1 | iex
```

## 검증

OpenCode 재시작 후:

- `resolver`가 primary agent로 보여야 합니다.
- `coder`가 subagent로 사용 가능해야 합니다.
- 비활성화하지 않았다면 Context7이 등록되어야 합니다.

전체 설정은 [설정 레퍼런스](CONFIGURATION.ko.md)를 참고하세요.
