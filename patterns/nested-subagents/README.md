# nested-subagents

The smallest possible demonstration of **nested subagents with depth protection**.

- `orchestrator` has only the `subagent` tool → it *must* delegate.
- `worker` has only `bash` → it *cannot* delegate (nested protection).

```
you ──subagent──▶ orchestrator ──subagent──▶ worker ──bash──▶ echo hello
```

## Install

```bash
mkdir -p ~/.pi/agent/extensions
ln -sfn "$PWD" ~/.pi/agent/extensions/nested-subagents
```

## Use

```
Use orchestrator to run 'echo hello'
```

Expected result: `orchestrator received: hello`.

## How it works

- `index.ts` registers a minimal single-mode `subagent` tool.
- It discovers agents from its own `agents/` directory — the pattern is **atomic**: everything it needs lives in this folder.
- Each subagent is a separate `pi --mode json -p --no-session` process with an isolated context window.
- Depth is capped structurally: `worker`'s `tools:` list omits `subagent`, so it physically cannot delegate.

## Add an agent

Drop a `.md` file into `agents/`:

```markdown
---
name: my-agent
description: what it does
tools: subagent        # include "subagent" to allow delegation; omit to make a hard leaf
---

System prompt here.
```
