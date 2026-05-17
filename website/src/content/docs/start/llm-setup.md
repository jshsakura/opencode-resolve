---
title: LLM-driven Install
description: Deprecated. Use the interactive CLI installer instead.
---

The LLM-driven install path has been retired. Run the package CLI directly — it is deterministic, faster, and won't hallucinate model IDs that don't exist in your configuration.

```sh
npm install -g opencode-resolve@latest
opencode-resolve setup
```

The installer auto-detects your providers and models from `~/.config/opencode/opencode.json`, walks you through a short Q&A with sensible defaults (press enter to accept), and writes `~/.config/opencode/resolve.json` for you. See [Installation](/opencode-resolve/start/install/) for the full operator path and CLI flags.
