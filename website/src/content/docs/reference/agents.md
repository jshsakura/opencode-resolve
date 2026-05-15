---
title: Agents
description: Default and optional OpenCode agents injected by opencode-resolve.
---

## Default Agents

| Agent | Mode | Edit | Bash | Web | Purpose |
| --- | --- | --- | --- | --- | --- |
| `resolver` | `all` | allow | ask | allow | Primary orchestrator. |
| `coder` | `subagent` | allow | ask | allow | Focused implementation. |
| `explorer` | `subagent` | deny | deny | allow | Fast read-only scout. |
| `reviewer` | `subagent` | deny | deny | allow | Read-only verification review. |
| `deep-reviewer` | `subagent` | deny | deny | allow | Strong review for risky changes. |
| `planner` | `subagent` | deny | deny | allow | Read-only planning. |

## Optional Agents

| Agent | Purpose |
| --- | --- |
| `gpt` | GPT-optimized primary resolver. |
| `glm` | GLM/ZAI-optimized primary resolver. |
| `codex` | Legacy Codex-optimized primary resolver. |
| `architect` | Design/decomposition helper. |
| `gpt-coder` | Stronger implementation helper. |
| `debugger` | Reproduction and root-cause helper. |
| `researcher` | Codebase and documentation research. |

## Resolver Loop

The resolver inspects relevant context, dispatches focused subagents, verifies the changed path, and iterates until the task is resolved or a real blocker is found.
