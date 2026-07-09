import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"

const script = new URL("../scripts/postinstall.mjs", import.meta.url)
const cli = new URL("../scripts/cli.mjs", import.meta.url)

test("postinstall creates OpenCode config and resolve config", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    const { stdout } = runPostinstall(configHome)

    const opencodeConfig = await readJson(join(configHome, "opencode.json"))
    const resolveConfig = await readJson(join(configHome, "resolve.json"))

    assert.deepEqual(opencodeConfig.plugin, ["opencode-resolve"])
    // enabled not set at top level — comes from agents.*.enabled in the example
    assert.equal(resolveConfig.enabled, undefined)
    assert.equal(resolveConfig.autoApprove, true)
    assert.equal(resolveConfig.profile, undefined, "profile key removed entirely")
    // maxParallelSubagents intentionally omitted from default — power-user opt-in only
    assert.equal(resolveConfig.maxParallelSubagents, undefined)
    // No opencode model => models stays empty (inherited preset)
    assert.deepEqual(resolveConfig.models, {})
    assert.equal(resolveConfig.agents.gpt, undefined, "gpt agent removed")
    assert.equal(resolveConfig.agents.glm, undefined, "glm agent removed")
    assert.match(stdout, /no models detected in opencode\.json — agents inherit the top-level model/)
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall adds plugin without duplicating existing entries", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    await writeJson(join(configHome, "opencode.json"), {
      plugin: ["@tarquinen/opencode-dcp@3.0.4", ["opencode-resolve", { commands: true }]],
    })

    runPostinstall(configHome, { OPENCODE_RESOLVE_AUTO_PRESET: "1" })

    const opencodeConfig = await readJson(join(configHome, "opencode.json"))
    assert.deepEqual(opencodeConfig.plugin, ["@tarquinen/opencode-dcp@3.0.4", ["opencode-resolve", { commands: true }]])
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall migrates an existing resolve.json by adding only missing top-level keys", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    const existing = {
      enabled: ["coder", "reviewer"],
      models: { glm: "custom/glm", coder: "glm" },
      autoApprove: false,
    }
    await writeJson(join(configHome, "resolve.json"), existing)

    runPostinstall(configHome, { OPENCODE_RESOLVE_AUTO_PRESET: "1" })

    const migrated = await readJson(join(configHome, "resolve.json"))
    assert.deepEqual(migrated.enabled, ["coder", "reviewer"], "user enabled list preserved")
    assert.deepEqual(migrated.models, { glm: "custom/glm", coder: "glm" }, "user models preserved")
    assert.equal(migrated.autoApprove, false, "user autoApprove preserved")
    assert.equal(migrated.maxParallelSubagents, undefined, "no longer added by migration — opt-in only")
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall is a no-op on an already-up-to-date resolve.json", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    const existing = {
      enabled: ["coder", "resolver"],
      autoApprove: true,
      maxParallelSubagents: 1,
    }
    await writeJson(join(configHome, "resolve.json"), existing)

    runPostinstall(configHome, { OPENCODE_RESOLVE_AUTO_PRESET: "1" })

    const migrated = await readJson(join(configHome, "resolve.json"))
    assert.deepEqual(migrated, existing)
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall can be skipped", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    runPostinstall(configHome, { OPENCODE_RESOLVE_SKIP_POSTINSTALL: "1" })

    await assert.rejects(() => readFile(join(configHome, "opencode.json")), /ENOENT/)
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall pins single detected model across all roles when opencode model is openai/gpt-*", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    await writeJson(join(configHome, "opencode.json"), {
      model: "openai/gpt-4o",
    })

    runPostinstall(configHome, { OPENCODE_RESOLVE_AUTO_PRESET: "1" })

    const resolveConfig = await readJson(join(configHome, "resolve.json"))

    // Single detected model pinned to every tier alias and most roles.
    assert.equal(resolveConfig.models.bronze, "openai/gpt-4o")
    assert.equal(resolveConfig.models.silver, "openai/gpt-4o")
    assert.equal(resolveConfig.models.gold, "openai/gpt-4o")
    assert.equal(resolveConfig.models.fast, "openai/gpt-4o")
    assert.equal(resolveConfig.models.strong, "openai/gpt-4o")
    assert.equal(resolveConfig.models.mini, "openai/gpt-4o")
    assert.equal(resolveConfig.models.explorer, "bronze")
    assert.equal(resolveConfig.models.coder, "gold")
    assert.equal(resolveConfig.models.resolver, "gold")
    assert.equal(resolveConfig.models.reviewer, "gold")
    assert.equal(resolveConfig.models["deep-reviewer"], "gold")
    assert.equal(resolveConfig.models.planner, "gold")
    // No model-specific (glm/gpt) alias keys remain
    assert.equal(resolveConfig.models.gpt, undefined)
    assert.equal(resolveConfig.models.glm, undefined)
    // No profile key, no removed gpt/glm agents
    assert.equal(resolveConfig.profile, undefined)
    assert.equal(resolveConfig.agents.gpt, undefined)
    assert.equal(resolveConfig.agents.glm, undefined)
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall pins the top-level model even when a stronger agent model is configured", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    await writeJson(join(configHome, "opencode.json"), {
      model: "zai-coding-plan/glm-5.1",
      agent: {
        plan: {
          model: "openai/gpt-5.5",
        },
      },
    })

    runPostinstall(configHome, { OPENCODE_RESOLVE_AUTO_PRESET: "1" })

    const resolveConfig = await readJson(join(configHome, "resolve.json"))

    assert.equal(resolveConfig.profile, undefined)
    assert.equal(resolveConfig.tier, undefined)
    // Non-interactive uses the top-level model only; the plan agent model is ignored.
    assert.equal(resolveConfig.models.gold, "zai-coding-plan/glm-5.1")
    assert.equal(resolveConfig.models.coder, "gold")
    assert.equal(resolveConfig.models.resolver, "gold")
    assert.equal(resolveConfig.models.reviewer, "gold")
    assert.equal(resolveConfig.models["deep-reviewer"], "gold")
    assert.equal(resolveConfig.models.planner, "gold")
    assert.equal(resolveConfig.models.explorer, "bronze")
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall pins single detected model across all roles when opencode model is glm", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    await writeJson(join(configHome, "opencode.json"), {
      model: "zai-coding-plan/glm-5.1",
    })

    runPostinstall(configHome, { OPENCODE_RESOLVE_AUTO_PRESET: "1" })

    const resolveConfig = await readJson(join(configHome, "resolve.json"))

    assert.equal(resolveConfig.models.gold, "zai-coding-plan/glm-5.1")
    assert.equal(resolveConfig.models.bronze, "zai-coding-plan/glm-5.1")
    assert.equal(resolveConfig.models.silver, "zai-coding-plan/glm-5.1")
    assert.equal(resolveConfig.models.coder, "gold")
    assert.equal(resolveConfig.models.resolver, "gold")
    assert.equal(resolveConfig.models.reviewer, "gold")
    assert.equal(resolveConfig.models["deep-reviewer"], "gold")
    assert.equal(resolveConfig.models.explorer, "bronze")
    assert.equal(resolveConfig.models.planner, "gold")
    // No gpt alias key
    assert.equal(resolveConfig.models.gpt, undefined)
    assert.equal(resolveConfig.profile, undefined)
    assert.equal(resolveConfig.tier, undefined)
    assert.equal(resolveConfig.agents.glm, undefined)
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall pins single detected model for zai model variant", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    await writeJson(join(configHome, "opencode.json"), {
      model: "zai/glm-4",
    })

    runPostinstall(configHome, { OPENCODE_RESOLVE_AUTO_PRESET: "1" })

    const resolveConfig = await readJson(join(configHome, "resolve.json"))
    assert.equal(resolveConfig.models.gold, "zai/glm-4")
    assert.equal(resolveConfig.models.bronze, "zai/glm-4")
    assert.equal(resolveConfig.models.silver, "zai/glm-4")
    assert.equal(resolveConfig.models.resolver, "gold")
    assert.equal(resolveConfig.models.gpt, undefined)
    assert.equal(resolveConfig.profile, undefined)
    assert.equal(resolveConfig.tier, undefined)
    assert.equal(resolveConfig.agents.glm, undefined)
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall leaves models empty when only providers (no top-level model) are configured", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    await writeJson(join(configHome, "opencode.json"), {
      provider: {
        zai: {
          models: {
            "glm-4.7-flash": {},
          },
        },
        openai: {
          models: {
            "gpt-5.5": {},
          },
        },
      },
    })

    const { stdout } = runPostinstall(configHome, { OPENCODE_RESOLVE_AUTO_PRESET: "1" })

    const resolveConfig = await readJson(join(configHome, "resolve.json"))
    // No top-level model/agent model => nothing detected non-interactively => inherited.
    assert.deepEqual(resolveConfig.models, {})
    assert.equal(resolveConfig.profile, undefined)
    assert.match(stdout, /no models detected in opencode\.json/)
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall pins single detected model for any provider (not just GLM/GPT)", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    await writeJson(join(configHome, "opencode.json"), {
      model: "anthropic/claude-sonnet-4",
    })

    runPostinstall(configHome, { OPENCODE_RESOLVE_AUTO_PRESET: "1" })

    const resolveConfig = await readJson(join(configHome, "resolve.json"))
    assert.equal(resolveConfig.models.gold, "anthropic/claude-sonnet-4")
    assert.equal(resolveConfig.models.coder, "gold")
    assert.equal(resolveConfig.profile, undefined)
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall preserves existing resolve.json regardless of model changes", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    await writeJson(join(configHome, "opencode.json"), {
      model: "zai-coding-plan/glm-5.1",
    })
    const existing = {
      enabled: ["coder"],
      models: { custom: "anthropic/claude-sonnet-4" },
      autoApprove: false,
    }
    await writeJson(join(configHome, "resolve.json"), existing)

    runPostinstall(configHome, { OPENCODE_RESOLVE_AUTO_PRESET: "1" })

    const migrated = await readJson(join(configHome, "resolve.json"))
    assert.deepEqual(migrated.enabled, ["coder"], "user enabled list preserved")
    assert.deepEqual(migrated.models, { custom: "anthropic/claude-sonnet-4" }, "user models preserved")
    assert.equal(migrated.autoApprove, false, "user autoApprove preserved")
    assert.equal(migrated.maxParallelSubagents, undefined, "no longer added by migration — opt-in only")
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall asks before updating an existing resolve.json when prompts are forced", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    const existing = {
      models: { custom: "anthropic/claude-sonnet-4" },
    }
    await writeJson(join(configHome, "resolve.json"), existing)

    const { stdout } = runPostinstall(
      configHome,
      {
        OPENCODE_RESOLVE_FORCE_PROMPT: "1",
        OPENCODE_RESOLVE_SKIP_COMPANIONS: "1",
      },
      "1\n",
    )

    const migrated = await readJson(join(configHome, "resolve.json"))
    assert.match(stdout, /existing config detected/)
    assert.match(stdout, /How do you want to handle it/)
    assert.match(stdout, /Choice \[1=keep, 2=models, 3=reset/)
    assert.deepEqual(migrated.models, existing.models, "user models preserved")
    assert.equal(migrated.autoApprove, true, "missing additive default added")
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall can fresh reinstall an existing resolve.json after backing it up", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    await writeJson(join(configHome, "opencode.json"), {
      provider: {
        zai: {
          models: {
            "glm-4.7-flash": {},
            "glm-5.1": {},
          },
        },
        "zai-coding-plan": {
          models: {
            "glm-5.1": {},
          },
        },
        openai: {
          models: {
            "gpt-5.3-codex-spark": {},
            "gpt-5.3-codex": {},
            "gpt-5.5": {},
          },
        },
      },
    })
    const existing = {
      enabled: ["coder"],
      models: { old: "custom/old-model" },
      autoApprove: false,
    }
    await writeJson(join(configHome, "resolve.json"), existing)

    const { stdout } = runPostinstall(
      configHome,
      {
        OPENCODE_RESOLVE_FORCE_PROMPT: "1",
        OPENCODE_RESOLVE_SKIP_COMPANIONS: "1",
      },
      [
        "3", // fresh reinstall
        "3", // pick openai provider (3rd)
        "3", // three-tier shape
        "", "", "", // accept default bronze/silver/gold picks
        "", // confirm picks (default Y)
      ].join("\n") + "\n",
    )

    const resolveConfig = await readJson(join(configHome, "resolve.json"))
    const files = await readdir(configHome)
    const backupName = files.find((name) => name.startsWith("resolve.json.bak."))
    assert.ok(backupName, "existing resolve.json should be backed up")
    assert.deepEqual(await readJson(join(configHome, backupName)), existing)
    assert.match(stdout, /backed up existing resolve config/)
    assert.equal(resolveConfig.profile, undefined, "profile removed")
    assert.equal(resolveConfig.models.old, undefined, "unified reset wipes prior model pins")
    // Provider-agnostic three-tier: bronze/silver/gold from the openai provider
    assert.equal(resolveConfig.models.gold, "openai/gpt-5.5")
    assert.equal(resolveConfig.models.coder, "silver")
    assert.equal(resolveConfig.models.resolver, "gold")
    assert.equal(resolveConfig.agents.gpt, undefined)
    assert.equal(resolveConfig.agents.glm, undefined)
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("non-interactive postinstall preserves existing resolve.json and prints reinstall guidance", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    const existing = {
      enabled: ["coder"],
      models: { custom: "anthropic/claude-sonnet-4" },
    }
    await writeJson(join(configHome, "resolve.json"), existing)

    const { stdout } = runPostinstall(configHome, { OPENCODE_RESOLVE_SKIP_COMPANIONS: "1" })

    const migrated = await readJson(join(configHome, "resolve.json"))
    assert.match(stdout, /existing .*resolve\.json found; preserving it/)
    assert.match(stdout, /opencode-resolve setup --models/)
    assert.match(stdout, /opencode-resolve setup --force-cache/)
    assert.deepEqual(migrated.enabled, existing.enabled)
    assert.deepEqual(migrated.models, existing.models)
    assert.equal(migrated.autoApprove, true)
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall reset reinstall wipes EVERYTHING including model pins (single unified reset)", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    await writeJson(join(configHome, "opencode.json"), {
      model: "openai/gpt-5-mini",
    })
    await writeJson(join(configHome, "resolve.json"), {
      enabled: ["coder"],
      models: { old: "custom/old-model" },
    })

    const { stdout } = runPostinstall(configHome, {
      OPENCODE_RESOLVE_REINSTALL: "fresh",
      OPENCODE_RESOLVE_SKIP_COMPANIONS: "1",
    })

    const resolveConfig = await readJson(join(configHome, "resolve.json"))
    const files = await readdir(configHome)
    assert.ok(files.some((name) => name.startsWith("resolve.json.bak.")), "existing resolve.json should be backed up")
    assert.equal(resolveConfig.models.old, undefined, "old model pins must be wiped")
    assert.equal(resolveConfig.models.gold, "openai/gpt-5-mini", "single detected model pinned")
    assert.equal(resolveConfig.models.coder, "gold")
    assert.equal(resolveConfig.profile, undefined, "profile removed")
    assert.equal(resolveConfig.agents.gpt, undefined)
    assert.match(stdout, /resetting resolve\.json/)
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall reset accepts legacy 'nuke'/'wipe' aliases as the same full wipe", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    await writeJson(join(configHome, "opencode.json"), {
      model: "openai/gpt-5-mini",
    })
    await writeJson(join(configHome, "resolve.json"), {
      enabled: ["coder"],
      models: { old: "custom/old-model" },
    })

    runPostinstall(configHome, {
      OPENCODE_RESOLVE_REINSTALL: "nuke",
      OPENCODE_RESOLVE_SKIP_COMPANIONS: "1",
    })

    const resolveConfig = await readJson(join(configHome, "resolve.json"))
    assert.equal(resolveConfig.models.old, undefined, "nuke alias should wipe pins too")
    assert.equal(resolveConfig.models.gold, "openai/gpt-5-mini", "single detected model pinned")
    assert.equal(resolveConfig.profile, undefined, "profile removed")
    assert.equal(resolveConfig.agents.gpt, undefined)
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall can reconfigure model pins without replacing other settings", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    await writeJson(join(configHome, "opencode.json"), {
      model: "openai/gpt-5-mini",
    })
    await writeJson(join(configHome, "resolve.json"), {
      enabled: ["coder"],
      models: { old: "custom/old-model" },
      autoApprove: false,
    })

    runPostinstall(configHome, {
      OPENCODE_RESOLVE_CONFIGURE_MODELS: "1",
      OPENCODE_RESOLVE_SKIP_COMPANIONS: "1",
    })

    const resolveConfig = await readJson(join(configHome, "resolve.json"))
    assert.deepEqual(resolveConfig.enabled, ["coder"])
    assert.equal(resolveConfig.autoApprove, false)
    assert.equal(resolveConfig.models.old, undefined)
    assert.equal(resolveConfig.models.gold, "openai/gpt-5-mini", "single detected model pinned")
    assert.equal(resolveConfig.models.coder, "gold")
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("cli prints setup help", () => {
  const result = spawnSync(process.execPath, [cli.pathname, "--help"], {
    encoding: "utf8",
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /opencode-resolve setup --reset/)
  assert.match(result.stdout, /--auto-preset/)
  assert.match(result.stdout, /--models/)
  assert.match(result.stdout, /--force-cache/)
})

test("postinstall detects model from agent config when top-level model absent", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    await writeJson(join(configHome, "opencode.json"), {
      agent: {
        build: {
          model: "openai/gpt-5-mini",
        },
      },
    })

    runPostinstall(configHome, { OPENCODE_RESOLVE_AUTO_PRESET: "1" })

    const resolveConfig = await readJson(join(configHome, "resolve.json"))
    assert.equal(resolveConfig.models.gold, "openai/gpt-5-mini", "model detected from agent config")
    assert.equal(resolveConfig.models.bronze, "openai/gpt-5-mini")
    assert.equal(resolveConfig.models.coder, "gold")
    assert.equal(resolveConfig.agents.gpt, undefined)
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall can force the interactive provider-agnostic three-tier prompt", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    await writeJson(join(configHome, "opencode.json"), {
      provider: {
        zai: {
          models: {
            "glm-4.7-flash": {},
            "glm-5.1": {},
          },
        },
        "zai-coding-plan": {
          models: {
            "glm-5.1": {},
            "glm-4.5": {},
          },
        },
        openai: {
          models: {
            "gpt-5.3-codex-spark": {},
            "gpt-5.3-codex": {},
            "gpt-5.5": {},
          },
        },
      },
    })

    const { stdout } = runPostinstall(
      configHome,
      { OPENCODE_RESOLVE_FORCE_PROMPT: "1" },
      [
        "3", // pick openai provider
        "3", // three-tier shape
        "", "", "", // accept default bronze/silver/gold
        "", // confirm picks (default Y)
      ].join("\n") + "\n",
    )

    const resolveConfig = await readJson(join(configHome, "resolve.json"))
    assert.match(stdout, /provider-agnostic mode/, "announces generic mode")
    assert.match(stdout, /Step 1\/3 — Pick provider/, "provider picker")
    assert.match(stdout, /Tier shape \[1,2,3, default 3\]/, "tier shape picker")
    assert.match(stdout, /Pick models/, "model picker")
    assert.equal(resolveConfig.profile, undefined)
    assert.equal(resolveConfig.models.gold, "openai/gpt-5.5")
    assert.equal(resolveConfig.models.coder, "silver")
    assert.equal(resolveConfig.models.resolver, "gold")
    assert.equal(resolveConfig.models.planner, "gold")
    assert.equal(resolveConfig.agents.gpt, undefined)
    assert.equal(resolveConfig.agents.glm, undefined)
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall interactive flow uses the only provider when just one is detected", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    await writeJson(join(configHome, "opencode.json"), {
      provider: {
        openai: {
          models: {
            "gpt-4o-mini": {},
            "gpt-4o": {},
            "gpt-5.5": {},
          },
        },
      },
    })

    const { stdout } = runPostinstall(
      configHome,
      { OPENCODE_RESOLVE_FORCE_PROMPT: "1", OPENCODE_RESOLVE_SKIP_COMPANIONS: "1" },
      // single provider auto-selected: tier=3, accept defaults, confirm
      ["3", "", "", "", ""].join("\n") + "\n",
    )

    const resolveConfig = await readJson(join(configHome, "resolve.json"))
    assert.match(stdout, /only one provider available — using "openai"/)
    assert.equal(resolveConfig.profile, undefined)
    assert.equal(resolveConfig.models.gold, "openai/gpt-5.5")
    assert.equal(resolveConfig.models.coder, "silver")
    assert.equal(resolveConfig.models.planner, "gold")
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall offers the generic auto path for non-GPT/GLM providers", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))
  try {
    await writeJson(join(configHome, "opencode.json"), {
      model: "anthropic/claude-opus-4",
      provider: {
        anthropic: {
          models: {
            "claude-haiku-4": {},
            "claude-sonnet-4": {},
            "claude-opus-4": {},
          },
        },
      },
    })

    const { stdout } = runPostinstall(
      configHome,
      { OPENCODE_RESOLVE_FORCE_PROMPT: "1", OPENCODE_RESOLVE_SKIP_COMPANIONS: "1" },
      // single anthropic provider auto-selected: tier=3 (three), accept defaults, confirm
      ["3", "", "", "", ""].join("\n") + "\n",
    )

    const resolveConfig = await readJson(join(configHome, "resolve.json"))
    assert.match(stdout, /provider-agnostic mode/, "should announce generic mode")
    assert.match(stdout, /only one provider available — using "anthropic"/, "single provider auto-selected")
    assert.match(stdout, /Tier shape \[1,2,3, default 3\]/, "should propose three-tier by default for 3 models")
    assert.equal(resolveConfig.models.gold, "anthropic/claude-opus-4", "strongest → gold")
    assert.equal(resolveConfig.models.coder, "silver", "coder mapped to silver tier")
    assert.equal(resolveConfig.models.resolver, "gold", "resolver mapped to gold tier")
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall never mentions companion plugins (no forced or suggested dependencies)", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    const { stdout } = runPostinstall(configHome)
    assert.doesNotMatch(stdout, /companion plugins/i, "must not mention companion plugins at all")
    assert.doesNotMatch(stdout, /@tarquinen\/opencode-dcp/, "must not reference opencode-dcp")
    assert.doesNotMatch(stdout, /@slkiser\/opencode-quota/, "must not reference opencode-quota")
    const opencodeConfig = await readJson(join(configHome, "opencode.json"))
    const pluginList = JSON.stringify(opencodeConfig.plugin ?? [])
    assert.ok(!pluginList.includes("opencode-dcp"), "companion must NOT be auto-installed")
    assert.ok(!pluginList.includes("opencode-quota"), "companion must NOT be auto-installed")
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall does NOT inject any MCP server, even for GLM models (no forced dependencies)", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))
  const dataHome = await mkdtemp(join(tmpdir(), "opencode-resolve-data-"))

  try {
    await writeJson(join(configHome, "opencode.json"), {
      model: "zai-coding-plan/glm-5.1",
    })

    // Auth.json with a ZAI API key present — must never leak into opencode.json.
    await mkdir(join(dataHome, "opencode"), { recursive: true })
    await writeJson(join(dataHome, "opencode", "auth.json"), {
      "zai-coding-plan": { type: "api", key: "test-api-key-12345" },
    })

    runPostinstall(configHome, { XDG_DATA_HOME: dataHome, Z_AI_API_KEY: "env-fallback-key" })

    const opencodeConfig = await readJson(join(configHome, "opencode.json"))
    // The plugin must never write MCP servers (zai-mcp-server, web-search-prime, etc.).
    assert.ok(!opencodeConfig.mcp || Object.keys(opencodeConfig.mcp).length === 0,
      "no MCP servers should be injected for any model")
    assert.doesNotMatch(JSON.stringify(opencodeConfig), /test-api-key-12345|env-fallback-key|Z_AI_API_KEY|Authorization/i,
      "no credentials must ever be copied into opencode.json")
  } finally {
    await rm(configHome, { recursive: true, force: true })
    await rm(dataHome, { recursive: true, force: true })
  }
})

test("postinstall preserves existing user MCP servers without modification", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    await writeJson(join(configHome, "opencode.json"), {
      model: "zai-coding-plan/glm-5.1",
      mcp: {
        "custom-mcp": { type: "local", command: ["my-tool"] },
        "zai-mcp-server": { type: "local", command: ["custom-npx"] },
      },
    })

    runPostinstall(configHome)

    const opencodeConfig = await readJson(join(configHome, "opencode.json"))
    // Existing MCPs are left exactly as the user configured them — never overwritten.
    assert.deepEqual(opencodeConfig.mcp["custom-mcp"], { type: "local", command: ["my-tool"] })
    assert.deepEqual(opencodeConfig.mcp["zai-mcp-server"], { type: "local", command: ["custom-npx"] })
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

function runPostinstall(configHome, env = {}, input = undefined) {
  const result = spawnSync(process.execPath, [script.pathname], {
    encoding: "utf8",
    input,
    env: {
      ...process.env,
      OPENCODE_CONFIG_HOME: configHome,
      OPENCODE_RESOLVE_SKIP_CACHE_REFRESH: "1",
      ...env,
    },
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}
