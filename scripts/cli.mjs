#!/usr/bin/env node
import { spawn } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const postinstall = join(root, "scripts", "postinstall.mjs")
const args = process.argv.slice(2)
const command = args[0] && !args[0].startsWith("-") ? args.shift() : "setup"

if (command === "help" || args.includes("--help") || args.includes("-h")) {
  printHelp()
  process.exit(0)
}

if (command !== "setup") {
  console.error(`Unknown command: ${command}`)
  printHelp()
  process.exit(1)
}

const env = { ...process.env }
if (args.includes("--fresh")) env.OPENCODE_RESOLVE_REINSTALL = "fresh"
if (args.includes("--reset-config")) {
  env.OPENCODE_RESOLVE_REINSTALL = "fresh"
  env.OPENCODE_RESOLVE_RESET_MODELS = "1"
}
if (args.includes("--update")) env.OPENCODE_RESOLVE_REINSTALL = "update"
if (args.includes("--models") || args.includes("--configure-models")) env.OPENCODE_RESOLVE_CONFIGURE_MODELS = "1"
if (args.includes("--auto-preset")) env.OPENCODE_RESOLVE_AUTO_PRESET = "1"
if (args.includes("--no-companions")) env.OPENCODE_RESOLVE_SKIP_COMPANIONS = "1"
if (args.includes("--force-cache") || args.includes("--refresh-cache")) env.OPENCODE_RESOLVE_FORCE_CACHE_REFRESH = "1"

const child = spawn(process.execPath, [postinstall], {
  stdio: "inherit",
  env,
})

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})

child.on("error", (error) => {
  console.error(error.message)
  process.exit(1)
})

function printHelp() {
  console.log(`opencode-resolve

Usage:
  opencode-resolve setup [--fresh|--update|--reset-config] [--models] [--auto-preset] [--force-cache] [--no-companions]

Commands:
  setup    Register the OpenCode plugin, create or migrate resolve.json, and refresh stale plugin cache.

Options:
  --fresh          Back up existing resolve.json and run setup again, preserving existing model pins.
  --update         Preserve existing resolve.json and add missing defaults.
  --reset-config   Back up existing resolve.json and regenerate it, including model pins.
  --models         Reconfigure model pins without replacing the rest of resolve.json.
  --auto-preset    Non-interactive provider-based model preset.
  --force-cache    Force OpenCode plugin cache refresh without deleting resolve.json.
  --no-companions  Skip companion plugin suggestions.

Examples:
  opencode-resolve setup --fresh
  opencode-resolve setup --update
  opencode-resolve setup --force-cache
`)
}
