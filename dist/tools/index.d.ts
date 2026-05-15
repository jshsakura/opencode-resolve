import { SessionState } from "../state.js";
export declare function getTools(sessionState: SessionState): {
    "resolve-verify": {
        description: string;
        args: {
            command: import("zod").ZodOptional<import("zod").ZodString>;
        };
        execute(args: {
            command?: string | undefined;
        }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
    };
    "resolve-diagnostics": {
        description: string;
        args: {
            path: import("zod").ZodOptional<import("zod").ZodString>;
        };
        execute(args: {
            path?: string | undefined;
        }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
    };
    "resolve-context": {
        description: string;
        args: {};
        execute(args: Record<string, never>, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
    };
    "resolve-git-status": {
        description: string;
        args: {};
        execute(args: Record<string, never>, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
    };
    "resolve-deps": {
        description: string;
        args: {
            dev: import("zod").ZodOptional<import("zod").ZodBoolean>;
        };
        execute(args: {
            dev?: boolean | undefined;
        }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
    };
    "resolve-search": {
        description: string;
        args: {
            query: import("zod").ZodString;
            glob: import("zod").ZodOptional<import("zod").ZodString>;
            max_results: import("zod").ZodOptional<import("zod").ZodNumber>;
        };
        execute(args: {
            query: string;
            glob?: string | undefined;
            max_results?: number | undefined;
        }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
    };
    "resolve-test": {
        description: string;
        args: {
            file: import("zod").ZodOptional<import("zod").ZodString>;
            pattern: import("zod").ZodOptional<import("zod").ZodString>;
            runner: import("zod").ZodOptional<import("zod").ZodString>;
        };
        execute(args: {
            file?: string | undefined;
            pattern?: string | undefined;
            runner?: string | undefined;
        }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
    };
    "resolve-pattern": {
        description: string;
        args: {
            paths: import("zod").ZodOptional<import("zod").ZodString>;
            checks: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
        };
        execute(args: {
            paths?: string | undefined;
            checks?: string[] | undefined;
        }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
    };
    "resolve-complexity": {
        description: string;
        args: {
            paths: import("zod").ZodOptional<import("zod").ZodString>;
            threshold: import("zod").ZodOptional<import("zod").ZodNumber>;
        };
        execute(args: {
            paths?: string | undefined;
            threshold?: number | undefined;
        }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
    };
    "resolve-file-info": {
        description: string;
        args: {
            path: import("zod").ZodString;
        };
        execute(args: {
            path: string;
        }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
    };
    "resolve-outdated": {
        description: string;
        args: {
            dev: import("zod").ZodOptional<import("zod").ZodBoolean>;
            filter: import("zod").ZodOptional<import("zod").ZodString>;
        };
        execute(args: {
            dev?: boolean | undefined;
            filter?: string | undefined;
        }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
    };
    "resolve-readme": {
        description: string;
        args: {
            max_length: import("zod").ZodOptional<import("zod").ZodNumber>;
        };
        execute(args: {
            max_length?: number | undefined;
        }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
    };
    "resolve-init": {
        description: string;
        args: {
            dry_run: import("zod").ZodOptional<import("zod").ZodBoolean>;
            harness: import("zod").ZodOptional<import("zod").ZodBoolean>;
            agents: import("zod").ZodOptional<import("zod").ZodBoolean>;
        };
        execute(args: {
            dry_run?: boolean | undefined;
            harness?: boolean | undefined;
            agents?: boolean | undefined;
        }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
    };
    "resolve-diff": {
        description: string;
        args: {
            ref: import("zod").ZodOptional<import("zod").ZodString>;
            file: import("zod").ZodOptional<import("zod").ZodString>;
            stat_only: import("zod").ZodOptional<import("zod").ZodBoolean>;
        };
        execute(args: {
            ref?: string | undefined;
            file?: string | undefined;
            stat_only?: boolean | undefined;
        }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
    };
    "resolve-scripts": {
        description: string;
        args: {
            filter: import("zod").ZodOptional<import("zod").ZodString>;
            verbose: import("zod").ZodOptional<import("zod").ZodBoolean>;
        };
        execute(args: {
            filter?: string | undefined;
            verbose?: boolean | undefined;
        }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
    };
    "resolve-env": {
        description: string;
        args: {};
        execute(args: Record<string, never>, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
    };
    "resolve-coverage": {
        description: string;
        args: {
            command: import("zod").ZodOptional<import("zod").ZodString>;
            file: import("zod").ZodOptional<import("zod").ZodString>;
        };
        execute(args: {
            command?: string | undefined;
            file?: string | undefined;
        }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
    };
    "resolve-todo": {
        description: string;
        args: {
            paths: import("zod").ZodOptional<import("zod").ZodString>;
            author: import("zod").ZodOptional<import("zod").ZodString>;
        };
        execute(args: {
            paths?: string | undefined;
            author?: string | undefined;
        }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
    };
    "resolve-tree": {
        description: string;
        args: {
            path: import("zod").ZodOptional<import("zod").ZodString>;
            depth: import("zod").ZodOptional<import("zod").ZodNumber>;
            exclude: import("zod").ZodOptional<import("zod").ZodString>;
        };
        execute(args: {
            path?: string | undefined;
            depth?: number | undefined;
            exclude?: string | undefined;
        }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
    };
    "resolve-metrics": {
        description: string;
        args: {
            skip_test: import("zod").ZodOptional<import("zod").ZodBoolean>;
        };
        execute(args: {
            skip_test?: boolean | undefined;
        }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
    };
    "resolve-changelog": {
        description: string;
        args: {
            count: import("zod").ZodOptional<import("zod").ZodNumber>;
            file: import("zod").ZodOptional<import("zod").ZodString>;
            format: import("zod").ZodOptional<import("zod").ZodEnum<{
                stat: "stat";
                oneline: "oneline";
                full: "full";
            }>>;
        };
        execute(args: {
            count?: number | undefined;
            file?: string | undefined;
            format?: "stat" | "oneline" | "full" | undefined;
        }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
    };
    "resolve-session": {
        description: string;
        args: {};
        execute(args: Record<string, never>, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
    };
    "resolve-audit": {
        description: string;
        args: {
            paths: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
            check_deps: import("zod").ZodOptional<import("zod").ZodBoolean>;
        };
        execute(args: {
            paths?: string[] | undefined;
            check_deps?: boolean | undefined;
        }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
    };
    "resolve-config-check": {
        description: string;
        args: {};
        execute(args: Record<string, never>, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
    };
    "resolve-state": {
        description: string;
        args: {
            action: import("zod").ZodUnion<readonly [import("zod").ZodLiteral<"save">, import("zod").ZodLiteral<"load">]>;
            note: import("zod").ZodOptional<import("zod").ZodString>;
        };
        execute(args: {
            action: "save" | "load";
            note?: string | undefined;
        }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
    };
};
