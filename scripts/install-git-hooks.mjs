#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const hooksDir = join(root, ".githooks")

if (!existsSync(join(root, ".git"))) {
  console.error("[opencode-resolve] not a git checkout; cannot install hooks")
  process.exit(1)
}

for (const hook of ["pre-commit", "pre-push"]) {
  chmodSync(join(hooksDir, hook), 0o755)
}

const result = spawnSync("git", ["config", "core.hooksPath", ".githooks"], {
  cwd: root,
  stdio: "inherit",
})

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

console.log("[opencode-resolve] git hooks installed: core.hooksPath=.githooks")
