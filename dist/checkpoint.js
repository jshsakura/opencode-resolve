// Rollback checkpoints.
//
// `git reset --hard` and `git clean -f` are the two recovery commands an agent
// needs to escape a tangled worktree, and they are also the two that can destroy
// uncommitted work. Before either runs, we snapshot the entire worktree —
// tracked modifications *and* untracked files — into a git ref that nothing else
// points at.
//
// The snapshot uses a throwaway index (`GIT_INDEX_FILE`) so the real index and
// the working tree are never touched: add -A → write-tree → commit-tree →
// update-ref. Nothing is staged, nothing is committed to any branch, no HEAD
// move. The ref keeps the objects alive against `git gc`.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "./utils.js";
/** Namespace for checkpoint refs. Outside refs/heads, so it never shows up as a branch. */
export const CHECKPOINT_REF_NAMESPACE = "refs/resolve-checkpoint";
const GIT_TIMEOUT_MS = 15_000;
export async function isGitRepository(directory) {
    const { exitCode } = await runCommand("git rev-parse --is-inside-work-tree", directory, GIT_TIMEOUT_MS);
    return exitCode === 0;
}
/**
 * Snapshot the worktree into `refs/resolve-checkpoint/<timestamp>-<kind>`.
 * Throws with the underlying git error if the snapshot cannot be written — the
 * caller must abort the destructive command rather than run it unprotected.
 */
export async function createRollbackCheckpoint(directory, kind) {
    const ref = `${CHECKPOINT_REF_NAMESPACE}/${Date.now()}-${kind}`;
    const indexDirectory = await mkdtemp(join(tmpdir(), "opencode-resolve-ckpt-"));
    const indexFile = join(indexDirectory, "index");
    // One shell invocation: a failure anywhere aborts (set -e) and we surface it.
    // `git add -A` against an empty throwaway index stages the whole worktree,
    // honouring .gitignore. `commit-tree` parents on HEAD when a HEAD exists (a
    // freshly-initialised repo has none).
    const script = [
        "set -e",
        `export GIT_INDEX_FILE=${JSON.stringify(indexFile)}`,
        // commit-tree refuses to run without a committer identity; a repo with no
        // user.email configured must still be able to checkpoint.
        "export GIT_AUTHOR_NAME=opencode-resolve GIT_AUTHOR_EMAIL=checkpoint@opencode-resolve.local",
        "export GIT_COMMITTER_NAME=opencode-resolve GIT_COMMITTER_EMAIL=checkpoint@opencode-resolve.local",
        "git add -A",
        "tree=$(git write-tree)",
        `message=${JSON.stringify(`opencode-resolve checkpoint before git ${kind}`)}`,
        'if git rev-parse -q --verify HEAD >/dev/null 2>&1; then',
        '  commit=$(git commit-tree "$tree" -p HEAD -m "$message")',
        "else",
        '  commit=$(git commit-tree "$tree" -m "$message")',
        "fi",
        `git update-ref ${JSON.stringify(ref)} "$commit"`,
    ].join("\n");
    try {
        const { stderr, exitCode } = await runCommand(script, directory, GIT_TIMEOUT_MS);
        if (exitCode !== 0) {
            throw new Error(`checkpoint failed (git exit ${exitCode}): ${stderr.trim() || "no stderr"}`);
        }
    }
    finally {
        await rm(indexDirectory, { recursive: true, force: true }).catch(() => { });
    }
    return { ref, restoreCommand: restoreCommandFor(ref) };
}
/**
 * Restores every path recorded in the checkpoint, including files a later
 * `git clean` deleted. Files created after the checkpoint are left alone —
 * recovery is additive, never destructive.
 */
export function restoreCommandFor(ref) {
    return `git restore --source=${ref} -- .`;
}
