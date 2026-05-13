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
    assert.deepEqual(resolveConfig.enabled, ["coder", "resolver", "explorer", "reviewer", "deep-reviewer"])
    assert.equal(resolveConfig.autoApprove, true)
    assert.equal(resolveConfig.maxParallelSubagents, 2)
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
    assert.equal(migrated.maxParallelSubagents, 2, "missing key added with default")
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
    // enabled, agents, and other fields are preserved from example
    assert.deepEqual(resolveConfig.enabled, ["coder", "resolver", "explorer", "reviewer", "deep-reviewer"])
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall creates GLM+GPT mixed preset when opencode model is glm", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    await writeJson(join(configHome, "opencode.json"), {
      model: "zai-coding-plan/glm-5.1",
    })

    runPostinstall(configHome)

    const resolveConfig = await readJson(join(configHome, "resolve.json"))

    assert.equal(resolveConfig.models.glm, "zai-coding-plan/glm-5.1")
    assert.equal(resolveConfig.models.gpt, "openai/gpt-5.5")
    assert.equal(resolveConfig.models.fast, "glm")
    assert.equal(resolveConfig.models.strong, "gpt")
    assert.equal(resolveConfig.models.coder, "glm")
    assert.equal(resolveConfig.models.resolver, "gpt")
    assert.equal(resolveConfig.models.reviewer, "gpt")
    assert.equal(resolveConfig.models["deep-reviewer"], "gpt")
    assert.equal(resolveConfig.models.explorer, "fast")
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

test("postinstall creates GLM+GPT preset for zai model variant", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "opencode-resolve-postinstall-"))

  try {
    await writeJson(join(configHome, "opencode.json"), {
      model: "zai/glm-4",
    })

    runPostinstall(configHome)

    const resolveConfig = await readJson(join(configHome, "resolve.json"))
    assert.equal(resolveConfig.models.glm, "zai-coding-plan/glm-5.1")
    assert.equal(resolveConfig.models.gpt, "openai/gpt-5.5")
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
    assert.equal(migrated.maxParallelSubagents, 2, "missing key added")
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
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}
