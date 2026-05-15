import { SessionState } from "../state.js";
export declare function getHooks(directory: string, options: any, sessionState: SessionState): {
    event: (input: any) => Promise<void>;
    config: (config: any) => Promise<void>;
    "shell.env": (_input: any, output: any) => Promise<void>;
    "permission.ask": (input: any, output: any) => Promise<void>;
    "chat.params": (input: any, output: any) => Promise<void>;
    "tool.definition": (input: any, output: any) => Promise<void>;
    "command.execute.before": (_input: any, output: any) => Promise<void>;
    "tool.execute.before": (input: any, output: any) => Promise<void>;
    "chat.headers": (input: any, output: any) => Promise<void>;
    "tool.execute.after": (input: any, output: any) => Promise<void>;
    "experimental.session.compacting": (_input: any, output: any) => Promise<void>;
    "experimental.chat.messages.transform": (_input: any, output: any) => Promise<void>;
    "experimental.compaction.autocontinue": (_input: any, output: any) => Promise<void>;
    "experimental.chat.system.transform": (_input: any, output: any) => Promise<void>;
    "experimental.text.complete": (_input: any, output: any) => Promise<void>;
};
