---
title: Troubleshooting
description: Fix plugin cache, config, model, and permission issues.
---

## Resolver Does Not Appear

Check `~/.config/opencode/opencode.json` and confirm:

```json
"opencode-resolve"
```

Then run:

```sh
opencode plugin opencode-resolve --global --force
```

Restart OpenCode.

## Old Version Keeps Loading

```sh
export OPENCODE_CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/opencode"
rm -rf "$OPENCODE_CACHE_ROOT/packages/opencode-resolve@latest"
opencode plugin opencode-resolve@latest --global --force
```

Do not delete `~/.config/opencode/resolve.json`.

## Config Fails

Common causes:

- unknown top-level key
- unknown agent name
- invalid `mode`
- invalid permission value
- non-positive `maxSteps` or `maxParallelSubagents`

Compare with `opencode-resolve.reference.jsonc`.

## Bash Still Asks

Expected for unknown commands. Safe common commands may be auto-allowed; dangerous patterns may be denied; unknown commands remain interactive.
