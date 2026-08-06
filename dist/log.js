// Structured file logger for opencode-resolve.
//
// Why a file (and not stdout / toast / text.complete):
//  - stdout conflicts with the TUI redraw cycle (lines appear doubled).
//  - Toast was rejected for UX reasons; a TUI-plugin module is impossible under
//    the V1 plugin format (server XOR tui).
//  - `experimental.text.complete` consumes LLM tokens, which the user rejected.
// A plain append-only log file sidesteps all four: zero tokens, no TUI overlay,
// no stdout corruption, and `tail -f` gives the live visibility the plugin
// otherwise lacks. See `narrate()` in messages.ts for the prior no-op history.
//
// Env knobs:
//  - OPENCODE_RESOLVE_LOG=0       → disable file logging entirely
//  - OPENCODE_RESOLVE_LOG_FILE=path → write to a custom path
//  - OPENCODE_RESOLVE_DEBUG=1      → raise verbosity to debug + mirror info+ to stderr
//  - OPENCODE_RESOLVE_QUIET=1      → suppress the stderr mirror (keeps the file)
import { appendFile, stat, rename, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
const LEVEL_ORDER = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};
const MAX_BYTES = 2_000_000; // rotate once the file passes 2MB
const LEVEL_PAD = 5;
function readOptions(directory) {
    const debug = process.env.OPENCODE_RESOLVE_DEBUG === "1";
    const quiet = process.env.OPENCODE_RESOLVE_QUIET === "1";
    const logOff = process.env.OPENCODE_RESOLVE_LOG === "0";
    const customPath = process.env.OPENCODE_RESOLVE_LOG_FILE;
    const path = typeof customPath === "string" && customPath.length > 0
        ? customPath
        : join(directory, ".opencode", "resolve.log");
    return {
        enabled: !logOff,
        fileLevel: debug ? "debug" : "info",
        // The stderr mirror uses the same gate as the load banner in src/index.ts:
        // opt-in via DEBUG, suppressed by QUIET. opencode renders plugin stderr into
        // the TUI, so this stays off by default to avoid polluting every session.
        stderrLevel: debug && !quiet ? "info" : null,
        path,
    };
}
function formatLine(level, event, detail) {
    const ts = new Date().toISOString();
    const lvl = level.toUpperCase().padEnd(LEVEL_PAD);
    let body = event;
    if (typeof detail === "string" && detail.length > 0) {
        body += ` — ${detail}`;
    }
    else if (detail && typeof detail === "object") {
        body += ` ${JSON.stringify(detail)}`;
    }
    return `${ts} ${lvl} ${body}\n`;
}
/**
 * Build a per-plugin-instance logger bound to `directory`.
 * `.opencode/` is created lazily on the first write. Rotation keeps a single
 * `.1` backup once the file exceeds MAX_BYTES. Every write failure is swallowed
 * — a logging error must never break the resolve loop.
 */
export function createResolveLogger(directory) {
    const opts = readOptions(directory);
    let dirEnsured = false;
    async function ensureDir() {
        if (dirEnsured)
            return;
        try {
            await mkdir(dirname(opts.path), { recursive: true });
            dirEnsured = true;
        }
        catch {
            // fall through — appendFile will simply fail silently below
        }
    }
    async function rotateIfNeeded() {
        try {
            const s = await stat(opts.path);
            if (s.size > MAX_BYTES) {
                try {
                    await rename(opts.path, `${opts.path}.1`);
                }
                catch {
                    // cannot rotate — keep appending; better than losing logs
                }
            }
        }
        catch {
            // file does not exist yet — nothing to rotate
        }
    }
    function log(level, event, detail) {
        if (!opts.enabled)
            return;
        const toFile = LEVEL_ORDER[level] >= LEVEL_ORDER[opts.fileLevel];
        const toStderr = opts.stderrLevel !== null && LEVEL_ORDER[level] >= LEVEL_ORDER[opts.stderrLevel];
        if (!toFile && !toStderr)
            return;
        const line = formatLine(level, event, detail);
        if (toFile) {
            // Chain the async work; swallow all errors. Ordering across writes is
            // best-effort (single event loop), which is fine for a diagnostics log.
            void ensureDir()
                .then(() => rotateIfNeeded())
                .then(() => appendFile(opts.path, line, "utf8"))
                .catch(() => {
                /* ignore — logging is best-effort */
            });
        }
        if (toStderr) {
            try {
                process.stderr.write(`[opencode-resolve] ${line}`);
            }
            catch {
                /* ignore */
            }
        }
    }
    return { path: opts.path, log };
}
