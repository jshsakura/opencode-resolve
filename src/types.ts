export type PermissionValue = "ask" | "allow" | "deny";
export type ResolveAgentName = | "coder"
      | "reviewer"
      | "resolver"
      | "codex"
      | "gpt"
      | "glm"
      | "architect"
      | "gpt-coder"
      | "debugger"
      | "researcher"
      | "explorer"
      | "deep-reviewer"
      | "planner";
export type ModelAlias = | ResolveAgentName
      | "glm"
      | "gpt"
      | "quick"
      | "deep"
      | "fast"
      | "strong"
      | "mini"
      | "codex"
      | "bronze"
      | "silver"
      | "gold"
      | "gpt-bronze"
      | "gpt-silver"
      | "gpt-gold"
      | "glm-bronze"
      | "glm-silver"
      | "glm-gold";
export type AgentMode = "subagent" | "primary" | "all";
export type ResolveAgentConfig = {
      enabled?: boolean
      model?: string
      mode?: AgentMode
      description?: string
      prompt?: string
      color?: string
      maxSteps?: number
      tools?: Record<string, boolean>
      permission?: {
        edit?: PermissionValue
        bash?: PermissionValue | Record<string, PermissionValue>
        webfetch?: PermissionValue
        doom_loop?: PermissionValue
        external_directory?: PermissionValue
      }
    };
export type ProfileName = "mix" | "glm" | "gpt";
export type TierName = "bronze" | "silver" | "gold";
export type LanguageSetting = "auto" | "en" | "ko";
export type ResolveConfig = {
      profile?: ProfileName
      tier?: TierName
      enabled?: ResolveAgentName[]
      models?: Partial<Record<ModelAlias, string>>
      agents?: Partial<Record<ResolveAgentName, ResolveAgentConfig>>
      preserveNative?: boolean
      context7?: boolean
      commands?: boolean
      autoApprove?: boolean
      maxParallelSubagents?: number
      autoUpdate?: boolean
      language?: LanguageSetting
    };
export type ResolvePluginOptions = ResolveConfig & {
      config?: string
    };
export type UnknownRecord = Record<string, unknown>;
export type ProjectContext = {
      /** Project knowledge files or directories that exist */
      knowledgeFiles: string[]
      /** Pattern/context documents discovered under committed context directories */
      contextFiles: string[]
      /** Package manager detected (npm, yarn, pnpm, bun) */
      packageManager: string | undefined
      /** Verification commands available (e.g. "npx tsc --noEmit", "npm run lint") */
      verifyCommands: string[]
      /** Whether this is a TypeScript project */
      hasTypeScript: boolean
      /** Whether HARNESS.md exists */
      hasHarness: boolean
      /** Whether AGENTS.md exists */
      hasAgents: boolean
    };
