import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { createInterface } from "node:readline/promises"
import { fileURLToPath } from "node:url"

const packageName = "opencode-resolve"
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const configDir = process.env.OPENCODE_CONFIG_HOME || join(homedir(), ".config", "opencode")
const opencodeConfigPath = join(configDir, "opencode.json")
const resolveConfigPath = join(configDir, "resolve.json")
const exampleConfigPath = join(root, "opencode-resolve.example.json")

const ADDITIVE_DEFAULTS = {
  autoApprove: true,
}

// ZAI local MCP server bootstrap for GLM users.
// Do not copy provider secrets from OpenCode's auth store into opencode.json.
// The MCP process should receive credentials from the user's runtime environment.
const ZAI_MCP_SERVERS = {
  "zai-mcp-server": {
    type: "local",
    command: ["npx", "-y", "@z_ai/mcp-server"],
    environment: {
      Z_AI_MODE: "ZAI",
    },
  },
}

const COMPANION_PLUGINS = [
  {
    pkg: "@tarquinen/opencode-dcp",
    desc: "Dynamic Context Pruning — strips obsolete tool outputs so long resolver loops cost fewer tokens",
  },
  {
    pkg: "@slkiser/opencode-quota",
    desc: "Live token/quota usage indicator — supports GLM coding-plan, OpenAI Plus/Pro, Qwen, and more",
  },
]

const OPENAI_MODEL_HINTS = [
  "openai/gpt-5.5",
  "openai/gpt-5.4",
  "openai/gpt-5.3-codex",
  "openai/gpt-5.3-codex-spark",
  "openai/gpt-5.2",
  "openai/gpt-5-mini",
  "openai/gpt-4o-mini",
]

const GLM_MODEL_HINTS = [
  "zai-coding-plan/glm-5.1",
  "zai/glm-5.1",
  "zai/glm-5",
  "zai/glm-4.7-flash",
  "zai/glm-4.5-flash",
  "zai/glm-4.5",
  "zai/glm-4.5-air",
]

if (process.env.OPENCODE_RESOLVE_SKIP_POSTINSTALL === "1") {
  process.exit(0)
}

const pluginVersion = await readOwnVersion()
console.log(`[${packageName}] installing v${pluginVersion}`)

try {
  await registerPlugin()
  await offerCompanionPlugins()
  console.log(`[${packageName}] v${pluginVersion} install complete — restart OpenCode to load the plugin`)
} catch (error) {
  console.warn(`[${packageName}] automatic OpenCode registration skipped: ${formatError(error)}`)
  console.warn(`[${packageName}] add "${packageName}" to your OpenCode plugin list manually if needed.`)
}

async function readOwnVersion() {
  try {
    const raw = await readFile(join(root, "package.json"), "utf8")
    const parsed = JSON.parse(raw)
    return typeof parsed?.version === "string" ? parsed.version : "unknown"
  } catch {
    return "unknown"
  }
}

async function registerPlugin() {
  await mkdir(configDir, { recursive: true })

  const config = await readOpenCodeConfig()
  let configChanged = addPlugin(config)

  // Inject ZAI MCP servers when GLM is detected
  const allModels = detectAllModels(config)
  const hasGLM = allModels.some((m) => isGLMModel(m))
  if (hasGLM) {
    const mcpChanged = await injectZAIMCPs(config)
    configChanged = configChanged || mcpChanged
  }

  if (configChanged) {
    await writeFile(opencodeConfigPath, `${JSON.stringify(config, null, 2)}\n`)
    console.log(`[${packageName}] updated ${opencodeConfigPath}`)
  } else {
    console.log(`[${packageName}] already registered in ${opencodeConfigPath}`)
  }

  if (!(await exists(resolveConfigPath))) {
    await createAdaptiveResolveConfig(config)
    return
  }

  await migrateResolveConfig()
}

async function createAdaptiveResolveConfig(opencodeConfig) {
  await assertReadable(exampleConfigPath)
  const raw = await readFile(exampleConfigPath, "utf8")
  const example = JSON.parse(raw)

  const currentModel = detectOpenCodeModel(opencodeConfig)
  const allModels = detectAllModels(opencodeConfig)
  const resolveConfig = { ...example }
  const forcePrompt = process.env.OPENCODE_RESOLVE_FORCE_PROMPT === "1"
  const canPrompt = Boolean(
    (process.stdin.isTTY && process.stdout.isTTY) || forcePrompt,
  )
  const scriptedAnswers = forcePrompt && !process.stdin.isTTY
    ? (await readAllStdin()).split(/\r?\n/)
    : undefined
  const interactivePreset = canPrompt
    ? await buildInteractivePreset(currentModel, allModels, scriptedAnswers)
    : undefined

  if (interactivePreset) {
    resolveConfig.profile = interactivePreset.profile
    if (interactivePreset.tier) resolveConfig.tier = interactivePreset.tier
    else delete resolveConfig.tier
    if (interactivePreset.enabled) resolveConfig.enabled = interactivePreset.enabled
    resolveConfig.models = interactivePreset.models
    resolveConfig.agents = {
      ...resolveConfig.agents,
      ...(interactivePreset.agents ?? {}),
    }
    await writeFile(resolveConfigPath, `${JSON.stringify(resolveConfig, null, 2)}\n`)
    console.log(`[${packageName}] created ${resolveConfigPath} (preset: ${interactivePreset.label})`)
    return
  }

  if (process.env.OPENCODE_RESOLVE_AUTO_PRESET !== "1") {
    resolveConfig.profile = "mix"
    delete resolveConfig.tier
    resolveConfig.models = {}
    resolveConfig.agents = {
      ...resolveConfig.agents,
      codex: { ...(resolveConfig.agents?.codex ?? {}), enabled: true },
      glm: { ...(resolveConfig.agents?.glm ?? {}), enabled: true },
    }
    await writeFile(resolveConfigPath, `${JSON.stringify(resolveConfig, null, 2)}\n`)
    console.log(`[${packageName}] created ${resolveConfigPath} (preset: prompt-required)`)
    console.log(`[${packageName}] model pinning was not guessed because no interactive prompt was available.`)
    console.log(`[${packageName}] rerun setup in a TTY or edit ${resolveConfigPath} to choose GPT/GLM three-tier models.`)
    return
  }

  // Profile selection based on detected providers
  const hasGLM = allModels.some((m) => isGLMModel(m))
  const hasGPT = allModels.some((m) => isGPTModel(m))
  const preset = buildModelPreset(currentModel, allModels)

  if (hasGLM && !hasGPT) {
    // GLM only → GLM profile, silver tier (token-efficient, no deep-reviewer)
    resolveConfig.profile = "glm"
    resolveConfig.tier = "silver"
    resolveConfig.agents = {
      ...resolveConfig.agents,
      glm: { ...(resolveConfig.agents?.glm ?? {}), enabled: true },
    }
  } else if (hasGPT && !hasGLM) {
    // GPT only → GPT profile, gold tier (full power)
    resolveConfig.profile = "gpt"
    resolveConfig.tier = "gold"
    resolveConfig.agents = {
      ...resolveConfig.agents,
      codex: { ...(resolveConfig.agents?.codex ?? {}), enabled: true },
    }
  } else {
    // Mixed or unknown provider → explicit mix profile. No tier: use DEFAULT_ENABLED.
    resolveConfig.profile = "mix"
    if (hasGLM && hasGPT) {
      resolveConfig.agents = {
        ...resolveConfig.agents,
        codex: { ...(resolveConfig.agents?.codex ?? {}), enabled: true },
        glm: { ...(resolveConfig.agents?.glm ?? {}), enabled: true },
      }
    }
  }

  if (preset && Object.keys(preset).length > 0) {
    resolveConfig.models = preset
  }

  await writeFile(resolveConfigPath, `${JSON.stringify(resolveConfig, null, 2)}\n`)

  const label = getPresetLabel(currentModel)
  console.log(`[${packageName}] created ${resolveConfigPath} (preset: ${label})`)
}

function detectOpenCodeModel(config) {
  // Prefer top-level `model` as primary signal
  if (typeof config.model === "string" && config.model.length > 0) {
    return config.model
  }

  // Check top-level `models` object values if present
  if (isObject(config.models)) {
    for (const value of Object.values(config.models)) {
      if (typeof value === "string" && value.length > 0) {
        return value
      }
    }
  }

  // Check agent.*.model values if present
  if (isObject(config.agent)) {
    for (const agentConfig of Object.values(config.agent)) {
      if (isObject(agentConfig) && typeof agentConfig.model === "string" && agentConfig.model.length > 0) {
        return agentConfig.model
      }
    }
  }

  return null
}

function buildModelPreset(currentModel, allModels = []) {
  const detectedGLMModels = allModels.filter(isGLMModel)
  const detectedGPTModels = allModels.filter(isGPTModel)
  const glmModels = detectedGLMModels.length > 0 ? collectModelChoices(detectedGLMModels, isGLMModel, GLM_MODEL_HINTS, false) : []
  const gptModels = detectedGPTModels.length > 0 ? collectModelChoices(detectedGPTModels, isGPTModel, OPENAI_MODEL_HINTS, false) : []
  const glmModel = glmModels[0]
  const gptModel = gptModels[0]

  if (glmModel && gptModel) {
    const glmTiers = chooseThreeTier(glmModels, "glm", false)
    const gptTiers = chooseThreeTier(gptModels, "gpt", false)
    return {
      mix: "gpt",
      gpt: gptTiers.gold,
      bronze: glmTiers.bronze,
      silver: glmTiers.silver,
      gold: gptTiers.gold,
      "glm-bronze": glmTiers.bronze,
      "glm-silver": glmTiers.silver,
      "glm-gold": glmTiers.gold,
      "gpt-bronze": gptTiers.bronze,
      "gpt-silver": gptTiers.silver,
      "gpt-gold": gptTiers.gold,
      fast: "bronze",
      strong: "gold",
      mini: "bronze",
      codex: "gpt-gold",
      glm: glmTiers.gold,
      explorer: "bronze",
      coder: "silver",
      resolver: "gold",
      reviewer: "gold",
      "deep-reviewer": "gold",
      planner: "gold",
    }
  }

  if (!currentModel) {
    return {}
  }

  const lower = currentModel.toLowerCase()

  // GLM / ZAI — GLM-only preset (no GPT dependency, avoids token-exhaustion errors)
  if (lower.includes("glm") || lower.includes("zai")) {
    return buildGLMOnlyPreset(currentModel)
  }

  // OpenAI / GPT single-provider preset
  if (lower.includes("openai/") || lower.includes("gpt")) {
    return buildGPTOnlyPreset(currentModel)
  }

  // Unknown provider — keep model-neutral
  return {}
}

function buildGLMOnlyPreset(model) {
  const tiers = chooseThreeTier(collectModelChoices([model], isGLMModel, GLM_MODEL_HINTS, false), "glm", false)
  return {
    glm: tiers.gold,
    bronze: tiers.bronze,
    silver: tiers.silver,
    gold: tiers.gold,
    fast: "bronze",
    strong: "gold",
    mini: "bronze",
    coder: "silver",
    resolver: "gold",
    reviewer: "gold",
    "deep-reviewer": "gold",
    explorer: "bronze",
    planner: "gold",
  }
}

function buildGPTOnlyPreset(model) {
  const tiers = chooseThreeTier(collectModelChoices([model], isGPTModel, OPENAI_MODEL_HINTS, false), "gpt", false)
  return {
    gpt: tiers.gold,
    bronze: tiers.bronze,
    silver: tiers.silver,
    gold: tiers.gold,
    fast: "bronze",
    strong: "gold",
    mini: "bronze",
    codex: "gold",
    coder: "silver",
    resolver: "gold",
    explorer: "bronze",
    reviewer: "gold",
    "deep-reviewer": "gold",
  }
}

async function buildInteractivePreset(currentModel, allModels, scriptedAnswers) {
  const choices = {
    gpt: collectModelChoices(allModels, isGPTModel, OPENAI_MODEL_HINTS),
    glm: collectModelChoices(allModels, isGLMModel, GLM_MODEL_HINTS),
  }
  if (currentModel) {
    if (isGPTModel(currentModel)) choices.gpt = unique([currentModel, ...choices.gpt])
    if (isGLMModel(currentModel)) choices.glm = unique([currentModel, ...choices.glm])
  }

  const rl = scriptedAnswers
    ? {
        async question(prompt) {
          const answer = scriptedAnswers.length > 0 ? scriptedAnswers.shift() ?? "" : ""
          process.stdout.write(prompt)
          process.stdout.write(`${answer}\n`)
          return answer
        },
        close() {},
      }
    : createInterface({ input: process.stdin, output: process.stdout })
  try {
    console.log("")
    console.log(`[${packageName}] Choose resolve profile:`)
    console.log("  1. mix — neutral resolver plus optional Codex and GLM primary agents")
    console.log("  2. gpt — GPT/Codex-only, three-tier")
    console.log("  3. glm — GLM-only, three-tier")
    const profileAnswer = await askChoice(rl, "Profile [1=mix, 2=gpt, 3=glm, default 1]: ", ["1", "2", "3"], "1")
    const profile = profileAnswer === "2" ? "gpt" : profileAnswer === "3" ? "glm" : "mix"

    if (profile === "gpt") {
      const tiers = await askThreeTier(rl, "GPT/Codex", choices.gpt)
      return {
        label: "gpt-three-tier",
        profile: "gpt",
        tier: "gold",
        models: buildGPTThreeTierModels(tiers),
        agents: { codex: { enabled: true } },
      }
    }

    if (profile === "glm") {
      const tiers = await askThreeTier(rl, "GLM", choices.glm)
      return {
        label: "glm-three-tier",
        profile: "glm",
        tier: "gold",
        models: buildGLMThreeTierModels(tiers),
        agents: { glm: { enabled: true } },
      }
    }

    const useCodex = await askYesNo(rl, "Enable dedicated Codex primary agent too? [Y/n]: ", true)
    const useGLM = await askYesNo(rl, "Enable dedicated GLM primary agent too? [Y/n]: ", true)
    const gptTiers = await askThreeTier(rl, "Codex/GPT", choices.gpt)
    const glmTiers = await askThreeTier(rl, "GLM", choices.glm)
    return {
      label: "mix-three-tier",
      profile: "mix",
      models: buildMixedThreeTierModels(gptTiers, glmTiers),
      agents: {
        codex: { enabled: useCodex },
        glm: { enabled: useGLM },
      },
    }
  } finally {
    rl.close()
  }
}

async function askThreeTier(rl, label, models) {
  const choices = models.length > 0 ? models : (label.toLowerCase().includes("glm") ? GLM_MODEL_HINTS : OPENAI_MODEL_HINTS)
  console.log("")
  console.log(`[${packageName}] ${label} model choices:`)
  choices.forEach((model, index) => console.log(`  ${index + 1}. ${model}`))
  const defaults = chooseThreeTier(choices, label.toLowerCase().includes("glm") ? "glm" : "gpt")
  const bronze = await askModel(rl, choices, `Pick ${label} bronze/scout [default ${defaults.bronze}]: `, defaults.bronze)
  const silver = await askModel(rl, choices, `Pick ${label} silver/coder [default ${defaults.silver}]: `, defaults.silver)
  const gold = await askModel(rl, choices, `Pick ${label} gold/reasoner [default ${defaults.gold}]: `, defaults.gold)
  return { bronze, silver, gold }
}

async function askModel(rl, choices, question, defaultValue) {
  const answer = (await rl.question(question)).trim()
  if (!answer) return defaultValue
  const index = Number.parseInt(answer, 10)
  if (Number.isInteger(index) && index >= 1 && index <= choices.length) return choices[index - 1]
  return answer
}

async function askChoice(rl, question, valid, defaultValue) {
  const answer = (await rl.question(question)).trim().toLowerCase()
  if (!answer) return defaultValue
  return valid.includes(answer) ? answer : defaultValue
}

async function askYesNo(rl, question, defaultValue) {
  const answer = (await rl.question(question)).trim().toLowerCase()
  if (!answer) return defaultValue
  return answer === "y" || answer === "yes"
}

function buildMixedThreeTierModels(gptTiers, glmTiers) {
  return {
    mix: "gpt-gold",
    gpt: "gpt-gold",
    glm: "glm-gold",
    bronze: "glm-bronze",
    silver: "glm-silver",
    gold: "gpt-gold",
    "gpt-bronze": gptTiers.bronze,
    "gpt-silver": gptTiers.silver,
    "gpt-gold": gptTiers.gold,
    "glm-bronze": glmTiers.bronze,
    "glm-silver": glmTiers.silver,
    "glm-gold": glmTiers.gold,
    fast: "bronze",
    strong: "gold",
    mini: "bronze",
    codex: "gpt-gold",
    explorer: "bronze",
    coder: "silver",
    resolver: "gold",
    reviewer: "gold",
    "deep-reviewer": "gold",
    planner: "gold",
  }
}

function buildGPTThreeTierModels(tiers) {
  return {
    gpt: "gold",
    bronze: tiers.bronze,
    silver: tiers.silver,
    gold: tiers.gold,
    fast: "bronze",
    strong: "gold",
    mini: "bronze",
    codex: "gold",
    explorer: "bronze",
    coder: "silver",
    resolver: "gold",
    reviewer: "gold",
    "deep-reviewer": "gold",
    planner: "gold",
  }
}

function buildGLMThreeTierModels(tiers) {
  return {
    glm: "gold",
    bronze: tiers.bronze,
    silver: tiers.silver,
    gold: tiers.gold,
    fast: "bronze",
    strong: "gold",
    mini: "bronze",
    explorer: "bronze",
    coder: "silver",
    resolver: "gold",
    reviewer: "gold",
    "deep-reviewer": "gold",
    planner: "gold",
  }
}

function collectModelChoices(allModels, predicate, hints, includeFallbackHints = true) {
  const detected = allModels.filter(predicate)
  const providerIds = new Set(detected.map((model) => model.split("/")[0]).filter(Boolean))
  const matchingHints = includeFallbackHints
    ? hints.filter((model) => providerIds.size === 0 || providerIds.has(model.split("/")[0]) || detected.length < 3)
    : []
  return unique([...detected, ...matchingHints])
}

function chooseThreeTier(models, family, includeFallbackHints = true) {
  const fallback = family === "glm" ? GLM_MODEL_HINTS : OPENAI_MODEL_HINTS
  const choices = unique(includeFallbackHints ? [...models, ...fallback] : models)
  return {
    bronze: preferModel(choices, family === "glm" ? ["flash", "air", "mini"] : ["spark", "mini", "4o-mini"], choices[0]),
    silver: preferModel(choices, family === "glm" ? ["5.1", "4.5"] : ["codex", "5.3", "5.2"], choices[1] ?? choices[0]),
    gold: preferModel(choices, family === "glm" ? ["5.1", "5", "4.5"] : ["5.5", "5.4", "gpt-5.3-codex"], choices[2] ?? choices[1] ?? choices[0]),
  }
}

function preferModel(models, needles, fallback) {
  return models.find((model) => {
    const lower = model.toLowerCase()
    return needles.some((needle) => lower.includes(needle))
  }) ?? fallback
}

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))]
}

async function readAllStdin() {
  let raw = ""
  for await (const chunk of process.stdin) {
    raw += chunk
  }
  return raw
}

function getPresetLabel(currentModel) {
  if (!currentModel) return "inherited"
  const lower = currentModel.toLowerCase()
  if (lower.includes("glm") || lower.includes("zai")) return "glm-only"
  if (lower.includes("openai/") || lower.includes("gpt")) return "gpt-only"
  return "inherited"
}

function isGLMModel(currentModel) {
  if (!currentModel) return false
  const lower = currentModel.toLowerCase()
  return lower.includes("glm") || lower.includes("zai")
}

function isGPTModel(currentModel) {
  if (!currentModel) return false
  const lower = currentModel.toLowerCase()
  return lower.includes("openai/") || lower.includes("gpt")
}

function detectAllModels(config) {
  const models = new Set()

  // Top-level model
  if (typeof config.model === "string" && config.model.length > 0) {
    models.add(config.model)
  }

  // Top-level models object values
  if (isObject(config.models)) {
    for (const value of Object.values(config.models)) {
      if (typeof value === "string" && value.length > 0) {
        models.add(value)
      }
    }
  }

  // Provider model lists
  if (isObject(config.provider)) {
    for (const [providerId, providerConfig] of Object.entries(config.provider)) {
      if (isObject(providerConfig) && isObject(providerConfig.models)) {
        for (const [modelKey, modelEntry] of Object.entries(providerConfig.models)) {
          if (typeof modelKey === "string" && modelKey.length > 0) {
            models.add(qualifyModelId(providerId, modelKey))
          }
          if (typeof modelEntry === "string") {
            models.add(qualifyModelId(providerId, modelEntry))
          } else if (isObject(modelEntry) && typeof modelEntry.id === "string") {
            models.add(qualifyModelId(providerId, modelEntry.id))
          }
        }
      }
    }
  }

  // Agent model values
  if (isObject(config.agent)) {
    for (const agentConfig of Object.values(config.agent)) {
      if (isObject(agentConfig) && typeof agentConfig.model === "string" && agentConfig.model.length > 0) {
        models.add(agentConfig.model)
      }
    }
  }

  return [...models]
}

function qualifyModelId(providerId, modelId) {
  if (typeof modelId !== "string" || modelId.length === 0) return modelId
  if (modelId.includes("/")) return modelId
  return `${providerId}/${modelId}`
}

async function migrateResolveConfig() {
  let raw
  try {
    raw = await readFile(resolveConfigPath, "utf8")
  } catch (error) {
    console.warn(`[${packageName}] could not read ${resolveConfigPath} for migration: ${formatError(error)}`)
    return
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    console.warn(`[${packageName}] ${resolveConfigPath} is not valid JSON; skipping migration: ${formatError(error)}`)
    return
  }

  if (!isObject(parsed)) {
    console.warn(`[${packageName}] ${resolveConfigPath} must contain a JSON object; skipping migration`)
    return
  }

  const updated = { ...parsed }
  const added = []
  for (const [key, value] of Object.entries(ADDITIVE_DEFAULTS)) {
    if (updated[key] === undefined) {
      updated[key] = value
      added.push(`${key}=${JSON.stringify(value)}`)
    }
  }

  if (added.length > 0) {
    await writeFile(resolveConfigPath, `${JSON.stringify(updated, null, 2)}\n`)
    console.log(`[${packageName}] migrated ${resolveConfigPath}: added ${added.join(", ")}`)
  } else {
    console.log(`[${packageName}] ${resolveConfigPath} already up to date`)
  }

  if (Array.isArray(updated.enabled) && !updated.enabled.includes("resolver")) {
    console.log(
      `[${packageName}] tip: add "resolver" to "enabled" in ${resolveConfigPath} to use the new orchestrator agent.`,
    )
  }
}

async function readOpenCodeConfig() {
  if (!(await exists(opencodeConfigPath))) {
    return {
      $schema: "https://opencode.ai/config.json",
      plugin: [],
    }
  }

  const raw = await readFile(opencodeConfigPath, "utf8")
  const parsed = JSON.parse(raw)
  if (!isObject(parsed)) throw new Error(`${opencodeConfigPath} must contain a JSON object`)
  return parsed
}

function addPlugin(config) {
  config.plugin ??= []
  if (!Array.isArray(config.plugin)) {
    throw new Error(`${opencodeConfigPath}.plugin must be an array`)
  }

  if (config.plugin.some(isRegisteredPluginEntry)) return false
  config.plugin.push(packageName)
  return true
}

async function injectZAIMCPs(config) {
  config.mcp ??= {}
  if (!isObject(config.mcp)) return false

  const added = []
  for (const [name, mcpConfig] of Object.entries(ZAI_MCP_SERVERS)) {
    if (config.mcp[name] === undefined) {
      config.mcp[name] = mcpConfig
      added.push(name)
    }
  }

  if (added.length > 0) {
    console.log(`[${packageName}] injected ZAI MCP server config: ${added.join(", ")}`)
    console.log(`[${packageName}] note: API keys are not copied into opencode.json; export Z_AI_API_KEY if the MCP server requires it.`)
    return true
  }

  console.log(`[${packageName}] ZAI MCP server already present — skipping`)
  return false
}

function isRegisteredPluginEntry(entry) {
  if (typeof entry === "string") return isResolvePluginName(entry)
  if (Array.isArray(entry) && typeof entry[0] === "string") return isResolvePluginName(entry[0])
  return false
}

function isResolvePluginName(value) {
  const name = value.split("/").pop() || value
  return name === packageName || name.startsWith(`${packageName}@`)
}

async function assertReadable(path) {
  await access(path, constants.R_OK)
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch (error) {
    if (isMissingFileError(error)) return false
    throw error
  }
}

function isMissingFileError(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error)
}

async function offerCompanionPlugins() {
  if (process.env.OPENCODE_RESOLVE_SKIP_COMPANIONS === "1") return

  const config = await readOpenCodeConfig()
  const existing = collectPluginBaseNames(config.plugin ?? [])
  const missing = COMPANION_PLUGINS.filter((c) => !existing.has(c.pkg))

  if (missing.length === 0) {
    console.log(`[${packageName}] recommended companion plugins already present — skipping`)
    return
  }

  const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY)

  if (!isInteractive) {
    console.log(`[${packageName}] recommended companion plugins not detected:`)
    for (const c of missing) {
      console.log(`  - ${c.pkg} — ${c.desc}`)
      console.log(`    install: opencode plugin ${c.pkg}@latest --global --force`)
    }
    return
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    for (const c of missing) {
      console.log("")
      console.log(`[${packageName}] recommended companion: ${c.pkg}`)
      console.log(`             ${c.desc}`)
      const raw = await rl.question("             install now? [Y/n] ")
      const answer = raw.trim().toLowerCase()
      const accepted = answer === "" || answer === "y" || answer === "yes"
      if (!accepted) {
        console.log(`             skipped — install later via:  opencode plugin ${c.pkg}@latest --global --force`)
        continue
      }
      const installed = await installCompanion(c.pkg)
      if (!installed) {
        console.warn(`             ${c.pkg} install command failed — leave plugin list untouched, retry manually`)
        continue
      }
      await addCompanionToOpenCodeConfig(`${c.pkg}@latest`)
      console.log(`             ${c.pkg} cached and registered — restart OpenCode to activate`)
    }
  } finally {
    rl.close()
  }
}

function collectPluginBaseNames(plugins) {
  const names = new Set()
  for (const entry of plugins) {
    const raw = typeof entry === "string"
      ? entry
      : Array.isArray(entry) && typeof entry[0] === "string"
        ? entry[0]
        : null
    if (!raw) continue
    names.add(stripVersionSuffix(raw))
  }
  return names
}

function stripVersionSuffix(name) {
  if (name.startsWith("@")) {
    const slashIndex = name.indexOf("/")
    if (slashIndex === -1) return name
    const scope = name.slice(0, slashIndex)
    const rest = name.slice(slashIndex + 1)
    return `${scope}/${rest.split("@")[0]}`
  }
  return name.split("@")[0]
}

async function installCompanion(pkg) {
  return new Promise((resolveSpawn) => {
    const child = spawn("opencode", ["plugin", `${pkg}@latest`, "--global", "--force"], {
      stdio: "inherit",
    })
    child.on("exit", (code) => resolveSpawn(code === 0))
    child.on("error", () => resolveSpawn(false))
  })
}

async function addCompanionToOpenCodeConfig(pluginEntry) {
  const config = await readOpenCodeConfig()
  config.plugin ??= []
  if (!Array.isArray(config.plugin)) {
    throw new Error(`${opencodeConfigPath}.plugin must be an array`)
  }
  const baseName = stripVersionSuffix(pluginEntry)
  const alreadyPresent = config.plugin.some((entry) => {
    const raw = typeof entry === "string"
      ? entry
      : Array.isArray(entry) && typeof entry[0] === "string"
        ? entry[0]
        : null
    return raw !== null && stripVersionSuffix(raw) === baseName
  })
  if (alreadyPresent) return
  config.plugin.push(pluginEntry)
  await writeFile(opencodeConfigPath, `${JSON.stringify(config, null, 2)}\n`)
}
