# subagent-question

Subagents ask questions, and those questions **ripple up** through nested levels to the orchestrator, where a **human answers** (human-in-the-loop at depth 0). Answers flow back down and the subagent continues.

- `subagent` tool — copied **verbatim** from Pi's built-in subagent extension (delegation).
- `ask_user` tool — a small addition that prompts the human at depth 0 (via `ctx.ui.input`).
- Agent definitions carry the question/answer protocol in their prompts and control depth via `tools:`.

```
depth 0:  you ◀── ask_user ──▶ orchestrator ──subagent──▶ delegator (depth 1)
                                                             │──subagent──▶ asker (depth 2)
                                                             │                 └─▶ 2 questions
                                                             │◀─── relays questions ──┘
                                           orchestrator ◀───┘
```

## Install

```bash
# extension (a directory with index.ts + agents.ts)
mkdir -p ~/.pi/agent/extensions
ln -sfn "$PWD" ~/.pi/agent/extensions/subagent-question

# agents — standard agent definitions
mkdir -p ~/.pi/agent/agents
ln -sfn "$PWD/agents/asker.md" ~/.pi/agent/agents/asker.md
ln -sfn "$PWD/agents/delegator.md" ~/.pi/agent/agents/delegator.md
```

## The loop (human in the loop)

Run interactively (`pi` TUI):

```
Use the subagent tool with agent "delegator" and task "design an auth system with password hashing and token encryption".
```

1. `delegator` → `asker` → 2 questions ripple up and reach you (the orchestrator).
2. The orchestrator calls `ask_user` once per question; you type answers.
3. The orchestrator re-invokes `subagent(delegator, task + PREVIOUS ANSWERS)`.
4. `delegator` passes the answers down to `asker`, which completes the work; the result relays back up.

Repeat until `asker` has enough to finish — you are in the loop at every round, but always at depth 0.

### Depth 1 (no middle agent)

```
Use the subagent tool with agent "asker" and task "plan a database schema for a blog".
```

`asker` returns 2 questions → `ask_user` prompts you → re-run `subagent(asker, task + PREVIOUS ANSWERS)` → `asker` completes.

## How it works

- `index.ts` + `agents.ts` are Pi's subagent example, copied as-is. `index.ts` adds one small tool, `ask_user`, which calls `ctx.ui.input()`.
- Subagents run headless (`--mode json -p --no-session`, stdin ignored), so they cannot use `ask_user` — only the top-level session has a UI. This is what forces questions to ripple up instead of being asked in place.
- The ripple is just each agent's final text being relayed to its parent by the stock `subagent` tool. Answers flow down by re-running with a `PREVIOUS ANSWERS:` block in the task (stateless — see caveat below).
- `tools:` frontmatter is the structural depth cap: `asker` has no `subagent`, so it cannot delegate; `delegator` has only `subagent`.

## Caveats

- Each round is a **fresh** subagent process (`--no-session`), not a resume. Answers are injected as text; a mid-level agent's prior context does not carry over.
- `ask_user` requires an interactive session (`ctx.hasUI`). In `-p`/non-interactive mode it returns an error.

## Add an agent

```markdown
---
name: my-agent
description: what it does
tools: subagent, ask_user   # omit "subagent" to make a hard leaf
---

System prompt here — put the question/answer protocol here.
```

- A leaf that only asks: list its working tools (`read, bash, …`) but **omit `subagent`**.
- A relay/mid-level: `tools: subagent`, prompt says "delegate, then relay the result."
- `ask_user` is only meaningful at depth 0 (headless subagents get no UI).
