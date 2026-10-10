# pi-patterns

Small, self-contained [pi](https://github.com/earendil-works/pi) patterns: delegation depth, goal-blind research, human approval gates, resumable children, questions that ripple up. Each pattern is a folder you can run, read, and verify in a few minutes — no package, no build, no dependencies.

## Requirements

- pi ≥ 1.1.0 on `PATH`, with a working model/auth (`pi` should start normally).
- One-time install for the patterns that **nest** (see below):

```bash
./install.sh --agents all     # subagent extension + reusable agents, at user scope
./install.sh --uninstall      # undo
```

`install.sh` honours `PI_CODING_AGENT_DIR` (default `~/.pi/agent`) and finds pi's bundled `examples/extensions/subagent` from the `pi` binary — no npm-global assumption.

## Read this once: why nesting needs an install

pi spawns every subagent as `pi --mode json -p --no-session [--tools …]`. Children therefore:

- do **not** inherit `-e <extension>` → a `subagent` tool loaded only in your top-level session does not exist for them, so a child with `tools: subagent` ends up with *no tools at all*;
- are **not** started with `-a` → a project-local `.pi/extensions/` is skipped (trust-gated), so it cannot rescue nesting either;
- do **not** inherit your `agentScope` → an agent prompt that delegates must say `agentScope: "both"` explicitly, or the child looks only at user-scope agents and reports `Unknown agent`.

Only a **user-scope** extension (`$PI_CODING_AGENT_DIR/extensions/subagent/`) is discoverable by children. That is what `install.sh` creates. Leaf-only patterns that ship their own `index.ts` (`resumable-subagents`) need no install.

## Two layout conventions

| Convention | Layout | Run | Patterns |
|---|---|---|---|
| **Project-local agents** — no code, just agent definitions | `.pi/agents/*.md` | `pi` inside the folder, `agentScope: "both"` (agents installed at user scope also work from any folder) | `nested-subagents`, `neutral-research`, `hitd-machine` |
| **Self-contained extension** — ships its own tool | `index.ts` (+ `agents.ts`) | `pi -e ./index.ts` inside the folder | `resumable-subagents`, `subagent-question` |

Depth is always capped the same way: an agent whose frontmatter `tools:` omits `subagent` gets no `subagent` tool, so it cannot delegate by accident.

**That cap is tool-level, not a sandbox.** A leaf that has `bash` can spawn `pi` itself and delegate anyway — observed with `worker` (see [nested-subagents](patterns/nested-subagents/README.md#what-the-cap-does-and-does-not-guarantee)). `--exclude-tools subagent` would hard-block it, but the stock extension only passes `--tools`. Treat the cap as *intent enforcement*, and keep secrets out of leaf reach if you need more than that.

Interactive runs ask `Run project-local agents?` once before using `.pi/agents/` (repo-controlled prompts); headless `-p` runs skip the prompt.

Everything above was measured, not assumed — each pattern's `verify.mjs` encodes the check.

## Patterns

### [`nested-subagents`](patterns/nested-subagents)

Minimal nested delegation with a structural depth cap: `orchestrator` → `delegator` → `worker`, three layers in three agent files and zero lines of code.

### [`neutral-research`](patterns/neutral-research)

Goal → neutral questions → goal-blind research: a reusable bundle for contamination-free codebase research (3 layers, facts cited `path:line`, no solutions).

### [`hitd-machine`](patterns/hitd-machine)

The irreducible human-in-the-loop machine: neutral research in, `designer` → human approval sentinel → gated `implementer` out. Files are state, refusal is enforcement, the human is the only key.

### [`resumable-subagents`](patterns/resumable-subagents)

Subagents that remember: a stock-style `subagent` tool plus `resume <run-id>`, backed by native pi session files (151 LOC, zero dependencies).

### [`subagent-question`](patterns/subagent-question)

Subagents ask questions that ripple up through nested levels to your session, where a human answers (`ask_user`) and the answers flow back down.

## Composing

`hitd-machine` consumes `neutral-research` as its research stage; both build the depth cap from `nested-subagents`. `./install.sh --agents all` installs all three agent sets at user scope, so you can drive the whole machine from any repository.

## Verification

Each pattern carries its own test next to it (`patterns/<name>/verify.mjs`), which imports the shared driver in [`shared/rpc.mjs`](shared/rpc.mjs). The pattern *runtime* stays self-contained — only the test imports shared code.

```bash
cd patterns/nested-subagents && node verify.mjs --verbose
cd patterns/subagent-question && node verify.mjs --verbose
cd patterns/resumable-subagents && node verify.mjs --verbose
cd patterns/neutral-research && node verify.mjs --verbose
cd patterns/hitd-machine && node verify.mjs --verbose
```

The interactive parts (the `ask_user` human loop and the project-agent approval prompt) are driven over pi's RPC protocol. Defaults: model `opencode-go/deepseek-v4.1-flash`, `--thinking off`, 180s per prompt — override `PI_TEST_MODEL` / `PI_VERIFY_TIMEOUT_MS`.

## License

MIT — see [LICENSE](LICENSE).
