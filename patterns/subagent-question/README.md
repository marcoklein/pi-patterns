# subagent-question

Subagents ask questions that ripple up to you — you answer at depth 0, the answers flow back down.

## Run it

```bash
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
mkdir -p "$agent_dir/extensions"
ln -sfn "$PWD" "$agent_dir/extensions/subagent-question"
../../install.sh --no-extension --agents subagent-question
pi
```

In pi:

```
Use the subagent tool with agent "delegator" and task "design an auth system with password hashing and token encryption".
```

The questions reach you as prompts; answer them and the subagent continues. Interactive only — the `ask_user` tool needs a UI.

## Test it

```bash
node verify.mjs --verbose
```
