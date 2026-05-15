import { constants } from "node:fs"
import { access, mkdir, readFile, symlink, unlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { createInterface } from "node:readline/promises"
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
} else {
  await handleExistingResolveConfig()
}

console.log(`Linked plugin: ${pluginLink} -> ${pluginTarget}`)
console.log(`Resolve config: ${resolveConfigPath}`)

async function handleExistingResolveConfig() {
  const action = await chooseExistingResolveConfigAction()
  if (action !== "fresh") {
    console.log(`Existing resolve config preserved: ${resolveConfigPath}`)
    return
  }

  await backupResolveConfig()
  await createAdaptiveResolveConfig()
}

async function chooseExistingResolveConfigAction() {
  const requested = (process.env.OPENCODE_RESOLVE_REINSTALL ?? "").trim().toLowerCase()
  if (["fresh", "reset", "recreate", "new"].includes(requested)) return "fresh"
  if (["update", "keep", "migrate", "preserve"].includes(requested)) return "update"
  if (requested) {
    console.warn(`Ignoring unknown OPENCODE_RESOLVE_REINSTALL=${JSON.stringify(requested)}; use "fresh" or "update".`)
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log(`Existing resolve config found; preserving it. Set OPENCODE_RESOLVE_REINSTALL=fresh for a fresh reinstall.`)
    return "update"
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    console.log("")
    console.log(`Existing resolve config found: ${resolveConfigPath}`)
    console.log("  1. update existing config — preserve your settings")
    console.log("  2. fresh reinstall — back up resolve.json and create a new config")
    const raw = await rl.question("Existing config [1=update, 2=fresh reinstall, default 1]: ")
    return raw.trim() === "2" ? "fresh" : "update"
  } finally {
    rl.close()
  }
}

async function backupResolveConfig() {
  const raw = await readFile(resolveConfigPath, "utf8")
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const backupPath = `${resolveConfigPath}.bak.${stamp}`
  await writeFile(backupPath, raw)
  console.log(`Backed up existing resolve config to ${backupPath}`)
}

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

  const resolveConfig = { ...example }
  let preset = {}
  if (process.env.OPENCODE_RESOLVE_AUTO_PRESET === "1") {
    const currentModel = detectOpenCodeModel(opencodeConfig)
    preset = buildModelPreset(currentModel)
  } else {
    resolveConfig.profile = "mix"
    resolveConfig.models = {}
    resolveConfig.agents = {
      ...resolveConfig.agents,
      gpt: { ...(resolveConfig.agents?.gpt ?? {}), enabled: true },
      glm: { ...(resolveConfig.agents?.glm ?? {}), enabled: true },
    }
  }
  if (preset && Object.keys(preset).length > 0) {
    resolveConfig.models = preset
  }

  await mkdir(configDir, { recursive: true })
  await writeFile(resolveConfigPath, `${JSON.stringify(resolveConfig, null, 2)}\n`)

  const label = process.env.OPENCODE_RESOLVE_AUTO_PRESET === "1"
    ? getPresetLabel(detectOpenCodeModel(opencodeConfig))
    : "prompt-required"
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
