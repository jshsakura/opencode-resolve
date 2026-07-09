# opencode-resolve — CLI Install

Do not delegate installation to an LLM. Install from the shell so the npm installer can manage OpenCode registration, `resolve.json`, and stale plugin cache refresh directly.

```sh
npm install -g opencode-resolve
opencode
```

To reconfigure model pins without delegating installation to an LLM:

```sh
opencode-resolve setup --models
```

To reset `resolve.json` from scratch (wipes model pins too):

```sh
opencode-resolve setup --reset
```

Manual cache refresh remains available when needed:

```sh
opencode plugin opencode-resolve --global --force
```
