import { constants } from "node:fs"
import { access, copyFile, mkdir, symlink, unlink } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const pluginTarget = join(root, "dist", "index.js")
const configDir = join(homedir(), ".config", "opencode")
const pluginLink = join(configDir, "plugins", "opencode-resolve.js")
const resolveConfig = join(configDir, "resolve.json")
const exampleConfig = join(root, "opencode-resolve.example.json")

await assertFile(pluginTarget)
await mkdir(dirname(pluginLink), { recursive: true })

try {
  await unlink(pluginLink)
} catch (error) {
  if (!isMissingFileError(error)) throw error
}

await symlink(pluginTarget, pluginLink)

if (!(await exists(resolveConfig))) {
  await copyFile(exampleConfig, resolveConfig)
}

console.log(`Linked plugin: ${pluginLink} -> ${pluginTarget}`)
console.log(`Resolve config: ${resolveConfig}`)

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
