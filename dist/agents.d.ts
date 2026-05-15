import { ResolveAgentName, ResolveAgentConfig, ModelAlias, TierName } from "./types.js";
export declare const DEFAULT_MODELS: Partial<Record<ModelAlias, string>>;
export declare const DEFAULT_ENABLED: ResolveAgentName[];
export declare const VALID_AGENT_NAMES: readonly ["coder", "reviewer", "resolver", "codex", "glm", "architect", "gpt-coder", "debugger", "researcher", "explorer", "deep-reviewer", "planner"];
export declare const VALID_AGENT_NAME_SET: Set<string>;
export declare const DEFAULT_AGENT_CONFIG: Record<ResolveAgentName, Required<Pick<ResolveAgentConfig, "mode" | "description" | "prompt" | "color">> & ResolveAgentConfig>;
export declare const GLM_CODER_PROMPT: string;
export declare const GPT_CODER_PROMPT: string;
export declare function buildGLMResolverPrompt(maxParallelSubagents: number | undefined): string;
export declare function buildGPTResolverPrompt(): string;
export declare function buildCodexResolverPrompt(): string;
export declare function buildResolverPrompt(maxParallelSubagents: number | undefined): string;
export declare const VALID_MODEL_ALIASES: readonly ["coder", "reviewer", "resolver", "codex", "glm", "architect", "gpt-coder", "debugger", "researcher", "explorer", "deep-reviewer", "planner", "glm", "gpt", "quick", "deep", "fast", "strong", "mini", "codex", "bronze", "silver", "gold", "gpt-bronze", "gpt-silver", "gpt-gold", "glm-bronze", "glm-silver", "glm-gold"];
export declare const VALID_MODEL_ALIAS_SET: Set<string>;
export declare const VALID_PROFILES: Set<string>;
export declare const VALID_TIERS: Set<string>;
export declare const GLM_ENABLED: ResolveAgentName[];
export declare const GPT_ENABLED: ResolveAgentName[];
export declare const TIER_ENABLED: Record<TierName, ResolveAgentName[]>;
export declare const GLM_AGENT_OVERRIDES: Partial<Record<ResolveAgentName, {
    maxSteps?: number;
    description?: string;
}>>;
export declare const GPT_AGENT_OVERRIDES: Partial<Record<ResolveAgentName, {
    maxSteps?: number;
    description?: string;
}>>;
