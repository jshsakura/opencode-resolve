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
    /planner \(user asks for plan\)/,
  )
})

test("coder prompt includes the explorer scope-discovery gate", async () => {
  const { config } = await runPlugin({})
  assert.match(
    config.agent.coder.prompt,
    /Dispatch explorer ONLY to locate 3\+ unknown files/,
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

test("write agents: edit=allow, bash=ask (hook decides); read-only agents: edit/bash=deny", async () => {
  const { config } = await runPlugin({})

  // Write agents: coder, resolver — edit allowed, bash via hook
  assert.equal(config.agent.coder.permission.edit, "allow")
  assert.equal(config.agent.coder.permission.bash, "ask")
  assert.equal(config.agent.coder.permission.webfetch, "allow")
  assert.equal(config.agent.resolver.permission.edit, "allow")
  assert.equal(config.agent.resolver.permission.bash, "ask")
  assert.equal(config.agent.resolver.permission.webfetch, "allow")
  // Read-only agents: reviewer — deny edit/bash, allow webfetch
  assert.equal(config.agent.reviewer.permission.edit, "deny")
  assert.equal(config.agent.reviewer.permission.bash, "deny")
  assert.equal(config.agent.reviewer.permission.webfetch, "allow")
})

test("autoApprove is a no-op — bash permissions stay as ask/deny", async () => {
  const { config } = await runPlugin({
    plugin: [["opencode-resolve", { autoApprove: false }]],
  })

  // autoApprove is now a no-op: bash=ask for write agents, bash=deny for read-only
  assert.equal(config.agent.coder.permission.edit, "allow")
  assert.equal(config.agent.coder.permission.bash, "ask")
  assert.equal(config.agent.coder.permission.webfetch, "allow")
  assert.equal(config.agent.resolver.permission.edit, "allow")
})

test("resolver prompt defaults to soft fan-out guidance with no hard cap", async () => {
  const { config } = await runPlugin({})

  assert.match(config.agent.resolver.prompt, /Fan out for independent work/)
  assert.match(config.agent.resolver.prompt, /rate-limit errors/)
  assert.doesNotMatch(config.agent.resolver.prompt, /at most \d+ coders concurrently/i)
})

test("maxParallelSubagents = 1 produces an explicit single-coder cap", async () => {
  const { config } = await runPlugin({
    plugin: [["opencode-resolve", { maxParallelSubagents: 1 }]],
  })

  assert.match(config.agent.resolver.prompt, /Dispatch ONE coder at a time/)
})

test("maxParallelSubagents > 1 produces an explicit N-coder cap", async () => {
  const { config } = await runPlugin({
    plugin: [["opencode-resolve", { maxParallelSubagents: 3 }]],
  })

  assert.match(config.agent.resolver.prompt, /Dispatch up to 3 coders/)
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

    // Explorer: read-only scout, deny edit and bash
    assert.equal(config.agent.explorer.mode, "subagent")
    assert.equal(config.agent.explorer.model, "provider/cheap")
    assert.equal(config.agent.explorer.permission.edit, "deny")
    assert.equal(config.agent.explorer.permission.bash, "deny")
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

test("read-only agents keep deny regardless of autoApprove", async () => {
  const project = await createProject({
    "opencode-resolve.json": {
      enabled: ["explorer"],
      autoApprove: false,
    },
  })

  try {
    const { config } = await runPlugin({}, project)

    assert.equal(config.agent.explorer.permission.edit, "deny")
    assert.equal(config.agent.explorer.permission.bash, "deny")
    assert.equal(config.agent.explorer.permission.webfetch, "allow")
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
  assert.match(config.agent.resolver.prompt, /verified resolve loop/)
  assert.match(config.agent.resolver.prompt, /verified resolve loop/)
  assert.match(config.agent.resolver.prompt, /Specialist/)
})

test("GLM profile applies GLM-specific prompts, maxSteps, and enabled list", async () => {
  const { config } = await runPlugin(
    { model: "zai-coding-plan/glm-5.1" },
    undefined,
    { profile: "glm", enabled: ["coder", "resolver", "explorer", "reviewer", "planner"] },
  )

  assert.equal(config.agent.resolver.mode, "all")
  assert.equal(config.agent.resolver.maxSteps, 25)
  assert.match(config.agent.resolver.prompt, /GLM profile/)
  assert.match(config.agent.resolver.prompt, /quota is finite/)
  assert.equal(config.agent.coder.maxSteps, 15)
  assert.match(config.agent.coder.prompt, /GLM profile/)
  // deep-reviewer not in GLM enabled list
  assert.equal(config.agent["deep-reviewer"], undefined)
})

test("GPT profile applies GPT-specific prompts and higher maxSteps", async () => {
  const { config } = await runPlugin(
    { model: "openai/gpt-5.5" },
    undefined,
    { profile: "gpt" },
  )

  assert.equal(config.agent.resolver.mode, "all")
  assert.equal(config.agent.resolver.maxSteps, 40)
  assert.match(config.agent.resolver.prompt, /GPT profile/)
  assert.equal(config.agent.coder.maxSteps, 25)
  assert.match(config.agent.coder.prompt, /GPT profile/)
  // deep-reviewer included in GPT enabled list
  assert.equal(config.agent["deep-reviewer"].mode, "subagent")
})

test("glm agent is registered when enabled", async () => {
  const { config } = await runPlugin(
    { model: "zai-coding-plan/glm-5.1" },
    undefined,
    { agents: { glm: { enabled: true } } },
  )

  assert.equal(config.agent.glm.mode, "all")
  assert.equal(config.agent.glm.maxSteps, 30)
  assert.match(config.agent.glm.description, /GLM/)
  assert.match(config.agent.glm.prompt, /GLM profile/)
})

test("glm agent is disabled by default", async () => {
  const { config } = await runPlugin({
    model: "provider/default",
  })

  assert.equal(config.agent.glm, undefined)
})

test("mixed mode (no profile) uses default resolver prompt", async () => {
  const { config } = await runPlugin(
    { model: "provider/default" },
    undefined,
    {},
  )

  assert.match(config.agent.resolver.prompt, /You are Resolver, the context-efficient orchestrator/)
  assert.equal(config.agent["deep-reviewer"].mode, "subagent")
})

test("injects project context: knowledge files + verify commands into resolver prompt", async () => {
  const tmpPath = await mkdtemp(join(tmpdir(), "opencode-resolve-test-"))
  try {
    // Create HARNESS.md (plain text, not JSON)
    await writeFile(join(tmpPath, "HARNESS.md"), "# Harness\nUse pnpm.\n")
    await writeFile(join(tmpPath, "AGENTS.md"), "# Agents\nAlways verify.\n")
    // Create tsconfig.json
    await writeFile(join(tmpPath, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }))
    // Create package.json with lint + test scripts
    await writeFile(join(tmpPath, "package.json"), JSON.stringify({
      scripts: { lint: "eslint .", test: "node --test test/*.mjs" },
    }))

    const { config } = await runPlugin({ model: "provider/model" }, { path: tmpPath, cleanup: () => rm(tmpPath, { recursive: true, force: true }) })

    // Resolver prompt should contain detected project info
    assert.match(config.agent.resolver.prompt, /HARNESS\.md/)
    assert.match(config.agent.resolver.prompt, /AGENTS\.md/)
    assert.match(config.agent.resolver.prompt, /npm run lint/)
    assert.match(config.agent.resolver.prompt, /npm test/)
    assert.match(config.agent.resolver.prompt, /TypeScript project/)
  } finally {
    await rm(tmpPath, { recursive: true, force: true })
  }
})

test("injects verify commands into coder prompt", async () => {
  const tmpPath = await mkdtemp(join(tmpdir(), "opencode-resolve-test-"))
  try {
    await writeFile(join(tmpPath, "package.json"), JSON.stringify({
      scripts: { typecheck: "tsc --noEmit", lint: "eslint ." },
    }))

    const { config } = await runPlugin({ model: "provider/model" }, { path: tmpPath, cleanup: () => rm(tmpPath, { recursive: true, force: true }) })

    assert.match(config.agent.coder.prompt, /npm run typecheck/)
    assert.match(config.agent.coder.prompt, /npm run lint/)
  } finally {
    await rm(tmpPath, { recursive: true, force: true })
  }
})

test("no project context injection when no files detected", async () => {
  const tmpPath = await mkdtemp(join(tmpdir(), "opencode-resolve-test-"))
  try {
    // Empty project directory
    const { config } = await runPlugin({ model: "provider/model" }, { path: tmpPath, cleanup: () => rm(tmpPath, { recursive: true, force: true }) })

    // Should not contain project context markers
    assert.doesNotMatch(config.agent.resolver.prompt, /knowledge files detected/)
    assert.doesNotMatch(config.agent.resolver.prompt, /Package manager/)
  } finally {
    await rm(tmpPath, { recursive: true, force: true })
  }
})

test("tier: bronze enables only coder + resolver", async () => {
  const { config } = await runPlugin(
    { model: "provider/model" },
    undefined,
    { tier: "bronze" },
  )

  assert.equal(config.agent.coder.mode, "subagent")
  assert.equal(config.agent.resolver.mode, "all")
  // Bronze excludes specialist subagents
  assert.equal(config.agent.explorer, undefined)
  assert.equal(config.agent.reviewer, undefined)
  assert.equal(config.agent["deep-reviewer"], undefined)
  assert.equal(config.agent.planner, undefined)
})

test("tier: silver enables coder + resolver + explorer + reviewer + planner", async () => {
  const { config } = await runPlugin(
    { model: "provider/model" },
    undefined,
    { tier: "silver" },
  )

  assert.equal(config.agent.coder.mode, "subagent")
  assert.equal(config.agent.resolver.mode, "all")
  assert.equal(config.agent.explorer.mode, "subagent")
  assert.equal(config.agent.reviewer.mode, "subagent")
  assert.equal(config.agent.planner.mode, "subagent")
  // Silver excludes deep-reviewer
  assert.equal(config.agent["deep-reviewer"], undefined)
})

test("tier: gold enables all agents including debugger and researcher", async () => {
  const { config } = await runPlugin(
    { model: "provider/model" },
    undefined,
    { tier: "gold" },
  )

  assert.equal(config.agent.coder.mode, "subagent")
  assert.equal(config.agent.resolver.mode, "all")
  assert.equal(config.agent.explorer.mode, "subagent")
  assert.equal(config.agent.reviewer.mode, "subagent")
  assert.equal(config.agent["deep-reviewer"].mode, "subagent")
  assert.equal(config.agent.planner.mode, "subagent")
  assert.equal(config.agent.debugger.mode, "subagent")
  assert.equal(config.agent.researcher.mode, "subagent")
})

test("tier + profile combined: bronze with GLM profile", async () => {
  const { config } = await runPlugin(
    { model: "zai-coding-plan/glm-5.1" },
    undefined,
    { profile: "glm", tier: "bronze" },
  )

  // Bronze: only coder + resolver
  assert.equal(config.agent.coder.mode, "subagent")
  assert.equal(config.agent.resolver.mode, "all")
  assert.equal(config.agent.explorer, undefined)
  // GLM profile prompt applied
  assert.match(config.agent.resolver.prompt, /GLM profile/)
})

test("rejects unknown tier", async () => {
  await assert.rejects(
    runPlugin({ model: "provider/model" }, undefined, { tier: "platinum" }),
    /Unknown tier "platinum"/,
  )
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

// ── permission.ask hook tests ──────────────────────────────────────────────

async function getHooks() {
  return await OpencodeResolve(
    { directory: "/tmp", client: {}, project: {}, worktree: "/tmp", serverUrl: new URL("http://localhost"), $: {}, experimental_workspace: { register() {} } },
    {},
  )
}

test("permission.ask auto-allows safe commands (npm test, git status, etc.)", async () => {
  const hooks = await getHooks()
  const allowCases = [
    "npm test",
    "npm run build",
    "npm run lint",
    "npx tsc --noEmit",
    "git status",
    "git diff",
    "git log --oneline",
    "tsc --noEmit",
    "eslint src/index.ts",
    "ls -la",
    "cat package.json",
    "echo hello",
    "pwd",
    "node -e \"console.log(1)\"",
    "bun test",
    "cargo test",
    "make build",
  ]
  for (const cmd of allowCases) {
    const output = { status: "ask" }
    await hooks["permission.ask"]({ type: "bash", pattern: cmd }, output)
    assert.equal(output.status, "allow", `expected allow for: ${cmd}`)
  }
})

test("permission.ask auto-denies dangerous commands", async () => {
  const hooks = await getHooks()
  const denyCases = [
    "rm -rf /",
    "rm -rf /tmp/important",
    "git push --force origin main",
    "git push -f",
    "git reset --hard HEAD~1",
    "sudo rm -rf /var",
    "DROP TABLE users",
  ]
  for (const cmd of denyCases) {
    const output = { status: "ask" }
    await hooks["permission.ask"]({ type: "bash", pattern: cmd }, output)
    assert.equal(output.status, "deny", `expected deny for: ${cmd}`)
  }
})

test("permission.ask leaves unknown commands as ask (user dialog)", async () => {
  const hooks = await getHooks()
  const askCases = [
    "python3 script.py",
    "docker build .",
    "terraform apply",
    "some-custom-command",
  ]
  for (const cmd of askCases) {
    const output = { status: "ask" }
    await hooks["permission.ask"]({ type: "bash", pattern: cmd }, output)
    assert.equal(output.status, "ask", `expected ask for: ${cmd}`)
  }
})

test("permission.ask ignores non-bash permissions", async () => {
  const hooks = await getHooks()
  const output = { status: "ask" }
  await hooks["permission.ask"]({ type: "edit", pattern: "/tmp/test.ts" }, output)
  assert.equal(output.status, "ask")
})

// ── New hooks tests ──────────────────────────────────────────────────────────

test("permission.ask auto-denies banned interactive commands (vim, nano, less, REPLs)", async () => {
  const hooks = await getHooks()
  const bannedCases = [
    "vim file.ts",
    "nano config.json",
    "less /var/log/syslog",
    "more README.md",
    "man bash",
    "git add -p",
    "git rebase -i HEAD~3",
    "git commit",
  ]
  for (const cmd of bannedCases) {
    const output = { status: "ask" }
    await hooks["permission.ask"]({ type: "bash", pattern: cmd }, output)
    assert.equal(output.status, "deny", `expected deny for: ${cmd}`)
  }
})

test("shell.env sets non-interactive environment variables", async () => {
  const hooks = await getHooks()
  const output = { env: {} }
  await hooks["shell.env"]({ cwd: "/tmp" }, output)
  assert.equal(output.env.CI, "true")
  assert.equal(output.env.DEBIAN_FRONTEND, "noninteractive")
  assert.equal(output.env.GIT_TERMINAL_PROMPT, "0")
  assert.equal(output.env.GIT_EDITOR, "true")
  assert.equal(output.env.GIT_PAGER, "cat")
  assert.equal(output.env.PAGER, "cat")
  assert.equal(output.env.GCM_INTERACTIVE, "never")
  assert.equal(output.env.npm_config_yes, "true")
  assert.equal(output.env.PIP_NO_INPUT, "1")
})

test("chat.params lowers temperature for GLM profile", async () => {
  // Create hooks with GLM profile
  const project = await createProject({
    "opencode.json": {},
    "opencode-resolve.json": { profile: "glm" },
  })
  const previousHome = process.env.HOME
  const previousUserprofile = process.env.USERPROFILE
  process.env.HOME = project.path
  process.env.USERPROFILE = project.path
  try {
    const config = { model: "zai/glm-4", agent: {} }
    const hooks = await OpencodeResolve(
      { directory: project.path, client: {}, project: {}, worktree: project.path, serverUrl: new URL("http://localhost"), $: {}, experimental_workspace: { register() {} } },
      {},
    )
    await hooks.config(config)

    const output = { temperature: 0.8, topP: 1, topK: 40, maxOutputTokens: undefined, options: {} }
    await hooks["chat.params"](
      { sessionID: "s1", agent: "resolver", model: { id: "glm-4", provider: "zai" }, provider: { source: "config" }, message: {} },
      output,
    )
    assert.ok(output.temperature <= 0.4, `GLM temperature should be <= 0.4, got ${output.temperature}`)
    assert.equal(output.maxOutputTokens, 16384)
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousUserprofile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = previousUserprofile
    await project.cleanup()
  }
})

test("chat.params lowers temperature for read-only agents", async () => {
  const hooks = await getHooks()
  const readOnlyAgents = ["reviewer", "deep-reviewer", "explorer", "planner", "researcher", "architect"]
  for (const agent of readOnlyAgents) {
    const output = { temperature: 0.8, topP: 1, topK: 40, maxOutputTokens: undefined, options: {} }
    await hooks["chat.params"](
      { sessionID: "s1", agent, model: { id: "model-1" }, provider: { source: "config" }, message: {} },
      output,
    )
    assert.ok(output.temperature <= 0.3, `${agent} temperature should be <= 0.3, got ${output.temperature}`)
  }
})

test("experimental.session.compacting preserves project context", async () => {
  const project = await createProject({
    "opencode.json": {},
    "opencode-resolve.json": {},
    "tsconfig.json": { compilerOptions: {} },
    "package.json": { scripts: { test: "jest", typecheck: "tsc --noEmit" } },
    "HARNESS.md": "# harness",
  })
  const previousHome = process.env.HOME
  const previousUserprofile = process.env.USERPROFILE
  process.env.HOME = project.path
  process.env.USERPROFILE = project.path
  try {
    const config = { model: "provider/model", agent: {} }
    const hooks = await OpencodeResolve(
      { directory: project.path, client: {}, project: {}, worktree: project.path, serverUrl: new URL("http://localhost"), $: {}, experimental_workspace: { register() {} } },
      {},
    )
    await hooks.config(config)

    const output = { context: [] }
    await hooks["experimental.session.compacting"]({ sessionID: "s1" }, output)
    assert.ok(output.context.length > 0, "should have at least one context line")
    const combined = output.context.join(" ")
    assert.ok(combined.includes("HARNESS.md"), "should mention HARNESS.md")
    assert.ok(combined.includes("TypeScript"), "should mention TypeScript")
    assert.ok(combined.includes("npm test"), "should mention npm test verify command")
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousUserprofile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = previousUserprofile
    await project.cleanup()
  }
})

test("experimental.chat.messages.transform replaces generic summarize prompt", async () => {
  const hooks = await getHooks()
  const messages = [
    {
      info: { id: "m1", role: "user", time: { created: 1 } },
      parts: [{ type: "text", text: "Summarize the task tool output above and continue with your task." }],
    },
    {
      info: { id: "m2", role: "user", time: { created: 2 } },
      parts: [{ type: "text", text: "Some other message" }],
    },
  ]
  await hooks["experimental.chat.messages.transform"]({}, { messages })
  assert.notEqual(messages[0].parts[0].text, "Summarize the task tool output above and continue with your task.")
  assert.ok(messages[0].parts[0].text.includes("Analyze the subtask result"), "should replace with actionable prompt")
  assert.equal(messages[1].parts[0].text, "Some other message", "should not touch other messages")
})

test("tool.execute.after adds verify hint on edit tool", async () => {
  // Hooks need stored project context from config
  const project = await createProject({
    "opencode.json": {},
    "opencode-resolve.json": {},
    "package.json": { scripts: { test: "vitest run" } },
  })
  const previousHome = process.env.HOME
  const previousUserprofile = process.env.USERPROFILE
  process.env.HOME = project.path
  process.env.USERPROFILE = project.path
  try {
    const config = { model: "provider/model", agent: {} }
    const hooks = await OpencodeResolve(
      { directory: project.path, client: {}, project: {}, worktree: project.path, serverUrl: new URL("http://localhost"), $: {}, experimental_workspace: { register() {} } },
      {},
    )
    await hooks.config(config)

    const output = { title: "", output: "", metadata: {} }
    await hooks["tool.execute.after"](
      { tool: "edit", sessionID: "s1", callID: "c1", args: { filePath: "/tmp/test.ts" } },
      output,
    )
    assert.ok(output.metadata._resolve_verify_hint, "should add verify hint")
    assert.ok(output.metadata._resolve_verify_hint.includes("npm test"), "hint should mention npm test")
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousUserprofile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = previousUserprofile
    await project.cleanup()
  }
})

// ── New hooks: tool.definition, command.execute.before, system.transform ──

test("tool.definition enriches edit/write/bash/task tools with discipline hints", async () => {
  const hooks = await getHooks()
  const toolHints = {
    edit: "smallest correct change",
    write: "Only write new files when explicitly needed",
    bash: "non-interactive mode",
    task: "TASK (atomic goal)",
  }
  for (const [toolID, expectedText] of Object.entries(toolHints)) {
    const output = { description: `Original ${toolID} description.`, parameters: {} }
    await hooks["tool.definition"]({ toolID }, output)
    assert.ok(output.description.includes(expectedText), `${toolID} hint should contain "${expectedText}"`)
    // Original description should be preserved
    assert.ok(output.description.includes(`Original ${toolID} description`), `${toolID} original description should be preserved`)
  }
})

test("tool.definition does not modify unrelated tools", async () => {
  const hooks = await getHooks()
  const output = { description: "Some other tool.", parameters: {} }
  await hooks["tool.definition"]({ toolID: "read" }, output)
  assert.equal(output.description, "Some other tool.")
})

test("command.execute.before injects discipline reminder", async () => {
  const hooks = await getHooks()
  const output = { parts: [] }
  await hooks["command.execute.before"]({ command: "resolve", sessionID: "s1", arguments: "fix the bug" }, output)
  assert.equal(output.parts.length, 1)
  assert.ok(output.parts[0].text.includes("verified resolution"), "should inject discipline reminder")
  assert.ok(output.parts[0].text.includes("opencode-resolve"), "should be tagged with opencode-resolve")
})

test("experimental.chat.system.transform injects project context into system prompt", async () => {
  const project = await createProject({
    "opencode.json": {},
    "opencode-resolve.json": {},
    "tsconfig.json": { compilerOptions: {} },
    "package.json": { scripts: { test: "jest", typecheck: "tsc --noEmit" } },
    "HARNESS.md": "# harness",
    "AGENTS.md": "# agents",
  })
  const previousHome = process.env.HOME
  const previousUserprofile = process.env.USERPROFILE
  process.env.HOME = project.path
  process.env.USERPROFILE = project.path
  try {
    const config = { model: "provider/model", agent: {} }
    const hooks = await OpencodeResolve(
      { directory: project.path, client: {}, project: {}, worktree: project.path, serverUrl: new URL("http://localhost"), $: {}, experimental_workspace: { register() {} } },
      {},
    )
    await hooks.config(config)

    const output = { system: ["You are an AI assistant."] }
    await hooks["experimental.chat.system.transform"](
      { sessionID: "s1", model: { id: "model-1" } },
      output,
    )
    // Original system prompt should be preserved
    assert.equal(output.system[0], "You are an AI assistant.")
    // New context should be appended
    assert.ok(output.system.length >= 2, "should add at least one context line")
    const combined = output.system.join(" ")
    assert.ok(combined.includes("HARNESS.md"), "should mention HARNESS.md")
    assert.ok(combined.includes("AGENTS.md"), "should mention AGENTS.md")
    assert.ok(combined.includes("TypeScript"), "should mention TypeScript")
    assert.ok(combined.includes("opencode-resolve"), "should be tagged with opencode-resolve")
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousUserprofile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = previousUserprofile
    await project.cleanup()
  }
})

test("experimental.chat.system.transform skips injection when no project context", async () => {
  const hooks = await getHooks()
  const output = { system: ["You are an AI assistant."] }
  await hooks["experimental.chat.system.transform"](
    { sessionID: "s1", model: { id: "model-1" } },
    output,
  )
  // No project context detected, so nothing should be added
  assert.equal(output.system.length, 1)
  assert.equal(output.system[0], "You are an AI assistant.")
})

test("tool.execute.before adds hint for git commit without -m", async () => {
  const hooks = await getHooks()
  const output = { args: { command: "git commit" } }
  await hooks["tool.execute.before"]({ tool: "bash", sessionID: "s1", callID: "c1" }, output)
  assert.ok(output.args._resolve_hint, "should add hint for git commit without -m")
  assert.ok(output.args._resolve_hint.includes("git commit -m"), "hint should mention -m flag")
})

test("tool.execute.before does not modify git commit -m", async () => {
  const hooks = await getHooks()
  const output = { args: { command: 'git commit -m "fix: something"' } }
  await hooks["tool.execute.before"]({ tool: "bash", sessionID: "s1", callID: "c1" }, output)
  assert.equal(output.args._resolve_hint, undefined, "should not add hint for git commit -m")
})

test("tool.execute.before does not modify non-bash tools", async () => {
  const hooks = await getHooks()
  const output = { args: { filePath: "/tmp/test.ts" } }
  await hooks["tool.execute.before"]({ tool: "edit", sessionID: "s1", callID: "c1" }, output)
  assert.equal(output.args.filePath, "/tmp/test.ts", "should not modify edit args")
})

test("chat.headers adds retry strategy for ZAI/GLM providers", async () => {
  const hooks = await getHooks()
  const output = { headers: {} }
  await hooks["chat.headers"](
    { sessionID: "s1", agent: "resolver", model: { id: "glm-5.1" }, provider: { source: "config", info: { id: "zai-coding-plan" }, options: {} }, message: {} },
    output,
  )
  assert.equal(output.headers["X-Custom-Retry-Strategy"], "exponential")
})

test("chat.headers skips retry strategy for non-GLM providers", async () => {
  const hooks = await getHooks()
  const output = { headers: {} }
  await hooks["chat.headers"](
    { sessionID: "s1", agent: "resolver", model: { id: "gpt-4" }, provider: { source: "config", info: { id: "openai" }, options: {} }, message: {} },
    output,
  )
  assert.equal(output.headers["X-Custom-Retry-Strategy"], undefined)
})

test("experimental.text.complete adds verification reminder for unverified edits", async () => {
  const hooks = await getHooks()
  const output = { text: "I edited the file:\n```typescript\nconst x = 1;\n```" }
  await hooks["experimental.text.complete"]({ sessionID: "s1", messageID: "m1", partID: "p1" }, output)
  assert.ok(output.text.includes("verify your changes"), "should add verification reminder")
})

test("experimental.text.complete skips reminder when already verified", async () => {
  const hooks = await getHooks()
  const output = { text: "I edited the file and verified:\n```typescript\nconst x = 1;\n```\nverified with tsc --noEmit ✅" }
  await hooks["experimental.text.complete"]({ sessionID: "s1", messageID: "m1", partID: "p1" }, output)
  assert.ok(!output.text.includes("Reminder"), "should NOT add reminder when already verified")
})

test("experimental.text.complete skips reminder for non-edit text", async () => {
  const hooks = await getHooks()
  const output = { text: "The architecture looks good. Let me think about it." }
  await hooks["experimental.text.complete"]({ sessionID: "s1", messageID: "m1", partID: "p1" }, output)
  assert.ok(!output.text.includes("Reminder"), "should NOT add reminder for non-edit text")
})

// ── LSP diagnostics event + tool.execute.after integration ────────────────

test("event hook captures LSP diagnostics and tool.execute.after reports them", async () => {
  const project = await createProject({
    "opencode.json": {},
    "opencode-resolve.json": {},
    "package.json": { scripts: { test: "jest" } },
  })
  const previousHome = process.env.HOME
  const previousUserprofile = process.env.USERPROFILE
  process.env.HOME = project.path
  process.env.USERPROFILE = project.path
  try {
    const config = { model: "provider/model", agent: {} }
    const hooks = await OpencodeResolve(
      { directory: project.path, client: {}, project: {}, worktree: project.path, serverUrl: new URL("http://localhost"), $: {}, experimental_workspace: { register() {} } },
      {},
    )
    await hooks.config(config)

    // Simulate LSP diagnostics event
    const testPath = "/project/src/index.ts"
    await hooks.event({
      event: {
        type: "lsp.client.diagnostics",
        properties: { serverID: "typescript", path: testPath },
        diagnostics: [
          { severity: 1, message: "Type 'string' is not assignable to type 'number'." },
          { severity: 2, message: "Unused variable 'x'." },
        ],
      },
    })

    // Now simulate tool.execute.after on that file
    const output = { title: "", output: "", metadata: {} }
    await hooks["tool.execute.after"](
      { tool: "edit", sessionID: "s1", callID: "c1", args: { filePath: testPath } },
      output,
    )

    // Should contain both verify hint and LSP diagnostics
    assert.ok(output.metadata._resolve_verify_hint, "should have verify hint")
    assert.equal(output.metadata._resolve_lsp_errors, 1, "should report 1 LSP error")
    assert.equal(output.metadata._resolve_lsp_warnings, 1, "should report 1 LSP warning")
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousUserprofile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = previousUserprofile
    await project.cleanup()
  }
})

test("event hook clears diagnostics when errors are resolved", async () => {
  const hooks = await getHooks()

  const testPath = "/project/src/index.ts"
  // First: errors
  await hooks.event({
    event: {
      type: "lsp.client.diagnostics",
      properties: { serverID: "typescript", path: testPath },
      diagnostics: [{ severity: 1, message: "error" }],
    },
  })

  // Then: all clear
  await hooks.event({
    event: {
      type: "lsp.client.diagnostics",
      properties: { serverID: "typescript", path: testPath },
      diagnostics: [],
    },
  })

  // tool.execute.after should NOT have LSP diagnostics
  const output = { title: "", output: "", metadata: {} }
  await hooks["tool.execute.after"](
    { tool: "edit", sessionID: "s1", callID: "c1", args: { filePath: testPath } },
    output,
  )
  assert.equal(output.metadata._resolve_lsp_errors, undefined, "should not have LSP errors after clear")
})

test("event hook ignores non-LSP events", async () => {
  const hooks = await getHooks()
  // Should not throw on unrelated events
  await hooks.event({
    event: { type: "chat.message.created", properties: {} },
  })
})

test("coder prompt mentions LSP diagnostics", async () => {
  const { config } = await runPlugin({})
  assert.match(config.agent.coder.prompt, /LSP diagnostics/)
})

test("GLM coder prompt mentions LSP diagnostics", async () => {
  const { config } = await runPlugin(
    { model: "zai-coding-plan/glm-5.1" },
    undefined,
    { profile: "glm", enabled: ["coder", "resolver"] },
  )
  assert.match(config.agent.coder.prompt, /LSP diagnostics/)
})

test("GPT coder prompt mentions LSP diagnostics", async () => {
  const { config } = await runPlugin(
    { model: "openai/gpt-5.5" },
    undefined,
    { profile: "gpt" },
  )
  assert.match(config.agent.coder.prompt, /LSP diagnostics/)
})
