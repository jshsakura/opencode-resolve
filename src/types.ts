export type PermissionValue = "ask" | "allow" | "deny";
export type ResolveAgentName = | "coder"
      | "reviewer"
      | "resolver"
      | "architect"
      | "debugger"
      | "researcher"
      | "explorer"
      | "deep-reviewer"
      | "planner";
export type ModelAlias = | ResolveAgentName
      | "quick"
      | "deep"
      | "fast"
      | "strong"
      | "mini"
      | "bronze"
      | "silver"
      | "gold";
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
export type TierName = "bronze" | "silver" | "gold";
export type LanguageSetting = "auto" | "en" | "ko";
/** Opt-in relaxations of the universal bash safety policy. Off by default. */
export type ResolvePermissions = {
      /** Let resolve agents run `git reset --hard` (a checkpoint ref is written first). */
      allowGitReset?: boolean
      /** Let resolve agents run `git clean -f...` (a checkpoint ref is written first). */
      allowGitClean?: boolean
    };
export type RollbackKind = "reset" | "clean";
export type ResolveConfig = {
      tier?: TierName
      enabled?: ResolveAgentName[]
      models?: Partial<Record<ModelAlias, string>>
      agents?: Partial<Record<ResolveAgentName, ResolveAgentConfig>>
      preserveNative?: boolean
      commands?: boolean
      autoApprove?: boolean
      maxParallelSubagents?: number
      autoUpdate?: boolean
      language?: LanguageSetting
      singleAgentMode?: boolean
      permissions?: ResolvePermissions
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
