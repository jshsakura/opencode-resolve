import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { createInterface } from "node:readline/promises"
import { fileURLToPath } from "node:url"

const packageName = "opencode-resolve"
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const configDir = process.env.OPENCODE_CONFIG_HOME || join(homedir(), ".config", "opencode")
const cacheDir = process.env.OPENCODE_CACHE_HOME || join(homedir(), ".cache", "opencode")
const opencodeConfigPath = join(configDir, "opencode.json")
const resolveConfigPath = join(configDir, "resolve.json")
const exampleConfigPath = join(root, "opencode-resolve.example.json")
// opencode caches one directory per plugin *spec string*. We register the bare
// name in opencode.json, so `packages/opencode-resolve` is the one it actually
// loads — but older installs (and `opencode plugin foo@latest`) also leave a
// `packages/opencode-resolve@latest` dir behind. Refreshing only one of them
// leaves the other pinned at whatever version it was installed at, and the TUI
// silently keeps loading the stale copy. Manage both.
const selfPluginCachePaths = [
  join(cacheDir, "packages", packageName),
  join(cacheDir, "packages", `${packageName}@latest`),
]
const selfPluginCachedPackageJson = (cachePath) => join(cachePath, "node_modules", packageName, "package.json")

const ADDITIVE_DEFAULTS = {
  autoApprove: true,
}

// Tier classification by name keywords. Returns 0=bronze (cheap scout),
// 1=silver (workhorse coder), 2=gold (flagship reasoner). Within the same
// tier we tiebreak by numeric version so 5.1 ranks above 4.5.
const TIER_BRONZE_RE = /\b(mini|flash|nano|lite|haiku|air|small|gpt-3\.5)\b/i
const TIER_GOLD_RE   = /\b(5\.5|5\.4|opus|o1-pro|o1|o3|o4|max|ultra|sota|reasoning|gpt-4-turbo)\b/i

// Provider-neutral agents — safe to enable for everyone (no profile-specific model needed).
const DEFAULT_ENABLED_AGENTS = [
  "coder", "resolver", "explorer", "reviewer", "deep-reviewer", "planner",
  "architect", "debugger", "researcher",
]

const OPENAI_MODEL_HINTS = [
  "openai/gpt-5.5",
  "openai/gpt-5.4",
  "openai/gpt-5.3-codex",
  "openai/gpt-5.3-codex-spark",
  "openai/gpt-5.2",
  "openai/gpt-5-mini",
  "openai/gpt-4o-mini",
]

const GLM_MODEL_HINTS = [
  "zai-coding-plan/glm-5.2",
  "zai-coding-plan/glm-5.1",
  "zai-coding-plan/glm-4.5",
  "zai-coding-plan/glm-4.5-air",
  "zai-coding-plan/glm-5",
  "zai-coding-plan/glm-4.7",
  "zai/glm-5.2",
  "zai/glm-5.1",
  "zai/glm-4.5",
  "zai/glm-4.5-air",
  "zai/glm-5",
  "zai/glm-4.7",
  "zai-coding-plan/glm-4.7-flashx",
  "zai/glm-4.7-flashx",
  "zai-coding-plan/glm-4.5-flash",
  "zai/glm-4.5-flash",
  "zai-coding-plan/glm-4.7-flash",
  "zai/glm-4.7-flash",
]

if (process.env.OPENCODE_RESOLVE_SKIP_POSTINSTALL === "1") {
  process.exit(0)
}

const pluginVersion = await readOwnVersion()
console.log(`[${packageName}] installing v${pluginVersion}`)

async function printSummaryBanner(version) {
  let resolveSummary = ""
  try {
    const raw = await readFile(resolveConfigPath, "utf8")
    const cfg = JSON.parse(raw)
    const parts = []
    if (cfg.tier) parts.push(`tier=${cfg.tier}`)
    const enabled = Array.isArray(cfg.enabled) ? cfg.enabled.length : Object.keys(cfg.agents ?? {}).length
    if (enabled) parts.push(`${enabled} agents`)
    if (parts.length > 0) resolveSummary = parts.join(", ")
  } catch { /* file may not exist on partial flows */ }

  const lines = [
    `✓ opencode-resolve v${version} installed`,
    `  Config: ${resolveConfigPath}${resolveSummary ? `  (${resolveSummary})` : ""}`,
    `  Next:   restart OpenCode to load the plugin`,
    `  Verify: opencode run "list available agents"   (must show resolver + coder)`,
    `          or inside any session: run resolve-version`,
  ]
  const width = Math.max(...lines.map((l) => l.length)) + 2
  const bar = "═".repeat(Math.min(width, 100))
  console.log("")
  console.log(bar)
  for (const line of lines) console.log(line)
  console.log(bar)
  console.log("")
}

try {
  await registerPlugin()
  await refreshSelfPluginCache(pluginVersion)
  console.log(`[${packageName}] v${pluginVersion} install complete`)
  await printSummaryBanner(pluginVersion)
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
  const scriptedAnswers = await readScriptedAnswersIfNeeded()

  const probe = await readOpenCodeConfig()
  const pluginNeeded = !isPluginRegisteredIn(probe)

  if (pluginNeeded) {
    const fresh = await readOpenCodeConfig()
    applyPluginPatch(fresh)
    await writeFile(opencodeConfigPath, `${JSON.stringify(fresh, null, 2)}\n`)
    console.log(`[${packageName}] updated ${opencodeConfigPath}`)
  } else {
    console.log(`[${packageName}] already registered in ${opencodeConfigPath}`)
  }

  if (!(await exists(resolveConfigPath))) {
    await createAdaptiveResolveConfig(probe, scriptedAnswers)
    return
  }

  await handleExistingResolveConfig(probe, scriptedAnswers)
}

async function refreshSelfPluginCache(expectedVersion) {
  if (process.env.OPENCODE_RESOLVE_SKIP_CACHE_REFRESH === "1") return
  if (process.env.OPENCODE_RESOLVE_REFRESHING_CACHE === "1") return

  const forceRefresh = readInstallerOption("force_cache_refresh") === "1"
  const cached = await readCachedSelfVersions()
  const stale = cached.filter((entry) => entry.version !== undefined && entry.version !== expectedVersion)
  const upToDate = cached.filter((entry) => entry.version === expectedVersion)

  if (!forceRefresh && stale.length === 0 && upToDate.length > 0) {
    console.log(`[${packageName}] OpenCode plugin cache already at v${expectedVersion}`)
    return
  }

  if (forceRefresh && stale.length === 0) {
    console.log(`[${packageName}] forcing OpenCode plugin cache refresh at v${expectedVersion}`)
  } else if (stale.length > 0) {
    for (const entry of stale) {
      console.log(`[${packageName}] stale OpenCode plugin cache detected: v${entry.version} -> v${expectedVersion} (${entry.path})`)
    }
  } else {
    console.log(`[${packageName}] OpenCode plugin cache missing; refreshing cache`)
  }

  // Wipe every spec dir, not just the stale one: opencode picks the dir by the
  // spec string in opencode.json, and we can't be sure which one it will read.
  for (const cachePath of selfPluginCachePaths) {
    await rm(cachePath, { recursive: true, force: true })
  }
  const refreshed = await runOpenCodePluginInstall()
  if (!refreshed) {
    console.warn(`[${packageName}] could not refresh OpenCode plugin cache automatically`)
    console.warn(`[${packageName}] run manually: opencode plugin ${packageName} --global --force`)
    return
  }

  const next = await readCachedSelfVersions()
  const stillStale = next.filter((entry) => entry.version !== undefined && entry.version !== expectedVersion)
  if (stillStale.length > 0) {
    for (const entry of stillStale) {
      console.warn(`[${packageName}] OpenCode plugin cache refreshed but ${entry.path} still reports v${entry.version}; expected v${expectedVersion}`)
    }
    return
  }
  console.log(`[${packageName}] OpenCode plugin cache refreshed to v${expectedVersion}`)
}

async function readCachedSelfVersions() {
  return Promise.all(
    selfPluginCachePaths.map(async (cachePath) => ({
      path: cachePath,
      version: await readCachedSelfVersion(cachePath),
    })),
  )
}

async function readCachedSelfVersion(cachePath) {
  try {
    const raw = await readFile(selfPluginCachedPackageJson(cachePath), "utf8")
    const parsed = JSON.parse(raw)
    return typeof parsed?.version === "string" ? parsed.version : undefined
  } catch (error) {
    if (isMissingFileError(error)) return undefined
    return undefined
  }
}

async function runOpenCodePluginInstall() {
  return new Promise((resolveSpawn) => {
    const child = spawn("opencode", ["plugin", packageName, "--global", "--force"], {
      stdio: "ignore",
      env: {
        ...process.env,
        OPENCODE_RESOLVE_REFRESHING_CACHE: "1",
        OPENCODE_RESOLVE_SKIP_POSTINSTALL: "1",
      },
    })
    child.on("exit", (code) => resolveSpawn(code === 0))
    child.on("error", () => resolveSpawn(false))
  })
}

function isPluginRegisteredIn(config) {
  return Array.isArray(config.plugin) && config.plugin.some(isRegisteredPluginEntry)
}

function applyPluginPatch(config) {
  config.plugin ??= []
  if (!Array.isArray(config.plugin)) {
    throw new Error(`${opencodeConfigPath}.plugin must be an array`)
  }
  if (!config.plugin.some(isRegisteredPluginEntry)) {
    config.plugin.push(packageName)
  }
}

async function handleExistingResolveConfig(opencodeConfig, scriptedAnswers) {
  const action = await chooseExistingResolveConfigAction(scriptedAnswers)
  if (action === "fresh") {
    await backupResolveConfig()
    console.log(`[${packageName}] resetting resolve.json — running setup from scratch (model pins wiped)`)
    await createAdaptiveResolveConfig(opencodeConfig, scriptedAnswers, {
      preservedModels: undefined,
    })
    return
  }

  if (action === "models") {
    await backupResolveConfig()
    await reconfigureExistingModels(opencodeConfig, scriptedAnswers)
    return
  }

  await migrateResolveConfig()
}

async function chooseExistingResolveConfigAction(scriptedAnswers) {
  if (readInstallerOption("configure_models") === "1") return "models"
  const requested = readInstallerOption("reinstall").trim().toLowerCase()
  if (["fresh", "reset", "recreate", "new", "nuke", "wipe", "full-reset", "scratch"].includes(requested)) return "fresh"
  if (["update", "keep", "migrate", "preserve"].includes(requested)) return "update"
  if (requested) {
    console.warn(`[${packageName}] ignoring unknown reinstall mode ${JSON.stringify(requested)}; use "fresh" or "update".`)
  }

  const forcePrompt = readInstallerOption("force_prompt") === "1"
  const canPrompt = Boolean((process.stdin.isTTY && process.stdout.isTTY) || forcePrompt)
  if (!canPrompt) {
    console.log(`[${packageName}] existing ${resolveConfigPath} found; preserving it and applying additive updates.`)
    console.log(`[${packageName}] for model setup, run: ${packageName} setup --models`)
    console.log(`[${packageName}] for a full reset (wipes the whole file incl. model pins), run: ${packageName} setup --reset`)
    console.log(`[${packageName}] to force plugin cache reinstall without touching settings, run: ${packageName} setup --force-cache`)
    return "update"
  }

  const rl = createPromptInterface(scriptedAnswers)
  try {
    console.log("")
    console.log("──────────────────────────────────────────────────────────────")
    console.log(` opencode-resolve — existing config detected`)
    console.log(`   ${resolveConfigPath}`)
    console.log("──────────────────────────────────────────────────────────────")
    console.log("")
    console.log("How do you want to handle it?")
    console.log("  1. keep   — preserve existing settings, only add missing defaults  (recommended)")
    console.log("  2. models — re-pick models only, keep the rest")
    console.log("  3. reset  — back up the file and wipe EVERYTHING (model pins included)")
    const answer = await askChoice(rl, "Choice [1=keep, 2=models, 3=reset, default 1]: ", ["1", "2", "3"], "1")
    if (answer === "2") return "models"
    if (answer === "3") return "fresh"
    return "update"
  } finally {
    rl.close()
  }
}

async function readExistingResolveConfig() {
  try {
    const raw = await readFile(resolveConfigPath, "utf8")
    const parsed = JSON.parse(raw)
    return isObject(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

async function backupResolveConfig() {
  const raw = await readFile(resolveConfigPath, "utf8")
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const backupPath = `${resolveConfigPath}.bak.${stamp}`
  await writeFile(backupPath, raw)
  console.log(`[${packageName}] backed up existing resolve config to ${backupPath}`)
}

async function createAdaptiveResolveConfig(opencodeConfig, scriptedAnswers, options = {}) {
  await assertReadable(exampleConfigPath)
  const raw = await readFile(exampleConfigPath, "utf8")
  const example = JSON.parse(raw)
  const preservedModels = isObject(options.preservedModels) ? options.preservedModels : undefined

  const currentModel = detectOpenCodeModel(opencodeConfig)
  const allModels = detectAllModels(opencodeConfig)
  const resolveConfig = { ...example }
  const forcePrompt = readInstallerOption("force_prompt") === "1"
  const canPrompt = Boolean(
    (process.stdin.isTTY && process.stdout.isTTY) || forcePrompt,
  )
  const interactivePreset = canPrompt
    ? await buildInteractivePreset(currentModel, allModels, scriptedAnswers, opencodeConfig)
    : undefined

  if (interactivePreset) {
    if (interactivePreset.tier) resolveConfig.tier = interactivePreset.tier
    else delete resolveConfig.tier
    if (interactivePreset.enabled) resolveConfig.enabled = interactivePreset.enabled
    resolveConfig.models = mergePreservedModels(interactivePreset.models, preservedModels)
    resolveConfig.agents = {
      ...resolveConfig.agents,
      ...(interactivePreset.agents ?? {}),
    }
    await writeFile(resolveConfigPath, `${JSON.stringify(resolveConfig, null, 2)}\n`)
    console.log(`[${packageName}] created ${resolveConfigPath} (preset: ${interactivePreset.label})`)
    return
  }

  // Non-interactive: agents inherit the top-level OpenCode model. No model
  // pinning unless the user runs setup in a TTY and picks one.
  const preset = buildModelPreset(currentModel, allModels)

  if (preset && Object.keys(preset).length > 0) {
    resolveConfig.models = mergePreservedModels(preset, preservedModels)
  } else if (preservedModels) {
    resolveConfig.models = { ...preservedModels }
  } else {
    const providerHint = currentModel ? ` (top-level model: ${currentModel})` : ""
    console.log(`[${packageName}] no models detected in opencode.json — agents inherit the top-level model${providerHint}`)
    console.log(`[${packageName}] to pin role-specific models, edit ${resolveConfigPath} ("models" section)`)
    console.log(`[${packageName}] or rerun setup in a TTY: ${packageName} setup --models`)
  }

  await writeFile(resolveConfigPath, `${JSON.stringify(resolveConfig, null, 2)}\n`)

  const label = getPresetLabel(currentModel)
  console.log(`[${packageName}] created ${resolveConfigPath} (preset: ${label})`)
}

async function reconfigureExistingModels(opencodeConfig, scriptedAnswers) {
  const existing = await readExistingResolveConfig()
  if (!existing) {
    await createAdaptiveResolveConfig(opencodeConfig, scriptedAnswers)
    return
  }

  const currentModel = detectOpenCodeModel(opencodeConfig)
  const allModels = detectAllModels(opencodeConfig)
  const forcePrompt = readInstallerOption("force_prompt") === "1"
  const canPrompt = Boolean((process.stdin.isTTY && process.stdout.isTTY) || forcePrompt)
  const interactivePreset = canPrompt
    ? await buildInteractivePreset(currentModel, allModels, scriptedAnswers, opencodeConfig)
    : undefined
  const preset = interactivePreset ?? {
    label: getPresetLabel(currentModel),
    models: buildModelPreset(currentModel, allModels),
  }

  if (!preset.models || Object.keys(preset.models).length === 0) {
    console.log(`[${packageName}] no models detected; existing model pins preserved`)
    return
  }

  const updated = { ...existing }
  if (preset.tier) updated.tier = preset.tier
  else delete updated.tier
  if (preset.enabled) updated.enabled = preset.enabled
  updated.models = preset.models
  updated.agents = {
    ...(updated.agents ?? {}),
    ...(preset.agents ?? {}),
  }

  await writeFile(resolveConfigPath, `${JSON.stringify(updated, null, 2)}\n`)
  console.log(`[${packageName}] updated model pins in ${resolveConfigPath} (preset: ${preset.label})`)
}

function mergePreservedModels(generated, preserved) {
  if (!preserved) return generated
  return { ...generated, ...preserved }
}

function inferModelStrengthHint(currentModel, allModels = []) {
  // Non-interactive fallback: pin a single detected model to every role so
  // agents don't fall through to an unrelated default. Returns {} when nothing
  // is detectable (agents then inherit the top-level OpenCode model).
  if (!currentModel) return {}
  return {
    bronze: currentModel,
    silver: currentModel,
    gold: currentModel,
    fast: currentModel,
    strong: currentModel,
    mini: currentModel,
    explorer: "bronze",
    coder: "gold",
    resolver: "gold",
    reviewer: "gold",
    "deep-reviewer": "gold",
    planner: "gold",
    architect: "gold",
    debugger: "gold",
    researcher: "bronze",
  }
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

function buildModelPreset(currentModel, allModels = []) {
  // Non-interactive path: pin a single detected model across all roles.
  // The interactive TTY flow (buildGenericInteractivePreset) handles tier
  // splitting; this is just the headless fallback.
  return inferModelStrengthHint(currentModel, allModels)
}

async function buildInteractivePreset(currentModel, allModels, scriptedAnswers, opencodeConfig) {
  // Single flow: detect providers from opencode.json, pick which API/model to
  // pin, done. No profile selection — model-agnostic by design.
  return buildGenericInteractivePreset(currentModel, opencodeConfig, scriptedAnswers)
}

function createPromptInterface(scriptedAnswers) {
  return scriptedAnswers
    ? {
        async question(prompt) {
          const answer = scriptedAnswers.length > 0 ? scriptedAnswers.shift() ?? "" : ""
          process.stdout.write(prompt)
          process.stdout.write(`${answer}\n`)
          return answer
        },
        close() {},
      }
    : createInterface({ input: process.stdin, output: process.stdout })
}

async function askThreeTier(rl, label, models) {
  const choices = models.length > 0 ? models : (label.toLowerCase().includes("glm") ? GLM_MODEL_HINTS : OPENAI_MODEL_HINTS)
  const defaults = chooseThreeTier(choices, label.toLowerCase().includes("glm") ? "glm" : "gpt")
  while (true) {
    console.log("")
    console.log(`[${packageName}] ${label} model choices  (★ = recommended default for that tier):`)
    choices.forEach((model, index) => {
      const tags = []
      if (model === defaults.bronze) tags.push("★ bronze")
      if (model === defaults.silver) tags.push("★ silver")
      if (model === defaults.gold)   tags.push("★ gold")
      const suffix = tags.length > 0 ? `    ${tags.join(" / ")}` : ""
      console.log(`  ${index + 1}. ${model}${suffix}`)
    })
    const bronze = await askModel(rl, choices, `Pick ${label} bronze/scout [default ${defaults.bronze}]: `, defaults.bronze)
    const silver = await askModel(rl, choices, `Pick ${label} silver/coder [default ${defaults.silver}]: `, defaults.silver)
    const gold = await askModel(rl, choices, `Pick ${label} gold/reasoner [default ${defaults.gold}]: `, defaults.gold)
    console.log("")
    console.log(`  → bronze: ${bronze}`)
    console.log(`  → silver: ${silver}`)
    console.log(`  → gold:   ${gold}`)
    const ok = await askYesNo(rl, `Confirm ${label} picks? [Y/n] (n re-asks all three): `, true)
    if (ok) return { bronze, silver, gold }
    console.log(`[${packageName}] re-asking ${label} picks…`)
  }
}

async function askModel(rl, choices, question, defaultValue) {
  const answer = (await rl.question(question)).trim()
  if (!answer) return defaultValue
  const index = Number.parseInt(answer, 10)
  if (Number.isInteger(index) && index >= 1 && index <= choices.length) return choices[index - 1]
  return answer
}

async function askChoice(rl, question, valid, defaultValue) {
  const answer = (await rl.question(question)).trim().toLowerCase()
  if (!answer) return defaultValue
  return valid.includes(answer) ? answer : defaultValue
}

async function askYesNo(rl, question, defaultValue) {
  const answer = (await rl.question(question)).trim().toLowerCase()
  if (!answer) return defaultValue
  return answer === "y" || answer === "yes"
}

function collectModelChoices(allModels, predicate, hints, includeFallbackHints = true) {
  const detected = allModels.filter(predicate)
  if (detected.length > 0) {
    // Only show the user's own models when they have any — never pollute the picker
    // with hint IDs they don't actually have configured in opencode.json.
    return predicate === isGLMModel ? sortGLMModelChoices(unique(detected)) : unique(detected)
  }
  // Fallback: user has zero models of this family — show the hint list so the
  // picker still has something to display.
  if (!includeFallbackHints) return []
  const choices = unique(hints)
  return predicate === isGLMModel ? sortGLMModelChoices(choices) : choices
}

function chooseThreeTier(models, family) {
  const choices = unique(models)
  if (choices.length === 0) {
    const fallback = family === "glm" ? GLM_MODEL_HINTS : OPENAI_MODEL_HINTS
    return chooseThreeTier(fallback, family)
  }
  // Bucket by tier, then pick the STRONGEST within each bucket so defaults are
  // the newest model of that class (e.g. gpt-5-mini beats gpt-4o-mini for bronze).
  const sorted = sortModelsByStrength(choices)
  return pickFromBuckets(sorted)
}

function pickFromBuckets(sorted) {
  // bronze = cheapest scout (WEAKEST of bronze bucket — e.g. gpt-4o-mini over gpt-5-mini)
  // silver = strongest workhorse coder (STRONGEST of silver bucket — e.g. gpt-5.3-codex)
  // gold   = flagship reasoner (STRONGEST of gold bucket — e.g. gpt-5.5)
  const buckets = [[], [], []]
  for (const m of sorted) buckets[inferModelTier(m)].push(m)
  const weakestOf   = (bucket) => bucket.length > 0 ? bucket[0] : null
  const strongestOf = (bucket) => bucket.length > 0 ? bucket[bucket.length - 1] : null
  const n = sorted.length
  const fallbackBronze = sorted[0]
  const fallbackGold   = sorted[n - 1]
  const fallbackSilver = n >= 2 ? sorted[Math.floor(n / 2)] : sorted[0]
  return {
    bronze: weakestOf(buckets[0])   ?? fallbackBronze,
    silver: strongestOf(buckets[1]) ?? fallbackSilver,
    gold:   strongestOf(buckets[2]) ?? fallbackGold,
  }
}

function sortGLMModelChoices(models) {
  return [...models].sort((a, b) => rankGLMModel(a) - rankGLMModel(b))
}

function rankGLMModel(model) {
  const lower = model.toLowerCase()
  if (lower.includes("5.2")) return -1
  if (lower.includes("5.1")) return 0
  if (lower.includes("4.5") && !lower.includes("air") && !lower.includes("flash")) return 1
  if (lower.includes("4.5-airx")) return 2
  if (lower.includes("4.5-air")) return 3
  if (/\bglm-5\b/.test(lower)) return 4
  if (lower.includes("4.7-flashx")) return 5
  if (lower.includes("4.7") && !lower.includes("flash")) return 6
  if (lower.includes("4.6")) return 7
  if (lower.includes("4.5-flash")) return 8
  if (lower.includes("4.7-flash")) return 9
  if (lower.includes("flash")) return 10
  return 20
}

function preferModel(models, needles, fallback) {
  return models.find((model) => {
    const lower = model.toLowerCase()
    return needles.some((needle) => lower.includes(needle))
  }) ?? fallback
}

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))]
}

async function readAllStdin() {
  let raw = ""
  for await (const chunk of process.stdin) {
    raw += chunk
  }
  return raw
}

async function readScriptedAnswersIfNeeded() {
  if (readInstallerOption("force_prompt") === "1" && !process.stdin.isTTY) {
    return (await readAllStdin()).split(/\r?\n/)
  }
  return undefined
}

function readInstallerOption(name) {
  const normalized = name.toUpperCase().replace(/-/g, "_")
  const npmName = name.toLowerCase().replace(/-/g, "_")
  return (
    process.env[`OPENCODE_RESOLVE_${normalized}`] ??
    process.env[`npm_config_opencode_resolve_${npmName}`] ??
    ""
  )
}

function getPresetLabel(currentModel) {
  return currentModel ? "configured" : "inherited"
}

function inferModelTier(modelId) {
  if (typeof modelId !== "string") return 1
  if (TIER_BRONZE_RE.test(modelId)) return 0
  if (TIER_GOLD_RE.test(modelId)) return 2
  return 1
}

function extractModelVersion(modelId) {
  if (typeof modelId !== "string") return 0
  const match = modelId.match(/\b(\d+(?:\.\d+)?)\b/)
  return match ? Number.parseFloat(match[1]) : 0
}

function inferModelStrength(modelId) {
  // Composite ordering: tier first, then version. Used for sortModelsByStrength.
  return inferModelTier(modelId) * 100 + extractModelVersion(modelId)
}

function sortModelsByStrength(models) {
  return [...models].sort((a, b) => {
    const diff = inferModelStrength(a) - inferModelStrength(b)
    if (diff !== 0) return diff
    // Tie on strength: keep the canonical/shorter variant last so bucket "strongest"
    // picks e.g. gpt-5.3-codex over gpt-5.3-codex-spark.
    return b.length - a.length
  })
}

function detectProvidersFromConfig(config) {
  const providers = new Map()
  const note = (providerId, modelId) => {
    if (!providerId) return
    const list = providers.get(providerId) ?? []
    if (modelId && !list.includes(modelId)) list.push(modelId)
    providers.set(providerId, list)
  }
  if (isObject(config.provider)) {
    for (const [providerId, providerConfig] of Object.entries(config.provider)) {
      providers.set(providerId, providers.get(providerId) ?? [])
      if (isObject(providerConfig) && isObject(providerConfig.models)) {
        for (const [modelKey, modelEntry] of Object.entries(providerConfig.models)) {
          if (typeof modelKey === "string" && modelKey.length > 0) {
            note(providerId, qualifyModelId(providerId, modelKey))
          }
          if (typeof modelEntry === "string") note(providerId, qualifyModelId(providerId, modelEntry))
          else if (isObject(modelEntry) && typeof modelEntry.id === "string") {
            note(providerId, qualifyModelId(providerId, modelEntry.id))
          }
        }
      }
    }
  }
  // Add implicit providers from top-level model and agent overrides
  const additional = []
  if (typeof config.model === "string" && config.model.includes("/")) additional.push(config.model)
  if (isObject(config.agent)) {
    for (const agent of Object.values(config.agent)) {
      if (isObject(agent) && typeof agent.model === "string" && agent.model.includes("/")) {
        additional.push(agent.model)
      }
    }
  }
  for (const fullId of additional) {
    const slash = fullId.indexOf("/")
    if (slash < 0) continue
    note(fullId.slice(0, slash), fullId)
  }
  return [...providers.entries()]
    .map(([id, models]) => ({ id, models: unique(models) }))
    .filter((p) => p.models.length > 0)
}

function pickTierShapeForModelCount(count) {
  if (count >= 3) return "three"
  if (count === 2) return "two"
  return "single"
}

function buildGenericResolveModels(tiers) {
  if (tiers.shape === "three") {
    return {
      bronze:        tiers.bronze,
      silver:        tiers.silver,
      gold:          tiers.gold,
      explorer:      "bronze",
      coder:         "silver",
      resolver:      "gold",
      reviewer:      "gold",
      "deep-reviewer": "gold",
      planner:       "gold",
      architect:     "gold",
      debugger:      "silver",
      researcher:    "bronze",
    }
  }
  if (tiers.shape === "two") {
    return {
      silver:        tiers.silver,
      gold:          tiers.gold,
      explorer:      "silver",
      coder:         "silver",
      resolver:      "gold",
      reviewer:      "gold",
      "deep-reviewer": "gold",
      planner:       "gold",
      architect:     "gold",
      debugger:      "silver",
      researcher:    "silver",
    }
  }
  return {
    gold:          tiers.gold,
    explorer:      "gold",
    coder:         "gold",
    resolver:      "gold",
    reviewer:      "gold",
    "deep-reviewer": "gold",
    planner:       "gold",
    architect:     "gold",
    debugger:      "gold",
    researcher:    "gold",
  }
}

async function buildGenericInteractivePreset(currentModel, opencodeConfig, scriptedAnswers) {
  const providers = detectProvidersFromConfig(opencodeConfig)
  if (providers.length === 0) return undefined

  const rl = createPromptInterface(scriptedAnswers)
  try {
    console.log("")
    console.log("──────────────────────────────────────────────────────────────")
    console.log(` opencode-resolve setup — provider-agnostic mode`)
    console.log(`   ${providers.length} provider${providers.length === 1 ? "" : "s"} detected in opencode.json`)
    console.log("──────────────────────────────────────────────────────────────")

    // 1. Pick provider
    let chosenProvider
    if (providers.length === 1) {
      chosenProvider = providers[0]
      console.log("")
      console.log(`[${packageName}] only one provider available — using "${chosenProvider.id}"`)
    } else {
      console.log("")
      console.log(`[${packageName}] Step 1/3 — Pick provider:`)
      providers.forEach((p, i) => {
        const marker = currentModel?.startsWith(`${p.id}/`) ? " ← top-level model" : ""
        console.log(`  ${i + 1}. ${p.id}  (${p.models.length} models)${marker}`)
      })
      const defaultIdx = Math.max(1, providers.findIndex((p) => currentModel?.startsWith(`${p.id}/`)) + 1)
      const valid = providers.map((_, i) => String(i + 1))
      const answer = await askChoice(rl, `Provider [1..${providers.length}, default ${defaultIdx}]: `, valid, String(defaultIdx))
      chosenProvider = providers[Number.parseInt(answer, 10) - 1]
    }

    const sorted = sortModelsByStrength(chosenProvider.models)
    const defaultShape = pickTierShapeForModelCount(sorted.length)

    // 2. Pick tier shape
    console.log("")
    console.log(`[${packageName}] Step 2/3 — Choose tier shape:`)
    console.log(`  1. single — one model for every role  (good for cost simplicity)`)
    console.log(`  2. two    — fast + strong split  (explorer/coder + resolver/reviewer/…)`)
    console.log(`  3. three  — bronze + silver + gold full split  (recommended when available)`)
    const shapeDefault = defaultShape === "three" ? "3" : defaultShape === "two" ? "2" : "1"
    const shapeAns = await askChoice(rl, `Tier shape [1,2,3, default ${shapeDefault}]: `, ["1", "2", "3"], shapeDefault)
    const shape = shapeAns === "3" ? "three" : shapeAns === "2" ? "two" : "single"

    // 3. Pick models — use the same bucket-aware picks as askThreeTier so the
    // generic flow defaults line up with the GPT/GLM tier shortcuts.
    const tierPicks = pickFromBuckets(sorted)
    const n = sorted.length
    const strongest = sorted[n - 1]
    const bronzeDefault = tierPicks.bronze
    const silverDefault = tierPicks.silver
    const goldDefault   = tierPicks.gold
    console.log("")
    console.log(`[${packageName}] Step 3/3 — Pick models  (★ = recommended default for that tier):`)
    sorted.forEach((m, i) => {
      const tags = []
      if (shape === "three") {
        if (m === bronzeDefault) tags.push("★ bronze")
        if (m === silverDefault) tags.push("★ silver")
        if (m === goldDefault)   tags.push("★ gold")
      } else if (shape === "two") {
        if (m === bronzeDefault) tags.push("★ silver")
        if (m === goldDefault)   tags.push("★ gold")
      } else if (m === strongest) {
        tags.push("★ all roles")
      }
      const suffix = tags.length > 0 ? `    ${tags.join(" / ")}` : ""
      console.log(`  ${i + 1}. ${m}${suffix}`)
    })

    while (true) {
      const tiers = { shape }
      if (shape === "three") {
        tiers.bronze = await askModel(rl, sorted, `Bronze (scout for explorer/researcher) [default ${bronzeDefault}]: `, bronzeDefault)
        tiers.silver = await askModel(rl, sorted, `Silver (coder/debugger) [default ${silverDefault}]: `, silverDefault)
        tiers.gold   = await askModel(rl, sorted, `Gold (resolver/reviewer/deep-reviewer/planner/architect) [default ${goldDefault}]: `, goldDefault)
      } else if (shape === "two") {
        tiers.silver = await askModel(rl, sorted, `Silver (fast: coder/explorer/debugger/researcher) [default ${bronzeDefault}]: `, bronzeDefault)
        tiers.gold   = await askModel(rl, sorted, `Gold (strong: resolver/reviewer/…/architect) [default ${goldDefault}]: `, goldDefault)
      } else {
        tiers.gold   = await askModel(rl, sorted, `Model for all roles [default ${strongest}]: `, strongest)
      }
      console.log("")
      for (const [k, v] of Object.entries(tiers)) {
        if (k === "shape") continue
        console.log(`  → ${k.padEnd(7)} ${v}`)
      }
      const ok = await askYesNo(rl, `Confirm picks? [Y/n] (n re-asks all): `, true)
      if (ok) {
        return {
          label: `${shape}-tier`,
          enabled: DEFAULT_ENABLED_AGENTS,
          models: buildGenericResolveModels(tiers),
          agents: {},
        }
      }
      console.log(`[${packageName}] re-asking picks…`)
    }
  } finally {
    rl.close()
  }
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
    for (const [providerId, providerConfig] of Object.entries(config.provider)) {
      if (isObject(providerConfig) && isObject(providerConfig.models)) {
        for (const [modelKey, modelEntry] of Object.entries(providerConfig.models)) {
          if (typeof modelKey === "string" && modelKey.length > 0) {
            models.add(qualifyModelId(providerId, modelKey))
          }
          if (typeof modelEntry === "string") {
            models.add(qualifyModelId(providerId, modelEntry))
          } else if (isObject(modelEntry) && typeof modelEntry.id === "string") {
            models.add(qualifyModelId(providerId, modelEntry.id))
          }
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

function qualifyModelId(providerId, modelId) {
  if (typeof modelId !== "string" || modelId.length === 0) return modelId
  if (modelId.includes("/")) return modelId
  return `${providerId}/${modelId}`
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

