import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import plugin, { OpencodeResolve } from "../dist/index.js"

test("exports plugin functions", () => {
  assert.equal(typeof plugin, "function")
  assert.equal(typeof OpencodeResolve, "function")
})

test("injects default coder, resolver, and internal specialist subagents using the OpenCode default model", async () => {
  const { config } = await runPlugin({
    model: "provider/default-model",
    agent: {
      plan: { model: "existing/plan" },
      build: { model: "existing/build" },
    },
  })

  assert.equal(config.agent.plan.model, "existing/plan")
  assert.equal(config.agent.build.model, "existing/build")
  assert.equal(config.agent.coder.model, "provider/default-model")
  assert.equal(config.agent.resolver.model, "provider/default-model")
  assert.equal(config.agent.coder.mode, "subagent")
  assert.equal(config.agent.resolver.mode, "all")
  // Internal specialist subagents enabled by default as subagents
  assert.equal(config.agent.reviewer.mode, "subagent")
  assert.equal(config.agent.explorer.mode, "subagent")
  assert.equal(config.agent["deep-reviewer"].mode, "subagent")
  assert.equal(config.agent.planner.mode, "subagent")
  assert.equal(config.agent.planner.model, "provider/default-model")
  // Disabled agents remain undefined
  assert.equal(config.agent.architect, undefined)
  assert.equal(config.agent["gpt-coder"], undefined)
  assert.equal(config.agent.debugger, undefined)
  assert.equal(config.agent.researcher, undefined)
})

test("resolver prompt mentions planner dispatch on explicit plan-request", async () => {
  const { config } = await runPlugin({})
  assert.match(
    config.agent.resolver.prompt,
    /planner: advanced read-only planner.*explicitly asks for a plan/i,
  )
})

test("coder prompt includes the explorer scope-discovery gate", async () => {
  const { config } = await runPlugin({})
  assert.match(
    config.agent.coder.prompt,
    /dispatch the `explorer` subagent ONLY when the scope is genuinely unclear/i,
  )
})

test("bronze/silver/gold aliases resolve to their pinned model ids", async () => {
  const { config } = await runPlugin({
    model: "default/model",
    plugin: [
      [
        "opencode-resolve",
        {
          models: {
            bronze: "vendor/glm-4.7-flash",
            silver: "vendor/glm-5.1",
            gold: "vendor/strong",
            explorer: "bronze",
            coder: "silver",
            resolver: "gold",
            reviewer: "gold",
            "deep-reviewer": "gold",
            planner: "gold",
          },
        },
      ],
    ],
  })

  assert.equal(config.agent.explorer.model, "vendor/glm-4.7-flash")
  assert.equal(config.agent.coder.model, "vendor/glm-5.1")
  assert.equal(config.agent.resolver.model, "vendor/strong")
  assert.equal(config.agent.reviewer.model, "vendor/strong")
  assert.equal(config.agent["deep-reviewer"].model, "vendor/strong")
  assert.equal(config.agent.planner.model, "vendor/strong")
})

test("autoUpdate parses as boolean and rejects non-boolean values", async () => {
  // valid: accepts true
  const { config: configTrue } = await runPlugin({
    plugin: [["opencode-resolve", { autoUpdate: true }]],
  })
  assert.equal(typeof configTrue.agent.resolver, "object")

  // valid: accepts false
  const { config: configFalse } = await runPlugin({
    plugin: [["opencode-resolve", { autoUpdate: false }]],
  })
  assert.equal(typeof configFalse.agent.resolver, "object")

  // invalid: rejects non-boolean
  await assert.rejects(
    runPlugin({ plugin: [["opencode-resolve", { autoUpdate: "yes" }]] }),
    /autoUpdate must be a boolean/,
  )
})

test("autoApprove defaults to true and flips ask permissions to allow", async () => {
  const { config } = await runPlugin({})

  assert.equal(config.agent.coder.permission.edit, "allow")
  assert.equal(config.agent.coder.permission.bash, "allow")
  assert.equal(config.agent.coder.permission.webfetch, "allow")
  assert.equal(config.agent.resolver.permission.edit, "allow")
  assert.equal(config.agent.resolver.permission.bash, "allow")
  assert.equal(config.agent.resolver.permission.webfetch, "allow")
  // reviewer is now enabled by default as internal subagent — its deny permissions stay deny
  assert.equal(config.agent.reviewer.permission.edit, "deny")
  assert.equal(config.agent.reviewer.permission.bash, "deny")
  assert.equal(config.agent.reviewer.permission.webfetch, "allow")
})

test("autoApprove: false preserves the conservative ask defaults", async () => {
  const { config } = await runPlugin({
    plugin: [["opencode-resolve", { autoApprove: false }]],
  })

  assert.equal(config.agent.coder.permission.edit, "ask")
  assert.equal(config.agent.coder.permission.bash, "ask")
  assert.equal(config.agent.coder.permission.webfetch, "ask")
  assert.equal(config.agent.resolver.permission.edit, "ask")
})

test("resolver prompt enforces per-role dispatch limit by default (2)", async () => {
  const { config } = await runPlugin({})

  assert.match(config.agent.resolver.prompt, /at most 2 subagents of the same role/)
  assert.match(config.agent.resolver.prompt, /Never exceed 2 coders in parallel/)
})

test("maxParallelSubagents = 1 produces the strict serial-per-role wording", async () => {
  const { config } = await runPlugin({
    plugin: [["opencode-resolve", { maxParallelSubagents: 1 }]],
  })

  assert.match(config.agent.resolver.prompt, /at most ONE subagent of each role concurrently/)
  assert.match(config.agent.resolver.prompt, /Never run two coders in parallel/)
})

test("maxParallelSubagents > 2 relaxes the resolver per-role rule", async () => {
  const { config } = await runPlugin({
    plugin: [["opencode-resolve", { maxParallelSubagents: 3 }]],
  })

  assert.match(config.agent.resolver.prompt, /at most 3 subagents of the same role/)
})

test("user-supplied resolver prompt is preserved over the templated default", async () => {
  const project = await createProject({
    "opencode-resolve.json": {
      maxParallelSubagents: 5,
      agents: {
        resolver: {
          prompt: "Custom orchestration prompt.",
        },
      },
    },
  })

  try {
    const { config } = await runPlugin({}, project)
    assert.equal(config.agent.resolver.prompt, "Custom orchestration prompt.")
  } finally {
    await project.cleanup()
  }
})

test("rejects non-positive maxParallelSubagents", async () => {
  const project = await createProject({
    "opencode-resolve.json": {
      maxParallelSubagents: 0,
    },
  })

  try {
    await assert.rejects(() => runPlugin({}, project), /maxParallelSubagents must be a positive integer/)
  } finally {
    await project.cleanup()
  }
})

test("user-set permission keys win over autoApprove", async () => {
  const project = await createProject({
    "opencode-resolve.json": {
      agents: {
        coder: {
          permission: {
            edit: "ask",
          },
        },
      },
    },
  })

  try {
    const { config } = await runPlugin({}, project)
    assert.equal(config.agent.coder.permission.edit, "ask")
  } finally {
    await project.cleanup()
  }
})

test("omits agent models when no explicit or OpenCode default model exists", async () => {
  const { config } = await runPlugin({})

  assert.equal("model" in config.agent.coder, false)
  assert.equal("model" in config.agent.resolver, false)
  assert.equal("model" in config.agent.reviewer, false)
  assert.equal("model" in config.agent.explorer, false)
  assert.equal("model" in config.agent["deep-reviewer"], false)
})

test("adds context7 preset without overwriting existing context7 config", async () => {
  const existingContext7 = {
    type: "remote",
    url: "https://example.test/context7",
    enabled: false,
  }
  const { config } = await runPlugin({
    mcp: {
      context7: existingContext7,
    },
  })

  assert.deepEqual(config.mcp.context7, existingContext7)
})

test("reads project config and resolves model aliases", async () => {
  const project = await createProject({
    "opencode-resolve.json": {
      enabled: ["coder", "reviewer", "debugger"],
      models: {
        glm: "custom/glm",
        gpt: "custom/gpt",
        coder: "glm",
        reviewer: "gpt",
        debugger: "gpt",
      },
      agents: {
        reviewer: {
          maxSteps: 4,
        },
      },
      context7: false,
    },
  })

  try {
    const { config } = await runPlugin({}, project)

    assert.equal(config.agent.coder.model, "custom/glm")
    assert.equal(config.agent.reviewer.model, "custom/gpt")
    assert.equal(config.agent.debugger.model, "custom/gpt")
    assert.equal(config.agent.reviewer.maxSteps, 4)
    assert.equal(config.agent.architect, undefined)
    assert.equal(config.mcp, undefined)
  } finally {
    await project.cleanup()
  }
})

test("plugin options override file config", async () => {
  const project = await createProject({
    "opencode-resolve.json": {
      enabled: ["coder", "reviewer", "debugger"],
      context7: false,
      models: {
        glm: "file/glm",
        coder: "glm",
      },
    },
  })

  try {
    const { config } = await runPlugin({}, project, {
      enabled: ["reviewer", "resolver"],
      context7: true,
      models: {
        gpt: "option/gpt",
        reviewer: "gpt",
      },
    })

    assert.equal(config.agent.coder, undefined)
    assert.equal(config.agent.debugger, undefined)
    assert.equal(config.agent.reviewer.model, "option/gpt")
    assert.equal(config.mcp.context7.url, "https://mcp.context7.com/mcp")
  } finally {
    await project.cleanup()
  }
})

test("per-agent enabled flag can enable optional agents and disable listed agents", async () => {
  const project = await createProject({
    "opencode-resolve.json": {
      enabled: ["coder", "reviewer"],
      models: {
        gpt: "custom/gpt",
        reviewer: "gpt",
      },
      agents: {
        coder: {
          enabled: false,
        },
        architect: {
          enabled: true,
          model: "gpt",
          mode: "subagent",
        },
      },
    },
  })

  try {
    const { config } = await runPlugin({}, project)

    assert.equal(config.agent.coder, undefined)
    assert.equal(config.agent.reviewer.model, "custom/gpt")
    assert.equal(config.agent.architect.model, "custom/gpt")
    assert.equal(config.agent.architect.mode, "subagent")
    assert.equal("enabled" in config.agent.architect, false)
  } finally {
    await project.cleanup()
  }
})

test("recognizes versioned plugin option entries", async () => {
  const { config } = await runPlugin({
    plugin: [
      [
        "opencode-resolve@0.1.0",
        {
          enabled: ["reviewer"],
          models: {
            gpt: "versioned/gpt",
            reviewer: "gpt",
          },
        },
      ],
    ],
  })

  assert.equal(config.agent.coder, undefined)
  assert.equal(config.agent.reviewer.model, "versioned/gpt")
})

test("can inject optional resolve commands", async () => {
  const { config } = await runPlugin({
    plugin: [["opencode-resolve", { commands: true }]],
    command: {
      existing: {
        template: "keep me",
      },
    },
  })

  assert.equal(config.command.existing.template, "keep me")
  assert.equal(config.command["resolve"].agent, "resolver")
  assert.equal(config.command["resolve"].subtask, true)
  assert.equal(config.command["resolve-code"].agent, "coder")
  assert.equal(config.command["resolve-code"].subtask, true)
  assert.equal(config.command["resolve-review"].agent, "reviewer")
  assert.equal(config.command["resolve-review"].subtask, true)
})

test("custom config path is resolved relative to project directory", async () => {
  const project = await createProject({
    "configs/resolve.custom.json": {
      enabled: ["gpt-coder"],
      agents: {
        "gpt-coder": {
          model: "custom/high-reasoning",
        },
      },
    },
  })

  try {
    const { config } = await runPlugin(
      {
        plugin: [["opencode-resolve", { config: "configs/resolve.custom.json" }]],
      },
      project,
    )

    assert.equal(config.agent.coder, undefined)
    assert.equal(config.agent.reviewer, undefined)
    assert.equal(config.agent["gpt-coder"].model, "custom/high-reasoning")
  } finally {
    await project.cleanup()
  }
})

test("rejects unknown agent names with clear errors", async () => {
  const project = await createProject({
    "opencode-resolve.json": {
      enabled: ["coder", "oracle"],
    },
  })

  try {
    await assert.rejects(() => runPlugin({}, project), /Unknown agent "oracle"/)
  } finally {
    await project.cleanup()
  }
})

test("rejects invalid agent config values", async () => {
  const project = await createProject({
    "opencode-resolve.json": {
      agents: {
        coder: {
          mode: "daemon",
        },
      },
    },
  })

  try {
    await assert.rejects(() => runPlugin({}, project), /Invalid mode "daemon"/)
  } finally {
    await project.cleanup()
  }
})

test("supports command-specific bash permissions", async () => {
  const project = await createProject({
    "opencode-resolve.json": {
      agents: {
        coder: {
          permission: {
            bash: {
              "npm test": "allow",
              "rm -rf": "deny",
            },
          },
        },
      },
    },
  })

  try {
    const { config } = await runPlugin({}, project)

    assert.deepEqual(config.agent.coder.permission.bash, {
      "npm test": "allow",
      "rm -rf": "deny",
    })
  } finally {
    await project.cleanup()
  }
})

test("injects explorer and deep-reviewer when enabled via config", async () => {
  const project = await createProject({
    "opencode-resolve.json": {
      enabled: ["coder", "reviewer", "resolver", "explorer", "deep-reviewer"],
      models: {
        quick: "provider/cheap",
        deep: "provider/strong",
        explorer: "quick",
        "deep-reviewer": "deep",
      },
    },
  })

  try {
    const { config } = await runPlugin({}, project)

    // Explorer: read-only scout, deny edit, bash auto-approved to allow
    assert.equal(config.agent.explorer.mode, "subagent")
    assert.equal(config.agent.explorer.model, "provider/cheap")
    assert.equal(config.agent.explorer.permission.edit, "deny")
    assert.equal(config.agent.explorer.permission.bash, "allow")
    assert.equal(config.agent.explorer.permission.webfetch, "allow")
    assert.equal(config.agent.explorer.maxSteps, 6)

    // Deep reviewer: read-only, deny edit and bash
    assert.equal(config.agent["deep-reviewer"].mode, "subagent")
    assert.equal(config.agent["deep-reviewer"].model, "provider/strong")
    assert.equal(config.agent["deep-reviewer"].permission.edit, "deny")
    assert.equal(config.agent["deep-reviewer"].permission.bash, "deny")
    assert.equal(config.agent["deep-reviewer"].permission.webfetch, "allow")
    assert.equal(config.agent["deep-reviewer"].maxSteps, 12)
  } finally {
    await project.cleanup()
  }
})

test("explorer permissions respect autoApprove: false", async () => {
  const project = await createProject({
    "opencode-resolve.json": {
      enabled: ["explorer"],
      autoApprove: false,
    },
  })

  try {
    const { config } = await runPlugin({}, project)

    assert.equal(config.agent.explorer.permission.edit, "deny")
    assert.equal(config.agent.explorer.permission.bash, "ask")
    assert.equal(config.agent.explorer.permission.webfetch, "ask")
  } finally {
    await project.cleanup()
  }
})

test("accepts quick and deep as valid model aliases", async () => {
  const project = await createProject({
    "opencode-resolve.json": {
      enabled: ["coder"],
      models: {
        quick: "provider/cheap-model",
        deep: "provider/strong-model",
        coder: "quick",
      },
    },
  })

  try {
    const { config } = await runPlugin({}, project)

    assert.equal(config.agent.coder.model, "provider/cheap-model")
  } finally {
    await project.cleanup()
  }
})

test("resolver prompt is context-efficient and mentions core path with internal subagents", async () => {
  const { config } = await runPlugin({})

  assert.match(config.agent.resolver.prompt, /context-efficient/)
  assert.match(config.agent.resolver.prompt, /CLASSIFY/)
  assert.match(config.agent.resolver.prompt, /Core path/)
  assert.match(config.agent.resolver.prompt, /[Ii]nternal specialist subagents/)
  assert.match(config.agent.resolver.prompt, /max 3/)
})

async function runPlugin(initialConfig, project, options) {
  return runPluginWithOptions(initialConfig, project, options)
}

async function runPluginWithOptions(initialConfig, project, options) {
  const ownedProject = project ?? (await createProject({}))
  const previousHome = process.env.HOME
  const previousUserprofile = process.env.USERPROFILE
  process.env.HOME = ownedProject.path
  process.env.USERPROFILE = ownedProject.path
  try {
    const config = structuredClone(initialConfig)
    const hooks = await plugin({ directory: ownedProject.path }, options)
    await hooks.config(config)
    return { config, project: ownedProject }
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousUserprofile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = previousUserprofile
    if (!project) await ownedProject.cleanup()
  }
}

async function createProject(files) {
  const path = await mkdtemp(join(tmpdir(), "opencode-resolve-test-"))

  for (const [relativePath, value] of Object.entries(files)) {
    const filePath = join(path, relativePath)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
  }

  return {
    path,
    cleanup: () => rm(path, { recursive: true, force: true }),
  }
}
