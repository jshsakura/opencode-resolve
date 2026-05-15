# Troubleshooting

Use this page when OpenCode does not appear to load `opencode-resolve` correctly.

## Resolver Does Not Appear

Check `opencode.json`:

```sh
cat ~/.config/opencode/opencode.json
```

The top-level `plugin` array should include:

```json
"opencode-resolve"
```

Then refresh the plugin cache:

```sh
opencode plugin opencode-resolve --global --force
```

Restart OpenCode.

## Old Version Keeps Loading

Remove only this plugin's cache entry:

```sh
export OPENCODE_CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/opencode"
rm -rf "$OPENCODE_CACHE_ROOT/packages/opencode-resolve@latest"
opencode plugin opencode-resolve@latest --global --force
```

Do not delete `~/.config/opencode/resolve.json`.

## Config Fails To Load

The config validator is strict by design. Common causes:

- Unknown top-level key.
- Unknown agent name.
- Invalid `mode`.
- Non-boolean `enabled`.
- Non-positive `maxSteps` or `maxParallelSubagents`.
- Invalid permission value.

Compare your config with:

```text
opencode-resolve.reference.jsonc
```

## Context7 Does Not Appear

Check:

```json
{
  "context7": true
}
```

If `mcp.context7` already exists in OpenCode config, the plugin preserves it and does not replace it.

## Bash Still Asks

That is expected for unknown commands. The plugin auto-allows common safe commands and denies known-dangerous patterns, but it does not turn all bash commands into `allow`.

For agent-specific behavior, configure:

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

## Model Looks Wrong

Model resolution order:

1. `agents.<name>.model`
2. `models.<name>`
3. OpenCode top-level `model`
4. OpenCode fallback

If `models` is empty, inheritance from OpenCode is expected.

## Installation Changed Too Much

The installer should be additive. If you want to avoid all install-time config edits:

```sh
OPENCODE_RESOLVE_SKIP_POSTINSTALL=1 npm install -g opencode-resolve
```

Then apply the manual setup from [Installation Guide](INSTALL.md).
