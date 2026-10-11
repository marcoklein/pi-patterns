# resumable-subagents

Subagents that remember their previous run — `resume <run-id>` continues the same child with full memory.

## Run it

No install needed:

```bash
pi -e ./index.ts
```

Then:

```
Use the subagent tool with agent poet, task 'write a haiku about the desert to haiku.md'
```

→ `RUN <id>` + `DRAFT: …`

```
Resume that RUN with task 'revision: make the second line about a solitary cactus'
```

→ the same child revises from memory (`REVISED: …`).

## Test it

```bash
node verify.mjs --verbose
```
