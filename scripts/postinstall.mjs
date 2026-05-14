import { constants } from "node:fs"
import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageName = "opencode-resolve"
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const configDir = process.env.OPENCODE_CONFIG_HOME || join(homedir(), ".config", "opencode")
const opencodeConfigPath = join(configDir, "opencode.json")
const resolveConfigPath = join(configDir, "resolve.json")
const exampleConfigPath = join(root, "opencode-resolve.example.json")

const ADDITIVE_DEFAULTS = {
  autoApprove: true,
  maxParallelSubagents: 2,
}

if (process.env.OPENCODE_RESOLVE_SKIP_POSTINSTALL === "1") {
  process.exit(0)
}

const pluginVersion = await readOwnVersion()
console.log(`[${packageName}] installing v${pluginVersion}`)

try {
  await registerPlugin()
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
  const changed = addPlugin(config)

  if (changed) {
    await writeFile(opencodeConfigPath, `${JSON.stringify(config, null, 2)}\n`)
    console.log(`[${packageName}] registered in ${opencodeConfigPath}`)
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
  const preset = buildModelPreset(currentModel)

  const resolveConfig = { ...example }
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

function buildModelPreset(currentModel) {
  if (!currentModel) return {}

  const lower = currentModel.toLowerCase()

  // GLM / ZAI mixed preset
  if (lower.includes("glm") || lower.includes("zai")) {
    return {
      glm: "zai-coding-plan/glm-5.1",
      gpt: "openai/gpt-5.5",
      fast: "glm",
      strong: "gpt",
      coder: "glm",
      resolver: "gpt",
      reviewer: "gpt",
      "deep-reviewer": "gpt",
      explorer: "fast",
    }
  }

  // OpenAI / GPT single-provider preset
  if (lower.includes("openai/") || lower.includes("gpt")) {
    return {
      gpt: currentModel,
      fast: "gpt",
      strong: "gpt",
      mini: "gpt",
      codex: "gpt",
      coder: "gpt",
      resolver: "gpt",
      explorer: "gpt",
      reviewer: "gpt",
      "deep-reviewer": "gpt",
    }
  }

  // Unknown provider — keep model-neutral
  return {}
}

function getPresetLabel(currentModel) {
  if (!currentModel) return "inherited"
  const lower = currentModel.toLowerCase()
  if (lower.includes("glm") || lower.includes("zai")) return "glm+gpt"
  if (lower.includes("openai/") || lower.includes("gpt")) return "gpt-only"
  return "inherited"
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
