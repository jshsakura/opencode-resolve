// Tests for the structured file logger (src/log.ts) and the narrate() → logger
// wiring. The logger is the plugin's primary visibility channel: it replaced
// the no-op narrate() so users can finally see what the plugin is doing via
// `tail -f .opencode/resolve.log`.

// Same hard guards as the other test files — block network + silence stderr.
process.env.OPENCODE_RESOLVE_NO_AUTO_UPDATE = "1"
process.env.OPENCODE_RESOLVE_SKIP_POSTINSTALL = "1"
process.env.OPENCODE_RESOLVE_SKIP_CACHE_REFRESH = "1"
process.env.OPENCODE_RESOLVE_QUIET = "1"

globalThis.fetch = async (input) => {
  throw new Error(`[test guard] network blocked in tests (fetch ${String(input)})`)
}

import assert from "node:assert/strict"
import test from "node:test"
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createResolveLogger } from "../dist/log.js"
import { narrate } from "../dist/messages.js"

// Logger writes are async (appendFile). Wait one tick + a small grace so the
// file is flushed before assertions read it. `.unref()` keeps tests from
// hanging the process on exit.
const flush = (ms = 60) => new Promise((r) => {
  const h = setTimeout(r, ms)
  if (typeof h.unref === "function") h.unref()
})

// Each test gets its own temp directory so log files never collide.
function withTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "opencode-resolve-log-"))
  return dir
}

test("createResolveLogger: writes a structured line to <dir>/.opencode/resolve.log", async () => {
  const dir = withTempDir()
  try {
    const logger = createResolveLogger(dir)
    assert.equal(logger.path, join(dir, ".opencode", "resolve.log"))
    logger.log("info", "plugin.loaded", { version: "9.9.9", directory: dir })
    await flush()
    assert.ok(existsSync(logger.path), "log file should be created lazily")
    const content = readFileSync(logger.path, "utf8")
    assert.match(content, /plugin\.loaded/, "event name is recorded")
    assert.match(content, /INFO/, "level is recorded")
    assert.match(content, /9\.9\.9/, "detail object is JSON-serialized")
    assert.match(content, /\n$/, "each line is newline-terminated")
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
})

test("createResolveLogger: string detail is appended after an em dash", async () => {
  const dir = withTempDir()
  try {
    const logger = createResolveLogger(dir)
    logger.log("info", "narrate.narration.editing", "[resolver] editing the file")
    await flush()
    const line = readFileSync(logger.path, "utf8").trimEnd()
    assert.match(line, /narrate\.narration\.editing — \[resolver\] editing the file$/)
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
})

test("createResolveLogger: OPENCODE_RESOLVE_LOG_FILE overrides the path", async () => {
  const dir = withTempDir()
  const custom = join(dir, "custom.log")
  const saved = process.env.OPENCODE_RESOLVE_LOG_FILE
  process.env.OPENCODE_RESOLVE_LOG_FILE = custom
  try {
    const logger = createResolveLogger(dir)
    assert.equal(logger.path, custom)
    logger.log("warn", "permission.denied", { cmd: "rm -rf" })
    await flush()
    assert.ok(existsSync(custom), "custom path is used")
    assert.ok(!existsSync(join(dir, ".opencode", "resolve.log")), "default path is not created")
  } finally {
    if (saved === undefined) delete process.env.OPENCODE_RESOLVE_LOG_FILE
    else process.env.OPENCODE_RESOLVE_LOG_FILE = saved
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
})

test("createResolveLogger: OPENCODE_RESOLVE_LOG=0 disables file writes", async () => {
  const dir = withTempDir()
  const saved = process.env.OPENCODE_RESOLVE_LOG
  process.env.OPENCODE_RESOLVE_LOG = "0"
  try {
    const logger = createResolveLogger(dir)
    logger.log("error", "should.not.write", "nope")
    await flush()
    assert.ok(!existsSync(logger.path), "no file when logging is disabled")
  } finally {
    if (saved === undefined) delete process.env.OPENCODE_RESOLVE_LOG
    else process.env.OPENCODE_RESOLVE_LOG = saved
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
})

test("createResolveLogger: default level filters out debug", async () => {
  const dir = withTempDir()
  try {
    const logger = createResolveLogger(dir)
    logger.log("debug", "debug.event", "filtered")
    logger.log("info", "info.event", "kept")
    await flush()
    const content = readFileSync(logger.path, "utf8")
    assert.ok(!/debug\.event/.test(content), "debug is below the default info floor")
    assert.match(content, /info\.event/, "info is recorded")
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
})

test("createResolveLogger: OPENCODE_RESOLVE_DEBUG=1 lowers the floor to debug", async () => {
  const dir = withTempDir()
  const savedDebug = process.env.OPENCODE_RESOLVE_DEBUG
  process.env.OPENCODE_RESOLVE_DEBUG = "1"
  try {
    const logger = createResolveLogger(dir)
    logger.log("debug", "debug.event", "now visible")
    await flush()
    const content = readFileSync(logger.path, "utf8")
    assert.match(content, /debug\.event/, "debug is recorded under DEBUG=1")
  } finally {
    if (savedDebug === undefined) delete process.env.OPENCODE_RESOLVE_DEBUG
    else process.env.OPENCODE_RESOLVE_DEBUG = savedDebug
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
})

test("createResolveLogger: never throws when the path is unwritable", async () => {
  // Point the logger at a path whose parent is a regular file (mkdir/append fail).
  const dir = withTempDir()
  const blockingFile = join(dir, "blocker")
  writeFileSync(blockingFile, "x") // a file, not a directory
  const custom = join(blockingFile, "nested", "resolve.log") // parent is a file → ENOTDIR
  const saved = process.env.OPENCODE_RESOLVE_LOG_FILE
  process.env.OPENCODE_RESOLVE_LOG_FILE = custom
  try {
    const logger = createResolveLogger(dir)
    assert.doesNotThrow(() => {
      logger.log("error", "anything", "logging must not throw")
      logger.log("info", "more", { x: 1 })
    })
    await flush()
    // No assertion on the file — the point is the calls did not throw.
  } finally {
    if (saved === undefined) delete process.env.OPENCODE_RESOLVE_LOG_FILE
    else process.env.OPENCODE_RESOLVE_LOG_FILE = saved
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
})

test("createResolveLogger: rotates to .1 past 2MB", async () => {
  const dir = withTempDir()
  try {
    const logger = createResolveLogger(dir)
    // Pre-seed the log file just over the 2MB threshold so the next write rotates.
    mkdirSync(join(dir, ".opencode"), { recursive: true })
    const seed = "x".repeat(2_000_100)
    writeFileSync(logger.path, seed)
    logger.log("info", "after.rotate", "trigger")
    await flush(120)
    assert.ok(existsSync(`${logger.path}.1`), "rotated backup (.1) should exist")
    const rotated = readFileSync(`${logger.path}.1`, "utf8")
    assert.equal(rotated, seed, "the old content moves to .1 verbatim")
    const fresh = readFileSync(logger.path, "utf8")
    assert.match(fresh, /after\.rotate/, "new content is written to the fresh log")
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
})

test("narrate: with a logger writes the rendered role-play line to the file", async () => {
  const dir = withTempDir()
  try {
    const logger = createResolveLogger(dir)
    narrate(
      { locale: "en", currentAgent: "resolver", logger },
      "narration.editing",
    )
    await flush()
    const content = readFileSync(logger.path, "utf8")
    assert.match(content, /narrate\.narration\.editing/, "event is keyed off the message key")
    assert.match(content, /\[resolver\]/, "brand prefix uses the current agent")
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
})

test("narrate: Korean locale renders the Korean variant", async () => {
  const dir = withTempDir()
  try {
    const logger = createResolveLogger(dir)
    narrate(
      { locale: "ko", currentAgent: "coder", logger },
      "narration.editing",
    )
    await flush()
    const content = readFileSync(logger.path, "utf8")
    assert.match(content, /\[coder\]/, "brand prefix uses the current agent")
    // Korean narration.editing message exists in MESSAGES.ko; the line must be
    // non-empty after the brand prefix.
    assert.ok(/narrate\.narration\.editing — \[coder\] .+/.test(content), "Korean text is rendered")
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
})

test("narrate: without a logger is silent and does not throw", () => {
  assert.doesNotThrow(() => {
    narrate({ locale: "en", currentAgent: "resolver" }, "narration.editing")
  })
})
