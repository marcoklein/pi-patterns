# neutral-research

Goal-blind research — your goal becomes neutral questions, and researchers who never see the goal produce facts cited `path:line`.

## Run it

```bash
../../install.sh --agents neutral-research   # once
cd /path/to/your-repo && pi
```

Step 1 — turn your goal into questions:

```
Use subagent with agentScope "both": agent neutral-question, task "Add Redis caching to the session store. Work dir: docs/research/demo"
```

Step 2 — research those questions:

```
Use subagent with agentScope "both": agent neutral-research, task "Work dir: docs/research/demo"
```

Read `docs/research/demo/research.md`. Sanity check the goal didn't leak: `grep -ril "redis\|cach" docs/research/demo/questions.md` → nothing.

## Test it

```bash
node verify.mjs --verbose
```
