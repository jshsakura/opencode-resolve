import { tool } from "@opencode-ai/plugin";
import { stat, readFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { classifyBashCommand, runCommand, sanitizeShellArg, truncateOutput } from "../utils.js";
import { SessionState, DIAGNOSTICS_TTL_MS } from "../state.js";
import { VALID_PROFILES, VALID_TIERS, VALID_AGENT_NAME_SET, VALID_AGENT_NAMES } from "../agents.js";

const WRITE_CAPABLE_AGENTS = new Set(["resolver", "coder", "glm", "gpt-coder", "debugger"]);

function canWriteFromTool(ctx: { agent?: string }): boolean {
  return typeof ctx.agent !== "string" || WRITE_CAPABLE_AGENTS.has(ctx.agent)
}

function readOnlyToolWriteDenied(ctx: { agent?: string }, action: string): string {
  return `Permission denied: agent '${ctx.agent ?? "unknown"}' is read-only and cannot ${action}. Dispatch resolver/coder for workspace writes.`
}

function commandExecutionDenied(command: string): string | undefined {
  const action = classifyBashCommand(command)
  if (action === "allow") return undefined
  if (action === "deny") {
    return `Command denied by opencode-resolve safety policy: ${command}`
  }
  return `Command is not allowlisted for direct tool execution: ${command}. Run it through OpenCode bash so the normal permission flow can decide.`
}

export function getTools(sessionState: SessionState) {
  return {
      "resolve-verify": tool({
        description: "Run project verification commands (typecheck, lint, test) and return results. Use after editing files to confirm correctness.",
        args: {
          command: tool.schema.string().optional().describe("Specific verify command to run. If omitted, runs the first detected verify command (e.g. typecheck or lint)."),
        },
        async execute(args, ctx) {
          const projCtx = sessionState.storedProjectContext
          if (!projCtx || projCtx.verifyCommands.length === 0) {
            return "No verify commands detected for this project. Add typecheck/lint/test scripts to package.json."
          }
          const cmd = args.command ?? projCtx.verifyCommands[0]
          const denied = commandExecutionDenied(cmd)
          if (denied) return denied
          try {
            const result = await runCommand(cmd, ctx.directory, 30_000)
            ctx.metadata({ title: `verify: ${cmd}` })
            if (result.exitCode === 0) {
              return { output: `✅ ${cmd} passed.\n${truncateOutput(result.stdout, 500)}`, metadata: { exitCode: 0 } }
            }
            return { output: `❌ ${cmd} failed (exit ${result.exitCode}).\n${truncateOutput(result.stderr || result.stdout, 1000)}`, metadata: { exitCode: result.exitCode } }
          } catch (err) {
            return `⚠️ Failed to run '${cmd}': ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      "resolve-diagnostics": tool({
        description: "Get current LSP diagnostics snapshot. Returns errors and warnings per file from the language server.",
        args: {
          path: tool.schema.string().optional().describe("Specific file path to check. If omitted, returns all files with active diagnostics."),
        },
        async execute(args) {
          if (sessionState.recentDiagnostics.size === 0) {
            return "No active LSP diagnostics."
          }
          const now = Date.now()
          const entries: string[] = []
          for (const [filePath, diag] of sessionState.recentDiagnostics) {
            if (now - diag.timestamp > DIAGNOSTICS_TTL_MS) continue
            if (args.path && filePath !== args.path) continue
            entries.push(`${filePath}: ${diag.errors} errors, ${diag.warnings} warnings`)
          }
          if (entries.length === 0) {
            return args.path ? `No active diagnostics for ${args.path}.` : "No active LSP diagnostics."
          }
          return entries.join("\n")
        },
      }),

      "resolve-context": tool({
        description: "Get detected project context: knowledge files, verify commands, package manager, TypeScript status.",
        args: {},
        async execute() {
          const ctx = sessionState.storedProjectContext
          if (!ctx) return "No project context detected."
          const lines: string[] = []
          if (ctx.knowledgeFiles.length > 0) lines.push(`Knowledge files: ${ctx.knowledgeFiles.join(", ")}`)
          if (ctx.contextFiles.length > 0) lines.push(`Context docs: ${ctx.contextFiles.join(", ")}`)
          if (ctx.verifyCommands.length > 0) lines.push(`Verify commands: ${ctx.verifyCommands.join("; ")}`)
          if (ctx.packageManager) lines.push(`Package manager: ${ctx.packageManager}`)
          if (ctx.hasTypeScript) lines.push("TypeScript: yes")
          if (ctx.hasHarness) lines.push("HARNESS.md: present")
          if (ctx.hasAgents) lines.push("AGENTS.md: present")
          return lines.length > 0 ? lines.join("\n") : "Empty project — no context detected."
        },
      }),

      "resolve-git-status": tool({
        description: "Get git status summary: branch, staged/unstaged/untracked file counts, and short diff stat.",
        args: {},
        async execute(_args, ctx) {
          try {
            const branch = await runCommand("git rev-parse --abbrev-ref HEAD", ctx.directory, 5_000)
            const status = await runCommand("git status --porcelain", ctx.directory, 5_000)
            const diffStat = await runCommand("git diff --stat", ctx.directory, 5_000)
            const lines = [
              `Branch: ${branch.stdout.trim()}`,
              `Changed files: ${status.stdout.trim().split("\n").filter(Boolean).length}`,
            ]
            if (diffStat.stdout.trim()) {
              lines.push(`Diff:\n${truncateOutput(diffStat.stdout, 500)}`)
            }
            return lines.join("\n")
          } catch {
            return "Not a git repository or git unavailable."
          }
        },
      }),

      "resolve-deps": tool({
        description: "List dependencies and devDependencies from package.json with version info.",
        args: {
          dev: tool.schema.boolean().optional().describe("If true, show devDependencies only. If false/omitted, show dependencies."),
        },
        async execute(args, ctx) {
          try {
            const pkgRaw = await readFile(join(ctx.directory, "package.json"), "utf8")
            const pkg = JSON.parse(pkgRaw)
            const section = args.dev ? pkg.devDependencies : pkg.dependencies
            if (!section || Object.keys(section).length === 0) {
              return args.dev ? "No devDependencies found." : "No dependencies found."
            }
            return Object.entries(section as Record<string, string>).map(([name, ver]) => `${name}: ${ver}`).join("\n")
          } catch {
            return "No package.json found or unreadable."
          }
        },
      }),

      "resolve-search": tool({
        description: "Search codebase with ripgrep. Returns matching file paths, line numbers, and content. Faster and more targeted than grep tool.",
        args: {
          query: tool.schema.string().describe("Search pattern (regex supported)."),
          glob: tool.schema.string().optional().describe("File glob filter (e.g. '*.ts', '*.{ts,tsx}')."),
          max_results: tool.schema.number().optional().describe("Max results to return (default 30)."),
        },
        async execute(args, ctx) {
          const maxResults = Math.min(args.max_results ?? 30, 100)
          let cmd = `rg --no-heading --line-number --max-count ${maxResults} --color never`
          if (args.glob) cmd += ` --glob '${sanitizeShellArg(args.glob)}'`
          cmd += ` '${sanitizeShellArg(args.query)}' .`
          try {
            const result = await runCommand(cmd, ctx.directory, 15_000)
            if (result.exitCode === 1) return "No matches found."
            if (result.exitCode !== 0) return `Search error: ${truncateOutput(result.stderr, 300)}`
            const lines = result.stdout.trim().split("\n").slice(0, maxResults)
            ctx.metadata({ title: `search: ${args.query} (${lines.length} results)` })
            return truncateOutput(lines.join("\n"), 3000)
          } catch (err) {
            return `Search failed: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      "resolve-test": tool({
        description: "Run specific test file(s) or test pattern. Detects test runner from project context (npm/yarn/pnpm/bun).",
        args: {
          file: tool.schema.string().optional().describe("Test file path or glob pattern (e.g. 'test/plugin.test.mjs')."),
          pattern: tool.schema.string().optional().describe("Test name pattern to filter (e.g. 'GLM profile')."),
          runner: tool.schema.string().optional().describe("Override test runner command (e.g. 'vitest run', 'jest')."),
        },
        async execute(args, ctx) {
          const projCtx = sessionState.storedProjectContext
          // Determine test command
          let testCmd = args.runner
          if (!testCmd) {
            // Find test runner from verify commands or package manager
            const testVerify = projCtx?.verifyCommands.find(c => /\btest\b/.test(c))
            if (testVerify) {
              testCmd = testVerify
            } else {
              const pm = projCtx?.packageManager ?? "npm"
              testCmd = `${pm} test`
            }
          }
          // Append file filter
          if (args.file) testCmd += ` '${sanitizeShellArg(args.file)}'`
          // Append pattern filter
          if (args.pattern) {
            const safePattern = sanitizeShellArg(args.pattern)
            if (testCmd.includes("vitest")) testCmd += ` -t '${safePattern}'`
            else if (testCmd.includes("jest")) testCmd += ` -t '${safePattern}'`
            else testCmd += ` --grep '${safePattern}'`
          }
          const denied = commandExecutionDenied(testCmd)
          if (denied) return denied
          try {
            const result = await runCommand(testCmd, ctx.directory, 60_000)
            ctx.metadata({ title: `test: ${args.file ?? "all"}${args.pattern ? ` /${args.pattern}/` : ""}` })
            if (result.exitCode === 0) {
              return { output: `✅ Tests passed.\n${truncateOutput(result.stdout, 800)}`, metadata: { exitCode: 0 } }
            }
            return { output: `❌ Tests failed (exit ${result.exitCode}).\n${truncateOutput(result.stderr || result.stdout, 1500)}`, metadata: { exitCode: result.exitCode } }
          } catch (err) {
            return `⚠️ Test runner failed: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      "resolve-pattern": tool({
        description: "Detect code anti-patterns in specified files. Scans for: 'as any', '@ts-ignore', '@ts-nocheck', empty catch blocks, console.log, TODO/FIXME, and large functions.",
        args: {
          paths: tool.schema.string().optional().describe("File or directory paths to scan (space-separated). Defaults to 'src/'."),
          checks: tool.schema.array(tool.schema.string()).optional().describe("Specific checks to run: 'as-any', 'ts-ignore', 'empty-catch', 'console-log', 'todo', 'large-functions'. Default: all."),
        },
        async execute(args, ctx) {
          const targets = args.paths ?? "src/"
          const safeTargets = targets.split(" ").map(t => `'${sanitizeShellArg(t)}'`).join(" ")
          const allChecks = ["as-any", "ts-ignore", "empty-catch", "console-log", "todo", "large-functions"] as const
          const checks = (args.checks?.length ? args.checks : allChecks) as string[]
          const patterns: Record<string, { regex: string; label: string }> = {
            "as-any": { regex: "\\bas\\s+any\\b", label: "as any" },
            "ts-ignore": { regex: "@ts-(?:ignore|nocheck|expect-error)", label: "@ts-ignore/@ts-nocheck" },
            "empty-catch": { regex: "catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}", label: "empty catch" },
            "console-log": { regex: "console\\.log\\(", label: "console.log" },
            "todo": { regex: "\\b(?:TODO|FIXME|HACK|XXX)\\b", label: "TODO/FIXME" },
          }
          const results: string[] = []
          for (const check of checks) {
            if (check === "large-functions") {
              // Find files over 300 lines
              try {
                const wc = await runCommand(`find ${safeTargets} -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' | head -50 | xargs wc -l 2>/dev/null | sort -rn | head -20`, ctx.directory, 10_000)
                if (wc.exitCode === 0) {
                  const bigFiles = wc.stdout.trim().split("\n").filter(l => {
                    const num = parseInt(l.trim())
                    return !isNaN(num) && num > 300
                  })
                  if (bigFiles.length > 0) results.push(`Large files (>300 lines):\n${bigFiles.join("\n")}`)
                }
              } catch { /* skip */ }
              continue
            }
            const p = patterns[check]
            if (!p) continue
            try {
              const rg = await runCommand(`rg --no-heading --line-number --color never '${p.regex}' ${safeTargets} 2>/dev/null | head -20`, ctx.directory, 10_000)
              if (rg.exitCode === 0 && rg.stdout.trim()) {
                const count = rg.stdout.trim().split("\n").length
                results.push(`${p.label} (${count} found):\n${truncateOutput(rg.stdout.trim(), 800)}`)
              }
            } catch { /* skip */ }
          }
          ctx.metadata({ title: `pattern scan: ${checks.join(", ")}${results.length > 0 ? ` (${results.length} issues)` : " (clean)"}` })
          return results.length > 0 ? results.join("\n\n") : "No anti-patterns detected. ✅"
        },
      }),

      "resolve-complexity": tool({
        description: "Analyze file complexity: line count, import count, export count, and function count. Helps identify files that may need refactoring.",
        args: {
          paths: tool.schema.string().optional().describe("File or directory paths to analyze (space-separated). Defaults to 'src/'."),
          threshold: tool.schema.number().optional().describe("Only show files with more than this many lines (default 50)."),
        },
        async execute(args, ctx) {
          const targets = args.paths ?? "src/"
          const safeTargets = targets.split(" ").map(t => `'${sanitizeShellArg(t)}'`).join(" ")
          const threshold = args.threshold ?? 50
          try {
            const result = await runCommand(`find ${safeTargets} -type f \\( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' \\) | head -100 | xargs wc -l 2>/dev/null | sort -rn | head -30`, ctx.directory, 10_000)
            if (result.exitCode !== 0 || !result.stdout.trim()) return "No source files found."
            const lines = result.stdout.trim().split("\n").filter(l => {
              const num = parseInt(l.trim())
              return !isNaN(num) && num >= threshold
            })
            // Enrich with import/export/function counts for top files
            const enriched: string[] = []
            for (const line of lines.slice(0, 10)) {
              const parts = line.trim().split(/\s+/)
              const lineCount = parseInt(parts[0])
              const filePath = parts.slice(1).join(" ")
              if (!filePath || filePath === "total") { enriched.push(line); continue }
              try {
                const imports = await runCommand(`grep -c '\\bimport\\b\\|\\brequire(' '${filePath}' 2>/dev/null || echo 0`, ctx.directory, 5_000)
                const exports = await runCommand(`grep -c '\\bexport\\b' '${filePath}' 2>/dev/null || echo 0`, ctx.directory, 5_000)
                const fns = await runCommand(`grep -cE '\\bfunction\\b|=>\\s*[{(]|\\basync\\b' '${filePath}' 2>/dev/null || echo 0`, ctx.directory, 5_000)
                enriched.push(`${filePath}: ${lineCount} lines, ${imports.stdout.trim()} imports, ${exports.stdout.trim()} exports, ~${fns.stdout.trim()} functions`)
              } catch {
                enriched.push(`${filePath}: ${lineCount} lines`)
              }
            }
            ctx.metadata({ title: `complexity: ${enriched.length} files analyzed` })
            return enriched.length > 0 ? enriched.join("\n") : `All files under ${threshold} lines. ✅`
          } catch (err) {
            return `Analysis failed: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      "resolve-file-info": tool({
        description: "Get file metadata quickly: size, last modified, line count, language, and whether it's tracked by git. Faster than reading full file contents.",
        args: {
          path: tool.schema.string().describe("File path to inspect."),
        },
        async execute(args, ctx) {
          const filePath = resolve(ctx.directory, args.path)
          try {
            const s = await stat(filePath)
            if (!s.isFile()) return `${args.path}: not a file.`
            const ext = filePath.split(".").pop()?.toLowerCase() ?? ""
            const langMap: Record<string, string> = {
              ts: "TypeScript", tsx: "TypeScript (JSX)", js: "JavaScript", mjs: "JavaScript (ESM)",
              json: "JSON", md: "Markdown", yml: "YAML", yaml: "YAML", py: "Python",
              go: "Go", rs: "Rust", java: "Java", rb: "Ruby", sh: "Shell", css: "CSS", html: "HTML",
            }
            const lines: string[] = [
              `Path: ${args.path}`,
              `Size: ${s.size} bytes`,
              `Modified: ${s.mtime.toISOString()}`,
              `Language: ${langMap[ext] ?? ext.toUpperCase()}`,
            ]
            // Quick line count — pure Node.js, no shell injection risk
            try {
              const content = await readFile(filePath, "utf8")
              const lineCount = content.split("\n").length - (content.endsWith("\n") ? 1 : 0)
              lines.push(`Lines: ${lineCount}`)
            } catch { /* skip */ }
            // Git tracked? — sanitize path to prevent shell injection
            try {
              const safePath = sanitizeShellArg(filePath)
              const git = await runCommand(`git ls-files --error-unmatch '${safePath}' 2>/dev/null`, ctx.directory, 3_000)
              lines.push(`Git: ${git.exitCode === 0 ? "tracked" : "untracked"}`)
            } catch {
              lines.push("Git: not a git repo")
            }
            ctx.metadata({ title: `file-info: ${args.path}` })
            return lines.join("\n")
          } catch {
            return `File not found: ${args.path}`
          }
        },
      }),

      "resolve-outdated": tool({
        description: "Check which dependencies are outdated by comparing package.json versions against npm registry. Returns current vs latest for each package.",
        args: {
          dev: tool.schema.boolean().optional().describe("Check devDependencies instead of dependencies."),
          filter: tool.schema.string().optional().describe("Only check packages matching this prefix (e.g. '@opencode-ai')."),
        },
        async execute(args, ctx) {
          try {
            const pkgRaw = await readFile(join(ctx.directory, "package.json"), "utf8")
            const pkg = JSON.parse(pkgRaw)
            const section = args.dev ? pkg.devDependencies : pkg.dependencies
            if (!section || Object.keys(section).length === 0) {
              return args.dev ? "No devDependencies." : "No dependencies."
            }
            const entries = Object.entries(section as Record<string, string>)
              .filter(([name]) => !args.filter || name.startsWith(args.filter))
              .slice(0, 20) // limit checks to avoid flooding npm
            if (entries.length === 0) return "No matching packages."
            const results: string[] = []
            // Batch check with npm outdated (fast, single command)
            const pkgNames = entries.map(([name]) => `"${name}"`).join(" ")
            const outdated = await runCommand(
              `npm outdated ${pkgNames} --json --long 2>/dev/null || true`,
              ctx.directory, 30_000,
            )
            if (outdated.stdout.trim()) {
              try {
                const data = JSON.parse(outdated.stdout) as Record<string, { current?: string; latest?: string; wanted?: string }>
                for (const [name, info] of Object.entries(data)) {
                  results.push(`${name}: ${info.current ?? "?"} → ${info.latest ?? "?"}`)
                }
              } catch {
                // fallback: show raw
                results.push(truncateOutput(outdated.stdout, 500))
              }
            }
            ctx.metadata({ title: `outdated: ${results.length} packages checked` })
            return results.length > 0 ? `Outdated packages:\n${results.join("\n")}` : "All checked packages are up to date. ✅"
          } catch {
            return "No package.json found or npm unavailable."
          }
        },
      }),

      "resolve-readme": tool({
        description: "Extract key information from project README: description, setup instructions, dependencies, and architecture notes. Saves reading the full file.",
        args: {
          max_length: tool.schema.number().optional().describe("Max summary length (default 2000)."),
        },
        async execute(args, ctx) {
          const maxLen = args.max_length ?? 2000
          // Try common README locations
          for (const name of ["README.md", "readme.md", "README.MD", "README", "README.txt"]) {
            const filePath = join(ctx.directory, name)
            try {
              const content = await readFile(filePath, "utf8")
              if (!content.trim()) continue
              // Extract structured info: first heading, first paragraph, any ## sections
              const lines = content.split("\n")
              const heading = lines.find(l => l.startsWith("#"))
              const sections: string[] = []
              let currentSection: string[] = []
              for (const line of lines) {
                if (line.startsWith("## ")) {
                  if (currentSection.length > 0) {
                    sections.push(currentSection.join("\n").trim())
                  }
                  currentSection = [line]
                } else {
                  currentSection.push(line)
                }
              }
              if (currentSection.length > 0) sections.push(currentSection.join("\n").trim())
              // Build summary
              const summaryParts: string[] = []
              if (heading) summaryParts.push(heading)
              // Extract key sections
              for (const section of sections) {
                const sectionLines = section.split("\n")
                const title = sectionLines[0]
                const keySections = /install|setup|usage|architect|config|getting.start|require|depend/i
                if (keySections.test(title)) {
                  summaryParts.push(section.slice(0, 500).trim())
                }
              }
              const summary = summaryParts.join("\n\n")
              ctx.metadata({ title: `readme: ${name}` })
              return truncateOutput(summary, maxLen) || "README exists but is empty or unparseable."
            } catch { /* not found, try next */ }
          }
          return "No README found in project root."
        },
      }),

      "resolve-init": tool({
        description: "Initialize opencode-resolve config files for the project. Creates resolve.json with detected settings, and optionally HARNESS.md + AGENTS.md scaffolds.",
        args: {
          dry_run: tool.schema.boolean().optional().describe("If true, show what would be created without writing files."),
          harness: tool.schema.boolean().optional().describe("Also create HARNESS.md scaffold."),
          agents: tool.schema.boolean().optional().describe("Also create AGENTS.md scaffold."),
        },
        async execute(args, ctx) {
          const projCtx = sessionState.storedProjectContext
          const results: string[] = []
          const dryRun = args.dry_run ?? false

          if (!dryRun && !canWriteFromTool(ctx)) {
            return readOnlyToolWriteDenied(ctx, "initialize files")
          }

          // Build resolve.json content
          const resolveConfig: Record<string, unknown> = {}
          if (sessionState.storedConfig?.profile) resolveConfig.profile = sessionState.storedConfig.profile
          if (sessionState.storedConfig?.tier) resolveConfig.tier = sessionState.storedConfig.tier
          if (projCtx?.verifyCommands.length) {
            results.push(`Detected verify: ${projCtx.verifyCommands.join(", ")}`)
          }
          if (projCtx?.packageManager) {
            results.push(`Package manager: ${projCtx.packageManager}`)
          }
          if (projCtx?.hasTypeScript) {
            results.push("TypeScript: yes")
          }

          if (!dryRun) {
            const configPath = join(ctx.directory, "opencode-resolve.json")
            try {
              await access(configPath)
              results.push("resolve.json: already exists, skipping")
            } catch {
              writeFileSync(configPath, JSON.stringify(resolveConfig, null, 2) + "\n")
              results.push("resolve.json: created")
            }
          } else {
            results.push(`[DRY RUN] Would create resolve.json: ${JSON.stringify(resolveConfig)}`)
          }

          // HARNESS.md scaffold
          if (args.harness) {
            const harnessContent = [
              "# Project Infrastructure",
              "",
              "## Build & Verify",
              ...(projCtx?.verifyCommands.map(c => `- \`${c}\``) ?? []),
              "",
              "## Architecture Decisions",
              "- _Add key decisions here_",
              "",
              "## Known Traps",
              "- _Add project-specific pitfalls here_",
            ].join("\n")
            if (!dryRun) {
              const harnessPath = join(ctx.directory, "HARNESS.md")
              try {
                await access(harnessPath)
                results.push("HARNESS.md: already exists, skipping")
              } catch {
                writeFileSync(harnessPath, harnessContent + "\n")
                results.push("HARNESS.md: created")
              }
            } else {
              results.push(`[DRY RUN] Would create HARNESS.md (${harnessContent.length} bytes)`)
            }
          }

          // AGENTS.md scaffold
          if (args.agents) {
            const agentsContent = [
              "# Agent Behavior Patterns",
              "",
              "## Delegation Strategy",
              "- _Document how tasks should be delegated here_",
              "",
              "## Verification Protocol",
              "- _Document verification expectations here_",
              "",
              "## Model-Specific Notes",
              "- _Add GLM/GPT specific patterns here_",
            ].join("\n")
            if (!dryRun) {
              const agentsPath = join(ctx.directory, "AGENTS.md")
              try {
                await access(agentsPath)
                results.push("AGENTS.md: already exists, skipping")
              } catch {
                writeFileSync(agentsPath, agentsContent + "\n")
                results.push("AGENTS.md: created")
              }
            } else {
              results.push(`[DRY RUN] Would create AGENTS.md (${agentsContent.length} bytes)`)
            }
          }

          ctx.metadata({ title: `init: ${results.length} items` })
          return results.join("\n")
        },
      }),

      "resolve-diff": tool({
        description: "Show focused git diff summary. Supports comparing against last commit, a specific commit, or between branches. Much faster than reading full diff.",
        args: {
          ref: tool.schema.string().optional().describe("Git ref to compare against (e.g. 'HEAD~1', 'main', 'v1.0.0'). Defaults to staged+unstaged changes."),
          file: tool.schema.string().optional().describe("Only show diff for this file path."),
          stat_only: tool.schema.boolean().optional().describe("If true, only show file-level stat (no line diffs)."),
        },
        async execute(args, ctx) {
          try {
            let cmd: string
            const fileFilter = args.file ? ` -- '${sanitizeShellArg(args.file)}'` : ""

            if (args.ref) {
              const safeRef = sanitizeShellArg(args.ref)
              if (args.stat_only) {
                cmd = `git diff --stat ${safeRef}${fileFilter}`
              } else {
                cmd = `git diff --stat --patch ${safeRef}${fileFilter}`
              }
            } else {
              if (args.stat_only) {
                cmd = `git diff --stat HEAD${fileFilter}`
              } else {
                cmd = `git diff --stat --patch HEAD${fileFilter}`
              }
            }

            const result = await runCommand(cmd, ctx.directory, 15_000)
            if (result.exitCode !== 0) return `Git diff failed: ${truncateOutput(result.stderr, 300)}`
            if (!result.stdout.trim()) return "No changes detected."
            ctx.metadata({ title: `diff: ${args.ref ?? "HEAD"}${args.file ? ` ${args.file}` : ""}` })
            return truncateOutput(result.stdout, 3000)
          } catch {
            return "Not a git repository or git unavailable."
          }
        },
      }),

      "resolve-scripts": tool({
        description: "List package.json scripts with their commands. Helps discover available build, test, lint, and dev commands.",
        args: {
          filter: tool.schema.string().optional().describe("Only show scripts matching this substring (e.g. 'test', 'build')."),
          verbose: tool.schema.boolean().optional().describe("If true, also show the full command for each script."),
        },
        async execute(args, ctx) {
          try {
            const pkgRaw = await readFile(join(ctx.directory, "package.json"), "utf8")
            const pkg = JSON.parse(pkgRaw)
            const scripts = pkg.scripts as Record<string, string> | undefined
            if (!scripts || Object.keys(scripts).length === 0) return "No scripts found in package.json."

            const entries = Object.entries(scripts)
              .filter(([name]) => !args.filter || name.includes(args.filter))
            if (entries.length === 0) return `No scripts matching '${args.filter}'.`

            const lines = entries.map(([name, cmd]) => {
              if (args.verbose) return `${name}: ${cmd}`
              return name
            })
            ctx.metadata({ title: `scripts: ${entries.length} found` })
            return `Available scripts:\n${lines.join("\n")}`
          } catch {
            return "No package.json found or unreadable."
          }
        },
      }),

      "resolve-env": tool({
        description: "Check environment configuration. Reads .env.example if present, lists required variables, and shows which ones are set (names only, never values).",
        args: {},
        async execute(_args, ctx) {
          const results: string[] = []
          // Check for .env.example
          for (const name of [".env.example", ".env.sample", ".env.template"]) {
            try {
              const content = await readFile(join(ctx.directory, name), "utf8")
              const vars = content.split("\n")
                .map(l => l.trim())
                .filter(l => l && !l.startsWith("#"))
                .map(l => l.split("=")[0].trim())
                .filter(Boolean)
              if (vars.length > 0) {
                results.push(`${name} variables: ${vars.join(", ")}`)
                // Check which are set (names only — never expose values)
                const set: string[] = []
                const missing: string[] = []
                for (const v of vars) {
                  if (process.env[v]) {
                    set.push(v)
                  } else {
                    missing.push(v)
                  }
                }
                if (set.length > 0) results.push(`Set: ${set.join(", ")}`)
                if (missing.length > 0) results.push(`Missing: ${missing.join(", ")}`)
              }
              break // found one, stop looking
            } catch { /* not found, try next */ }
          }

          // Check for .env
          try {
            await access(join(ctx.directory, ".env"))
            results.push(".env: present (not reading for safety)")
          } catch { /* no .env */ }

          if (results.length === 0) return "No .env.example or .env files found."
          ctx.metadata({ title: `env: ${results.length} items` })
          return results.join("\n")
        },
      }),

      "resolve-coverage": tool({
        description: "Run test coverage analysis. Detects coverage command from package.json scripts or uses npx c8/vitest --coverage. Returns coverage summary.",
        args: {
          command: tool.schema.string().optional().describe("Override coverage command (e.g. 'npm run test:coverage')."),
          file: tool.schema.string().optional().describe("Only check coverage for this file or directory."),
        },
        async execute(args, ctx) {
          const projCtx = sessionState.storedProjectContext
          let cmd = args.command
          if (!cmd) {
            // Try to find coverage script
            try {
              const pkgRaw = await readFile(join(ctx.directory, "package.json"), "utf8")
              const pkg = JSON.parse(pkgRaw)
              const scripts = pkg.scripts as Record<string, string> | undefined
              const covScript = scripts?.["test:coverage"] ?? scripts?.["coverage"] ?? scripts?.["test:cov"]
              if (covScript) {
                const pm = projCtx?.packageManager ?? "npm"
                const scriptName = Object.keys(scripts!).find(k => scripts![k] === covScript)!
                cmd = `${pm} run ${scriptName}`
              }
            } catch { /* no package.json */ }
            if (!cmd) {
              // Try common tools
              cmd = "npx vitest run --coverage 2>/dev/null || npx c8 npm test 2>/dev/null || echo 'No coverage tool found'"
            }
          }
          if (args.file) cmd += ` '${sanitizeShellArg(args.file)}'`

          const denied = commandExecutionDenied(cmd)
          if (denied) return denied
          try {
            const result = await runCommand(cmd, ctx.directory, 60_000)
            ctx.metadata({ title: `coverage: ${args.file ?? "all"}` })
            if (result.exitCode === 0) {
              return { output: truncateOutput(result.stdout, 2000), metadata: { exitCode: 0 } }
            }
            return { output: `Coverage failed (exit ${result.exitCode}).\n${truncateOutput(result.stderr || result.stdout, 1000)}`, metadata: { exitCode: result.exitCode } }
          } catch (err) {
            return `Coverage error: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      "resolve-todo": tool({
        description: "Extract TODO, FIXME, HACK, and XXX comments from source files. Shows file, line number, and comment text. Useful for finding incomplete work.",
        args: {
          paths: tool.schema.string().optional().describe("File or directory paths to scan (space-separated). Defaults to 'src/'."),
          author: tool.schema.string().optional().describe("Filter by author name in comment (e.g. 'john')."),
        },
        async execute(args, ctx) {
          const targets = args.paths ?? "src/"
          const safeTargets = targets.split(" ").map(t => `'${sanitizeShellArg(t)}'`).join(" ")
          const pattern = args.author
            ? `\\b(?:TODO|FIXME|HACK|XXX)\\b.*${sanitizeShellArg(args.author)}`
            : `\\b(?:TODO|FIXME|HACK|XXX)\\b`
          try {
            const result = await runCommand(
              `rg --no-heading --line-number --color never -i '${pattern}' ${safeTargets} 2>/dev/null | head -50`,
              ctx.directory, 10_000,
            )
            if (result.exitCode === 1) return "No TODO/FIXME comments found. ✅"
            if (result.exitCode !== 0) return `Search error: ${truncateOutput(result.stderr, 300)}`
            const lines = result.stdout.trim().split("\n")
            // Categorize
            const todos = lines.filter(l => /\bTODO\b/i.test(l)).length
            const fixmes = lines.filter(l => /\bFIXME\b/i.test(l)).length
            const hacks = lines.filter(l => /\bHACK\b/i.test(l)).length
            const summary = `Found: ${todos} TODO, ${fixmes} FIXME, ${hacks} HACK`
            ctx.metadata({ title: `todo: ${summary}` })
            return `${summary}\n${truncateOutput(result.stdout.trim(), 2000)}`
          } catch (err) {
            return `Search failed: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      "resolve-tree": tool({
        description: "Show directory structure up to a given depth. Faster than running find or ls -R. Useful for understanding project layout.",
        args: {
          path: tool.schema.string().optional().describe("Directory path to tree. Defaults to '.' (project root)."),
          depth: tool.schema.number().optional().describe("Maximum depth to traverse (default 3)."),
          exclude: tool.schema.string().optional().describe("Comma-separated exclude patterns (default: 'node_modules,.git,dist,build,.next')."),
        },
        async execute(args, ctx) {
          const dir = args.path ?? "."
          const maxDepth = Math.min(args.depth ?? 3, 6)
          const excludes = (args.exclude ?? "node_modules,.git,dist,build,.next,.cache,target")
            .split(",")
            .map(e => `-I '${sanitizeShellArg(e.trim())}'`)
            .join(" ")
          try {
            // Try tree first, fall back to find
            const result = await runCommand(
              `tree -L ${maxDepth} ${excludes} '${sanitizeShellArg(dir)}' 2>/dev/null || find '${sanitizeShellArg(dir)}' -maxdepth ${maxDepth} -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/build/*' 2>/dev/null | head -100`,
              ctx.directory, 10_000,
            )
            if (result.exitCode !== 0 && !result.stdout.trim()) {
              return `Directory not found: ${dir}`
            }
            ctx.metadata({ title: `tree: ${dir} (depth ${maxDepth})` })
            return truncateOutput(result.stdout, 3000)
          } catch (err) {
            return `Tree failed: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      "resolve-metrics": tool({
        description: "Quick project health overview: file counts, dependency counts, TODO/FIXME counts, test status, and git status. Aggregates data from multiple sources into a single summary.",
        args: {
          skip_test: tool.schema.boolean().optional().describe("Skip running tests (faster). Default: false."),
        },
        async execute(args, ctx) {
          const results: string[] = []
          const projCtx = sessionState.storedProjectContext

          // 1. File counts by type
          try {
            const srcFiles = await runCommand("find src -type f 2>/dev/null | wc -l", ctx.directory, 5_000)
            const testFiles = await runCommand("find test tests -type f 2>/dev/null | wc -l", ctx.directory, 5_000)
            const totalFiles = await runCommand("find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' 2>/dev/null | wc -l", ctx.directory, 5_000)
            results.push(`Files: ${totalFiles.stdout.trim()} total, ${srcFiles.stdout.trim() || "0"} src, ${testFiles.stdout.trim() || "0"} test`)
          } catch { /* skip */ }

          // 2. Dependencies
          try {
            const pkgRaw = await readFile(join(ctx.directory, "package.json"), "utf8")
            const pkg = JSON.parse(pkgRaw)
            const deps = Object.keys(pkg.dependencies ?? {}).length
            const devDeps = Object.keys(pkg.devDependencies ?? {}).length
            results.push(`Dependencies: ${deps} prod, ${devDeps} dev`)
          } catch { /* skip */ }

          // 3. TODO/FIXME count
          try {
            const todoResult = await runCommand("rg -c '\\b(?:TODO|FIXME|HACK|XXX)\\b' src 2>/dev/null | wc -l", ctx.directory, 5_000)
            const todoCount = parseInt(todoResult.stdout.trim()) || 0
            if (todoCount > 0) results.push(`TODO/FIXME: ${todoCount} files with action items`)
            else results.push("TODO/FIXME: clean ✅")
          } catch { results.push("TODO/FIXME: not checked") }

          // 4. TypeScript check (if applicable)
          if (projCtx?.hasTypeScript && projCtx.verifyCommands.length > 0) {
            const tscCmd = projCtx.verifyCommands.find(c => /tsc|typecheck|type.check/i.test(c))
            if (tscCmd) {
              try {
                const tsc = await runCommand(tscCmd, ctx.directory, 30_000)
                results.push(`TypeCheck: ${tsc.exitCode === 0 ? "pass ✅" : "fail ❌"}`)
              } catch {
                results.push("TypeCheck: error running check")
              }
            }
          }

          // 5. Test status
          if (!args.skip_test && projCtx?.verifyCommands.some(c => /test/i.test(c))) {
            const testCmd = projCtx.verifyCommands.find(c => /test/i.test(c))!
            try {
              const test = await runCommand(testCmd, ctx.directory, 60_000)
              results.push(`Tests: ${test.exitCode === 0 ? "pass ✅" : "fail ❌"}`)
            } catch {
              results.push("Tests: error running tests")
            }
          } else if (args.skip_test) {
            results.push("Tests: skipped")
          }

          // 6. Git status
          try {
            const branch = await runCommand("git rev-parse --abbrev-ref HEAD 2>/dev/null", ctx.directory, 3_000)
            const dirty = await runCommand("git status --porcelain 2>/dev/null | wc -l", ctx.directory, 3_000)
            if (branch.exitCode === 0) {
              const dirtyCount = parseInt(dirty.stdout.trim()) || 0
              results.push(`Git: ${branch.stdout.trim()}, ${dirtyCount} dirty files`)
            }
          } catch { /* skip */ }

          // 7. Project context info
          if (projCtx) {
            const info: string[] = []
            if (projCtx.packageManager) info.push(`pm: ${projCtx.packageManager}`)
            if (projCtx.hasTypeScript) info.push("TS")
            if (projCtx.hasHarness) info.push("HARNESS.md")
            if (projCtx.hasAgents) info.push("AGENTS.md")
            if (info.length > 0) results.push(`Context: ${info.join(", ")}`)
          }

          ctx.metadata({ title: `metrics: ${results.length} items` })
          return results.join("\n")
        },
      }),

      // ── Ralph Loop tools ──────────────────────────────────────────────────

      "resolve-changelog": tool({
        description: "Show recent git changes. Useful for understanding what changed in the current session and detecting if edits are going in circles (Ralph Loop detection).",
        args: {
          count: tool.schema.number().optional().describe("Number of commits to show. Default: 10."),
          file: tool.schema.string().optional().describe("Show changes for a specific file only."),
          format: tool.schema.enum(["oneline", "stat", "full"]).optional().describe("Output format. Default: oneline."),
        },
        async execute(args, ctx) {
          const n = Math.min(args.count ?? 10, 50)
          const fmt = args.format ?? "oneline"
          try {
            let cmd: string
            if (args.file) {
              const safeFile = sanitizeShellArg(args.file)
              cmd = fmt === "stat"
                ? `git log --stat -${n} -- ${safeFile}`
                : fmt === "full"
                  ? `git log -${n} -- ${safeFile}`
                  : `git log --oneline -${n} -- ${safeFile}`
            } else {
              cmd = fmt === "stat"
                ? `git log --stat -${n}`
                : fmt === "full"
                  ? `git log -${n}`
                  : `git log --oneline -${n}`
            }
            const result = await runCommand(cmd, ctx.directory, 10_000)
            if (result.exitCode !== 0) return `Git log failed: ${result.stderr.trim()}`
            ctx.metadata({ title: `changelog: ${n} commits` })
            return truncateOutput(result.stdout, 4000)
          } catch (err) {
            return `Changelog failed: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      "resolve-session": tool({
        description: "Show current Ralph Loop session state: profile, tier, edit count, tool call count, failure warnings, loop warnings, and elapsed time. Use when you suspect you're going in circles.",
        args: {},
        async execute(_args, ctx) {
          const lines: string[] = []
          const cfg = sessionState.storedConfig
          const projCtx = sessionState.storedProjectContext
          const elapsed = Math.round((Date.now() - sessionState.sessionStartTime) / 1000)

          lines.push(`Session duration: ${elapsed}s`)
          lines.push(`Tool calls: ${sessionState.totalToolCalls}`)
          lines.push(`Edits: ${sessionState.totalEdits}`)
          if (cfg?.profile) lines.push(`Profile: ${cfg.profile}`)
          if (cfg?.tier) lines.push(`Tier: ${cfg.tier}`)
          if (projCtx?.hasTypeScript) lines.push("TypeScript: yes")
          if (projCtx?.packageManager) lines.push(`Package manager: ${projCtx.packageManager}`)
          if (projCtx?.verifyCommands.length) lines.push(`Verify commands: ${projCtx.verifyCommands.join(", ")}`)

          // Edit hotspots
          const hotspots = Array.from(sessionState.editHotspots.entries())
            .filter(([, v]) => v.count >= 2)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 5)
          if (hotspots.length > 0) {
            lines.push("Edit hotspots:")
            for (const [file, data] of hotspots) {
              lines.push(`  ${file}: ${data.count} edits`)
            }
          }

          // Failure warnings
          if (sessionState.failureWarnings.length > 0) {
            lines.push("Failure warnings:")
            for (const w of sessionState.failureWarnings) lines.push(`  ⚠️ ${w}`)
          }

          // Loop warnings
          if (sessionState.loopWarnings.length > 0) {
            lines.push("Loop warnings:")
            for (const w of sessionState.loopWarnings) lines.push(`  🔄 ${w}`)
          }

          ctx.metadata({ title: `session: ${sessionState.totalEdits} edits, ${sessionState.totalToolCalls} tools, ${elapsed}s` })
          return lines.join("\n")
        },
      }),

      "resolve-audit": tool({
        description: "Run a quick security audit: detect accidentally committed secrets, vulnerable dependency patterns, and common security issues in source files.",
        args: {
          paths: tool.schema.array(tool.schema.string()).optional().describe("Directories to scan. Default: ['src']."),
          check_deps: tool.schema.boolean().optional().describe("Also check npm audit. Default: false."),
        },
        async execute(args, ctx) {
          const dirs = args.paths ?? ["src"]
          const results: string[] = []
          const safeDirs = dirs.map(d => sanitizeShellArg(d)).join(" ")

          // 1. Secret detection
          const secretPatterns = [
            { name: "Private keys", regex: "-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----" },
            { name: "API keys (generic)", regex: "(api[_-]?key|apikey)\\s*[:=]\\s*['\"][a-zA-Z0-9]{20,}" },
            { name: "AWS keys", regex: "AKIA[0-9A-Z]{16}" },
            { name: "Generic secrets", regex: "(secret|password|token|credential)\\s*[:=]\\s*['\"][^'\"]{8,}" },
          ]
          for (const { name, regex } of secretPatterns) {
            try {
              const result = await runCommand(
                `rg -l '${regex}' ${safeDirs} 2>/dev/null`,
                ctx.directory, 5_000,
              )
              if (result.exitCode === 0 && result.stdout.trim()) {
                const files = result.stdout.trim().split("\n")
                results.push(`🔴 ${name}: found in ${files.length} file(s): ${files.slice(0, 5).join(", ")}`)
              }
            } catch { /* rg not found */ }
          }

          // 2. Vulnerable patterns
          const vulnPatterns = [
            { name: "eval() usage", regex: "\\beval\\s*\\(" },
            { name: "innerHTML usage", regex: "\\.innerHTML\\s*=" },
            { name: "exec() with string", regex: "\\bexec\\s*\\(.*\\$" },
            { name: "SQL string concat", regex: "(SELECT|INSERT|UPDATE|DELETE).*\\+" },
            { name: "HTTP (not HTTPS)", regex: "http://[^/]*[^s]\\b" },
          ]
          for (const { name, regex } of vulnPatterns) {
            try {
              const result = await runCommand(
                `rg -c '${regex}' ${safeDirs} 2>/dev/null`,
                ctx.directory, 5_000,
              )
              if (result.exitCode === 0 && result.stdout.trim()) {
                const count = result.stdout.trim().split("\n").length
                results.push(`🟡 ${name}: ${count} file(s)`)
              }
            } catch { /* skip */ }
          }

          // 3. npm audit
          if (args.check_deps) {
            try {
              const audit = await runCommand("npm audit --json 2>/dev/null", ctx.directory, 30_000)
              if (audit.exitCode !== 0 && audit.stdout.trim()) {
                const auditData = JSON.parse(audit.stdout)
                const vulns = auditData.metadata?.vulnerabilities
                if (vulns) {
                  results.push(`📦 npm audit: ${vulns.high ?? 0} high, ${vulns.critical ?? 0} critical, ${vulns.moderate ?? 0} moderate`)
                }
              } else {
                results.push("📦 npm audit: no vulnerabilities ✅")
              }
            } catch {
              results.push("📦 npm audit: not available")
            }
          }

          if (results.length === 0) {
            results.push("No security issues detected ✅")
          }

          ctx.metadata({ title: `audit: ${results.length} findings` })
          return results.join("\n")
        },
      }),

      "resolve-config-check": tool({
        description: "Validate the current opencode-resolve configuration. Checks resolve.json validity, missing agents, conflicting settings, and suggests fixes.",
        args: {},
        async execute(_args, ctx) {
          const results: string[] = []
          const cfg = sessionState.storedConfig

          if (!cfg) {
            return "No resolve config loaded. Plugin may not be initialized."
          }

          // 1. Profile check
          if (cfg.profile) {
            if (VALID_PROFILES.has(cfg.profile)) {
              results.push(`✅ Profile: ${cfg.profile}`)
            } else {
              results.push(`🔴 Invalid profile: '${cfg.profile}'. Valid: ${[...VALID_PROFILES].join(", ")}`)
            }
          } else {
            results.push("ℹ️ No profile set (using defaults)")
          }

          // 2. Tier check
          if (cfg.tier) {
            if (VALID_TIERS.has(cfg.tier)) {
              results.push(`✅ Tier: ${cfg.tier}`)
            } else {
              results.push(`🔴 Invalid tier: '${cfg.tier}'. Valid: ${[...VALID_TIERS].join(", ")}`)
            }
          }

          // 3. Enabled agents check
          if (cfg.enabled) {
            for (const name of cfg.enabled) {
              if (VALID_AGENT_NAME_SET.has(name)) {
                results.push(`✅ Agent '${name}' enabled`)
              } else {
                results.push(`🔴 Unknown agent: '${name}'. Valid: ${VALID_AGENT_NAMES.join(", ")}`)
              }
            }
          }

          // 4. Model aliases check
          if (cfg.models) {
            for (const [key, value] of Object.entries(cfg.models)) {
              if (typeof value !== "string") {
                results.push(`🔴 Model alias '${key}' must be a string, got ${typeof value}`)
              } else {
                results.push(`✅ Model '${key}' → '${value}'`)
              }
            }
          }

          // 5. Agent overrides check
          if (cfg.agents) {
            for (const name of Object.keys(cfg.agents)) {
              if (!VALID_AGENT_NAME_SET.has(name)) {
                results.push(`🔴 Unknown agent override: '${name}'`)
              }
            }
          }

          // 6. Project context check
          const projCtx = sessionState.storedProjectContext
          if (projCtx) {
            if (projCtx.verifyCommands.length === 0) {
              results.push("⚠️ No verify commands detected — add typecheck/lint/test scripts to package.json")
            } else {
              results.push(`✅ Verify commands: ${projCtx.verifyCommands.join(", ")}`)
            }
            if (!projCtx.hasTypeScript) {
              results.push("ℹ️ Not a TypeScript project")
            }
          }

          // 7. Resolve.json file check
          try {
            const { readFileSync: rf } = await import("node:fs")
            const paths = [
              join(ctx.directory, ".opencode", "resolve.json"),
              join(ctx.directory, "opencode-resolve.json"),
            ]
            let found = false
            for (const p of paths) {
              try {
                rf(p, "utf8")
                results.push(`✅ Config file: ${p}`)
                found = true
                break
              } catch { /* not found */ }
            }
            if (!found) results.push("ℹ️ No local resolve.json found (using defaults)")
          } catch { /* skip */ }

          ctx.metadata({ title: `config-check: ${results.length} items` })
          return results.join("\n")
        },
      }),

      "resolve-state": tool({
        description: "Read or write session state checkpoints to .opencode/resolve-state.json. Enables session resumption and cross-turn state persistence. Use 'save' to checkpoint current progress, 'load' to read last checkpoint.",
        args: {
          action: tool.schema.union([tool.schema.literal("save"), tool.schema.literal("load")]).describe("'save' to write current state, 'load' to read last checkpoint."),
          note: tool.schema.string().optional().describe("Optional note to attach to the checkpoint (e.g. 'finished auth module, starting API routes')."),
        },
        async execute(args, ctx) {
          const stateDir = join(ctx.directory, ".opencode")
          const statePath = join(stateDir, "resolve-state.json")

          if (args.action === "load") {
            try {
              const data = await readFile(statePath, "utf8")
              const state = JSON.parse(data)
              return { output: `📋 Last checkpoint loaded:\n${JSON.stringify(state, null, 2)}`, metadata: state }
            } catch {
              return "No previous checkpoint found. Use 'save' to create one."
            }
          }

          // save
          if (!canWriteFromTool(ctx)) {
            return readOnlyToolWriteDenied(ctx, "save session state")
          }

          const state: Record<string, unknown> = {
            timestamp: new Date().toISOString(),
            sessionId: ctx.sessionID ?? "unknown",
            edits: sessionState.totalEdits,
            toolCalls: sessionState.totalToolCalls,
            failures: sessionState.totalFailures,
            elapsedSeconds: Math.round((Date.now() - sessionState.sessionStartTime) / 1000),
          }
          if (sessionState.storedConfig?.profile) state.profile = sessionState.storedConfig.profile
          if (sessionState.storedConfig?.tier) state.tier = sessionState.storedConfig.tier
          if (sessionState.failureWarnings.length > 0) state.activeFailures = sessionState.failureWarnings
          if (sessionState.loopWarnings.length > 0) state.loopWarnings = sessionState.loopWarnings
          if (args.note) state.note = args.note
          if (sessionState.storedProjectContext) {
            state.knowledgeFiles = sessionState.storedProjectContext.knowledgeFiles
            state.contextFiles = sessionState.storedProjectContext.contextFiles
            state.verifyCommands = sessionState.storedProjectContext.verifyCommands
          }
          // Track hotspots
          const hotspots: string[] = []
          for (const [file, data] of sessionState.editHotspots) {
            if (data.count >= 3) hotspots.push(`${file} (${data.count} edits)`)
          }
          if (hotspots.length > 0) state.hotspots = hotspots

          try {
            mkdirSync(stateDir, { recursive: true })
            writeFileSync(statePath, JSON.stringify(state, null, 2))
            ctx.metadata({ title: `state: checkpoint saved` })
            return `✅ Checkpoint saved to .opencode/resolve-state.json\n${JSON.stringify(state, null, 2)}`
          } catch (err) {
            return `⚠️ Failed to save checkpoint: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),
    };
}
