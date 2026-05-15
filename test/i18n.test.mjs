import assert from "node:assert/strict"
import test from "node:test"
import {
  ALL_MESSAGE_KEYS,
  brand,
  contextMessage,
  narrate,
  PLUGIN_BRAND,
  pluginMessage,
  resolveLocale,
  t,
  agentDisplayName,
} from "../dist/messages.js"
import { normalizeResolveConfig } from "../dist/config.js"
import { OpencodeResolve } from "../dist/index.js"

test("resolveLocale: explicit 'en' wins over any env", () => {
  assert.equal(resolveLocale("en", "ko_KR.UTF-8"), "en")
})

test("resolveLocale: explicit 'ko' wins over any env", () => {
  assert.equal(resolveLocale("ko", "en_US.UTF-8"), "ko")
})

test("resolveLocale: 'auto' falls back to env (Korean LANG)", () => {
  assert.equal(resolveLocale("auto", "ko_KR.UTF-8"), "ko")
  assert.equal(resolveLocale("auto", "ko"), "ko")
})

test("resolveLocale: 'auto' falls back to en when env is non-Korean", () => {
  assert.equal(resolveLocale("auto", "en_US.UTF-8"), "en")
  assert.equal(resolveLocale("auto", undefined), "en")
})

test("resolveLocale: undefined config still detects Korean LANG", () => {
  assert.equal(resolveLocale(undefined, "ko_KR.UTF-8"), "ko")
})

test("brand: returns plugin name when no agent", () => {
  assert.equal(brand(undefined), `[${PLUGIN_BRAND}]`)
  assert.equal(brand(""), `[${PLUGIN_BRAND}]`)
})

test("brand: returns dynamic agent name", () => {
  assert.equal(brand("resolver"), "[resolver]")
  assert.equal(brand("coder"), "[coder]")
  assert.equal(brand("gpt-coder"), "[gpt-coder]")
})

test("agentDisplayName: Korean variants exist", () => {
  assert.equal(agentDisplayName("resolver", "ko"), "리졸버")
  assert.equal(agentDisplayName("coder", "ko"), "코더")
  assert.equal(agentDisplayName("explorer", "ko"), "익스플로러")
})

test("agentDisplayName: English passthrough", () => {
  assert.equal(agentDisplayName("resolver", "en"), "resolver")
  assert.equal(agentDisplayName("coder", "en"), "coder")
})

test("agentDisplayName: unknown agent passes through unchanged", () => {
  assert.equal(agentDisplayName("oracle", "ko"), "oracle")
  assert.equal(agentDisplayName("oracle", "en"), "oracle")
})

test("t: returns English reminder string", () => {
  const msg = t("reminder.verify", "en")
  assert.match(msg, /verify/i)
})

test("t: tool definition hints localize", () => {
  const en = t("tool.edit", "en")
  const ko = t("tool.edit", "ko")
  assert.notEqual(en, ko)
  assert.match(ko, /파일/) // Korean: "file"
})

test("t: dispatch.coder produces a string regardless of variant pick", () => {
  for (let i = 0; i < 20; i++) {
    const en = t("dispatch.coder", "en", { goal: "fix the parser" })
    assert.equal(typeof en, "string")
    assert.ok(en.length > 0)
    assert.match(en, /coder/)
  }
})

test("t: dispatch.coder Korean variants include 코더", () => {
  let sawCoder = false
  for (let i = 0; i < 20; i++) {
    const ko = t("dispatch.coder", "ko", { goal: "파서 수정" })
    if (/코더/.test(ko)) sawCoder = true
  }
  assert.ok(sawCoder, "expected at least one Korean variant to mention 코더")
})

test("t: variant arrays produce more than one distinct value across many calls", () => {
  const seen = new Set()
  for (let i = 0; i < 30; i++) {
    seen.add(t("dispatch.explorer", "ko", { goal: "" }))
  }
  assert.ok(seen.size > 1, "expected variant rotation to yield distinct strings")
})

test("contextMessage: always English regardless of session locale", () => {
  // This is the key invariant: context-bound messages stay English so they
  // don't bloat non-English prompts or break consistency on cached tokens.
  const msg = contextMessage("resolver", "reminder.verify")
  assert.match(msg, /^\[resolver\] /)
  assert.match(msg, /verify/i)
  assert.doesNotMatch(msg, /[가-힣]/) // no Korean characters
})

test("contextMessage: agent name appears as brand", () => {
  assert.match(contextMessage("coder", "reminder.verify"), /^\[coder\] /)
  assert.match(contextMessage(undefined, "reminder.verify"), /^\[opencode-resolve\] /)
})

test("pluginMessage: uses plugin brand regardless of agent", () => {
  const msg = pluginMessage("ko", "system.driveResolution")
  assert.match(msg, /^\[opencode-resolve\] /)
})

test("normalizeResolveConfig: accepts 'auto', 'en', 'ko'", () => {
  assert.equal(normalizeResolveConfig({ language: "auto" }, "test").language, "auto")
  assert.equal(normalizeResolveConfig({ language: "en" }, "test").language, "en")
  assert.equal(normalizeResolveConfig({ language: "ko" }, "test").language, "ko")
})

test("normalizeResolveConfig: rejects unknown language", () => {
  assert.throws(
    () => normalizeResolveConfig({ language: "jp" }, "test"),
    /Unknown language "jp"/,
  )
})

test("normalizeResolveConfig: rejects non-string language", () => {
  assert.throws(
    () => normalizeResolveConfig({ language: 123 }, "test"),
    /test\.language must be a non-empty string/,
  )
})

// ── smoke: every key renders in en + ko, every variant fires ───────────────

test("smoke: every message key renders cleanly in en and ko across all variants", () => {
  // Variant rotation is linear, so 100 iterations comfortably exhausts every
  // array entry (longest variant array is ~22 elements). Run with goal set
  // AND goal empty so both ternary branches in `goal ? ... : ...` fire.
  const paramSets = [
    {
      files: "AGENTS.md, CLAUDE.md",
      commands: "npm test; npm run typecheck",
      count: 5,
      edits: 12,
      calls: 30,
      elapsed: 7,
      body: "knowledge=AGENTS.md",
      from: "resolver",
      to: "coder",
      goal: "wire the dispatch hook",
    },
    {
      files: "",
      commands: "",
      count: 0,
      edits: 0,
      calls: 0,
      elapsed: 0,
      body: "",
      from: "resolver",
      to: "coder",
      goal: "",
    },
  ]
  for (const key of ALL_MESSAGE_KEYS) {
    for (const locale of ["en", "ko"]) {
      for (const params of paramSets) {
        for (let i = 0; i < 100; i++) {
          const out = t(key, locale, params)
          assert.equal(typeof out, "string", `t(${key}, ${locale}) must return string`)
          assert.ok(out.length > 0, `t(${key}, ${locale}) must be non-empty`)
        }
      }
    }
  }
})

// ── narration: terminal-only role-play ─────────────────────────────────────

function captureConsole(fn) {
  const original = console.log
  const lines = []
  console.log = (...args) => { lines.push(args.join(" ")) }
  try {
    fn()
  } finally {
    console.log = original
  }
  return lines
}

test("narrate: writes to console (terminal-only path, not context)", () => {
  const lines = captureConsole(() => {
    narrate({ locale: "en", currentAgent: "resolver" }, "narration.editing")
  })
  assert.equal(lines.length, 1)
  assert.match(lines[0], /^\[resolver\] /)
})

test("narrate: uses Korean variants when locale is ko", () => {
  let sawKorean = false
  for (let i = 0; i < 30; i++) {
    const lines = captureConsole(() => {
      narrate({ locale: "ko", currentAgent: "coder" }, "narration.editing")
    })
    if (/[가-힣]/.test(lines[0])) sawKorean = true
  }
  assert.ok(sawKorean, "expected Korean characters in at least one ko narration")
})

test("hook: chat.params captures input.agent into session state", async () => {
  const hooks = await OpencodeResolve(
    { directory: "/tmp", client: {}, project: {}, worktree: "/tmp", serverUrl: new URL("http://localhost"), $: {}, experimental_workspace: { register() {} } },
    {},
  )
  await hooks.config({})
  const output = {}
  await hooks["chat.params"]({ agent: "explorer" }, output)
  // We can't directly read state, but the next end-of-turn reminder should
  // brand as [explorer].
  const turn = { text: "I edited the file:\n```\nconst x = 1\n```" }
  await hooks["experimental.text.complete"]({}, turn)
  assert.match(turn.text, /\[explorer\]/, "reminder should adopt latest agent name")
})

test("hook: tool.execute.before with task tool narrates dispatch (terminal only)", async () => {
  const hooks = await OpencodeResolve(
    { directory: "/tmp", client: {}, project: {}, worktree: "/tmp", serverUrl: new URL("http://localhost"), $: {}, experimental_workspace: { register() {} } },
    { language: "en" },
  )
  await hooks.config({})
  await hooks["chat.params"]({ agent: "resolver" }, {})
  const lines = []
  const original = console.log
  console.log = (...args) => { lines.push(args.join(" ")) }
  try {
    await hooks["tool.execute.before"](
      { tool: "task", args: { subagent_type: "coder", description: "fix the parser bug" } },
      { args: { subagent_type: "coder", description: "fix the parser bug" } },
    )
  } finally {
    console.log = original
  }
  assert.ok(lines.length > 0, "expected at least one narration line")
  assert.match(lines[0], /\[resolver\]/)
  assert.match(lines[0], /coder/i)
  assert.match(lines[0], /fix the parser bug/)
})

test("hook: tool.execute.before with task tool narrates in Korean when language is ko", async () => {
  const hooks = await OpencodeResolve(
    { directory: "/tmp", client: {}, project: {}, worktree: "/tmp", serverUrl: new URL("http://localhost"), $: {}, experimental_workspace: { register() {} } },
    { language: "ko" },
  )
  await hooks.config({})
  await hooks["chat.params"]({ agent: "resolver" }, {})
  let sawKorean = false
  for (let i = 0; i < 30; i++) {
    const lines = []
    const original = console.log
    console.log = (...args) => { lines.push(args.join(" ")) }
    try {
      await hooks["tool.execute.before"](
        { tool: "task", args: { subagent_type: "coder", description: "파서 버그 수정" } },
        { args: { subagent_type: "coder", description: "파서 버그 수정" } },
      )
    } finally {
      console.log = original
    }
    if (lines[0] && /코더/.test(lines[0])) sawKorean = true
  }
  assert.ok(sawKorean, "expected Korean dispatch narration with 코더")
})
