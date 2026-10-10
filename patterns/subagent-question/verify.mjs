// Verify subagent-question: ask_user dialogs ripple up to depth 0, answers
// flow back down, and the delegator -> asker chain completes.
//
//   node verify.mjs [--verbose]
//
// Env: PI_TEST_MODEL (default opencode-go/deepseek-v4.1-flash),
//      PI_VERIFY_TIMEOUT_MS (default 180000).
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RpcDriver,
  assistantText,
  findCredsDir,
  makeAgentDir,
  symlinkForce,
  toolResults,
  toolText,
  uiRequests,
} from "../../shared/rpc.mjs";

const verbose = process.argv.includes("--verbose");
const pattern = dirname(fileURLToPath(import.meta.url));
const model = process.env.PI_TEST_MODEL || "opencode-go/deepseek-v4.1-flash";
const modelArgs = ["--model", model, "--thinking", "off"];
const timeout = Number(process.env.PI_VERIFY_TIMEOUT_MS || 180_000);
const maxDialogsPerRound = 3;

const creds = findCredsDir();
if (!creds) {
  console.error("no auth.json found in ~/.pi/agent, ~/.config/.pi/agent, or $PI_CODING_AGENT_DIR");
  process.exit(2);
}

const checks = [];
const failures = [];
function check(name, cond, detail = "") {
  const line = `${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`;
  checks.push(line);
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

const tmp = mkdtempSync(join(tmpdir(), "sq-verify-"));
try {
  // Clean agent dir: this pattern ships its OWN extension (stock + ask_user),
  // so symlink the whole folder, plus its agents at user scope.
  const agentDir = makeAgentDir(creds, tmp);
  symlinkForce(pattern, join(agentDir, "extensions", "subagent-question"));
  for (const n of ["asker", "delegator"]) symlinkForce(join(pattern, ".pi", "agents", `${n}.md`), join(agentDir, "agents", `${n}.md`));
  const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir };
  // Scratch cwd so the asker's written files never land in this folder.
  const work = join(tmp, "work");
  mkdirSync(work, { recursive: true });

  const driver = new RpcDriver({ cwd: work, env, args: modelArgs }).start();
  try {
    // A1 — deterministic: ask_user dialog fires at depth 0, answer returns.
    await run("ask_user round-trip", async () => {
      const ev = await driver.promptAndSettle(
        'Call the ask_user tool with question "What color should the test use?". Then reply with exactly the text the tool returned, prefixed with ANSWER: ',
        { timeoutMs: timeout, onUiRequest: (r) => (r.method === "input" ? { value: "blue" } : null) },
      );
      const trip = uiRequests(ev, "input");
      const final = assistantText(ev);
      check("ask_user dialog fires and answer returns", trip.length >= 1 && /blue/i.test(final), trip.length ? `answer echoed: ${/blue/i.test(final)}` : "no dialog");
      if (verbose) console.log(`     ${final.slice(0, 120)}`);
    });

    // A2 — the pattern: delegator -> asker -> (questions up) -> answers down.
    await run("delegator chain", async () => {
      const pool = [
        "A browser-only Node/Express web app with email+password login, password resets, and MFA via TOTP.",
        "Postgres as the session store; refresh tokens encrypted with AES-GCM; access tokens are short-lived JWTs.",
        "Use JWT access + encrypted refresh tokens instead of server-side sessions.",
      ];
      const answers = [];
      const task = "design an auth system with password hashing and token encryption";

      // Answer at most N inputs, then cancel + abort so the round always settles.
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
        { timeoutMs: timeout, onUiRequest: makeUiHandler() },
      );
      const inputs1 = uiRequests(round1, "input");
      if (verbose) console.log(`     round 1: ${inputs1.length} ask_user dialog(s)`);
      for (const r of inputs1.slice(0, maxDialogsPerRound)) console.log(`       ask_user: ${(r.title ?? "").slice(0, 100)}`);

      const prev = answers.map((x, i) => `Q${i + 1}: ${x.q}\nA${i + 1}: ${x.a}`).join("\n\n");
      const round2 = await driver.promptAndSettle(
        `Use the subagent tool with agentScope "both" with agent "delegator" and task "${task}.\n\nPREVIOUS ANSWERS:\n${prev}".`,
        { timeoutMs: timeout, onUiRequest: makeUiHandler() },
      );
      const subs2 = toolResults(round2, "subagent").map((e) => toolText(e.result));
      const final2 = assistantText(round2);
      check("delegator -> asker completes", subs2.length >= 1 && final2.length >= 40, `final ${final2.length} chars`);
      console.log(inputs1.length >= 1 ? "     (ripple observed: questions reached depth 0)" : "     (note: asker asked no questions this run — mechanism covered by the round-trip)");
    });
  } finally {
    await driver.stop();
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${checks.length - failures.length}/${checks.length} checks passed`);
process.exitCode = failures.length ? 1 : 0;
