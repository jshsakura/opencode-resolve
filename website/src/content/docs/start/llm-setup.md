---
title: LLM-driven Install (Auto)
description: Hand this page to any capable LLM. It auto-detects providers/models in opencode.json, applies the recommended three-tier setup, installs companion plugins, and writes resolve.json — without asking questions unless something is genuinely ambiguous.
---

> **For LLMs reading this page:** the user said *"set up opencode-resolve on this machine"*. You **auto-install with recommended defaults**. Do not run a Q&A. Only stop and ask the user when something is genuinely ambiguous (see "Ambiguity gates" below).

## What "auto" means

| Decision | Default action |
|---|---|
| Provider | Use the prefix of the user's top-level `model` in `opencode.json`. |
| Tier shape | **Three-tier (bronze/silver/gold)** — recommended. Fall back automatically if fewer models exist. |
| Tier→model mapping | Cheapest available → bronze, mid → silver, strongest → gold. Inferred by name (`mini`/`flash`/`air` = cheap, `gold`/`pro`/`max`/`5.5`/`5.1` = strong). |
| Companion plugins | Install **both** `@tarquinen/opencode-dcp` and `@slkiser/opencode-quota` by default (recommended). |
| `maxParallelSubagents` | Omit. Resolver uses soft fan-out by default. |
| `context7` / `autoApprove` | Both `true` (defaults). |

The LLM picks all the above silently and prints a summary at the end. No interactive Q&A unless an "ambiguity gate" trips.

## Ambiguity gates — only stop when one of these is true

1. **No provider configured at all.** Tell the user to add at least one provider with a valid API key to `~/.config/opencode/opencode.json` first, then re-run.
2. **Multiple providers and no top-level `model`.** Show the list, ask the user which one to use. Use the answer; do not invent.
3. **`resolve.json` already exists.** Show the user the existing content + a diff of what would change + ask: overwrite, merge missing keys only, or abort.

For every other ambiguity, pick the recommended default and report it in the final summary.

## Auto-install steps

### Step 1 — Install package and prime cache

```sh
npm install -g opencode-resolve@latest
opencode plugin opencode-resolve@latest --global --force
```

### Step 2 — Detect providers/models from `~/.config/opencode/opencode.json`

Build a candidate map:

| Source | Collect |
|---|---|
| `provider.*` keys | Each configured provider. |
| `provider.<key>.models.*` keys | Models declared under each provider. |
| Top-level `model` | The provider prefix becomes the **primary provider** (auto-pick target). |
| `agent.*.model` | Also valid candidates. |

If gate 1 trips, stop. If gate 2 trips, ask. Otherwise: primary provider = prefix of top-level `model`.

### Step 3 — Auto-assign three-tier

Sort the primary provider's models by inferred strength (heuristic: keywords `mini`/`flash`/`nano`/`air`/`lite` → weakest; `pro`/`max`/`5.5`/`opus`/`gold` → strongest). Then:

- **3+ distinct models available** → three-tier: bronze=weakest, silver=middle, gold=strongest.
- **Exactly 2 models** → two-tier: silver=weaker (also covers explorer/coder), gold=stronger (covers resolver/reviewer/deep-reviewer/planner).
- **1 model** → single-tier: gold=that model for every role.

### Step 4 — Install companion plugins (default yes)

```sh
opencode plugin @tarquinen/opencode-dcp@latest --global --force
opencode plugin @slkiser/opencode-quota@latest --global --force
```

Append each to the `plugin` array in `opencode.json` if not already present. Skip silently if `OPENCODE_RESOLVE_SKIP_COMPANIONS=1` is set in the user's environment.

### Step 5 — Register the plugin in `opencode.json`

Add the bare string `"opencode-resolve"` to the `plugin` array (never the inline tuple form). Append, do not overwrite existing entries.

### Step 6 — Write `~/.config/opencode/resolve.json` (gate 3 first)

If the file exists, run gate 3. Otherwise write the picked tier template:

**Three-tier (recommended default):**

```json
{
  "enabled": ["coder", "resolver", "explorer", "reviewer", "deep-reviewer", "planner"],
  "preserveNative": true,
  "context7": true,
  "commands": false,
  "models": {
    "bronze":        "<provider>/<weakest>",
    "silver":        "<provider>/<middle>",
    "gold":          "<provider>/<strongest>",
    "explorer":      "bronze",
    "coder":         "silver",
    "resolver":      "gold",
    "reviewer":      "gold",
    "deep-reviewer": "gold",
    "planner":       "gold"
  },
  "agents": {
    "coder":         { "enabled": true,  "mode": "subagent" },
    "resolver":      { "enabled": true },
    "explorer":      { "enabled": true,  "mode": "subagent" },
    "reviewer":      { "enabled": true,  "mode": "subagent" },
    "deep-reviewer": { "enabled": true,  "mode": "subagent" },
    "planner":       { "enabled": true,  "mode": "subagent" },
    "architect":     { "enabled": false },
    "gpt-coder":     { "enabled": false },
    "debugger":      { "enabled": false },
    "researcher":    { "enabled": false }
  },
  "autoApprove": true,
  "autoUpdate": true
}
```

**Two-tier fallback** (only 2 models available):

```json
"models": {
  "silver":        "<provider>/<weaker>",
  "gold":          "<provider>/<stronger>",
  "explorer":      "silver",
  "coder":         "silver",
  "resolver":      "gold",
  "reviewer":      "gold",
  "deep-reviewer": "gold",
  "planner":       "gold"
}
```

**Single-tier fallback** (only 1 model):

```json
"models": {
  "gold":          "<provider>/<single>",
  "explorer":      "gold",
  "coder":         "gold",
  "resolver":      "gold",
  "reviewer":      "gold",
  "deep-reviewer": "gold",
  "planner":       "gold"
}
```

Substitute the **exact** model IDs picked in Step 3. No invented IDs, no version drift.

### Step 7 — Print a summary and verify

Print a single summary block, then run verification.

```
✓ opencode-resolve installed (v<X.Y.Z>)
✓ Provider: <provider>
✓ Tier: three-tier (bronze=<weakest>, silver=<middle>, gold=<strongest>)
✓ Companion plugins: @tarquinen/opencode-dcp, @slkiser/opencode-quota
→ Restart OpenCode, then run: opencode run "list available agents"
  (must include resolver and coder)
```

Inside any agent session you can also ask:

> *run resolve-version*

The `resolve-version` tool returns the loaded plugin version and the cache path — confirms the upgrade actually took effect.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Only OpenCode's built-in `explore` / `general` appear | Plugin didn't load | Re-run `opencode plugin opencode-resolve@latest --global --force`; check `"opencode-resolve"` is in `opencode.json` `plugin` array as a string. |
| Agents appear but fail with "model not found" | A pinned model ID in `models` doesn't exist | Edit `resolve.json` and replace the offending ID with a real one, restart OpenCode. |
| Boot line shows the wrong version after upgrade | Stale plugin cache | `rm -rf ~/.cache/opencode/packages/opencode-resolve@latest && opencode plugin opencode-resolve@latest --global --force` |

See [Installation](/opencode-resolve/start/install/) for the shell-only operator path if you'd rather not delegate to an LLM.
