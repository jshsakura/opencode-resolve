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

// ZAI MCP servers that boost GLM capabilities (vision, web search, GitHub, URL reading)
// Only injected when GLM is detected — GLM users already have Z_AI_API_KEY
const ZAI_MCP_SERVERS = {
  "zai-mcp-server": {
    type: "local",
    command: ["npx", "-y", "@z_ai/mcp-server"],
    environment: {
      Z_AI_MODE: "ZAI",
    },
  },
  "web-search-prime": {
    type: "remote",
    url: "https://api.z.ai/api/mcp/web_search_prime/mcp",
  },
  "web-reader": {
    type: "remote",
    url: "https://api.z.ai/api/mcp/web_reader/mcp",
  },
  zread: {
    type: "remote",
    url: "https://api.z.ai/api/mcp/zread/mcp",
  },
}

// Read ZAI API key from OpenCode's auth store (~/.local/share/opencode/auth.json)
// OpenCode stores provider credentials here when user sets up a provider
async function readZAIApiKey() {
  const dataDir = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share")
  const authPath = join(dataDir, "opencode", "auth.json")
  try {
    const raw = await readFile(authPath, "utf8")
    const auth = JSON.parse(raw)
    // Look for ZAI provider entries: "zai", "zai-coding-plan", or any key starting with "zai"
    for (const [providerId, entry] of Object.entries(auth)) {
      if (
        (providerId === "zai" || providerId.startsWith("zai")) &&
        isObject(entry) &&
        entry.type === "api" &&
        typeof entry.key === "string" &&
        entry.key.length > 0
      ) {
        return entry.key
      }
    }
  } catch {
    // auth.json doesn't exist or isn't readable — fall back to env var
  }
  return process.env.Z_AI_API_KEY || null
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
  const preset = buildModelPreset(currentModel)

  const resolveConfig = { ...example }

  // Profile selection based on detected providers
  const hasGLM = allModels.some((m) => isGLMModel(m))
  const hasGPT = allModels.some((m) => isGPTModel(m))

  if (hasGLM && !hasGPT) {
    // GLM only → GLM profile, silver tier (token-efficient, no deep-reviewer)
    resolveConfig.profile = "glm"
    resolveConfig.tier = "silver"
  } else if (hasGPT && !hasGLM) {
    // GPT only → GPT profile, gold tier (full power)
    resolveConfig.profile = "gpt"
    resolveConfig.tier = "gold"
  }
  // Both GLM + GPT → no profile (mixed, default recommendation)

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

  // GLM / ZAI — GLM-only preset (no GPT dependency, avoids token-exhaustion errors)
  if (lower.includes("glm") || lower.includes("zai")) {
    return {
      glm: "zai-coding-plan/glm-5.1",
      fast: "glm",
      strong: "glm",
      coder: "glm",
      resolver: "glm",
      reviewer: "glm",
      "deep-reviewer": "glm",
      explorer: "fast",
      planner: "glm",
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
    for (const providerConfig of Object.values(config.provider)) {
      if (isObject(providerConfig) && isObject(providerConfig.models)) {
        for (const modelEntry of Object.values(providerConfig.models)) {
          if (typeof modelEntry === "string") models.add(modelEntry)
          else if (isObject(modelEntry) && typeof modelEntry.id === "string") models.add(modelEntry.id)
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

  const apiKey = await readZAIApiKey()
  if (!apiKey) {
    console.warn(`[${packageName}] GLM detected but no ZAI API key found in auth.json or env — MCP servers may not work`)
    console.warn(`[${packageName}] Set up the ZAI provider in OpenCode first, or set Z_AI_API_KEY in your environment`)
    return false
  }

  // Build MCP configs with the actual API key
  const zaiMcpWithKey = {
    "zai-mcp-server": {
      type: "local",
      command: ["npx", "-y", "@z_ai/mcp-server"],
      environment: {
        Z_AI_API_KEY: apiKey,
        Z_AI_MODE: "ZAI",
      },
    },
    "web-search-prime": {
      type: "remote",
      url: "https://api.z.ai/api/mcp/web_search_prime/mcp",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
    "web-reader": {
      type: "remote",
      url: "https://api.z.ai/api/mcp/web_reader/mcp",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
    zread: {
      type: "remote",
      url: "https://api.z.ai/api/mcp/zread/mcp",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
  }

  const added = []
  for (const [name, mcpConfig] of Object.entries(zaiMcpWithKey)) {
    if (config.mcp[name] === undefined) {
      config.mcp[name] = mcpConfig
      added.push(name)
    }
  }

  if (added.length > 0) {
    console.log(`[${packageName}] injected ZAI MCP servers: ${added.join(", ")}`)
    return true
  }

  console.log(`[${packageName}] ZAI MCP servers already present — skipping`)
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
