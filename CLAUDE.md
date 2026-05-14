# CLAUDE.md — opencode-resolve

Project-level notes for future Claude/OpenCode sessions. Read this before making changes that touch agent registration, schema validation, or release flow.

## Release flow (use this, don't `npm publish` by hand)

`NPM_TOKEN` is stored as a GitHub repo secret. `.github/workflows/publish.yml` handles typecheck → test → `npm publish --provenance`. Two ways to trigger:

**Preferred — workflow_dispatch (no local git surgery):**

```sh
gh workflow run "Publish to npm" --repo jshsakura/opencode-resolve -f version=patch
# version: patch | minor | major | <explicit version>
```

The workflow bumps `package.json`, commits as `chore: release vX.Y.Z`, tags `vX.Y.Z`, pushes, then publishes.

**Alternative — local version bump + tag push:**

```sh
npm version patch -m "chore: release v%s"   # or minor / major
git push --follow-tags                       # workflow fires on the v* tag
```

**Never** push a tag for a version that's already on npm — the workflow fails the `Publish` step (npm rejects duplicate versions). To recover: delete the bad tag (`git push origin :refs/tags/vX.Y.Z`), bump again, retry.

## The trap that bit us in v0.1.0–0.1.3

The plugin schema kept gaining valid names in `src/index.ts` (new agents in `VALID_AGENT_NAMES`, new aliases in `VALID_MODEL_ALIASES`) **without a corresponding `npm publish`**. The README's drop-in template told users to write a `resolve.json` that referenced those new names. When OpenCode loaded the npm-cached old plugin against a new `resolve.json`, `normalizeResolveConfig` threw on the unknown name → OpenCode silently disabled the plugin → user saw only `build` / `plan` in the agent picker.

**Rule:** every commit that changes `VALID_AGENT_NAMES`, `VALID_MODEL_ALIASES`, `VALID_TOP_LEVEL_KEYS`, the `enabled` defaults, or any field referenced from the README templates **must** ship as a new published version. Don't merge a README-only update that names a new agent/alias before the supporting schema change is on npm.

## Verifying an install actually worked

From v0.1.4 onward, the plugin logs `[opencode-resolve] v<version> loaded` on every plugin module load. Postinstall logs `installing v<version>` and `install complete`.

End-to-end check after release:

```sh
opencode plugin opencode-resolve --global --force        # should print: installing v<X>, install complete
opencode run "list available agents" 2>&1 | tail -20     # must include resolver and coder
```

If the load line doesn't appear, the plugin wasn't imported — typically a stale cache (delete `~/.cache/opencode/packages/opencode-resolve@latest` and re-run `opencode plugin ... --global --force`) or a JSON parse error in `resolve.json`.

If the load line appears but no agents register, `normalizeResolveConfig` threw. The throw message goes to stderr on plugin load.

## Local testing without publishing

```sh
npm run build
# Replace the cache for this machine only:
rsync -a --delete dist/ scripts/ package.json opencode-resolve.example.json \
  ~/.cache/opencode/packages/opencode-resolve@latest/node_modules/opencode-resolve/
```

Restart OpenCode. Confirms the new code on one machine before publishing.

## Schema change checklist

When adding a new agent name, model alias, or top-level config key:

- [ ] Add to `VALID_AGENT_NAMES` / `VALID_MODEL_ALIASES` / `VALID_TOP_LEVEL_KEYS` in `src/index.ts`
- [ ] Add to `DEFAULT_AGENT_CONFIG` if it's an agent (with prompt, permission, mode)
- [ ] Update `DEFAULT_ENABLED` if the agent should ship enabled
- [ ] Update `opencode-resolve.example.json` (postinstall-created template)
- [ ] Update `opencode-resolve.reference.jsonc`
- [ ] Add a test in `test/*.mjs` that exercises the new path
- [ ] Update README.md and README.ko.md (Drop-in setup, Configuration Reference, Agent Reference, Default Behavior tables)
- [ ] Run `npm test` (currently 36 tests; add one for any new branch)
- [ ] Release a new version — schema additions are a published-version event, not a docs-only event

## Drop-in setup contract

The README's `## Drop-in setup (give to an LLM)` section is the user-facing AI install spec. Any LLM consuming it must:

1. Discover providers + models from the user's `opencode.json` (`provider.*`, top-level `model`, `agent.*.model`).
2. Ask the user which provider, then which model(s).
3. Only write IDs the user explicitly picked — never invent.
4. Don't silently overwrite an existing `resolve.json`; show diff, ask.
5. Verify with `opencode run "list available agents"`.

If you change any of those steps, mirror in `README.ko.md`.

## Files that must stay in sync

| Pair | Why |
|---|---|
| `README.md` ↔ `README.ko.md` | Drop-in template is the install contract — must match. |
| `src/index.ts` ↔ `opencode-resolve.example.json` | Postinstall writes the example as the starter `resolve.json`. Keys must validate against current schema. |
| `src/index.ts` ↔ `opencode-resolve.reference.jsonc` | Reference is documentation for every accepted key. |
| `package.json` `version` ↔ git tag ↔ npm `latest` | The release workflow keeps these aligned. Don't bump version in a commit without tagging. |
