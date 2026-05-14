import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"

const script = new URL("../scripts/postinstall.mjs", import.meta.url)

test("postinstall creates OpenCode config and resolve config", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    runPostinstall(configHome)

    const opencodeConfig = await readJson(join(configHome, "opencode.json"))
    const resolveConfig = await readJson(join(configHome, "resolve.json"))

    assert.deepEqual(opencodeConfig.plugin, ["opencode-resolve"])
    // enabled not set in example — resolved at runtime by tier or DEFAULT_ENABLED
    assert.equal(resolveConfig.enabled, undefined)
    assert.equal(resolveConfig.autoApprove, true)
    // maxParallelSubagents intentionally omitted from default — power-user opt-in only
    assert.equal(resolveConfig.maxParallelSubagents, undefined)
    // No opencode model => models stays empty (inherited preset)
    assert.deepEqual(resolveConfig.models, {})
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

    runPostinstall(configHome)

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

    runPostinstall(configHome)

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

    runPostinstall(configHome)

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

    runPostinstall(configHome)

    const resolveConfig = await readJson(join(configHome, "resolve.json"))

    assert.equal(resolveConfig.models.gpt, "openai/gpt-4o")
    assert.equal(resolveConfig.models.fast, "gpt")
    assert.equal(resolveConfig.models.strong, "gpt")
    assert.equal(resolveConfig.models.coder, "gpt")
    assert.equal(resolveConfig.models.resolver, "gpt")
    assert.equal(resolveConfig.models.reviewer, "gpt")
    assert.equal(resolveConfig.models["deep-reviewer"], "gpt")
    assert.equal(resolveConfig.models.explorer, "gpt")
    // GPT profile and tier set automatically
    assert.equal(resolveConfig.profile, "gpt")
    assert.equal(resolveConfig.tier, "gold")
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

    runPostinstall(configHome)

    const resolveConfig = await readJson(join(configHome, "resolve.json"))

    assert.equal(resolveConfig.models.glm, "zai-coding-plan/glm-5.1")
    // GLM-only: no GPT dependency — all agents use GLM
    assert.equal(resolveConfig.models.fast, "glm")
    assert.equal(resolveConfig.models.strong, "glm")
    assert.equal(resolveConfig.models.coder, "glm")
    assert.equal(resolveConfig.models.resolver, "glm")
    assert.equal(resolveConfig.models.reviewer, "glm")
    assert.equal(resolveConfig.models["deep-reviewer"], "glm")
    assert.equal(resolveConfig.models.explorer, "fast")
    assert.equal(resolveConfig.models.planner, "glm")
    // No GPT key at all
    assert.equal(resolveConfig.models.gpt, undefined)
    // GLM profile and tier set automatically
    assert.equal(resolveConfig.profile, "glm")
    assert.equal(resolveConfig.tier, "silver")
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

    runPostinstall(configHome)

    const resolveConfig = await readJson(join(configHome, "resolve.json"))
    assert.equal(resolveConfig.models.glm, "zai-coding-plan/glm-5.1")
    // GLM-only: all agents point to glm, no GPT key
    assert.equal(resolveConfig.models.resolver, "glm")
    assert.equal(resolveConfig.models.gpt, undefined)
    assert.equal(resolveConfig.profile, "glm")
    assert.equal(resolveConfig.tier, "silver")
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

    runPostinstall(configHome)

    const resolveConfig = await readJson(join(configHome, "resolve.json"))
    assert.deepEqual(resolveConfig.models, {})
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

    runPostinstall(configHome)

    const migrated = await readJson(join(configHome, "resolve.json"))
    assert.deepEqual(migrated.enabled, ["coder"], "user enabled list preserved")
    assert.deepEqual(migrated.models, { custom: "anthropic/claude-sonnet-4" }, "user models preserved")
    assert.equal(migrated.autoApprove, false, "user autoApprove preserved")
    assert.equal(migrated.maxParallelSubagents, undefined, "no longer added by migration — opt-in only")
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
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

    runPostinstall(configHome)

    const resolveConfig = await readJson(join(configHome, "resolve.json"))
    assert.equal(resolveConfig.models.gpt, "openai/gpt-5-mini")
    assert.equal(resolveConfig.models.coder, "gpt")
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

test("postinstall injects ZAI MCP servers when GLM model detected", async () => {
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

    // All 4 ZAI MCP servers should be present
    assert.ok(opencodeConfig.mcp, "mcp section should exist")
    assert.ok(opencodeConfig.mcp["zai-mcp-server"], "zai-mcp-server should be injected")
    assert.ok(opencodeConfig.mcp["web-search-prime"], "web-search-prime should be injected")
    assert.ok(opencodeConfig.mcp["web-reader"], "web-reader should be injected")
    assert.ok(opencodeConfig.mcp.zread, "zread should be injected")

    // Verify actual API key is injected (not {env:...} template)
    assert.equal(opencodeConfig.mcp["zai-mcp-server"].environment.Z_AI_API_KEY, "test-api-key-12345")
    assert.equal(opencodeConfig.mcp["web-search-prime"].headers.Authorization, "Bearer test-api-key-12345")
    assert.equal(opencodeConfig.mcp["web-reader"].headers.Authorization, "Bearer test-api-key-12345")
    assert.equal(opencodeConfig.mcp.zread.headers.Authorization, "Bearer test-api-key-12345")
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
    // Other ZAI MCPs still injected with actual key
    assert.ok(opencodeConfig.mcp["web-search-prime"])
    assert.equal(opencodeConfig.mcp["web-search-prime"].headers.Authorization, "Bearer test-key")
    assert.ok(opencodeConfig.mcp["web-reader"])
    assert.ok(opencodeConfig.mcp.zread)
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

test("postinstall reads ZAI API key from auth.json, falling back to env", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))
  const dataHome = await mkdtemp(join(tmpdir(), "opencode-resolve-data-"))

  try {
    await writeJson(join(configHome, "opencode.json"), {
      model: "zai-coding-plan/glm-5.1",
    })
    // No auth.json — should fall back to env
    const { stdout } = runPostinstall(configHome, {
      XDG_DATA_HOME: dataHome,
      Z_AI_API_KEY: "env-fallback-key",
    })

    const opencodeConfig = await readJson(join(configHome, "opencode.json"))
    assert.ok(opencodeConfig.mcp["web-search-prime"])
    assert.equal(opencodeConfig.mcp["web-search-prime"].headers.Authorization, "Bearer env-fallback-key")
  } finally {
    await rm(configHome, { recursive: true, force: true })
    await rm(dataHome, { recursive: true, force: true })
  }
})

function runPostinstall(configHome, env = {}) {
  const result = spawnSync(process.execPath, [script.pathname], {
    encoding: "utf8",
    env: {
      ...process.env,
      OPENCODE_CONFIG_HOME: configHome,
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
