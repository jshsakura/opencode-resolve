---
title: CLI Install
description: Use the installer directly. Do not delegate installation to an LLM.
---

Do not delegate installation to an LLM. Install from the shell so the npm installer can manage OpenCode registration, `resolve.json`, and stale plugin cache refresh directly.

```sh
npm install -g opencode-resolve
opencode
```

To reconfigure model pins without delegating installation to an LLM:

```sh
opencode-resolve setup --models
```

For a regenerated `resolve.json` that preserves existing model pins:

```sh
opencode-resolve setup --fresh
```

Manual cache refresh remains available when needed:

```sh
opencode plugin opencode-resolve --global --force
```

See [Installation](/opencode-resolve/start/install/) for the full operator path.
