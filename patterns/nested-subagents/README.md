# nested-subagents

Nested subagents with a structural depth cap, in three agent files and zero lines of code.

```
you ──subagent──▶ orchestrator ──subagent──▶ delegator ──subagent──▶ worker ──bash──▶ echo hello
                     (layer 1)                  (layer 2)               (layer 3, leaf)
```

`orchestrator` → `delegator` → `worker`: two layers delegate, the leaf executes. The `tools:` frontmatter in [`.pi/agents/`](.pi/agents/) *is* the depth cap — `worker` has only `bash` (no `subagent`), so it cannot delegate by accident. No depth counter to get wrong.

## Prerequisite (once)

Nesting needs pi's `subagent` extension at **user scope** — children are spawned without `-e`, so a top-level-only extension is invisible to them (details in the [repo README](../../README.md#read-this-once-why-nesting-needs-an-install)).

```bash
../../install.sh
```

## Run it

From this folder:

```bash
pi
```

Then:

```
Use the subagent tool with agentScope "both" to run agent orchestrator with task 'echo hello'
```

Interactive runs ask `Run project-local agents?` once — accept. Expect:

```
orchestrator received: delegator received: hello
```

Headless (no prompt, same result):

```bash
pi --no-session -p 'Use the subagent tool with agentScope "both" to run agent orchestrator with task "echo hello". Reply with only the final text.'
```

Then try delegating *from* `worker`: it has no `subagent` tool, so it cannot delegate *as a tool call* — see the caveat below for what it can still do.

## What the cap does and does not guarantee

Verified on pi 1.1.0 ([VERIFIED.md](../../VERIFIED.md), rows 2–3):

- **Holds:** the child's declared tool list contains only `bash`; asked to call `subagent`, a `--tools bash` session replies `NOTOOL`. `--tools` does filter extension tools.
- **Does not hold:** the cap is not a sandbox. Asked to delegate, `worker` used `bash` to spawn pi itself and got the answer:

  ```
  TOOLCALL bash {"command": "pi --no-session -p 'Use the subagent tool with agentScope \"both\" to run agent orchestrator with task \"echo hi\"…'"}
  RESULT   orchestrator received: delegator received: hi
  ```

  `--exclude-tools subagent` would hard-block that, but the stock extension only ever passes `--tools`, and agent frontmatter has no field for exclusions. So the cap enforces *intent* (leaves cannot delegate through the tool, and their prompts stay honest), not *capability* — do not give a leaf `bash` if it must not reach the network, the filesystem, or another pi process.

## The two details that make nesting work

1. **`agentScope: "both"` in the agent prompts.** Children default to `"user"` scope, so [`orchestrator.md`](.pi/agents/orchestrator.md) and [`delegator.md`](.pi/agents/delegator.md) tell the model to pass `agentScope: "both"` when delegating; otherwise the child cannot see this folder's `.pi/agents/` and replies `Unknown agent: "delegator"`.
2. **User-scope extension.** See the prerequisite above — `pi -e <stock>/index.ts` alone gives the child `tools: subagent` with no such tool present, i.e. *no tools at all*, and the chain silently returns `(no output)`.

## Add an agent

Drop a `.md` file into `.pi/agents/`:

```markdown
---
name: my-agent
description: what it does
tools: subagent        # include "subagent" to allow delegation; omit to make a hard leaf
---

System prompt here. If it delegates, tell it to pass agentScope "both".
```

Depth-3 chain, leaf tool filtering and the `bash` escape are all verified on pi 1.1.0 — see [VERIFIED.md](../../VERIFIED.md).

## Verify it

```bash
node verify.mjs --verbose
```

Runs on `opencode-go/deepseek-v4.1-flash` (`--thinking off`) with 180s per prompt by default — override `PI_TEST_MODEL` / `PI_VERIFY_TIMEOUT_MS`. Uses a throwaway `PI_CODING_AGENT_DIR` and never touches your config.
