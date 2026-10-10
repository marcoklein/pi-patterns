# neutral-research

A reusable bundle for **better research**: transform any goal into neutral questions, then research the codebase *without anyone who knows the goal touching it* — goal-blind findings about current behavior, cited `path:line`.

```
you ─▶ neutral-question (knows goal) ─▶ questions.md (goal unrecoverable)
                └──────────────── not passed on ─────────────────┐
you ─▶ neutral-research (NEVER sees goal) ─┬─▶ worker(q1)        │
                                           ├─▶ worker(q2)   research.md ─▶ returned to you
                                           └─▶ worker(q3) ───────┘
```

Why bother: a researcher who knows the goal shops for confirmation and drifts toward solutions. Facts about *what exists*, gathered by processes that *cannot* know what you want, are the cleanest input to any design.

## Install (once)

```bash
./install.sh --agents neutral-research
```

That puts the `subagent` extension and these three agents at user scope, so you can run the bundle **from any repository**. Nesting requires user scope — children are spawned without `-e` (see the [repo README](../../README.md#read-this-once-why-nesting-needs-an-install)).

## Use it

Start pi **inside the repository you want researched**, and put the work directory *inside that repository* — the workers investigate pi's working directory, so a work dir in `/tmp` yields research about nothing:

```bash
cd /path/to/target-repo && pi
```

1. ```
   Use subagent with agentScope "both": agent neutral-question, task "Add Redis caching to the session store. Work dir: docs/research/demo"
   ```
   → `docs/research/demo/questions.md`. **Audit it:** can you tell what feature is being added? If yes, re-run this step.
2. ```
   Use subagent with agentScope "both": agent neutral-research, task "Work dir: docs/research/demo"
   ```
   → fans out one worker per question, writes `docs/research/demo/research.md` — facts with `path:line`, zero solutions — and replies `COMPLETED: research.md`.
3. Contamination check: `grep -ril "redis\|cach" docs/research/demo/questions.md` should find nothing.

Headless equivalent (verified on pi 1.1.0):

```bash
pi --no-session -p 'Use subagent with agentScope "both": agent neutral-question, task "<goal>. Work dir: docs/research/demo"'
pi --no-session -p 'Use subagent with agentScope "both": agent neutral-research, task "Work dir: docs/research/demo"'
```

## The three knowledge scopes (this is the whole pattern)

| Agent | Knows | Never sees |
|---|---|---|
| `neutral-question` | the goal | — (it's the sanctioned transform) |
| `neutral-research` | only the questions | the goal, `task.md` — refuses contaminated handoffs |
| `neutral-research-worker` | one question | even the other questions |

Enforcement is layered: stateless headless processes (context cannot leak via history), minimal handoffs (only what is allowed is passed), refusal rules, and your audit of the artifacts (snooping on the shared filesystem is prompt-blocked and detectable).

`neutral-research` delegates and `neutral-research-worker` does not — depth 3, leaf-capped exactly as in [nested-subagents](../nested-subagents). Consumed by [hitd-machine](../hitd-machine) as the research stage.

Be precise about what is enforced: the *goal* never reaches the researchers because nothing passes it (separate stateless processes, minimal handoffs, refusal rules) — not because the workers lack tools. A worker has `bash`, so it could in principle snoop for `task.md`; that is prompt-blocked and detectable, which is why step 1's audit and step 3's grep are part of the pattern rather than optional polish.

Verified end-to-end on pi 1.1.0 — goal-blind questions (`CLEAN` contamination grep), worker fan-out, and `research.md` citing real `index.ts:106-117`-style locations — see [VERIFIED.md](../../VERIFIED.md), rows 6–7.

## Verify it

```bash
node verify.mjs --verbose
```

Runs on `opencode-go/deepseek-v4.1-flash` (`--thinking off`) with 180s per prompt by default — override `PI_TEST_MODEL` / `PI_VERIFY_TIMEOUT_MS`. Uses a throwaway `PI_CODING_AGENT_DIR` and never touches your config.
