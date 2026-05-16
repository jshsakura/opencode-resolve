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
    // enabled not set in example — resolved at runtime by tier or DEFAULT_ENABLED
    assert.equal(resolveConfig.enabled, undefined)
    assert.equal(resolveConfig.autoApprove, true)
    assert.equal(resolveConfig.profile, "mix")
    // maxParallelSubagents intentionally omitted from default — power-user opt-in only
    assert.equal(resolveConfig.maxParallelSubagents, undefined)
    // No opencode model => models stays empty (inherited preset)
    assert.deepEqual(resolveConfig.models, {})
    assert.equal(resolveConfig.agents.gpt.enabled, false)
    assert.equal(resolveConfig.agents.glm.enabled, false)
    assert.match(stdout, /no GPT\/GLM models detected/)
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

test("postinstall creates GPT-only preset when opencode model is openai/gpt-*", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    await writeJson(join(configHome, "opencode.json"), {
      model: "openai/gpt-4o",
    })

    runPostinstall(configHome, { OPENCODE_RESOLVE_AUTO_PRESET: "1" })

    const resolveConfig = await readJson(join(configHome, "resolve.json"))

    assert.equal(resolveConfig.models.gpt, "openai/gpt-4o")
    assert.equal(resolveConfig.models.bronze, "openai/gpt-4o")
    assert.equal(resolveConfig.models.silver, "openai/gpt-4o")
    assert.equal(resolveConfig.models.gold, "openai/gpt-4o")
    assert.equal(resolveConfig.models.fast, "bronze")
    assert.equal(resolveConfig.models.strong, "gold")
    assert.equal(resolveConfig.models.codex, "gold")
    assert.equal(resolveConfig.models.coder, "silver")
    assert.equal(resolveConfig.models.resolver, "gold")
    assert.equal(resolveConfig.models.reviewer, "gold")
    assert.equal(resolveConfig.models["deep-reviewer"], "gold")
    assert.equal(resolveConfig.models.explorer, "bronze")
    assert.equal(resolveConfig.agents.gpt.enabled, true)
    // GPT profile and tier set automatically
    assert.equal(resolveConfig.profile, "gpt")
    assert.equal(resolveConfig.tier, "gold")
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall creates explicit mixed preset when GLM and GPT models are both configured", async () => {
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

    assert.equal(resolveConfig.profile, "mix")
    assert.equal(resolveConfig.tier, undefined)
    assert.equal(resolveConfig.models.glm, "zai-coding-plan/glm-5.1")
    assert.equal(resolveConfig.models.gpt, "openai/gpt-5.5")
    assert.equal(resolveConfig.models["glm-bronze"], "zai-coding-plan/glm-5.1")
    assert.equal(resolveConfig.models["glm-silver"], "zai-coding-plan/glm-5.1")
    assert.equal(resolveConfig.models["glm-gold"], "zai-coding-plan/glm-5.1")
    assert.equal(resolveConfig.models["gpt-bronze"], "openai/gpt-5.5")
    assert.equal(resolveConfig.models["gpt-silver"], "openai/gpt-5.5")
    assert.equal(resolveConfig.models["gpt-gold"], "openai/gpt-5.5")
    assert.equal(resolveConfig.models.explorer, "bronze")
    assert.equal(resolveConfig.models.coder, "silver")
    assert.equal(resolveConfig.models.resolver, "gold")
    assert.equal(resolveConfig.models.reviewer, "gold")
    assert.equal(resolveConfig.models["deep-reviewer"], "gold")
    assert.equal(resolveConfig.models.planner, "gold")
    assert.equal(resolveConfig.agents.gpt.enabled, true)
    assert.equal(resolveConfig.agents.glm.enabled, true)
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall creates GLM-only preset when opencode model is glm", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    await writeJson(join(configHome, "opencode.json"), {
      model: "zai-coding-plan/glm-5.1",
    })

    runPostinstall(configHome, { OPENCODE_RESOLVE_AUTO_PRESET: "1" })

    const resolveConfig = await readJson(join(configHome, "resolve.json"))

    assert.equal(resolveConfig.models.glm, "zai-coding-plan/glm-5.1")
    // GLM-only: no GPT dependency — GLM fills all three tiers
    assert.equal(resolveConfig.models.bronze, "zai-coding-plan/glm-5.1")
    assert.equal(resolveConfig.models.silver, "zai-coding-plan/glm-5.1")
    assert.equal(resolveConfig.models.gold, "zai-coding-plan/glm-5.1")
    assert.equal(resolveConfig.models.fast, "bronze")
    assert.equal(resolveConfig.models.strong, "gold")
    assert.equal(resolveConfig.models.coder, "gold")
    assert.equal(resolveConfig.models.resolver, "gold")
    assert.equal(resolveConfig.models.reviewer, "gold")
    assert.equal(resolveConfig.models["deep-reviewer"], "gold")
    assert.equal(resolveConfig.models.explorer, "bronze")
    assert.equal(resolveConfig.models.planner, "gold")
    // No GPT key at all
    assert.equal(resolveConfig.models.gpt, undefined)
    // GLM profile and tier set automatically
    assert.equal(resolveConfig.profile, "glm")
    assert.equal(resolveConfig.tier, "silver")
    assert.equal(resolveConfig.agents.glm.enabled, true)
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall creates GLM-only preset for zai model variant", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    await writeJson(join(configHome, "opencode.json"), {
      model: "zai/glm-4",
    })

    runPostinstall(configHome, { OPENCODE_RESOLVE_AUTO_PRESET: "1" })

    const resolveConfig = await readJson(join(configHome, "resolve.json"))
    assert.equal(resolveConfig.models.glm, "zai/glm-4")
    // GLM-only: all three tiers use the user's configured GLM model, no GPT key
    assert.equal(resolveConfig.models.bronze, "zai/glm-4")
    assert.equal(resolveConfig.models.silver, "zai/glm-4")
    assert.equal(resolveConfig.models.gold, "zai/glm-4")
    assert.equal(resolveConfig.models.resolver, "gold")
    assert.equal(resolveConfig.models.gpt, undefined)
    assert.equal(resolveConfig.profile, "glm")
    assert.equal(resolveConfig.tier, "silver")
    assert.equal(resolveConfig.agents.glm.enabled, true)
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall qualifies provider model keys before building mixed preset", async () => {
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

    runPostinstall(configHome, { OPENCODE_RESOLVE_AUTO_PRESET: "1" })

    const resolveConfig = await readJson(join(configHome, "resolve.json"))
    assert.equal(resolveConfig.profile, "mix")
    assert.equal(resolveConfig.models.glm, "zai/glm-4.7-flash")
    assert.equal(resolveConfig.models.gpt, "openai/gpt-5.5")
    assert.equal(resolveConfig.models["glm-bronze"], "zai/glm-4.7-flash")
    assert.equal(resolveConfig.models["gpt-gold"], "openai/gpt-5.5")
    assert.equal(resolveConfig.models.coder, "silver")
    assert.equal(resolveConfig.models.resolver, "gold")
    assert.equal(resolveConfig.agents.gpt.enabled, true)
    assert.equal(resolveConfig.agents.glm.enabled, true)
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall keeps models empty for unknown provider", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    await writeJson(join(configHome, "opencode.json"), {
      model: "anthropic/claude-sonnet-4",
    })

    runPostinstall(configHome, { OPENCODE_RESOLVE_AUTO_PRESET: "1" })

    const resolveConfig = await readJson(join(configHome, "resolve.json"))
    assert.deepEqual(resolveConfig.models, {})
    assert.equal(resolveConfig.profile, "mix")
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
    assert.match(stdout, /Existing resolve config found/)
    assert.match(stdout, /Existing config \[1=update, 2=models, 3=fresh/)
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
        "1", // mix
        "y", // enable gpt primary
        "y", // enable glm primary
        "1", "2", "3", // GPT bronze/silver/gold
        "1", "2", "2", // GLM bronze/silver/gold
      ].join("\n") + "\n",
    )

    const resolveConfig = await readJson(join(configHome, "resolve.json"))
    const files = await readdir(configHome)
    const backupName = files.find((name) => name.startsWith("resolve.json.bak."))
    assert.ok(backupName, "existing resolve.json should be backed up")
    assert.deepEqual(await readJson(join(configHome, backupName)), existing)
    assert.match(stdout, /backed up existing resolve config/)
    assert.equal(resolveConfig.profile, "mix")
    assert.equal(resolveConfig.models.old, "custom/old-model")
    assert.equal(resolveConfig.models["gpt-gold"], "openai/gpt-5.5")
    assert.equal(resolveConfig.models["glm-bronze"], "zai/glm-5.1")
    assert.equal(resolveConfig.agents.gpt.enabled, true)
    assert.equal(resolveConfig.agents.glm.enabled, true)
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

test("postinstall fresh reinstall preserves existing model pins by default", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    await writeJson(join(configHome, "resolve.json"), {
      enabled: ["coder"],
      models: { old: "custom/old-model" },
    })

    runPostinstall(configHome, {
      OPENCODE_RESOLVE_REINSTALL: "fresh",
      OPENCODE_RESOLVE_SKIP_COMPANIONS: "1",
    })

    const resolveConfig = await readJson(join(configHome, "resolve.json"))
    const files = await readdir(configHome)
    assert.ok(files.some((name) => name.startsWith("resolve.json.bak.")), "existing resolve.json should be backed up")
    assert.equal(resolveConfig.models.old, "custom/old-model")
    assert.equal(resolveConfig.profile, "mix")
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall reset models flag allows destructive model regeneration", async () => {
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
      OPENCODE_RESOLVE_REINSTALL: "fresh",
      OPENCODE_RESOLVE_RESET_MODELS: "1",
      OPENCODE_RESOLVE_SKIP_COMPANIONS: "1",
    })

    const resolveConfig = await readJson(join(configHome, "resolve.json"))
    assert.equal(resolveConfig.models.old, undefined)
    assert.equal(resolveConfig.models.gpt, "openai/gpt-5-mini")
    assert.equal(resolveConfig.profile, "gpt")
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
    assert.equal(resolveConfig.models.gpt, "openai/gpt-5-mini")
    assert.equal(resolveConfig.models.coder, "silver")
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("cli prints setup help", () => {
  const result = spawnSync(process.execPath, [cli.pathname, "--help"], {
    encoding: "utf8",
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /opencode-resolve setup --fresh/)
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
    assert.equal(resolveConfig.models.gpt, "openai/gpt-5-mini")
    assert.equal(resolveConfig.models.bronze, "openai/gpt-5-mini")
    assert.equal(resolveConfig.models.silver, "openai/gpt-5-mini")
    assert.equal(resolveConfig.models.gold, "openai/gpt-5-mini")
    assert.equal(resolveConfig.models.coder, "silver")
    assert.equal(resolveConfig.agents.gpt.enabled, true)
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall can force the interactive mix three-tier prompt", async () => {
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
        "1", // mix
        "y", // enable gpt primary
        "y", // enable glm primary
        "1", "2", "3", // GPT bronze/silver/gold
        "1", "2", "2", // GLM bronze/silver/gold
      ].join("\n") + "\n",
    )

    const resolveConfig = await readJson(join(configHome, "resolve.json"))
    assert.match(stdout, /Enable dedicated GPT primary agent/)
    assert.match(stdout, /Pick GPT bronze\/scout/)
    assert.match(stdout, /Pick GLM gold\/reasoner/)
    assert.equal(resolveConfig.profile, "mix")
    assert.ok(resolveConfig.enabled.includes("gpt"))
    assert.ok(resolveConfig.enabled.includes("glm"))
    assert.equal(resolveConfig.agents.gpt.enabled, true)
    assert.equal(resolveConfig.agents.glm.enabled, true)
    assert.equal(resolveConfig.models["gpt-bronze"], "openai/gpt-5.3-codex-spark")
    assert.equal(resolveConfig.models["gpt-silver"], "openai/gpt-5.3-codex")
    assert.equal(resolveConfig.models["gpt-gold"], "openai/gpt-5.5")
    assert.equal(resolveConfig.models["glm-bronze"], "zai/glm-5.1")
    assert.equal(resolveConfig.models["glm-silver"], "zai-coding-plan/glm-5.1")
    assert.equal(resolveConfig.models["glm-gold"], "zai-coding-plan/glm-5.1")
    assert.equal(resolveConfig.models.coder, "silver")
    assert.equal(resolveConfig.models.planner, "gold")
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall can force the interactive GPT three-tier prompt", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    const { stdout } = runPostinstall(
      configHome,
      { OPENCODE_RESOLVE_FORCE_PROMPT: "1" },
      ["2", "", "", ""].join("\n") + "\n",
    )

    const resolveConfig = await readJson(join(configHome, "resolve.json"))
    assert.match(stdout, /GPT\/Codex model choices/)
    assert.equal(resolveConfig.profile, "gpt")
    assert.equal(resolveConfig.tier, "gold")
    assert.ok(resolveConfig.enabled.includes("gpt"))
    assert.equal(resolveConfig.agents.gpt.enabled, true)
    assert.equal(resolveConfig.models.coder, "silver")
    assert.equal(resolveConfig.models.planner, "gold")
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall can force the interactive GLM three-tier prompt", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    const { stdout } = runPostinstall(
      configHome,
      { OPENCODE_RESOLVE_FORCE_PROMPT: "1" },
      ["3", "n", "", "", ""].join("\n") + "\n",
    )

    const resolveConfig = await readJson(join(configHome, "resolve.json"))
    assert.match(stdout, /GLM model choices/)
    assert.match(stdout, /coding-plan/)
    assert.equal(resolveConfig.profile, "glm")
    assert.equal(resolveConfig.tier, "gold")
    assert.ok(resolveConfig.enabled.includes("glm"))
    assert.equal(resolveConfig.agents.glm.enabled, true)
    assert.equal(resolveConfig.models.coder, "gold")
    assert.equal(resolveConfig.models.planner, "gold")
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("non-interactive postinstall prints companion-plugin suggestions when companions are missing", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    const { stdout } = runPostinstall(configHome)
    assert.match(stdout, /recommended companion plugins not detected/)
    assert.match(stdout, /@tarquinen\/opencode-dcp/)
    assert.match(stdout, /@slkiser\/opencode-quota/)
    assert.match(stdout, /opencode plugin @tarquinen\/opencode-dcp@latest --global --force/)
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("non-interactive postinstall stays silent about companions already present", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    await writeJson(join(configHome, "opencode.json"), {
      plugin: [
        "opencode-resolve",
        "@tarquinen/opencode-dcp@latest",
        "@slkiser/opencode-quota@latest",
      ],
    })

    const { stdout } = runPostinstall(configHome)
    assert.match(stdout, /recommended companion plugins already present/)
    assert.doesNotMatch(stdout, /recommended companion plugins not detected/)
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("OPENCODE_RESOLVE_SKIP_COMPANIONS=1 silences the companion suggestion", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    const { stdout } = runPostinstall(configHome, { OPENCODE_RESOLVE_SKIP_COMPANIONS: "1" })
    assert.doesNotMatch(stdout, /recommended companion plugins/)
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall injects ZAI MCP server without copying API keys", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))
  const dataHome = await mkdtemp(join(tmpdir(), "opencode-resolve-data-"))

  try {
    await writeJson(join(configHome, "opencode.json"), {
      model: "zai-coding-plan/glm-5.1",
    })

    // Set up auth.json with ZAI API key
    await mkdir(join(dataHome, "opencode"), { recursive: true })
    await writeJson(join(dataHome, "opencode", "auth.json"), {
      "zai-coding-plan": { type: "api", key: "test-api-key-12345" },
    })

    runPostinstall(configHome, { XDG_DATA_HOME: dataHome })

    const opencodeConfig = await readJson(join(configHome, "opencode.json"))

    // Local ZAI MCP server should be present
    assert.ok(opencodeConfig.mcp, "mcp section should exist")
    assert.ok(opencodeConfig.mcp["zai-mcp-server"], "zai-mcp-server should be injected")
    assert.equal(opencodeConfig.mcp["zai-mcp-server"].environment.Z_AI_MODE, "ZAI")
    assert.equal(opencodeConfig.mcp["zai-mcp-server"].environment.Z_AI_API_KEY, undefined)
    assert.equal(opencodeConfig.mcp["web-search-prime"], undefined)
    assert.equal(opencodeConfig.mcp["web-reader"], undefined)
    assert.equal(opencodeConfig.mcp.zread, undefined)
  } finally {
    await rm(configHome, { recursive: true, force: true })
    await rm(dataHome, { recursive: true, force: true })
  }
})

test("postinstall preserves existing MCP servers and skips already-present ZAI MCPs", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))
  const dataHome = await mkdtemp(join(tmpdir(), "opencode-resolve-data-"))

  try {
    await writeJson(join(configHome, "opencode.json"), {
      model: "zai-coding-plan/glm-5.1",
      mcp: {
        "custom-mcp": { type: "local", command: ["my-tool"] },
        "zai-mcp-server": { type: "local", command: ["custom-npx"] },
      },
    })
    await mkdir(join(dataHome, "opencode"), { recursive: true })
    await writeJson(join(dataHome, "opencode", "auth.json"), {
      "zai-coding-plan": { type: "api", key: "test-key" },
    })

    runPostinstall(configHome, { XDG_DATA_HOME: dataHome })

    const opencodeConfig = await readJson(join(configHome, "opencode.json"))

    // Existing custom MCP preserved
    assert.deepEqual(opencodeConfig.mcp["custom-mcp"], { type: "local", command: ["my-tool"] })
    // Existing ZAI MCP NOT overwritten
    assert.deepEqual(opencodeConfig.mcp["zai-mcp-server"], { type: "local", command: ["custom-npx"] })
    // No API key or remote Authorization headers are copied into config
    assert.equal(opencodeConfig.mcp["web-search-prime"], undefined)
    assert.equal(opencodeConfig.mcp["web-reader"], undefined)
    assert.equal(opencodeConfig.mcp.zread, undefined)
  } finally {
    await rm(configHome, { recursive: true, force: true })
    await rm(dataHome, { recursive: true, force: true })
  }
})

test("postinstall does NOT inject ZAI MCP servers for non-GLM models", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    await writeJson(join(configHome, "opencode.json"), {
      model: "openai/gpt-4o",
    })

    runPostinstall(configHome)

    const opencodeConfig = await readJson(join(configHome, "opencode.json"))
    assert.ok(!opencodeConfig.mcp || Object.keys(opencodeConfig.mcp).length === 0,
      "no ZAI MCPs should be injected for GPT-only setup")
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall does not copy ZAI API key from env into config", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))
  const dataHome = await mkdtemp(join(tmpdir(), "opencode-resolve-data-"))

  try {
    await writeJson(join(configHome, "opencode.json"), {
      model: "zai-coding-plan/glm-5.1",
    })
    runPostinstall(configHome, {
      XDG_DATA_HOME: dataHome,
      Z_AI_API_KEY: "env-fallback-key",
    })

    const opencodeConfig = await readJson(join(configHome, "opencode.json"))
    assert.ok(opencodeConfig.mcp["zai-mcp-server"])
    assert.equal(opencodeConfig.mcp["zai-mcp-server"].environment.Z_AI_API_KEY, undefined)
    assert.doesNotMatch(JSON.stringify(opencodeConfig), /env-fallback-key/)
  } finally {
    await rm(configHome, { recursive: true, force: true })
    await rm(dataHome, { recursive: true, force: true })
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
