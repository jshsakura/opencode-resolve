---
title: AI Setup Guide
description: Instructions for delegating setup to an AI coding assistant.
---

Give this to an AI coding assistant:

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

Raw setup guide:

```sh
curl -s https://raw.githubusercontent.com/jshsakura/opencode-resolve/main/docs/llm-setup.md
```

Fresh reinstall command that works across Windows PowerShell, macOS, and Linux:

```sh
npm install -g opencode-resolve --opencode-resolve-reinstall=fresh
```

## Expected Result

The assistant should:

1. Check `opencode --version` and `node --version`.
2. Install `opencode-resolve`.
3. Run `opencode plugin opencode-resolve --global --force`.
4. Merge the plugin entry into `opencode.json`.
5. Create `resolve.json` only if missing.
6. Ask before pinning any model.
7. Offer `awesome-opencode-skills` as an optional skills collection.
8. Tell you to restart OpenCode.
