// Automated verification of the two checks that needed a human + TUI:
//
//   A. subagent-question: ask_user dialogs ripple up to depth 0, and answering
//      them lets the subagent make progress (round 2 delegates and returns a
//      completed result instead of just questions).
//   B. project-agent approval: the stock subagent tool's "Run project-local
//      agents?" confirm fires in RPC mode; accept -> chain runs, decline ->
//      "Canceled: project-local agents not approved."
//
// Run:  node verify/interactive.mjs [--verbose]
// Needs: pi on PATH, valid auth in your real pi agent dir.
//
// Fast model + short timeouts by default:
//   PI_TEST_MODEL=opencode-go/deepseek-v4.1-flash (override via env)
//   PI_VERIFY_TIMEOUT_MS=180000
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RpcDriver,
  assistantText,
  findCredsDir,
  findStockSubagent,
  makeAgentDir,
  symlinkForce,
  toolResults,
  toolText,
  uiRequests,
} from "./rpc.mjs";

const verbose = process.argv.includes("--verbose");
const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const patterns = join(repo, "patterns");
const testModel = process.env.PI_TEST_MODEL || "opencode-go/deepseek-v4.1-flash";
const modelArgs = ["--model", testModel, "--thinking", "off"];
const perPromptTimeout = Number(process.env.PI_VERIFY_TIMEOUT_MS || 180_000);
const maxDialogsPerRound = 3;

const creds = findCredsDir();
if (!creds) {
  console.error("no auth.json found in ~/.pi/agent, ~/.config/.pi/agent, or $PI_CODING_AGENT_DIR");
  process.exit(2);
}

const results = [];
const failures = [];
function check(name, cond, detail = "") {
  const line = `${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`;
  results.push(line);
  console.log(line);
  if (!cond) failures.push(name);
}
async function run(id, fn) {
  try {
    await fn();
  } catch (e) {
    console.error(`\nERROR ${id}: ${e.stack || e}`);
    failures.push(id);
  }
}

const tmp = mkdtempSync(join(tmpdir(), "pi-verify-"));
const cleanEnv = (agentDir) => ({ ...process.env, PI_CODING_AGENT_DIR: agentDir });

try {
  // ============================================================ A: ask_user loop
  await run("A: subagent-question human loop", async () => {
    const agentDir = makeAgentDir(creds, join(tmp, "A"));
    const q = join(patterns, "subagent-question");
    const workA = join(tmp, "A-work");
    mkdirSync(workA, { recursive: true });
    symlinkForce(q, join(agentDir, "extensions", "subagent-question"));
    for (const n of ["asker", "delegator"]) symlinkForce(join(q, ".pi", "agents", `${n}.md`), join(agentDir, "agents", `${n}.md`));

    const driver = new RpcDriver({ cwd: workA, env: cleanEnv(agentDir), args: modelArgs }).start();
    try {
      // A1 — deterministic: ask_user dialog appears at depth 0 and the answer
      // flows back through the tool.
      const roundTrip = await driver.promptAndSettle(
        'Call the ask_user tool with question "What color should the test use?". Then reply with exactly the text the tool returned, prefixed with ANSWER: ',
        { timeoutMs: perPromptTimeout, onUiRequest: (req) => (req.method === "input" ? { value: "blue" } : null) },
      );
      const tripFinal = assistantText(roundTrip);
      const tripInputs = uiRequests(roundTrip, "input");
      check("A1  ask_user dialog fired and answer returned", tripInputs.length >= 1 && /blue/i.test(tripFinal), tripInputs.length ? `answer echoed: ${/blue/i.test(tripFinal)}` : "no dialog");
      if (verbose) console.log(`       ask_user round-trip: ${tripFinal.slice(0, 120)}`);

      // A2 — the pattern: delegator -> asker -> (questions up) -> answers down.
      const pool = [
        "A browser-only Node/Express web app with email+password login, password resets, and MFA via TOTP.",
        "Postgres as the session store; refresh tokens encrypted with AES-GCM; access tokens are short-lived JWTs.",
        "Use JWT access + encrypted refresh tokens instead of server-side sessions.",
      ];
      const answers = [];
      const task = "design an auth system with password hashing and token encryption";

      // Answer at most `maxDialogsPerRound` inputs, then cancel + abort so the
      // round always settles instead of the model asking forever.
      const makeUiHandler = () => {
        let n = 0;
        return (req) => {
          if (req.method !== "input") return null;
          if (n < maxDialogsPerRound) {
            const a = pool[answers.length % pool.length];
            answers.push({ q: req.title, a });
            n++;
            return { value: a };
          }
          if (n === maxDialogsPerRound) {
            n++;
            driver.send({ type: "abort" });
          }
          return { cancelled: true };
        };
      };

      const round1 = await driver.promptAndSettle(
        `Use the subagent tool with agentScope "both" with agent "delegator" and task "${task}".`,
        { timeoutMs: perPromptTimeout, onUiRequest: makeUiHandler() },
      );
      const inputs1 = uiRequests(round1, "input");
      if (verbose) console.log(`       round 1: ${inputs1.length} ask_user dialog(s)`);
      for (const r of inputs1.slice(0, maxDialogsPerRound)) console.log(`         ask_user: ${(r.title ?? "").slice(0, 100)}`);

      const prev = answers.map((x, i) => `Q${i + 1}: ${x.q}\nA${i + 1}: ${x.a}`).join("\n\n");
      const round2 = await driver.promptAndSettle(
        `Use the subagent tool with agentScope "both" with agent "delegator" and task "${task}.\n\nPREVIOUS ANSWERS:\n${prev}".`,
        { timeoutMs: perPromptTimeout, onUiRequest: makeUiHandler() },
      );
      const subs2 = toolResults(round2, "subagent").map((e) => toolText(e.result));
      const final2 = assistantText(round2);
      if (verbose) console.log(`       round 2 final: ${final2.slice(0, 240)}`);

      check("A2  delegator chain completed", subs2.length >= 1 && final2.length >= 40, `final ${final2.length} chars`);
      console.log(inputs1.length >= 1 ? "       (ripple observed: questions reached depth 0)" : "       (note: asker asked no questions this run — mechanism covered by A1)");
    } finally {
      await driver.stop();
    }
  });

  // ==================================================== B: approval prompt
  const stock = findStockSubagent();
  if (!stock) throw new Error("could not locate pi's examples/extensions/subagent");

  await run("B: project-agent approval", async () => {
    const agentDir = makeAgentDir(creds, join(tmp, "B"));
    mkdirSync(join(agentDir, "extensions", "subagent"), { recursive: true });
    symlinkForce(join(stock, "index.ts"), join(agentDir, "extensions", "subagent", "index.ts"));
    symlinkForce(join(stock, "agents.ts"), join(agentDir, "extensions", "subagent", "agents.ts"));
    const cwd = join(patterns, "nested-subagents");
    const msg =
      'Use the subagent tool with agentScope "both" (leave confirmProjectAgents unset) to run agent orchestrator with task "echo hello".';

    // --no-approve forces the untrusted project state so the stock tool's
    // "Run project-local agents?" confirm fires. In RPC/headless mode without
    // it, isProjectTrusted() is true (no interactive trust prompt exists), so
    // the confirm would be skipped — which is exactly what a TUI user approves
    // first via pi's own trust prompt.
    const argsB = [...modelArgs, "--no-approve"];

    // accept
    {
      const driver = new RpcDriver({ cwd, env: cleanEnv(agentDir), args: argsB }).start();
      try {
        const ev = await driver.promptAndSettle(msg, { timeoutMs: perPromptTimeout, onUiRequest: (req) => (req.method === "confirm" ? { confirmed: true } : null) });
        const confirms = uiRequests(ev, "confirm");
        const fire = confirms.some((r) => /project-local agents/i.test(`${r.title ?? ""} ${r.message ?? ""}`));
        const subs = toolResults(ev, "subagent").map((e) => toolText(e.result));
        const ok = subs.some((t) => /hello/i.test(t));
        check("B1  confirm dialog fired", fire, `${confirms.length} confirm(s)`);
        check("B2  accept -> chain ran", ok, subs[0]?.slice(0, 60) ?? "no subagent result");
      } finally {
        await driver.stop();
      }
    }

    // decline
    {
      const driver = new RpcDriver({ cwd, env: cleanEnv(agentDir), args: argsB }).start();
      try {
        const ev = await driver.promptAndSettle(msg, { timeoutMs: perPromptTimeout, onUiRequest: (req) => (req.method === "confirm" ? { confirmed: false } : null) });
        const subs = toolResults(ev, "subagent").map((e) => toolText(e.result));
        const ok = subs.some((t) => t.includes("Canceled: project-local agents not approved"));
        check("B3  decline -> canceled, chain did not run", ok, subs[0]?.slice(0, 60) ?? "no subagent result");
      } finally {
        await driver.stop();
      }
    }
  });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${results.length - failures.length}/${results.length} checks passed`);
process.exitCode = failures.length ? 1 : 0;
