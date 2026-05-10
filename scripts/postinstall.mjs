import { constants } from "node:fs"
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageName = "opencode-resolve"
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const configDir = process.env.OPENCODE_CONFIG_HOME || join(homedir(), ".config", "opencode")
const opencodeConfigPath = join(configDir, "opencode.json")
const resolveConfigPath = join(configDir, "resolve.json")
const exampleConfigPath = join(root, "opencode-resolve.example.json")

if (process.env.OPENCODE_RESOLVE_SKIP_POSTINSTALL === "1") {
  process.exit(0)
}

try {
  await registerPlugin()
} catch (error) {
  console.warn(`[${packageName}] automatic OpenCode registration skipped: ${formatError(error)}`)
  console.warn(`[${packageName}] add "${packageName}" to your OpenCode plugin list manually if needed.`)
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
    await assertReadable(exampleConfigPath)
    await copyFile(exampleConfigPath, resolveConfigPath)
    console.log(`[${packageName}] created ${resolveConfigPath}`)
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
