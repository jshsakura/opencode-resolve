// Internationalized hook messages + dynamic agent brand.
//
// All session-time nudges and role-play narrations route through `t()` so they
// can be rendered in Korean or English. The brand prefix is the *current
// agent's name* (e.g. `[resolver]`, `[coder]`) — that gives the role-play feel
// the user wants. For plugin-level notices unrelated to an agent (auto-update,
// tool-definition hints loaded once), use `PLUGIN_BRAND` instead.

export type Locale = "en" | "ko";

export const PLUGIN_BRAND = "opencode-resolve";

const LOCALE_FALLBACK: Locale = "en";

const KOREAN_LANG_RE = /^ko(?:[_-]|$)/i;

/** Resolve a Locale from explicit config (`"ko"|"en"|"auto"`) or env. */
export function resolveLocale(
  configured: string | undefined,
  envLang: string | undefined,
): Locale {
  if (configured === "ko" || configured === "en") return configured;
  if (envLang && KOREAN_LANG_RE.test(envLang)) return "ko";
  return LOCALE_FALLBACK;
}

/** Bracketed brand for the currently-active agent. */
export function brand(agent: string | undefined): string {
  const name = agent && agent.length > 0 ? agent : PLUGIN_BRAND;
  return `[${name}]`;
}

/** Friendly display name per agent (used in role-play narration). */
export function agentDisplayName(agent: string | undefined, locale: Locale): string {
  if (!agent) return PLUGIN_BRAND;
  const map = AGENT_DISPLAY[locale];
  return map[agent] ?? agent;
}

const AGENT_DISPLAY: Record<Locale, Record<string, string>> = {
  en: {
    resolver: "resolver",
    coder: "coder",
    reviewer: "reviewer",
    "deep-reviewer": "deep-reviewer",
    explorer: "explorer",
    planner: "planner",
    architect: "architect",
    researcher: "researcher",
    debugger: "debugger",
    codex: "codex",
    glm: "glm",
    gpt: "gpt",
    "gpt-coder": "gpt-coder",
  },
  ko: {
    resolver: "리졸버",
    coder: "코더",
    reviewer: "리뷰어",
    "deep-reviewer": "딥리뷰어",
    explorer: "익스플로러",
    planner: "플래너",
    architect: "아키텍트",
    researcher: "리서처",
    debugger: "디버거",
    codex: "코덱스",
    glm: "GLM",
    gpt: "GPT",
    "gpt-coder": "GPT 코더",
  },
};

export type MessageKey =
  | "reminder.verify"
  | "reminder.ralphLoopText"
  | "system.driveResolution"
  | "system.projectKnowledge"
  | "system.contextDocs"
  | "system.verifyCommands"
  | "system.typescriptMandatory"
  | "system.failuresHeader"
  | "system.failuresFooter"
  | "system.strategyPivotHeader"
  | "system.strategyPivotBody"
  | "system.strategyPivotTail"
  | "system.ralphHeader"
  | "system.ralphKeepGoing"
  | "system.sessionStats"
  | "system.iterationWarning"
  | "compaction.contextHeader"
  | "tool.edit"
  | "tool.write"
  | "tool.bash"
  | "tool.task"
  | "tool.glob"
  | "tool.grep"
  | "tool.read"
  | "tool.webfetch"
  | "tool.todowrite"
  | "dispatch.toSubagent"
  | "dispatch.fromResolver"
  | "dispatch.coder"
  | "dispatch.reviewer"
  | "dispatch.deepReviewer"
  | "dispatch.explorer"
  | "dispatch.planner"
  | "dispatch.architect"
  | "dispatch.researcher"
  | "dispatch.debugger"
  | "dispatch.codex"
  | "dispatch.glm"
  | "dispatch.gpt"
  | "dispatch.gptCoder"
  | "dispatch.completed"
  | "dispatch.failed"
  | "narration.editing"
  | "narration.searching"
  | "narration.reading"
  | "narration.thinking"
  | "narration.bashing"
  | "narration.compacting"
  | "narration.writing"
  | "narration.testing"
  | "narration.typechecking"
  | "narration.linting"
  | "narration.git"
  | "narration.fetch"
  | "narration.todo"
  | "narration.diagnostics"
  | "narration.context"
  | "narration.verifyPass"
  | "narration.verifyFail"
  | "narration.idle"
  | "strategy.smallerPieces"
  | "strategy.differentFile"
  | "strategy.readTest"
  | "strategy.checkImports"
  | "strategy.searchSimilar"
  | "strategy.rereadFile"
  | "strategy.tryDifferent"
  | "strategy.useDiagnostics"
  | "strategy.suggestionLabel";

type Params = Record<string, string | number>;

type MessageFn = (params: Params) => string;
type MessageTemplate = string | MessageFn | ReadonlyArray<string | MessageFn>;

let variantCounter = 0;
function nextVariantSeed(): number {
  variantCounter = (variantCounter + 1) >>> 0;
  return variantCounter;
}

const MESSAGES: Record<Locale, Record<MessageKey, MessageTemplate>> = {
  en: {
    "reminder.verify": "Reminder: verify your changes (run resolve-verify — typecheck/lint/test) before reporting completion.",
    "reminder.ralphLoopText": "🔄 Ralph Loop: heavy iteration detected. Check resolve-diagnostics (current LSP errors snapshot) and pivot the approach before the next attempt.",
    "system.driveResolution": "Drive to verified resolution. Classify intent, dispatch focused subagents, verify after each, iterate on failure. Report completion only when verified.",
    "system.projectKnowledge": ({ files }) => `Project knowledge: ${files}. Read when relevant before modifying code.`,
    "system.contextDocs": ({ files }) => `Context docs: ${files}. MVI: load only task-relevant docs.`,
    "system.verifyCommands": ({ commands }) => `Verify commands: ${commands}. Run after changes.`,
    "system.typescriptMandatory": "TypeScript project — type safety is mandatory. No `as any` or `@ts-ignore`.",
    "system.failuresHeader": "⚠️ Recurring failures detected:",
    "system.failuresFooter": "Keep going — try a different approach for the same goal. The Ralph Loop should drive to completion.",
    "system.strategyPivotHeader": ({ count }) => `🔀 STRATEGY PIVOT: ${count} total failures detected.`,
    "system.strategyPivotBody": "The current approach is not working. Dispatch ARCHITECT to analyze the problem from scratch and propose a fundamentally different strategy.",
    "system.strategyPivotTail": "Then apply the new strategy. Do NOT keep retrying the same approach.",
    "system.ralphHeader": "🔄 Ralph Loop: heavy editing detected on same file(s):",
    "system.ralphKeepGoing": "Keep driving — the Ralph Loop should keep iterating until verified resolution.",
    "system.sessionStats": ({ edits, calls, elapsed }) =>
      `📊 Session stats: ${edits} edits, ${calls} tool calls, ${elapsed}s elapsed.`,
    "system.iterationWarning": "Significant iteration with failures. Consider a fundamentally different approach — but keep going.",
    "compaction.contextHeader": ({ body }) => `Project context (preserve): ${body}`,
    "tool.edit": "Read the file first. Make the smallest correct change. Verify after editing.",
    "tool.write": "Only write new files when explicitly needed. Prefer editing existing files.",
    "tool.bash": "Commands run in non-interactive mode. No interactive editors, pagers, or REPLs. Use -c flags for scripting.",
    "tool.task": "Dispatch subagents with: TASK (atomic goal), OUTCOME (success criteria), MUST DO, MUST NOT DO, CONTEXT.",
    "tool.glob": "Use specific patterns. Avoid '**/*' unless genuinely needed — prefer scoped searches.",
    "tool.grep": "Use specific regex patterns. Combine with include filter for targeted search.",
    "tool.read": "Read only what you need. Use offset/limit for large files. Check file-info tool for quick metadata.",
    "tool.webfetch": "Only fetch URLs when you genuinely need external information. Prefer local docs and code first.",
    "tool.todowrite": "Keep todos current. Mark completed immediately. One in_progress at a time.",
    "dispatch.toSubagent": [
      ({ from, to, goal }) => goal ? `🎯 ${from} → ${to}: ${goal}` : `🎯 ${from} → ${to}: dispatching subtask`,
      ({ from, to, goal }) => goal ? `▶ ${from} hands off to ${to}: ${goal}` : `▶ ${from} hands off to ${to}`,
      ({ from, to, goal }) => goal ? `📡 ${from} → ${to} | ${goal}` : `📡 ${from} → ${to} (subtask)`,
      ({ from, to, goal }) => goal ? `🤝 ${from} delegates "${goal}" to ${to}` : `🤝 ${from} delegates to ${to}`,
    ],
    "dispatch.fromResolver": [
      ({ to }) => `🎯 dispatching ${to} subagent`,
      ({ to }) => `▶ spinning up ${to}`,
      ({ to }) => `📡 ${to} on deck`,
    ],
    "dispatch.coder": [
      ({ goal }) => goal ? `🔧 coder is on it: ${goal}` : "🔧 coder picks up the implementation work",
      ({ goal }) => goal ? `🔧 handing the patch over to coder — ${goal}` : "🔧 coder takes the wheel for the edit",
      ({ goal }) => goal ? `🔧 coder: smallest correct change for "${goal}"` : "🔧 coder: smallest correct change incoming",
      ({ goal }) => goal ? `🛠 coder cracks knuckles — ${goal}` : "🛠 coder cracks knuckles. Patch time.",
      ({ goal }) => goal ? `🧰 coder enters the chat. Job: ${goal}` : "🧰 coder enters the chat. Time to do the boring correct thing.",
      ({ goal }) => goal ? `⌨️ coder pinning down: ${goal}` : "⌨️ coder pinning down the exact lines",
      ({ goal }) => goal ? `🪛 coder turning the screw on ${goal}` : "🪛 coder turning the screws carefully",
      ({ goal }) => goal ? `🔧 coder takes the ticket — ${goal}` : "🔧 coder takes the ticket. No heroics, just the fix.",
      ({ goal }) => goal ? `🎯 coder, target: ${goal}` : "🎯 coder locked on the next change",
      ({ goal }) => goal ? `🧑‍💻 coder rolls up the sleeves — ${goal}` : "🧑‍💻 coder rolls up the sleeves",
      ({ goal }) => goal ? `🚧 coder on site: ${goal}` : "🚧 coder on site. Hard hat goes on.",
      ({ goal }) => goal ? `⚙️ coder warming the engine — ${goal}` : "⚙️ coder warming the engine",
      ({ goal }) => goal ? `🤝 baton to coder: ${goal}` : "🤝 baton passes to coder",
      ({ goal }) => goal ? `✍️ coder ready to type — ${goal}` : "✍️ coder ready to type the boring correct fix",
      ({ goal }) => goal ? `🧪 coder will measure twice for "${goal}"` : "🧪 coder will measure twice, cut once",
      ({ goal }) => goal ? `📎 coder pulls the relevant context for ${goal}` : "📎 coder pulls the relevant context first",
      ({ goal }) => goal ? `🏃 coder off to the keys — ${goal}` : "🏃 coder off to the keys",
      ({ goal }) => goal ? `🧱 coder lays one brick: ${goal}` : "🧱 coder lays one brick at a time",
      ({ goal }) => goal ? `🔨 coder, hammer time on "${goal}"` : "🔨 coder, hammer time",
      ({ goal }) => goal ? `🛟 coder rescues the diff — ${goal}` : "🛟 coder rescues the diff",
    ],
    "dispatch.reviewer": [
      ({ goal }) => goal ? `🔎 reviewer takes a look: ${goal}` : "🔎 reviewer reads the diff (no edits)",
      ({ goal }) => goal ? `🔎 reviewer auditing — ${goal}` : "🔎 reviewer auditing the change",
      ({ goal }) => goal ? `🔎 reviewer cross-checking "${goal}"` : "🔎 reviewer cross-checking quality",
      ({ goal }) => goal ? `👓 reviewer puts on the glasses — ${goal}` : "👓 reviewer puts on the glasses. Quiet for a sec.",
      ({ goal }) => goal ? `🧐 reviewer skeptical-but-fair pass on ${goal}` : "🧐 reviewer doing the skeptical-but-fair pass",
      ({ goal }) => goal ? `🔎 reviewer hunts the silent regression in ${goal}` : "🔎 reviewer hunting silent regressions",
      ({ goal }) => goal ? `📝 reviewer marking margins on "${goal}"` : "📝 reviewer marking the margins",
    ],
    "dispatch.deepReviewer": [
      ({ goal }) => goal ? `🛡 deep-reviewer: rigorous pass on ${goal}` : "🛡 deep-reviewer doing a rigorous read-only pass",
      ({ goal }) => goal ? `🛡 deep-reviewer engaged for "${goal}"` : "🛡 deep-reviewer engaged for risky surface area",
      ({ goal }) => goal ? `⚖️ deep-reviewer weighing every edge of ${goal}` : "⚖️ deep-reviewer weighing every edge case",
      ({ goal }) => goal ? `🛡 deep-reviewer slow-reads the diff — ${goal}` : "🛡 deep-reviewer slow-reads the diff",
      ({ goal }) => goal ? `🔬 deep-reviewer dissecting "${goal}" line by line` : "🔬 deep-reviewer dissecting line by line",
    ],
    "dispatch.explorer": [
      ({ goal }) => goal ? `🧭 explorer scouts the code: ${goal}` : "🧭 explorer scouts the codebase",
      ({ goal }) => goal ? `🧭 explorer mapping "${goal}"` : "🧭 explorer mapping the territory",
      ({ goal }) => goal ? `🧭 explorer hunts for: ${goal}` : "🧭 explorer hunts for relevant files",
      ({ goal }) => goal ? `🗺 explorer sketching the lay of the land for ${goal}` : "🗺 explorer sketching the lay of the land",
      ({ goal }) => goal ? `🔭 explorer takes a wide read on ${goal}` : "🔭 explorer takes a wide read",
      ({ goal }) => goal ? `🧭 explorer tailing references for "${goal}"` : "🧭 explorer tailing references",
      ({ goal }) => goal ? `🌲 explorer wandering into the codebase — ${goal}` : "🌲 explorer wandering into the codebase",
    ],
    "dispatch.planner": [
      ({ goal }) => goal ? `🗺 planner sketches a plan for: ${goal}` : "🗺 planner sketches the approach",
      ({ goal }) => goal ? `🗺 planner laying out steps — ${goal}` : "🗺 planner laying out the steps",
      ({ goal }) => goal ? `📐 planner blueprinting ${goal}` : "📐 planner blueprinting the approach",
      ({ goal }) => goal ? `🗂 planner ordering the moves for "${goal}"` : "🗂 planner ordering the moves",
      ({ goal }) => goal ? `🪜 planner stacking phases for ${goal}` : "🪜 planner stacking phases",
    ],
    "dispatch.architect": [
      ({ goal }) => goal ? `🏛 architect reframes the problem: ${goal}` : "🏛 architect reframes the problem",
      ({ goal }) => goal ? `🏛 architect proposing a new design for ${goal}` : "🏛 architect proposing a new design",
      ({ goal }) => goal ? `🏗 architect zooming out on ${goal}` : "🏗 architect zooming out",
      ({ goal }) => goal ? `🏛 architect: 'let's draw it first' — ${goal}` : "🏛 architect: 'let's draw it first'",
      ({ goal }) => goal ? `📐 architect cross-cutting concerns on "${goal}"` : "📐 architect cross-cutting concerns",
    ],
    "dispatch.researcher": [
      ({ goal }) => goal ? `📚 researcher digs into the docs for ${goal}` : "📚 researcher digs into docs and code",
      ({ goal }) => goal ? `📚 researcher pulling references for "${goal}"` : "📚 researcher pulling references",
      ({ goal }) => goal ? `🔬 researcher reading the upstream for ${goal}` : "🔬 researcher reading the upstream",
      ({ goal }) => goal ? `🗃 researcher cross-referencing "${goal}"` : "🗃 researcher cross-referencing prior art",
    ],
    "dispatch.debugger": [
      ({ goal }) => goal ? `🐛 debugger tracking the root cause of ${goal}` : "🐛 debugger tracking the root cause",
      ({ goal }) => goal ? `🐛 debugger reproducing "${goal}"` : "🐛 debugger reproducing the failure",
      ({ goal }) => goal ? `🔦 debugger flashlight on ${goal}` : "🔦 debugger flashlight on the stack",
      ({ goal }) => goal ? `🪤 debugger setting a trap for "${goal}"` : "🪤 debugger setting a trap",
      ({ goal }) => goal ? `🧪 debugger isolating ${goal} in a minimal repro` : "🧪 debugger isolating the failure",
    ],
    "dispatch.codex": [
      ({ goal }) => goal ? `🧠 codex tackles ${goal}` : "🧠 codex tackles a hard reasoning task",
      ({ goal }) => goal ? `🧠 codex chewing on "${goal}"` : "🧠 codex chewing on a thorny piece",
      ({ goal }) => goal ? `📚 codex consults its tomes for ${goal}` : "📚 codex consults its tomes",
    ],
    "dispatch.glm": [
      ({ goal }) => goal ? `⚡ glm handles ${goal}` : "⚡ glm handles the next slice",
      ({ goal }) => goal ? `⚡ glm sprinting through "${goal}"` : "⚡ glm sprinting through the next slice",
      ({ goal }) => goal ? `🐎 glm fast lane on ${goal}` : "🐎 glm fast lane",
    ],
    "dispatch.gpt": [
      ({ goal }) => goal ? `🚀 gpt drives ${goal}` : "🚀 gpt drives the next slice",
      ({ goal }) => goal ? `🚀 gpt boosting through "${goal}"` : "🚀 gpt boosting through",
      ({ goal }) => goal ? `🎯 gpt locked on ${goal}` : "🎯 gpt locked on the target",
    ],
    "dispatch.gptCoder": [
      ({ goal }) => goal ? `🧠 gpt-coder handles a tough patch: ${goal}` : "🧠 gpt-coder handles a tough patch",
      ({ goal }) => goal ? `🧠 gpt-coder taking the hard one — ${goal}` : "🧠 gpt-coder taking the hard one",
      ({ goal }) => goal ? `🛠 gpt-coder splicing the gnarly part of "${goal}"` : "🛠 gpt-coder splicing the gnarly part",
    ],
    "dispatch.completed": [
      ({ to }) => `✅ ${to} done — control back to resolver`,
      ({ to }) => `✅ ${to} reported back — resolver resumes`,
      ({ to }) => `✅ ${to} wrapped — resolver picks up the result`,
      ({ to }) => `🏁 ${to} cleared — back to the main thread`,
      ({ to }) => `📬 ${to} dropped the result. Resolver picks it up.`,
      ({ to }) => `👌 ${to} closed it out`,
      ({ to }) => `✅ ${to} returns with a clean report`,
      ({ to }) => `🎬 ${to} cuts. Scene returns to resolver.`,
      ({ to }) => `📦 ${to} delivered — resolver opens the box`,
      ({ to }) => `🎤 ${to} hands the mic back to resolver`,
      ({ to }) => `🛬 ${to} touchdown — back to taxi`,
      ({ to }) => `🧾 ${to} files the report`,
      ({ to }) => `🪃 ${to} comes back with the answer`,
      ({ to }) => `🛎 ${to} rings the done bell`,
      ({ to }) => `🤝 ${to} → resolver: handed off cleanly`,
    ],
    "dispatch.failed": [
      ({ to }) => `⚠️ ${to} hit a snag — resolver inspecting`,
      ({ to }) => `⚠️ ${to} couldn't close it — resolver retries with a different plan`,
      ({ to }) => `💥 ${to} stumbled — diagnosing root cause now`,
      ({ to }) => `🩹 ${to} bounced — resolver picking a new angle`,
      ({ to }) => `⛔️ ${to} reports trouble. Time for a different approach.`,
      ({ to }) => `😬 ${to} ran into a wall — let's not bang harder, let's go around`,
      ({ to }) => `🧯 ${to} hit smoke — resolver puts it out and re-plans`,
      ({ to }) => `🔁 ${to} retry needed — same goal, new path`,
      ({ to }) => `🥲 ${to} came back empty — diagnosing`,
      ({ to }) => `🪤 ${to} caught in a trap — resolver freeing it`,
    ],
    "narration.editing": [
      "✏️ shaping the patch",
      "✏️ making the change",
      "✏️ rewriting the relevant lines",
      "🖋 putting it on paper",
      "🛠 tightening the bolts",
      "✏️ surgical edit incoming",
      "✏️ small precise change — measure twice",
      "🪡 stitching the lines together",
      "🔧 nudging the bits into place",
      "✂️ snipping the wrong line, splicing the right one",
      "✏️ keystroke by keystroke",
      "🪚 trimming the dead code",
      "🧷 pinning the right value",
      "🩹 small patch on the bleed",
      "🎚 dialing in the value",
      "🪛 minor adjustment, major payoff",
      "🖌 brushstroke on the patch",
      "🎯 landing the change exactly",
      "🪞 mirroring the existing style",
      "🧼 quiet refactor in passing",
    ],
    "narration.searching": [
      "🔍 grepping the codebase",
      "🔍 looking for the right hook",
      "🔍 scanning for the pattern",
      "🕵 sniffing out the call sites",
      "🔎 tracing the symbol",
      "🔍 casting a wide net",
      "🧭 narrowing the search",
      "🪤 setting filters on the search",
      "🔍 walking the references",
      "🔭 zooming in on a suspect file",
      "🕸 following the import graph",
      "🔍 finding the needle",
      "🗺 cross-referencing locations",
      "🧲 magnet on the symbol name",
      "🕯 holding up the candle to the dark module",
    ],
    "narration.reading": [
      "📖 reading the file",
      "📖 loading context",
      "📖 checking what's already there",
      "📚 doing the reading first",
      "📖 absorbing the surrounding code",
      "👀 skimming for relevant bits",
      "📖 not skipping the comments",
      "📃 paging through the function",
      "📖 'measure first' phase",
      "🔍 reading the contract before signing",
      "📑 catching up with the file",
      "📖 reading the whole thing — no shortcuts",
      "🧠 building the mental model first",
      "📖 picking up the thread",
      "📕 RTFM on this module",
      "🪟 looking through the window of the function",
    ],
    "narration.thinking": [
      "🧠 thinking through the next move",
      "🧠 weighing the options",
      "🧠 picking the smallest correct path",
      "💭 mulling it over",
      "🧠 connecting the dots",
      "🧠 sleeping on it for a half-second",
      "🤔 considering the boring option (it usually wins)",
      "🧠 running the trade-offs",
      "🪙 flipping the option coin... but with reasons",
      "🧠 picturing the call graph",
      "🤨 asking 'what would break?' before acting",
      "🧠 simulating it in my head first",
      "💡 small idea forming",
      "🧠 narrowing it to one move",
      "🪑 sitting with the design for a beat",
      "🧠 'do nothing' is also an option, considering it",
      "🤔 looking for the cheaper fix",
      "🧠 if X then Y else Z — walking the branches",
    ],
    "narration.bashing": [
      "💻 running a shell step",
      "💻 executing the command",
      "💻 firing the script",
      "🐚 dropping into the shell",
      "💻 letting the command speak",
      "📟 piping bits around",
      "🖥 talking to the OS",
      "💻 a quick subprocess",
      "🛎 ringing the bell on a CLI",
      "🚀 launching the command",
      "🐚 from /bin with love",
      "⌨️ shelling out",
      "💻 expect-non-interactive mode engaged",
    ],
    "narration.compacting": [
      "🗑 dropping the older context to keep momentum",
      "🗑 trimming the transcript — we keep driving",
      "🗑 sweeping up old chatter",
      "🗑 making room for the next stretch",
      "🗑 archive the noise, keep the signal",
    ],
    "narration.writing": [
      "📝 writing the new file",
      "📝 fresh file going down",
      "📝 putting it in writing",
      "📜 laying out the new module",
      "📝 first draft hitting disk",
      "🆕 brand-new file on the way",
      "📝 scaffolding the file",
    ],
    "narration.testing": [
      "🧪 running the tests",
      "🧪 letting the suite speak",
      "🧪 test runner — the only honest reviewer",
      "🧪 spinning up the tests",
      "🧪 watching the green/red verdict",
      "🧪 tests get to vote",
      "🧪 burning some CPU on truth",
    ],
    "narration.typechecking": [
      "🧬 type-checking",
      "🧬 letting tsc do its job",
      "🧬 chasing red squigglies",
      "🧬 type narrowing pass",
      "🧬 making the compiler happy",
      "🧬 fighting it out with the type system",
    ],
    "narration.linting": [
      "🧹 running the linter",
      "🧹 tidying up the styling",
      "🧹 letting the linter complain",
      "🧹 dusting off the formatting",
      "🧹 polishing — fast pass",
      "🧹 letting the rules talk",
    ],
    "narration.git": [
      "🌳 talking to git",
      "🌳 checking the tree",
      "🌳 reading the history",
      "🌳 quick git glance",
      "🌳 reading the blame",
      "🌳 inspecting the diff",
      "🌳 listening to git",
    ],
    "narration.fetch": [
      "🌐 fetching from the web",
      "🌐 grabbing the docs",
      "🌐 stepping out to the network",
      "🌐 quick trip to the docs",
      "🌐 reading the upstream",
      "🛰 satellite link to the web",
    ],
    "narration.todo": [
      "📋 updating the todo board",
      "📋 marking progress",
      "📋 keeping the list honest",
      "📋 ticking the box",
      "📋 next item, please",
      "📋 keeping the tasks honest",
    ],
    "narration.diagnostics": [
      "📡 pulling LSP diagnostics",
      "📡 reading the current errors",
      "📡 letting the language server tell us where it hurts",
      "📡 LSP says...",
      "📡 listening for the squigglies",
      "📡 reading what the IDE already knows",
    ],
    "narration.context": [
      "📦 loading project context",
      "📦 gathering the relevant docs",
      "📦 priming the working set",
      "📦 stocking up on context",
      "📦 collecting the relevant files",
      "📦 minimum-viable context, loading",
    ],
    "narration.verifyPass": [
      "✅ green build — onward",
      "✅ verification passed",
      "✅ the tests are happy",
      "🟢 all checks green",
      "✅ clean run — moving on",
      "🎉 verify clear",
      "✅ build sane, tests happy",
    ],
    "narration.verifyFail": [
      "❌ verification failed — diagnosing",
      "❌ red build — finding the bite",
      "❌ tests are unhappy. Reading the output.",
      "🔴 verify says no — reading the failure",
      "❌ something's biting — let's find the tooth",
      "❌ red light. Pulling logs.",
    ],
    "narration.idle": [
      "☕ catching breath, then back to it",
      "🧘 brief pause — gathering the next step",
      "🪑 sitting with the problem for a beat",
      "🌬 short exhale before the next move",
      "🪑 brief regroup",
    ],
    "strategy.smallerPieces": "Break the problem into smaller pieces. Edit one function at a time, verify between each.",
    "strategy.differentFile": "Check if the error is actually in a DIFFERENT file — the real issue may be upstream.",
    "strategy.readTest": "Read the test file if it exists — the test often reveals the expected behavior.",
    "strategy.checkImports": "Check imports — missing or wrong imports are a common cause of cascading errors.",
    "strategy.searchSimilar": "Use resolve-search to find similar patterns elsewhere in the codebase.",
    "strategy.rereadFile": "Re-read the file carefully. You may be missing existing code that conflicts with your edit.",
    "strategy.tryDifferent": "Try a completely different approach — revert your last change and try a different fix.",
    "strategy.useDiagnostics": "Use resolve-diagnostics to check current LSP errors before the next edit.",
    "strategy.suggestionLabel": "Strategy suggestion",
  },
  ko: {
    "reminder.verify": [
      "리마인더: 완료 보고 전에 변경사항을 검증하세요 (resolve-verify).",
      "잠깐 — typecheck/lint/test 가 통과하기 전에는 완료 보고 금지.",
      "확인: 검증 명령은 실제로 돌렸어요? 'diff 가 그럴듯해 보임' 은 증거가 아니에요.",
      "마무리 전에: 검증 게이트를 통과시키세요. 컴파일된다 ≠ 동작한다.",
      "리마인더: 빌드가 초록색이어야 완료입니다. resolve-verify 실행하세요.",
      "주의: 검증이 통과했을 때 알려주세요. diff 가 좋아 보일 때 말고요.",
    ],
    "reminder.ralphLoopText": [
      "🔄 Ralph Loop: 반복이 많이 감지됐어요. resolve-diagnostics 로 현재 상태를 확인하고, 다른 접근을 시도해보세요. 멈추지 말고 끝까지 갑니다.",
      "🔄 Ralph Loop 진행 중. 같은 자리에서 맴돌고 있어요 — 다음 시도 전에 접근을 바꾸세요.",
      "🔄 Ralph Loop: 휘청거리는 느낌이에요. 진단부터 읽고, 새 각도로 가세요.",
    ],
    "system.driveResolution": "검증된 해결까지 끌고 가세요. 의도를 분류하고, 집중된 서브에이전트를 위임하고, 각 단계 후 검증하고, 실패 시 반복하세요. 검증이 끝났을 때만 완료를 보고합니다.",
    "system.projectKnowledge": ({ files }) => `프로젝트 지식 문서: ${files}. 코드 수정 전에 필요하면 먼저 읽으세요.`,
    "system.contextDocs": ({ files }) => `컨텍스트 문서: ${files}. MVI 원칙: 작업에 관련 있는 문서만 로드합니다.`,
    "system.verifyCommands": ({ commands }) => `검증 명령: ${commands}. 변경 후 실행하세요.`,
    "system.typescriptMandatory": "TypeScript 프로젝트입니다 — 타입 안전성 필수. `as any` 와 `@ts-ignore` 금지.",
    "system.failuresHeader": "⚠️ 반복되는 실패가 감지됐어요:",
    "system.failuresFooter": "멈추지 마세요 — 같은 목표를 다른 접근으로 시도하세요. Ralph Loop 는 완료까지 끌고 가는 게 일입니다.",
    "system.strategyPivotHeader": ({ count }) => `🔀 전략 전환: 총 ${count}회의 실패가 감지됐어요.`,
    "system.strategyPivotBody": "지금 접근은 통하지 않아요. ARCHITECT 를 위임해서 문제를 처음부터 분석하고 근본적으로 다른 전략을 제안받으세요.",
    "system.strategyPivotTail": "그 다음 새 전략을 적용하세요. 같은 접근을 다시 시도하지 마세요.",
    "system.ralphHeader": "🔄 Ralph Loop: 같은 파일을 너무 자주 수정 중이에요:",
    "system.ralphKeepGoing": "계속 진행하세요 — Ralph Loop 는 검증된 해결이 나올 때까지 반복합니다.",
    "system.sessionStats": ({ edits, calls, elapsed }) =>
      `📊 세션 통계: ${edits}회 편집, ${calls}회 도구 호출, ${elapsed}초 경과.`,
    "system.iterationWarning": "실패와 함께 반복이 많아졌어요. 근본적으로 다른 접근을 고려하세요 — 하지만 멈추지는 마세요.",
    "compaction.contextHeader": ({ body }) => `프로젝트 컨텍스트 (보존): ${body}`,
    "tool.edit": "먼저 파일을 읽으세요. 가장 작은 정확한 변경을 만드세요. 편집 후 검증하세요.",
    "tool.write": "명시적으로 필요할 때만 새 파일을 만드세요. 기존 파일 편집을 우선합니다.",
    "tool.bash": "명령은 비대화형으로 실행됩니다. 대화형 에디터, 페이저, REPL 금지. 스크립팅용 -c 플래그 사용.",
    "tool.task": "서브에이전트 위임 시: TASK(원자적 목표), OUTCOME(성공 기준), MUST DO, MUST NOT DO, CONTEXT 를 명시하세요.",
    "tool.glob": "구체적인 패턴을 쓰세요. 정말 필요할 때 외엔 '**/*' 피하기 — 범위가 좁은 검색을 선호합니다.",
    "tool.grep": "구체적인 정규식을 쓰세요. include 필터와 조합해 대상을 좁히세요.",
    "tool.read": "필요한 만큼만 읽으세요. 큰 파일은 offset/limit 사용. 메타정보가 필요하면 file-info 도구를 먼저 확인하세요.",
    "tool.webfetch": "정말 외부 정보가 필요할 때만 URL 을 가져오세요. 로컬 문서와 코드를 먼저 살핍니다.",
    "tool.todowrite": "할 일을 최신 상태로 유지하세요. 완료 즉시 표시. in_progress 는 한 번에 하나만.",
    "dispatch.toSubagent": [
      ({ from, to, goal }) => goal ? `🎯 ${from} → ${to}: ${goal}` : `🎯 ${from} → ${to}: 서브에이전트에 작업 위임`,
      ({ from, to, goal }) => goal ? `▶ ${from} 가 ${to} 에게 넘김 — ${goal}` : `▶ ${from} 가 ${to} 에게 작업을 넘깁니다`,
      ({ from, to, goal }) => goal ? `📡 ${from} → ${to} | ${goal}` : `📡 ${from} → ${to} (서브태스크)`,
      ({ from, to, goal }) => goal ? `🤝 ${from} 가 "${goal}" 를 ${to} 에게 위임` : `🤝 ${from} 가 ${to} 에게 위임`,
    ],
    "dispatch.fromResolver": [
      ({ to }) => `🎯 ${to} 서브에이전트 호출`,
      ({ to }) => `▶ ${to} 가동`,
      ({ to }) => `📡 ${to} 출동 준비`,
    ],
    "dispatch.coder": [
      ({ goal }) => goal ? `🔧 코더 출동: ${goal}` : "🔧 코더가 구현 작업을 받았어요",
      ({ goal }) => goal ? `🔧 코더에게 패치 위임 — ${goal}` : "🔧 코더가 편집을 맡습니다",
      ({ goal }) => goal ? `🔧 코더: "${goal}" 에 대해 가장 작은 정확한 변경 진행` : "🔧 코더: 가장 작은 정확한 변경 들어갑니다",
      ({ goal }) => goal ? `🛠 코더가 손가락 풀고 — ${goal}` : "🛠 코더가 손가락 풀고 시작합니다",
      ({ goal }) => goal ? `🧰 코더 등판. 작업: ${goal}` : "🧰 코더 등판. 화려한 거 없이 정확한 거 하나 박습니다.",
      ({ goal }) => goal ? `⌨️ 코더가 정확히 어느 줄인지 짚는 중 — ${goal}` : "⌨️ 코더가 정확히 어느 줄인지 짚는 중",
      ({ goal }) => goal ? `🪛 코더가 "${goal}" 의 나사 조이는 중` : "🪛 코더가 나사 조이는 중",
      ({ goal }) => goal ? `🔧 코더가 티켓을 받음 — ${goal}` : "🔧 코더가 티켓을 받았습니다. 영웅놀이 없이 정공법으로.",
      ({ goal }) => goal ? `🎯 코더, 타겟: ${goal}` : "🎯 코더가 다음 변경에 락온",
      ({ goal }) => goal ? `🧑‍💻 코더가 소매 걷어붙임 — ${goal}` : "🧑‍💻 코더가 소매 걷어붙입니다",
      ({ goal }) => goal ? `🚧 코더 현장 도착: ${goal}` : "🚧 코더 현장 도착. 안전모 착용.",
      ({ goal }) => goal ? `⚙️ 코더 엔진 워밍업 — ${goal}` : "⚙️ 코더 엔진 워밍업",
      ({ goal }) => goal ? `🤝 바통 코더에게: ${goal}` : "🤝 바통이 코더에게 넘어갑니다",
      ({ goal }) => goal ? `✍️ 코더가 타이핑 준비 — ${goal}` : "✍️ 코더가 지루하지만 정확한 수정을 타이핑할 준비",
      ({ goal }) => goal ? `🧪 코더는 "${goal}" 두 번 잴 거예요` : "🧪 코더는 두 번 재고 한 번 자릅니다",
      ({ goal }) => goal ? `📎 코더가 ${goal} 관련 컨텍스트 끌어오는 중` : "📎 코더가 관련 컨텍스트부터 끌어옵니다",
      ({ goal }) => goal ? `🏃 코더가 키보드로 — ${goal}` : "🏃 코더가 키보드로 달려갑니다",
      ({ goal }) => goal ? `🧱 코더가 벽돌 한 장씩: ${goal}` : "🧱 코더가 벽돌을 한 장씩 쌓습니다",
      ({ goal }) => goal ? `🔨 코더, "${goal}" 망치 타임` : "🔨 코더, 망치 타임",
      ({ goal }) => goal ? `🛟 코더가 diff 구조 — ${goal}` : "🛟 코더가 diff 를 구조합니다",
      ({ goal }) => goal ? `🐢 코더가 천천히, 그러나 정확히 — ${goal}` : "🐢 코더가 천천히, 그러나 정확히",
      ({ goal }) => goal ? `🍵 코더가 한 모금 마시고 ${goal} 들어갑니다` : "🍵 코더가 한 모금 마시고 들어갑니다",
    ],
    "dispatch.reviewer": [
      ({ goal }) => goal ? `🔎 리뷰어 확인: ${goal}` : "🔎 리뷰어가 변경사항을 읽습니다 (편집 없음)",
      ({ goal }) => goal ? `🔎 리뷰어 감사 — ${goal}` : "🔎 리뷰어가 변경을 감사 중",
      ({ goal }) => goal ? `🔎 리뷰어 교차 검증 "${goal}"` : "🔎 리뷰어 품질 교차 검증",
      ({ goal }) => goal ? `👓 리뷰어가 안경 올리고 — ${goal}` : "👓 리뷰어가 안경 올리는 중. 잠깐 조용히.",
      ({ goal }) => goal ? `🧐 리뷰어가 "${goal}" 에 까칠하게 한 번 봅니다` : "🧐 리뷰어가 까칠하지만 공정하게 한 번 봅니다",
      ({ goal }) => goal ? `🔎 리뷰어가 ${goal} 의 조용한 회귀 버그를 사냥 중` : "🔎 리뷰어가 조용한 회귀 버그를 사냥 중",
      ({ goal }) => goal ? `📝 리뷰어가 "${goal}" 여백에 메모를 다는 중` : "📝 리뷰어가 여백에 메모를 다는 중",
    ],
    "dispatch.deepReviewer": [
      ({ goal }) => goal ? `🛡 딥리뷰어: ${goal} 엄격 검토` : "🛡 딥리뷰어가 엄격 읽기 전용 검토를 진행",
      ({ goal }) => goal ? `🛡 딥리뷰어 투입 — "${goal}"` : "🛡 위험 영역에 딥리뷰어 투입",
      ({ goal }) => goal ? `⚖️ 딥리뷰어가 ${goal} 의 모든 엣지를 저울질` : "⚖️ 딥리뷰어가 모든 엣지 케이스를 저울질",
      ({ goal }) => goal ? `🛡 딥리뷰어가 diff 를 천천히 — ${goal}` : "🛡 딥리뷰어가 diff 를 천천히 읽는 중",
      ({ goal }) => goal ? `🔬 딥리뷰어가 "${goal}" 를 한 줄씩 해부 중` : "🔬 딥리뷰어가 한 줄씩 해부 중",
    ],
    "dispatch.explorer": [
      ({ goal }) => goal ? `🧭 익스플로러 탐색: ${goal}` : "🧭 익스플로러가 코드베이스를 탐색합니다",
      ({ goal }) => goal ? `🧭 익스플로러 지도 작성 "${goal}"` : "🧭 익스플로러가 영역을 매핑합니다",
      ({ goal }) => goal ? `🧭 익스플로러 추적: ${goal}` : "🧭 익스플로러가 관련 파일을 추적합니다",
      ({ goal }) => goal ? `🗺 익스플로러가 ${goal} 의 지형을 그리는 중` : "🗺 익스플로러가 지형을 그리는 중",
      ({ goal }) => goal ? `🔭 익스플로러가 ${goal} 를 넓게 읽는 중` : "🔭 익스플로러가 넓게 읽는 중",
      ({ goal }) => goal ? `🧭 익스플로러가 "${goal}" 의 참조를 따라가는 중` : "🧭 익스플로러가 참조를 따라가는 중",
      ({ goal }) => goal ? `🌲 익스플로러가 코드베이스 속으로 — ${goal}` : "🌲 익스플로러가 코드베이스 속으로 들어갑니다",
    ],
    "dispatch.planner": [
      ({ goal }) => goal ? `🗺 플래너 설계: ${goal}` : "🗺 플래너가 접근 방안을 그립니다",
      ({ goal }) => goal ? `🗺 플래너 단계 정리 — ${goal}` : "🗺 플래너가 단계를 정리합니다",
      ({ goal }) => goal ? `📐 플래너가 ${goal} 청사진 작성 중` : "📐 플래너가 청사진을 작성 중",
      ({ goal }) => goal ? `🗂 플래너가 "${goal}" 의 순서를 정리 중` : "🗂 플래너가 순서를 정리 중",
      ({ goal }) => goal ? `🪜 플래너가 ${goal} 단계를 쌓는 중` : "🪜 플래너가 단계를 쌓는 중",
    ],
    "dispatch.architect": [
      ({ goal }) => goal ? `🏛 아키텍트가 ${goal} 문제를 재정의` : "🏛 아키텍트가 문제를 재정의합니다",
      ({ goal }) => goal ? `🏛 아키텍트가 ${goal} 의 새 설계 제안` : "🏛 아키텍트가 새로운 설계를 제안합니다",
      ({ goal }) => goal ? `🏗 아키텍트가 ${goal} 를 줌아웃해서 보는 중` : "🏗 아키텍트가 줌아웃해서 보는 중",
      ({ goal }) => goal ? `🏛 아키텍트: '먼저 그림부터' — ${goal}` : "🏛 아키텍트: '먼저 그림부터 그리자'",
      ({ goal }) => goal ? `📐 아키텍트가 "${goal}" 의 횡단 관심사를 정리` : "📐 아키텍트가 횡단 관심사를 정리",
    ],
    "dispatch.researcher": [
      ({ goal }) => goal ? `📚 리서처가 ${goal} 관련 문서 조사` : "📚 리서처가 문서와 코드를 조사합니다",
      ({ goal }) => goal ? `📚 리서처가 "${goal}" 참고자료 수집` : "📚 리서처가 참고자료를 수집합니다",
      ({ goal }) => goal ? `🔬 리서처가 ${goal} 의 업스트림을 읽는 중` : "🔬 리서처가 업스트림을 읽는 중",
      ({ goal }) => goal ? `🗃 리서처가 "${goal}" 의 선행 사례 교차 참조` : "🗃 리서처가 선행 사례 교차 참조",
    ],
    "dispatch.debugger": [
      ({ goal }) => goal ? `🐛 디버거가 ${goal} 의 근본 원인 추적` : "🐛 디버거가 근본 원인을 추적합니다",
      ({ goal }) => goal ? `🐛 디버거가 "${goal}" 재현 중` : "🐛 디버거가 실패를 재현합니다",
      ({ goal }) => goal ? `🔦 디버거가 ${goal} 에 손전등을 비춤` : "🔦 디버거가 스택에 손전등을 비추는 중",
      ({ goal }) => goal ? `🪤 디버거가 "${goal}" 함정 설치 중` : "🪤 디버거가 함정을 설치하는 중",
      ({ goal }) => goal ? `🧪 디버거가 ${goal} 를 최소 재현으로 격리` : "🧪 디버거가 최소 재현으로 격리 중",
    ],
    "dispatch.codex": [
      ({ goal }) => goal ? `🧠 코덱스가 ${goal} 처리` : "🧠 코덱스가 까다로운 추론 작업을 받습니다",
      ({ goal }) => goal ? `🧠 코덱스가 "${goal}" 를 곱씹는 중` : "🧠 코덱스가 까다로운 부분을 곱씹는 중",
      ({ goal }) => goal ? `📚 코덱스가 ${goal} 의 비전을 들춰보는 중` : "📚 코덱스가 비전을 들춰보는 중",
    ],
    "dispatch.glm": [
      ({ goal }) => goal ? `⚡ GLM 이 ${goal} 처리` : "⚡ GLM 이 다음 슬라이스를 처리합니다",
      ({ goal }) => goal ? `⚡ GLM 이 "${goal}" 를 빠르게 통과 중` : "⚡ GLM 이 다음 슬라이스를 빠르게 통과 중",
      ({ goal }) => goal ? `🐎 GLM 패스트레인 — ${goal}` : "🐎 GLM 패스트레인",
    ],
    "dispatch.gpt": [
      ({ goal }) => goal ? `🚀 GPT 가 ${goal} 진행` : "🚀 GPT 가 다음 슬라이스를 끌고 갑니다",
      ({ goal }) => goal ? `🚀 GPT 가 "${goal}" 부스팅` : "🚀 GPT 가 부스팅 중",
      ({ goal }) => goal ? `🎯 GPT 가 ${goal} 에 락온` : "🎯 GPT 가 타겟에 락온",
    ],
    "dispatch.gptCoder": [
      ({ goal }) => goal ? `🧠 GPT 코더가 까다로운 패치: ${goal}` : "🧠 GPT 코더가 까다로운 패치를 받습니다",
      ({ goal }) => goal ? `🧠 GPT 코더가 어려운 거 — ${goal}` : "🧠 GPT 코더가 어려운 거 맡습니다",
      ({ goal }) => goal ? `🛠 GPT 코더가 "${goal}" 의 까다로운 부분을 봉합` : "🛠 GPT 코더가 까다로운 부분을 봉합 중",
    ],
    "dispatch.completed": [
      ({ to }) => `✅ ${to} 완료 — 리졸버에게 제어 반환`,
      ({ to }) => `✅ ${to} 보고 도착 — 리졸버가 이어 받음`,
      ({ to }) => `✅ ${to} 마무리 — 리졸버가 결과를 회수`,
      ({ to }) => `🏁 ${to} 정리됨 — 메인 스레드 복귀`,
      ({ to }) => `📬 ${to} 결과 도착. 리졸버가 받습니다.`,
      ({ to }) => `👌 ${to} 깔끔하게 종료`,
      ({ to }) => `✅ ${to} 가 깨끗한 리포트로 복귀`,
      ({ to }) => `🎬 ${to} 컷. 씬은 리졸버로 복귀.`,
      ({ to }) => `📦 ${to} 배달 완료 — 리졸버가 박스 열어봅니다`,
      ({ to }) => `🎤 ${to} 가 리졸버에게 마이크 반환`,
      ({ to }) => `🛬 ${to} 착륙 — 게이트로 이동`,
      ({ to }) => `🧾 ${to} 리포트 제출`,
      ({ to }) => `🪃 ${to} 가 답 가지고 돌아옴`,
      ({ to }) => `🛎 ${to} 가 종 울림 — 완료`,
      ({ to }) => `🤝 ${to} → 리졸버: 깔끔하게 인수인계`,
      ({ to }) => `🎁 ${to} 결과물 도착`,
    ],
    "dispatch.failed": [
      ({ to }) => `⚠️ ${to} 가 걸렸어요 — 리졸버 확인 중`,
      ({ to }) => `⚠️ ${to} 가 마무리를 못 했어요 — 리졸버가 다른 계획으로 재시도`,
      ({ to }) => `💥 ${to} 가 헛디뎠어요 — 근본 원인 진단 중`,
      ({ to }) => `🩹 ${to} 가 튕겼어요 — 리졸버가 다른 각도를 잡습니다`,
      ({ to }) => `⛔️ ${to} 가 곤란해 하는군요. 다른 접근 갑니다.`,
      ({ to }) => `😬 ${to} 가 벽에 부딪힘 — 더 세게 박지 말고 돌아갑시다`,
      ({ to }) => `🧯 ${to} 연기 발생 — 리졸버가 진화하고 재계획`,
      ({ to }) => `🔁 ${to} 재시도 필요 — 같은 목표, 다른 경로`,
      ({ to }) => `🥲 ${to} 빈손으로 복귀 — 진단 중`,
      ({ to }) => `🪤 ${to} 가 함정에 빠짐 — 리졸버가 빼내는 중`,
      ({ to }) => `🤷 ${to} 가 이번엔 안 통했네요 — 다음 카드`,
    ],
    "narration.editing": [
      "✏️ 패치 작성 중",
      "✏️ 변경 적용 중",
      "✏️ 관련 라인 재작성 중",
      "🖋 종이에 옮기는 중",
      "🛠 볼트를 조이는 중",
      "✏️ 외과적 편집 들어갑니다",
      "✏️ 작고 정확하게 — 두 번 재고 한 번 자르기",
      "🪡 라인들을 꿰매는 중",
      "🔧 비트를 제자리에 살짝 밀어 넣는 중",
      "✂️ 잘못된 줄 잘라내고 옳은 줄 붙이는 중",
      "✏️ 키 하나하나 정성껏",
      "🪚 죽은 코드 다듬는 중",
      "🧷 올바른 값으로 고정 중",
      "🩹 출혈 부위에 작은 패치",
      "🎚 값 미세 조정 중",
      "🪛 작은 조정, 큰 보상",
      "🖌 패치에 한 획",
      "🎯 정확히 그 자리에 변경 안착",
      "🪞 기존 스타일 그대로 미러링",
      "🧼 지나가며 조용히 리팩터",
      "📐 줄 맞추는 중",
      "🧩 퍼즐 한 조각 끼우는 중",
    ],
    "narration.searching": [
      "🔍 코드베이스 grep 중",
      "🔍 적절한 훅 위치 탐색",
      "🔍 패턴 스캔 중",
      "🕵 호출 지점 추적 중",
      "🔎 심볼 따라가는 중",
      "🔍 그물 넓게 던지는 중",
      "🧭 검색 범위 좁히는 중",
      "🪤 검색 필터 거는 중",
      "🔍 참조 따라 걸어가는 중",
      "🔭 의심 가는 파일 확대",
      "🕸 import 그래프 따라가는 중",
      "🔍 바늘 찾는 중",
      "🗺 위치 교차 참조 중",
      "🧲 심볼 이름에 자석 대는 중",
      "🕯 어두운 모듈에 촛불 비추는 중",
      "🐕 단서 냄새 추적 중",
      "🧐 잘 숨어 있는 호출자 찾는 중",
    ],
    "narration.reading": [
      "📖 파일을 읽는 중",
      "📖 컨텍스트 로딩",
      "📖 기존 코드 확인 중",
      "📚 일단 읽기부터",
      "📖 주변 코드를 흡수 중",
      "👀 관련 부분 훑는 중",
      "📖 주석도 빼먹지 않고",
      "📃 함수 페이지 넘기는 중",
      "📖 '먼저 재기' 단계",
      "🔍 사인하기 전에 계약서 읽는 중",
      "📑 파일 따라잡는 중",
      "📖 통째로 읽기 — 지름길 없이",
      "🧠 머릿속에 모델 먼저 세우는 중",
      "📖 끊긴 실 줍는 중",
      "📕 이 모듈은 매뉴얼대로",
      "🪟 함수의 창문 너머 보는 중",
      "🛋 차분히 앉아서 읽는 중",
      "📖 한 단락씩 찬찬히",
    ],
    "narration.thinking": [
      "🧠 다음 수를 고민 중",
      "🧠 옵션을 비교 중",
      "🧠 가장 작은 정확한 길을 고르는 중",
      "💭 곰곰이 굴려보는 중",
      "🧠 점들을 연결 중",
      "🧠 0.5초 정도 묵혀두는 중",
      "🤔 지루한 옵션 고민 중 (보통 그게 이김)",
      "🧠 트레이드오프 굴려보는 중",
      "🪙 옵션 동전 던지는 중... 단, 근거와 함께",
      "🧠 콜 그래프 머릿속에 그리는 중",
      "🤨 행동 전에 '뭐가 깨지지?' 자문 중",
      "🧠 머리속에서 먼저 시뮬레이션",
      "💡 작은 아이디어 생기는 중",
      "🧠 한 수로 좁히는 중",
      "🪑 잠깐 디자인이랑 마주 앉기",
      "🧠 '아무것도 안 하기'도 옵션, 고려 중",
      "🤔 더 싼 수정 찾는 중",
      "🧠 if X면 Y, 아니면 Z — 가지치기 중",
      "🧠 옛날 비슷한 거 떠올리는 중",
      "🤔 흠... 이거 트랩 있는 부분이지",
      "🧠 정공법으로 갈지 우회로 갈지",
    ],
    "narration.bashing": [
      "💻 쉘 단계 실행 중",
      "💻 명령 실행 중",
      "💻 스크립트 발사",
      "🐚 쉘에 내려가는 중",
      "💻 명령에 말을 시키는 중",
      "📟 비트 파이핑 중",
      "🖥 OS 한테 말 거는 중",
      "💻 잠깐 서브프로세스",
      "🛎 CLI 종 치는 중",
      "🚀 명령 발사",
      "🐚 /bin 에서 사랑을 담아",
      "⌨️ 쉘 아웃",
      "💻 비대화형 모드 가동",
    ],
    "narration.compacting": [
      "🗑 흐름 유지하려고 오래된 컨텍스트 비우는 중",
      "🗑 트랜스크립트 정리 — 멈추지 않고 계속 갑니다",
      "🗑 옛 잡담 쓸어 담는 중",
      "🗑 다음 구간 자리 마련 중",
      "🗑 노이즈는 보내고 시그널만 남깁니다",
    ],
    "narration.writing": [
      "📝 새 파일 작성 중",
      "📝 새 파일 들어갑니다",
      "📝 문서화 — 글로 남기는 중",
      "📜 새 모듈 펼치는 중",
      "📝 첫 초안 디스크로",
      "🆕 따끈한 새 파일",
      "📝 파일 스캐폴딩",
    ],
    "narration.testing": [
      "🧪 테스트 실행 중",
      "🧪 스위트에게 말을 시키는 중",
      "🧪 테스트 러너 — 유일하게 정직한 리뷰어",
      "🧪 테스트 돌리는 중",
      "🧪 초록/빨강 판결 기다리는 중",
      "🧪 테스트가 투표할 차례",
      "🧪 진실에 CPU 좀 태우는 중",
    ],
    "narration.typechecking": [
      "🧬 타입 체크 중",
      "🧬 tsc 에게 일을 시키는 중",
      "🧬 빨간 물결선 사냥 중",
      "🧬 타입 좁히기 패스",
      "🧬 컴파일러 비위 맞추는 중",
      "🧬 타입 시스템과 한 판",
    ],
    "narration.linting": [
      "🧹 린터 실행 중",
      "🧹 스타일 정리 중",
      "🧹 린터가 잔소리하게 두는 중",
      "🧹 포매팅 먼지 털기",
      "🧹 빠르게 광내는 중",
      "🧹 규칙이 말하게 두기",
    ],
    "narration.git": [
      "🌳 git 과 대화 중",
      "🌳 트리 점검 중",
      "🌳 히스토리 읽는 중",
      "🌳 git 한 번 흘끔",
      "🌳 blame 읽는 중",
      "🌳 diff 점검 중",
      "🌳 git 말 듣는 중",
    ],
    "narration.fetch": [
      "🌐 웹에서 가져오는 중",
      "🌐 문서 끌어오는 중",
      "🌐 네트워크로 잠깐 외출",
      "🌐 문서 보러 잠깐 다녀옴",
      "🌐 업스트림 읽는 중",
      "🛰 위성 링크로 웹에 접속",
    ],
    "narration.todo": [
      "📋 할 일 보드 업데이트",
      "📋 진행 표시 중",
      "📋 리스트를 정직하게 유지",
      "📋 체크 박스 채우기",
      "📋 다음 항목으로",
      "📋 태스크 정직하게 유지",
    ],
    "narration.diagnostics": [
      "📡 LSP 진단 가져오는 중",
      "📡 현재 에러 읽는 중",
      "📡 언어 서버에게 어디 아픈지 물어보는 중",
      "📡 LSP 가 말하길...",
      "📡 물결선 청취 중",
      "📡 IDE 가 이미 아는 거 읽는 중",
    ],
    "narration.context": [
      "📦 프로젝트 컨텍스트 로딩",
      "📦 관련 문서 모으는 중",
      "📦 작업 셋 준비 중",
      "📦 컨텍스트 비축 중",
      "📦 관련 파일 모으는 중",
      "📦 최소 유효 컨텍스트 로딩",
    ],
    "narration.verifyPass": [
      "✅ 빌드 초록색 — 전진",
      "✅ 검증 통과",
      "✅ 테스트가 만족하네요",
      "🟢 모든 체크 그린",
      "✅ 깨끗하게 통과 — 다음",
      "🎉 검증 클리어",
      "✅ 빌드 멀쩡, 테스트 만족",
    ],
    "narration.verifyFail": [
      "❌ 검증 실패 — 진단 중",
      "❌ 빨간 빌드 — 어디가 물렸는지 찾는 중",
      "❌ 테스트가 화났어요. 출력 읽는 중.",
      "🔴 검증이 NO 라네요 — 실패 읽는 중",
      "❌ 뭔가 물고 있어요 — 이빨 찾는 중",
      "❌ 빨간불. 로그 펴는 중.",
    ],
    "narration.idle": [
      "☕ 한 숨 돌리고 다시",
      "🧘 잠시 멈춤 — 다음 수 고르는 중",
      "🪑 문제와 잠깐 마주 앉아 있는 중",
      "🌬 다음 수 전에 잠깐 호흡",
      "🪑 잠깐 정비",
    ],
    "strategy.smallerPieces": "문제를 더 작은 단위로 쪼개세요. 한 번에 함수 하나씩 편집하고, 각 사이에 검증하세요.",
    "strategy.differentFile": "에러가 실제로는 다른 파일에 있는지 확인하세요 — 진짜 원인은 상류일 수 있습니다.",
    "strategy.readTest": "테스트 파일이 있으면 먼저 읽으세요 — 기대 동작이 거기에 드러나 있을 때가 많습니다.",
    "strategy.checkImports": "import 를 확인하세요 — 누락되거나 잘못된 import 가 연쇄 에러의 흔한 원인입니다.",
    "strategy.searchSimilar": "resolve-search 로 코드베이스 내 유사 패턴을 찾으세요.",
    "strategy.rereadFile": "파일을 다시 차분히 읽으세요. 편집과 충돌하는 기존 코드를 놓쳤을 수 있습니다.",
    "strategy.tryDifferent": "완전히 다른 접근을 시도하세요 — 마지막 변경을 되돌리고 다른 방법으로 고치세요.",
    "strategy.useDiagnostics": "다음 편집 전에 resolve-diagnostics 로 현재 LSP 에러를 확인하세요.",
    "strategy.suggestionLabel": "전략 제안",
  },
};

/** Render a message in the requested locale. Picks a random variant if multiple are defined. */
export function t(key: MessageKey, locale: Locale, params: Params = {}): string {
  const localeTable = MESSAGES[locale] ?? MESSAGES[LOCALE_FALLBACK];
  const template = localeTable[key] ?? MESSAGES[LOCALE_FALLBACK][key];
  const picked = Array.isArray(template)
    ? template[nextVariantSeed() % template.length]
    : template;
  return typeof picked === "function" ? picked(params) : picked;
}

/** Compose `[agent] message` for session-time nudges. */
export function brandedMessage(
  agent: string | undefined,
  locale: Locale,
  key: MessageKey,
  params: Params = {},
): string {
  return `${brand(agent)} ${t(key, locale, params)}`;
}

/** Compose `[opencode-resolve] message` for plugin-level notices. */
export function pluginMessage(locale: Locale, key: MessageKey, params: Params = {}): string {
  return `[${PLUGIN_BRAND}] ${t(key, locale, params)}`;
}

/**
 * Render a context-bound message — always English, regardless of session locale.
 * Use for everything that lands in LLM context (system reminders, tool definitions,
 * end-of-turn reminders that become part of conversation history).
 */
export function contextMessage(agent: string | undefined, key: MessageKey, params: Params = {}): string {
  return `${brand(agent)} ${t(key, "en", params)}`;
}

/**
 * Print a terminal-only narration. Uses session locale (Korean if configured).
 * Does NOT enter LLM context — only the user sees it in the OpenCode UI/log.
 * Free to be playful, varied, and bilingual.
 */
export function narrate(
  state: { locale: Locale; currentAgent?: string },
  key: MessageKey,
  params: Params = {},
): void {
  const line = `${brand(state.currentAgent)} ${t(key, state.locale, params)}`;
  console.log(line);
}

/** All registered message keys, derived from the English table. */
export const ALL_MESSAGE_KEYS: ReadonlyArray<MessageKey> = Object.keys(MESSAGES.en) as ReadonlyArray<MessageKey>;
