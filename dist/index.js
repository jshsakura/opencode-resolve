export * from "./types.js";
export * from "./agents.js";
export * from "./utils.js";
export * from "./config.js";
export * from "./state.js";
import { getTools } from "./tools/index.js";
import { getHooks } from "./hooks/index.js";
import { createSessionState } from "./state.js";
export const OpencodeResolve = async ({ directory }, options) => {
    const sessionState = createSessionState();
    return {
        ...getHooks(directory, options, sessionState),
        tool: getTools(sessionState)
    };
};
export default OpencodeResolve;
