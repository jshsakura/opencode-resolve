import { constants } from "node:fs"
import { access, mkdir, readFile, symlink, unlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const pluginTarget = join(root, "dist", "index.js")
const configDir = join(homedir(), ".config", "opencode")
const pluginLink = join(configDir, "plugins", "opencode-resolve.js")
const resolveConfigPath = join(configDir, "resolve.json")
const exampleConfig = join(root, "opencode-resolve.example.json")
const opencodeConfigPath = join(configDir, "opencode.json")

await assertFile(pluginTarget)
await mkdir(dirname(pluginLink), { recursive: true })

try {
  await unlink(pluginLink)
} catch (error) {
  if (!isMissingFileError(error)) throw error
}

await symlink(pluginTarget, pluginLink)

if (!(await exists(resolveConfigPath))) {
  await createAdaptiveResolveConfig()
}

console.log(`Linked plugin: ${pluginLink} -> ${pluginTarget}`)
console.log(`Resolve config: ${resolveConfigPath}`)

async function createAdaptiveResolveConfig() {
  const raw = await readFile(exampleConfig, "utf8")
  const example = JSON.parse(raw)

  let opencodeConfig = {}
  try {
    const configRaw = await readFile(opencodeConfigPath, "utf8")
    opencodeConfig = JSON.parse(configRaw)
  } catch {
    // opencode.json not found or unreadable — use empty config
  }

  const currentModel = detectOpenCodeModel(opencodeConfig)
  const preset = buildModelPreset(currentModel)

  const resolveConfig = { ...example }
  if (preset && Object.keys(preset).length > 0) {
    resolveConfig.models = preset
  }

  await mkdir(configDir, { recursive: true })
  await writeFile(resolveConfigPath, `${JSON.stringify(resolveConfig, null, 2)}\n`)

  const label = getPresetLabel(currentModel)
  console.log(`Created ${resolveConfigPath} (preset: ${label})`)
}

function detectOpenCodeModel(config) {
  if (typeof config.model === "string" && config.model.length > 0) {
    return config.model
  }
  if (isObject(config.models)) {
    for (const value of Object.values(config.models)) {
      if (typeof value === "string" && value.length > 0) return value
    }
  }
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
  return {}
}

function getPresetLabel(currentModel) {
  if (!currentModel) return "inherited"
  const lower = currentModel.toLowerCase()
  if (lower.includes("glm") || lower.includes("zai")) return "glm+gpt"
  if (lower.includes("openai/") || lower.includes("gpt")) return "gpt-only"
  return "inherited"
}

async function assertFile(path) {
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
