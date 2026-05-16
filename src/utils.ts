import { spawn } from "node:child_process";
import { stat, readFile, access, readdir } from "node:fs/promises";
import { resolve, join, dirname, isAbsolute, extname, relative } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { ProjectContext, ResolveConfig } from "./types.js";
import { normalizeResolveConfig } from "./config.js";

export const PLUGIN_VERSION = readPluginVersion();
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_CHECK_FILE = join(homedir(), ".cache", "opencode-resolve", "update-check.json");
export const PLUGIN_CACHE_DIR = join(homedir(), ".cache", "opencode", "packages", "opencode-resolve@latest");

export function runCommand(command: string, cwd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
    const proc = spawn("sh", ["-c", command], {
      cwd,
      env: { ...process.env, CI: "true", GIT_TERMINAL_PROMPT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => { proc.kill("SIGKILL") }, timeoutMs)

    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString() })
    proc.on("close", (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode: code ?? 1 })
    })
    proc.on("error", (err) => {
      clearTimeout(timer)
      resolve({ stdout: "", stderr: err.message, exitCode: 1 })
    })
    })
}

export function truncateOutput(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text
    return text.slice(0, maxLen) + `\n... (${text.length - maxLen} more bytes truncated)`
}

/** Sanitize a string for safe use as a shell argument. Strips dangerous metacharacters. */
export function sanitizeShellArg(input: string): string {
    return input
    .replace(/[;&|`$(){}[\]!#~<>\\]/g, "") // strip shell metacharacters
.replace(/'/g, "'\\''")                  // escape single quotes for single-quoted context
.slice(0, 500)
}

export function isMissingFileError(error: unknown) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}

export function formatError(error: unknown) {
    return error instanceof Error ? error.message : String(error)
}

export function classifyBashCommand(pattern: string): "allow" | "deny" | "ask" {
    const cmd = pattern.trim();
    for (const re of BANNED_COMMANDS) {
    if (re.test(cmd)) return "deny"
    }

    for (const re of DANGEROUS_BASH_PATTERNS) {
    if (re.test(cmd)) return "deny"
    }

    const firstToken = cmd.split(/\s+/)[0];
    if (ALWAYS_SAFE_COMMANDS.includes(firstToken)) return "allow"
    for (const [prefix, subcommands] of SAFE_BASH_PREFIXES) {
    if (firstToken !== prefix) continue
    // If no subcommands listed, the prefix itself is safe (e.g. npx, node)
    if (subcommands.length === 0) return "allow"
    const secondToken = cmd.split(/\s+/)[1]
    if (secondToken && subcommands.includes(secondToken)) return "allow"
    }

    return "ask"
}

export async function existsFile(path: string): Promise<boolean> {
    try {
    const s = await stat(path)
    return s.isFile()
    } catch {
    return false
    }
}

export async function existsPath(path: string): Promise<boolean> {
    try {
    await stat(path)
    return true
    } catch {
    return false
    }
}

export async function existsDirectory(path: string): Promise<boolean> {
    try {
    const s = await stat(path)
    return s.isDirectory()
    } catch {
    return false
    }
}

export async function detectProjectContext(directory: string): Promise<ProjectContext> {
    const ctx: ProjectContext = {
            knowledgeFiles: [],
            contextFiles: [],
            packageManager: undefined,
            verifyCommands: [],
            hasTypeScript: false,
            hasHarness: false,
            hasAgents: false,
          };
    const knowledgeFileCandidates = [
            "HARNESS.md",
            "AGENTS.md",
            "CLAUDE.md",
            "CONVENTIONS.md",
          ];
    for (const candidate of knowledgeFileCandidates) {
    const fullPath = join(directory, candidate)
    if (await existsFile(fullPath)) {
      ctx.knowledgeFiles.push(candidate)
      if (candidate === "HARNESS.md") ctx.hasHarness = true
      if (candidate === "AGENTS.md") ctx.hasAgents = true
    }
    }

    const knowledgeDirectoryCandidates = [
            ".opencode/context",
            ".claude/context",
            "context",
            "thoughts",
          ];
    for (const candidate of knowledgeDirectoryCandidates) {
    const fullPath = join(directory, candidate)
    if (await existsDirectory(fullPath)) {
      ctx.knowledgeFiles.push(candidate)
      ctx.contextFiles.push(...await collectContextFiles(directory, candidate))
    }
    }

    if (await existsFile(join(directory, "pnpm-lock.yaml"))) ctx.packageManager = "pnpm"
    else if (await existsFile(join(directory, "bun.lockb")) || await existsFile(join(directory, "bun.lock"))) ctx.packageManager = "bun"
    else if (await existsFile(join(directory, "yarn.lock"))) ctx.packageManager = "yarn"
    else if (await existsFile(join(directory, "package-lock.json"))) ctx.packageManager = "npm"
    ctx.hasTypeScript = await existsFile(join(directory, "tsconfig.json"))
    try {
    const pkgRaw = await readFile(join(directory, "package.json"), "utf8")
    const pkg = JSON.parse(pkgRaw)
    const scripts = typeof pkg?.scripts === "object" && pkg.scripts !== null ? pkg.scripts as Record<string, string> : {}

    if (typeof scripts["typecheck"] === "string" || typeof scripts["type-check"] === "string") {
      const cmd = scripts["typecheck"] ?? scripts["type-check"]
      ctx.verifyCommands.push(`npm run ${scripts["typecheck"] ? "typecheck" : "type-check"}`)
    } else if (ctx.hasTypeScript) {
      ctx.verifyCommands.push("npx tsc --noEmit")
    }

    if (typeof scripts["lint"] === "string") {
      ctx.verifyCommands.push("npm run lint")
    }

    if (typeof scripts["test"] === "string") {
      ctx.verifyCommands.push("npm test")
    }
    } catch {
    // no package.json or unreadable — skip
    }

    return ctx
}

export async function collectContextFiles(rootDirectory: string, relativeDirectory: string, maxFiles = 40): Promise<string[]> {
    const allowedExtensions = new Set([".md", ".mdx", ".txt", ".json", ".jsonc", ".yaml", ".yml"]);
    const results: string[] = [];
    async function walk(current: string, depth: number): Promise<void> {
    if (depth > 3 || results.length >= maxFiles) return
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (results.length >= maxFiles) break
      if (entry.name.startsWith(".")) continue
      if (entry.name === "archive") continue
      const fullPath = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (!allowedExtensions.has(extname(entry.name).toLowerCase())) continue
      results.push(relative(rootDirectory, fullPath))
    }
    }
    await walk(join(rootDirectory, relativeDirectory), 0)
    return results
}

export function readPluginVersion(): string {
    try {
    const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)))
    const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"))
    return typeof pkg?.version === "string" ? pkg.version : "unknown"
    } catch {
    return "unknown"
    }
}

export function readUpdateCheckCache(): { checkedAt: number; latest: string } | undefined {
    try {
    const raw = readFileSync(UPDATE_CHECK_FILE, "utf8")
    const parsed = JSON.parse(raw)
    if (
      typeof parsed?.checkedAt === "number" &&
      typeof parsed?.latest === "string"
    ) {
      return { checkedAt: parsed.checkedAt, latest: parsed.latest }
    }
    } catch {
    // file missing or unparseable
    }

    return undefined
}

export function isNewerVersion(candidate: string, baseline: string): boolean {
    const a = candidate.split(".").map((n) => Number.parseInt(n, 10));
    const b = baseline.split(".").map((n) => Number.parseInt(n, 10));
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = Number.isFinite(a[i]) ? (a[i] as number) : 0
    const bv = Number.isFinite(b[i]) ? (b[i] as number) : 0
    if (av > bv) return true
    if (av < bv) return false
    }

    return false
}

export async function maybeAutoUpdate(): Promise<void> {
    const previous = readUpdateCheckCache()
    try {
    if (previous && Date.now() - previous.checkedAt < UPDATE_CHECK_INTERVAL_MS) {
      if (isNewerVersion(previous.latest, PLUGIN_VERSION)) {
        refreshPluginCacheInBackground(previous.latest, "cached")
      }
      return
    }
    } catch {
    // ignore corrupt cache and re-check
    }

    let latest: string;
    try {
    const response = await fetch("https://registry.npmjs.org/opencode-resolve/latest", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return
    const data = (await response.json()) as { version?: unknown }
    if (typeof data?.version !== "string") return
    latest = data.version
    } catch {
    return
    }

    try {
    mkdirSync(dirname(UPDATE_CHECK_FILE), { recursive: true })
    writeFileSync(UPDATE_CHECK_FILE, JSON.stringify({ checkedAt: Date.now(), latest }))
    } catch {
    // best-effort; don't block on cache write failure
    }

    if (!isNewerVersion(latest, PLUGIN_VERSION)) return
    refreshPluginCacheInBackground(latest, "registry")
}

function refreshPluginCacheInBackground(latest: string, source: "cached" | "registry"): void {
    const sourceLabel = source === "cached" ? "cached latest" : "registry latest"
    console.log(
    `[opencode-resolve] new version v${latest} available (${sourceLabel}, current: v${PLUGIN_VERSION}) — refreshing OpenCode plugin cache in background. Restart OpenCode to activate it.`,
    )
    try {
    spawn(
      "sh",
      ["-c", `rm -rf "${PLUGIN_CACHE_DIR}" && opencode plugin opencode-resolve@latest --global --force`],
      {
        detached: true,
        stdio: "ignore",
        env: {
          ...process.env,
          OPENCODE_RESOLVE_REFRESHING_CACHE: "1",
          OPENCODE_RESOLVE_SKIP_POSTINSTALL: "1",
          OPENCODE_RESOLVE_SKIP_COMPANIONS: "1",
        },
      },
    ).unref()
    } catch {
    // If spawn fails, the user already saw the notice and can run the command manually.
    }
}

export async function readFirstJson(paths: string[]): Promise<ResolveConfig | undefined> {
    for (const path of paths) {
    try {
      await access(path)
      return normalizeResolveConfig(JSON.parse(await readFile(path, "utf8")), path)
    } catch (error) {
      if (isMissingFileError(error)) continue
      throw new Error(`Failed to read OpenCode Resolve config at ${path}: ${formatError(error)}`)
    }
    }

    return undefined
}

export const BANNED_COMMANDS: ReadonlyArray<RegExp> = [
      /\b(vim?|nano|emacs|pico|ed)\b/,           // interactive editors
      /\b(less|more|most|pg)\b/,                   // pagers
      /\bman\s/,                                   // man pages
      /\b(python|python3|ipython)\b(\s*$)/,       // Python REPL
      /\b(node|bun|deno)\b(\s*$)/,                // JS REPL
      /\b(irb|ghci|scala|jshell)\b(\s*$)/,        // other REPLs
      /\b(bash|zsh|fish|sh)\s+-i\b/,              // interactive shells
      /\bgit\s+add\s+-p\b/,                        // interactive git add
      /\bgit\s+add\s+(\.|-A|--all)(\s|$)/,          // broad staging can capture unrelated files
      /\bgit\s+rebase\s+-i\b/,                     // interactive rebase
      /\bgit\s+commit\b(?!\s+-m)/,                 // commit without -m
      /\bscreen\b/,                                 // screen multiplexer
      /\btmux\b(?!.*[|&;])/,                       // tmux without subcommand pipe
      /\bssh\b(?!\s.*-\w*[oN])/,                   // ssh without batch flags
      /\bsftp\b/,                                   // sftp interactive
      /\btelnet\b/,                                 // telnet interactive
      /\bnc\b(\s*$)/,                              // netcat interactive
      /\bsqlite3?\b(\s*$)/,                        // sqlite interactive
      /\bpsql\b(\s*$)/,                            // psql interactive
      /\bmysql\b(\s*$)/,                           // mysql interactive
      // Ralph Loop: dangerous patterns that waste tokens or cause damage
      /\bcurl\b.*\|\s*(ba)?sh\b/,                  // curl pipe to shell
      /\bwget\b.*\|\s*(ba)?sh\b/,                  // wget pipe to shell
      /\beval\s/,                                  // eval is dangerous
      /\bchmod\s+(-R\s+)?777\b/,                   // chmod 777
      /\bchown\s+-R\s+/,                           // recursive chown
      /\bsudo\s+(rm|chmod|chown|dd|mkfs)/,         // sudo + destructive
      /\bgit\s+push\s+--force/,                    // force push
      /\bgit\s+reset\s+--hard/,                    // hard reset
      /\brm\s+(-rf?|-fr?)\s+[^.]/,                // rm -rf (not dotfiles)
      /\bdd\s+if=/,                                 // dd can destroy disks
      /\b(mkfs|format)\b/,                          // filesystem format
    ];
export const DANGEROUS_BASH_PATTERNS: ReadonlyArray<RegExp> = [
      /\brm\s+.*-[rR].*[fF].*\s+\//,          // rm -rf /... (absolute path)
      /\bgit\s+push\s+.*(--force|-f\b)/,       // force push
      /\bgit\s+reset\s+--hard/,                // hard reset
      /\bgit\s+clean\s+-fd/,                   // clean untracked files
      /\bsudo\s+rm\b/,                         // sudo rm
      /\bdd\s+.*of=\/dev\//,                   // dd to device
      /\bchmod\s+-R\s+777\s+\//,              // chmod everything
      /\b(DROP|TRUNCATE)\s/i,                  // SQL destructive
    ];
export const ALWAYS_SAFE_COMMANDS: ReadonlyArray<string> = [
      "ls", "cat", "head", "tail", "wc", "which", "echo", "pwd", "env",
      "printenv", "whoami", "uname", "date", "df", "du", "free", "top",
      "ps", "grep", "find", "sort", "uniq", "diff", "file", "stat",
      "touch", "mkdir", "cp", "mv", "sed", "awk", "tr", "cut", "xargs",
      "curl", "wget", "dig", "nslookup", "ping",
    ];
export const SAFE_BASH_PREFIXES: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
      ["npm",      ["test", "run", "start", "build", "lint", "typecheck", "check", "info", "list", "view", "outdated", "audit", "pack"]],
      ["npx",      []],
      ["node",     []],
      ["bun",      ["test", "run", "build", "install", "add", "remove"]],
      ["yarn",     ["test", "run", "build", "install", "add", "remove", "lint", "typecheck"]],
      ["pnpm",     ["test", "run", "build", "install", "add", "remove", "lint", "typecheck"]],
      ["git",      ["status", "log", "diff", "branch", "show", "remote", "stash", "tag", "describe"]],
      ["tsc",      []],
      ["eslint",   []],
      ["prettier", []],
      ["jest",     []],
      ["vitest",   []],
      ["pytest",   []],
      ["cargo",    ["test", "check", "build", "clippy", "fmt"]],
      ["make",     ["test", "check", "build", "lint", "clean"]],
    ];
