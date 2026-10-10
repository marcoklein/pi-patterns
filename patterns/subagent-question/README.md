# subagent-question

Subagents ask questions, and those questions **ripple up** through nested levels to the orchestrator, where a **human answers** (human-in-the-loop at depth 0). Answers flow back down and the subagent continues.

- `subagent` tool — copied **verbatim** from pi 1.1.0's bundled subagent extension (delegation).
- `ask_user` tool — a small *additive* change that prompts the human at depth 0 (via `ctx.ui.input`); the rest of `index.ts` is byte-identical to the stock example.
- Agent definitions carry the question/answer protocol in their prompts and control depth via `tools:`.

```
depth 0:  you ◀── ask_user ──▶ orchestrator ──subagent──▶ delegator (depth 1)
                                                             │──subagent──▶ asker (depth 2)
                                                             │                 └─▶ 2 questions
                                                             │◀─── relays questions ──┘
                                           orchestrator ◀───┘
```

## Install (once)

This pattern ships its **own** extension, so install that one — not pi's stock `subagent` (both register a tool named `subagent`). Nesting needs it at user scope: children are spawned without `-e` (see the [repo README](../../README.md#read-this-once-why-nesting-needs-an-install)).

From this folder:

```bash
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
mkdir -p "$agent_dir/extensions"
ln -sfn "$PWD" "$agent_dir/extensions/subagent-question"   # a directory with index.ts + agents.ts
../../install.sh --no-extension --agents subagent-question # asker.md, delegator.md at user scope
```

Agents live in [`.pi/agents/`](.pi/agents/), so instead of installing them you can also run pi inside this folder and pass `agentScope: "both"`.

## The loop (human in the loop)

`ask_user` needs a UI, so the full loop is **interactive-only** — run the pi TUI:

```
Use the subagent tool with agent "delegator" and task "design an auth system with password hashing and token encryption".
```

1. `delegator` → `asker` → 2 questions ripple up and reach you (the orchestrator).
2. The orchestrator calls `ask_user` once per question; you type answers.
3. The orchestrator re-invokes `subagent(delegator, task + PREVIOUS ANSWERS)`.
4. `delegator` passes the answers down to `asker`, which completes the work; the result relays back up.

Repeat until `asker` has enough to finish — you are in the loop at every round, but always at depth 0.

Headless (`-p`) runs cannot do the human part: `ask_user` returns `Error: ask_user needs an interactive session (no UI available).` The ripple itself still works headlessly, which is how `verify.mjs` checks it.

### Depth 1 (no middle agent)

```
Use the subagent tool with agent "asker" and task "plan a database schema for a blog".
```

`asker` returns 2 questions → `ask_user` prompts you → re-run `subagent(asker, task + PREVIOUS ANSWERS)` → `asker` completes.

## How it works

- `index.ts` + `agents.ts` are pi 1.1.0's subagent example, copied as-is. `index.ts` adds one small tool, `ask_user`, which calls `ctx.ui.input()`.
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
tools: subagent, ask_user   # omit "subagent" so the agent cannot delegate
---

System prompt here — put the question/answer protocol here.
```

- A leaf that only asks: list its working tools (`read, bash, …`) but **omit `subagent`**.
- A relay/mid-level: `tools: subagent`, prompt says "delegate, then relay the result." If it delegates to a project-local agent, tell it to pass `agentScope: "both"`.
- `ask_user` is only meaningful at depth 0 (headless subagents get no UI).
- Omitting `subagent` removes the tool, it is not a sandbox — a leaf with `bash` can still spawn `pi` (see [nested-subagents](../nested-subagents/README.md#what-the-cap-does-and-does-not-guarantee)).

## Verified

On pi 1.1.0: the two-level ripple (`delegator` → `asker` → questions back at depth 0), the graceful headless `ask_user` error, and loading this pattern's own extension from a symlinked directory


## Verify it

```bash
node verify.mjs --verbose
```

Uses the shared driver in `../../shared/rpc.mjs`; runs on `opencode-go/deepseek-v4.1-flash` (`--thinking off`), 180s per prompt — override `PI_TEST_MODEL` / `PI_VERIFY_TIMEOUT_MS`. Never touches your config (throwaway `PI_CODING_AGENT_DIR`).
