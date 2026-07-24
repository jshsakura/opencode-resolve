
export * from "./types.js";
export * from "./agents.js";
export * from "./utils.js";
export * from "./config.js";
export * from "./state.js";

import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { getTools } from "./tools/index.js";
import { getHooks } from "./hooks/index.js";
import { createSessionState } from "./state.js";
import { PLUGIN_VERSION } from "./utils.js";
import type { Plugin } from "@opencode-ai/plugin";

if (process.env.OPENCODE_RESOLVE_QUIET !== "1") {
  let where = "";
  try { where = ` (from: ${dirname(fileURLToPath(import.meta.url))})`; } catch { /* ignore */ }
  // stderr, NOT stdout — stdout corrupts the opencode TUI (renders into the
  // chat window). See the same note in config.ts warnResolve().
  process.stderr.write(`[opencode-resolve] v${PLUGIN_VERSION} loaded${where}\n`);
}

export const OpencodeResolve: Plugin = async ({ directory }, options) => {
  const sessionState = createSessionState();
  return {
    ...getHooks(directory, options, sessionState),
    tool: getTools(sessionState)
  };
};

// V1 plugin format — avoids opencode's legacy getLegacyPlugins fallback path,
// which iterates Object.values(mod) and throws on non-function exports
// (DEFAULT_MODELS, VALID_MODES, PLUGIN_VERSION, etc. from the re-exports above).
export default { id: "opencode-resolve", server: OpencodeResolve };
