# nested-subagents

Nested subagents with a structural depth cap — `orchestrator` → `delegator` → `worker`, three agent files, zero code.

## Run it

```bash
../../install.sh    # once: puts the subagent extension at user scope (nesting needs it)
pi
```

In pi, accept the `Run project-local agents?` prompt, then:

```
Use the subagent tool with agentScope "both" to run agent orchestrator with task 'echo hello'
```

Expect `orchestrator received: delegator received: hello`.

## Test it

```bash
node verify.mjs --verbose
```
