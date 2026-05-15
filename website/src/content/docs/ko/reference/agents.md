---
title: 에이전트
description: opencode-resolve가 주입하는 기본/선택 OpenCode 에이전트.
---

## 기본 에이전트

| 에이전트 | 모드 | Edit | Bash | Web | 목적 |
| --- | --- | --- | --- | --- | --- |
| `resolver` | `all` | allow | ask | allow | 기본 오케스트레이터 |
| `coder` | `subagent` | allow | ask | allow | 집중 구현 |
| `explorer` | `subagent` | deny | deny | allow | 빠른 읽기 전용 탐색 |
| `reviewer` | `subagent` | deny | deny | allow | 읽기 전용 검증 리뷰 |
| `deep-reviewer` | `subagent` | deny | deny | allow | 위험 변경 강한 리뷰 |
| `planner` | `subagent` | deny | deny | allow | 읽기 전용 계획 |

## 선택 에이전트

| 에이전트 | 목적 |
| --- | --- |
| `gpt` | GPT 최적화 primary resolver |
| `glm` | GLM/ZAI 최적화 primary resolver |
| `codex` | 레거시 Codex 최적화 primary resolver |
| `architect` | 설계/분해 보조 |
| `gpt-coder` | 더 강한 구현 보조 |
| `debugger` | 재현과 root-cause 보조 |
| `researcher` | 코드베이스와 문서 리서치 |
