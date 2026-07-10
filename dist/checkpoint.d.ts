import type { RollbackKind } from "./types.js";
/** Namespace for checkpoint refs. Outside refs/heads, so it never shows up as a branch. */
export declare const CHECKPOINT_REF_NAMESPACE = "refs/resolve-checkpoint";
export type Checkpoint = {
    /** Full ref name, e.g. `refs/resolve-checkpoint/1730000000000-reset`. */
    ref: string;
    /** Copy-pasteable command that puts the worktree back the way it was. */
    restoreCommand: string;
};
export declare function isGitRepository(directory: string): Promise<boolean>;
/**
 * Snapshot the worktree into `refs/resolve-checkpoint/<timestamp>-<kind>`.
 * Throws with the underlying git error if the snapshot cannot be written — the
 * caller must abort the destructive command rather than run it unprotected.
 */
export declare function createRollbackCheckpoint(directory: string, kind: RollbackKind): Promise<Checkpoint>;
/**
 * Restores every path recorded in the checkpoint, including files a later
 * `git clean` deleted. Files created after the checkpoint are left alone —
 * recovery is additive, never destructive.
 */
export declare function restoreCommandFor(ref: string): string;
