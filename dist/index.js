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
if (process.env.OPENCODE_RESOLVE_QUIET !== "1") {
    let where = "";
    try {
        where = ` (from: ${dirname(fileURLToPath(import.meta.url))})`;
    }
    catch { /* ignore */ }
    console.log(`[opencode-resolve] v${PLUGIN_VERSION} loaded${where}`);
}
export const OpencodeResolve = async ({ directory }, options) => {
    const sessionState = createSessionState();
    return {
        ...getHooks(directory, options, sessionState),
        tool: getTools(sessionState)
    };
};
export default OpencodeResolve;
