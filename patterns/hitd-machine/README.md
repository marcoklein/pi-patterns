# hitd-machine

The irreducible automated HITD machine: **files are state, a sentinel is the gate, refusal is the enforcement, and the human is the only key.** Research comes from the [neutral-research](../neutral-research) bundle — this pattern is the design gate and everything downstream.

```
you (orchestrating session)
  ├─▶ [neutral-research] ──▶ research.md          (goal-blind facts, no designer involved)
  ├─▶ designer ──▶ BLOCKED: open-questions.md     (refuses without research.md)
  ├─▶ designer + ANSWERS ──▶ design.md            (ends: approval: pending)
  └─▶ implementer ─▶ REFUSED ─ or ─▶ result.md    (runs only if a human wrote approval: approved)
```

Nothing else is required: no orchestrator agent, no handoff markers, no run IDs. Your interactive session is the orchestrator (headless children cannot reach you, so questions ripple up); artifacts survive stateless re-invocation; the gate is structural because the designer cannot flip its own sentinel and the implementer touches nothing before checking it.

Two firewalls, each one agent boundary: **research never knew the goal** (neutral-research), **implementation never sees the goal** (only the approved `design.md` — the design is authoritative; contradictions return `BLOCKED`, never improvisation).

## Install (once)

```bash
./install.sh --agents hitd-machine --agents neutral-research
```

Both bundles' agents plus the `subagent` extension land at user scope, which is what nesting needs (children are spawned without `-e`; see the [repo README](../../README.md#read-this-once-why-nesting-needs-an-install)).

## Run it

From the **repository you want changed** (work dir inside it, so research has something to cite):

```bash
cd /path/to/target-repo && pi
```

Drive one task through the machine, work dir e.g. `docs/hitd/demo`:

1. Run the [neutral-research](../neutral-research) walkthrough for your task → `docs/hitd/demo/research.md`.
2. ```
   Use subagent with agentScope "both": agent designer, task "<the task>. Work dir: docs/hitd/demo"
   ```
   Without `research.md`: `BLOCKED: run neutral-research first`. With it: `BLOCKED:` plus intent/taste questions.
3. Answer, then re-invoke `designer` with your answers appended (`ANSWERS: …`) → `design.md` ending in `approval: pending`.
4. **Invoke the implementer now, before step 5, to see the gate bite:**
   ```
   Use subagent with agentScope "both": agent implementer, task "Work dir: docs/hitd/demo"
   ```
   → `REFUSED: design not approved — a human must edit design.md`.
5. Edit `design.md` yourself: `approval: approved`. Re-invoke `implementer` → implementation plus `result.md` with test evidence.

Depth is capped as in [nested-subagents](../nested-subagents): `designer` and `implementer` have no `subagent` tool. Note what that means — the cap stops accidental delegation, it is not a sandbox (a leaf with `bash` can spawn pi itself; see [VERIFIED.md](../../VERIFIED.md), Finding 4). The gate that actually holds here is the **sentinel**: `implementer` reads `design.md` and refuses unless a human wrote `approval: approved` — verified both ways (rows 11–12).

Verified end-to-end on pi 1.1.0: both refusals, the `approval: pending` → `approved` flip, and a real implementation landing with `result.md` evidence — see [VERIFIED.md](../../VERIFIED.md), rows 8–12.

## Verify it

```bash
node verify.mjs --verbose
```

Runs on `opencode-go/deepseek-v4.1-flash` (`--thinking off`) with 180s per prompt by default — override `PI_TEST_MODEL` / `PI_VERIFY_TIMEOUT_MS`. Uses a throwaway `PI_CODING_AGENT_DIR` and never touches your config.
