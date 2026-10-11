# hitd-machine

The human-in-the-loop machine — research → designer → human approval gate → gated implementer; files are state, a sentinel is the gate, you are the only key.

## Run it

```bash
../../install.sh --agents hitd-machine --agents neutral-research   # once
cd /path/to/your-repo && pi
```

Work dir e.g. `docs/hitd/demo`:

1. Run the [neutral-research](../neutral-research) walkthrough for your task → `docs/hitd/demo/research.md`.
2. ```
   Use subagent with agentScope "both": agent designer, task "<the task>. Work dir: docs/hitd/demo"
   ```
   → without research: `BLOCKED`; with it: questions. Answer them, re-run with `ANSWERS: …` appended → `design.md` ending `approval: pending`.
3. ```
   Use subagent with agentScope "both": agent implementer, task "Work dir: docs/hitd/demo"
   ```
   → `REFUSED: design not approved`.
4. Edit `design.md`: `approval: approved`, then re-run the implementer → implementation + `result.md`.

## Test it

```bash
node verify.mjs --verbose
```
