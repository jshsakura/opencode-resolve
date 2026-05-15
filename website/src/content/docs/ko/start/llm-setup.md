---
title: AI 설치 가이드
description: AI 코딩 어시스턴트에게 설치를 맡기기 위한 지시문.
---

AI 코딩 어시스턴트에게 아래를 전달하세요.

```text
Install and configure opencode-resolve on this machine.

Rules:
- Do not overwrite existing OpenCode config.
- Add "opencode-resolve" to the OpenCode plugin array if missing.
- Refresh the OpenCode plugin cache with:
  opencode plugin opencode-resolve --global --force
- Create ~/.config/opencode/resolve.json only if it does not exist.
- If choosing role-specific models, inspect existing provider/model ids first and ask me which ones to use.
- Do not invent model ids.
- Restart OpenCode or tell me to restart it.
```

Raw 설치 가이드:

```sh
curl -s https://raw.githubusercontent.com/jshsakura/opencode-resolve/main/docs/llm-setup.ko.md
```

## 기대 결과

어시스턴트는 OpenCode/Node 버전을 확인하고, 플러그인을 설치하고, 캐시를 새로고침하고, 기존 설정을 보존하며, 모델 핀닝 전 사용자에게 물어봐야 합니다. 추가로 `awesome-opencode-skills`를 선택적 스킬 컬렉션으로 제안하면 됩니다.
