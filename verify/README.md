# verify

Automated checks for the parts of the patterns that need a human + UI, plus a reusable RPC driver.

## What it proves

The two things that used to be "run the TUI and type" are now driven over pi's RPC protocol, which exposes `ctx.ui` dialogs as `extension_ui_request` records that a client answers with `extension_ui_response`:

| Test | Asserts |
|---|---|
| **A** `subagent-question` | the `ask_user` dialog fires at depth 0 and the scripted answer returns through the tool; the `delegator → asker` chain delegates and completes |
| **B** `nested-subagents` approval | the stock tool's `Run project-local agents?` confirm fires; accept → chain runs; decline → `Canceled: project-local agents not approved.` |

## Run it

```bash
node verify/interactive.mjs --verbose
```

Requirements: `pi` on `PATH` and valid auth in your real agent dir (`~/.pi/agent`, `~/.config/.pi/agent`, or `$PI_CODING_AGENT_DIR`). The harness copies credentials into a throwaway `PI_CODING_AGENT_DIR` and deletes it afterwards — your real config is never modified.

Environment knobs:

| Variable | Default | Meaning |
|---|---|---|
| `PI_TEST_MODEL` | `opencode-go/deepseek-v4.1-flash` | model passed to every process (children inherit it) |
| `PI_VERIFY_TIMEOUT_MS` | `180000` | per-prompt timeout |
| `PI_BIN` | `pi` | CLI entry point |
| `PI_STOCK_SUBAGENT_DIR` | auto-detected | override path to pi's `examples/extensions/subagent` |

Exit code is `0` when all checks pass, `1` otherwise.

## Why RPC, not the SDK

The in-process SDK has no way to answer `ctx.ui` dialogs (`createAgentSession` exposes no UI responder, and `ctx.hasUI` is false there). The exported `RpcClient` wraps the same RPC process but does not expose the `extension_ui_request`/`extension_ui_response` subprotocol either. `verify/rpc.mjs` implements the wire protocol directly (JSONL over stdio, ~150 lines, no dependencies), which also means it exercises the real CLI, real extension loading, and real child `pi` spawns — not an approximation.

## Files

- `rpc.mjs` — `RpcDriver` (spawn `pi --mode rpc`, correlate events, answer dialogs) + helpers.
- `interactive.mjs` — the tests and assertions above.
