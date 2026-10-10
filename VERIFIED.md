# VERIFIED

What was actually run, what came out, and what is still a manual check.

**Environment** — pi **1.1.0** (also the latest published version on npm at test time), macOS/arm64, model `github-copilot/gpt-6-luna`, date **2026-10-09**.

**Method** — every test ran headless (`pi --no-session -p --mode json …`) inside a *clean* `PI_CODING_AGENT_DIR` (a temp dir containing only symlinked `auth.json`, `models-store.json`, `settings.json`, `trust.json`), set up with `./install.sh` exactly as the READMEs instruct. Nothing was pre-installed at user scope. Outputs below are quoted from the JSON event stream (`toolResult` text and the child transcripts in `details.results[].messages`).

After committing, rows 1 and 4–5 were re-run from a **fresh `git clone`** with a fresh temp agent dir, to prove the pushed state is self-sufficient: `install.sh` resolved pi's bundled extension, and the chain returned `orchestrator received: delegator received: hello`.

Model output is not deterministic: wording varies between runs, the *structure* (which agent ran, which refusal fired, which artifact appeared) is what is being asserted.

## Results

| # | Pattern | Check | Result |
|---|---|---|---|
| 1 | `nested-subagents` | 3-layer chain | ✅ `orchestrator received: delegator received: hello` |
| 2 | `nested-subagents` | leaf has no `subagent` tool | ✅ child system prompt declares only `bash`; a direct probe with `--tools bash` replies `NOTOOL` |
| 3 | `nested-subagents` | cap is not a sandbox | ⚠️ `worker` used `bash` to run `pi …` and delegated anyway (see Finding 4) |
| 4 | `resumable-subagents` | fresh run | ✅ `RUN 7663ec6f-…` + `DRAFT: Dry winds sculpt the dunes …`, `haiku.md` written |
| 5 | `resumable-subagents` | `resume <run-id>` keeps memory | ✅ same run id, `REVISED: Replaced the second line with "A lone cactus guards the dunes"; first line remains "Sun sinks into sand"` — the child quotes its own earlier lines |
| 6 | `neutral-research` | goal-blind questions | ✅ 4 flow questions, `grep -ril "budget\|cap\|N turns" questions.md` → no hits (`CLEAN`) |
| 7 | `neutral-research` | fan-out + real citations | ✅ `COMPLETED: research.md`, citing `index.ts:100-101`, `index.ts:106-117`, `index.ts:122-126`, `index.ts:128-133`, `index.ts:132-138` |
| 8 | `hitd-machine` | designer without research | ✅ `BLOCKED: run neutral-research first` |
| 9 | `hitd-machine` | designer with research | ✅ `BLOCKED:` + 3 intent questions, `open-questions.md` written |
| 10 | `hitd-machine` | designer + `ANSWERS:` | ✅ `COMPLETED: design.md`, file ends `approval: pending` |
| 11 | `hitd-machine` | implementer before approval | ✅ `REFUSED: design not approved — a human must edit design.md` |
| 12 | `hitd-machine` | human flips sentinel → implement | ✅ `COMPLETED: result.md`; real code change (`maxTurns` in the tool schema, `turn_end` counting, `BUDGET EXCEEDED RUN <id>`), `result.md` includes a checks section |
| 13 | `subagent-question` | questions ripple up 2 levels | ✅ `delegator` → `asker` returned: `1. What platform or framework should the auth system target? 2. Should it use session tokens or JWTs, …` |
| 14 | `subagent-question` | `ask_user` headless | ✅ `Error: ask_user needs an interactive session (no UI available).` (as its Caveats state) |
| 15 | `subagent-question` | own extension as a symlinked dir | ✅ `$PI_CODING_AGENT_DIR/extensions/subagent-question → patterns/subagent-question` loads; both `subagent` and `ask_user` register |
| 16 | all | API compatibility with 1.1.0 | ✅ every frontmatter tool name (`read, grep, find, ls, write, edit, bash`) is a real builtin; `ctx.hasUI` / `ctx.ui.input(title, placeholder)` exist; all CLI flags used exist; `subagent-question/index.ts` is the stock 1.1.0 example plus an additive `ask_user` tool (37 lines), `agents.ts` byte-identical |
| 17 | `subagent-question` | `ask_user` human loop (automated) | ✅ driven over RPC by [verify.mjs](patterns/subagent-question/verify.mjs): the dialog fires, the scripted answer returns (`ANSWER: blue`), and the `delegator → asker` chain completes |
| 18 | `nested-subagents` | project-agent approval (automated) | ✅ [verify.mjs](patterns/nested-subagents/verify.mjs): the `Run project-local agents?` confirm fires; accept → chain runs, decline → `Canceled: project-local agents not approved.` |

## Manual checks

Each pattern ships a `verify.mjs`; run it from inside the pattern folder:

```bash
cd patterns/<pattern> && node verify.mjs --verbose
```

The interactive checks (rows 17–18) are driven over `pi --mode rpc`, which exposes `ctx.ui` dialogs as `extension_ui_request` records that the harness answers programmatically. Defaults: model `opencode-go/deepseek-v4.1-flash`, `--thinking off`, 180s per prompt — override with `PI_TEST_MODEL` and `PI_VERIFY_TIMEOUT_MS`. Every script builds a throwaway `PI_CODING_AGENT_DIR` (copies your `auth.json`/`settings.json`) and never touches your real config.

The only thing still not covered by automation is the *look* of the dialogs in the TUI (rendering/keybindings). The underlying protocol — dialogs at depth 0, answers flowing back, accept/decline branches — is what the harness asserts.

## Findings that changed the docs

1. **Children never inherit `-e`.** Subagents spawn as `pi --mode json -p --no-session [--tools …]`. With the extension loaded only via `-e`, a child whose frontmatter says `tools: subagent` gets an allowlist naming a tool that does not exist → its system prompt shows `tools: (none)` and the call returns `(no output)`. Fix: user-scope install (`install.sh`).
2. **Project-local `.pi/extensions/` cannot rescue nesting.** It is trust-gated and children are not started with `-a`; verified `(no output)` even when the top-level run passed `-a`.
3. **Children never inherit `agentScope`.** Default is `"user"`, so a delegating agent prompt must say `agentScope: "both"`; otherwise the child reports `Unable to complete the task because the "delegator" agent is unavailable`. This was a real bug in `nested-subagents` (fixed in `orchestrator.md` / `delegator.md`); `neutral-research` already had it.
4. **The depth cap is tool-level, not a sandbox.** `worker` (`tools: bash`) had no `subagent` tool, and still delegated by shelling out:
   ```
   TOOLCALL bash {"command": "pi --no-session -p 'Use the subagent tool with agentScope \"both\" to run agent orchestrator with task \"echo hi\"…'"}
   RESULT   orchestrator received: delegator received: hi
   ```
   `--exclude-tools subagent` *would* hard-block it (verified: `NOTOOL`), but the stock extension only ever passes `--tools`, never `-xt`, and agent frontmatter has no field for it. So: the cap reliably stops *accidental* delegation and keeps leaf prompts honest; it is not a security boundary against a leaf that has `bash`.
5. **`--tools` does filter extension tools** (contrary to what row 3's first appearance suggested): a direct probe with `--tools bash` and the extension loaded replies `NOTOOL`.
6. **`neutral-research` needs its work dir inside the target repo.** Workers investigate pi's working directory; with the work dir in `/tmp` and pi started in the pattern folder, `research.md` came back citing only `questions.md:1…4`. Run from the repo you want researched (READMEs updated).
7. **The subagent tool's own confirm needs an untrusted project.** In RPC/headless mode there is no interactive trust prompt, so `ctx.isProjectTrusted()` is true and the `Run project-local agents?` confirm is skipped (the chain runs without asking). Pass `--no-approve` to force the untrusted path — which is what the approval test (row 18) does. In the TUI you would see pi's project-trust prompt first, and approving it likewise skips the subagent confirm.

## Reproduce

```bash
git clone git@github.com:marcoklein/pi-patterns.git && cd pi-patterns
pi --version                       # expect 1.1.0 or newer
T=$(mktemp -d); PI_CODING_AGENT_DIR=$T ./install.sh --agents all   # clean room
cd patterns/nested-subagents && PI_CODING_AGENT_DIR=$T pi --no-session -p \
  'Use the subagent tool with agentScope "both" to run agent orchestrator with task "echo hello". Reply with only the final text.'
```

Rows 4–15 follow the same shape: `cd` into the pattern (or a target repo for `neutral-research` / `hitd-machine`), run the command from its README with `--no-session -p --mode json`, and compare the structure of the output.
