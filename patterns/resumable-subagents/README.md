# resumable-subagents

Subagents that **remember their previous run**: a stock-style `subagent` tool where each run gets a UUID backed by a real pi session file, so `resume` continues the *same child* — pi-subagents' headline feature in 151 lines and zero dependencies.

```
subagent({agent, task})            ──▶ RUN <id>  →  child pi session (.subagent-runs/<id>.jsonl)
subagent({resume: <id>, task})     ──▶ same child, full conversational memory — no artifact relay
```

The trick is pi's own persistence: `--session-dir <dir> --session-id <uuid>` on the *next* spawn **loads the history and continues it**. Everything else is the stock example: isolated processes, `tools:`-gated agents, JSON event parsing.

## Run it

Self-contained: this pattern ships its own extension and its agent is a leaf, so **no install is needed** — `pi -e ./index.ts` loads the tool in your session and the child only needs builtins.

From this folder:

```bash
pi -e ./index.ts
```

Do **not** install this extension at user scope next to pi's stock `subagent` extension: both register a tool named `subagent`, and they are not interchangeable.

1. `Use the subagent tool with agent poet, task 'write a haiku about the desert to haiku.md'`
   → `RUN <id>` + `DRAFT: …`
2. `Resume that RUN with task 'revision: make the second line about a solitary cactus'`
   → `REVISED: …` — the child quotes **its own earlier lines from memory** (compare: a stock stateless re-invocation would need `haiku.md` re-read and no recognition of its choices).

Runs persist in `.subagent-runs/` (gitignored): `<id>.jsonl` sessions, `<id>.json` records, `<id>.prompt.md` — `cat` them to inspect any child's full transcript.

## What this replaces, and what it doesn't

Of pi-subagents' 91k LOC, the machinery HITD actually used was resume + run IDs — both here. Still absent by design: `async`/background runs, fleet UI, watchdog, budgets. For revision-heavy phases (HITD's Design loop), stateless-artifact patterns ([neutral-research](../neutral-research), [hitd-machine](../hitd-machine)) stay the leaner choice: resume *saves re-explaining* but costs a persistent session per child. Depth protection works as elsewhere — `poet` has no `subagent` tool, so it's a hard leaf.

Verified on pi 1.1.0: fresh run → `DRAFT`, `resume <run-id>` → the same child revising from memory — see [VERIFIED.md](../../VERIFIED.md).

## Verify it

```bash
node verify.mjs --verbose
```

Runs on `opencode-go/deepseek-v4.1-flash` (`--thinking off`) with 180s per prompt by default — override `PI_TEST_MODEL` / `PI_VERIFY_TIMEOUT_MS`. Uses a throwaway `PI_CODING_AGENT_DIR` and never touches your config.
