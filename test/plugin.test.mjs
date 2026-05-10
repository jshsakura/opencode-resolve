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

test("injects only default coder and reviewer agents", async () => {
  const { config } = await runPlugin({
    model: "zai-coding-plan/glm-5",
    agent: {
      plan: { model: "existing/plan" },
      build: { model: "existing/build" },
    },
  })

  assert.equal(config.agent.plan.model, "existing/plan")
  assert.equal(config.agent.build.model, "existing/build")
  assert.equal(config.agent.coder.model, "zai-coding-plan/glm-5")
  assert.equal(config.agent.reviewer.model, "openai/gpt-5")
  assert.equal(config.agent.coder.mode, "subagent")
  assert.equal(config.agent.reviewer.mode, "subagent")
  assert.equal(config.agent.reviewer.permission.edit, "deny")
  assert.equal(config.agent.architect, undefined)
  assert.equal(config.agent["gpt-coder"], undefined)
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
      enabled: ["reviewer"],
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
    assert.equal(config.agent.reviewer.model, "openai/gpt-5")
    assert.equal(config.agent.architect.model, "openai/gpt-5")
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

async function runPlugin(initialConfig, project, options) {
  return runPluginWithOptions(initialConfig, project, options)
}

async function runPluginWithOptions(initialConfig, project, options) {
  const ownedProject = project ?? (await createProject({}))
  try {
    const config = structuredClone(initialConfig)
    const hooks = await plugin({ directory: ownedProject.path }, options)
    await hooks.config(config)
    return { config, project: ownedProject }
  } finally {
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
