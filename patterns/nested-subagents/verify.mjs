// Verify nested-subagents: the 3-layer chain and the project-agent approval gate.
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
  findCredsDir,
  findStockSubagent,
  makeAgentDir,
  runJson,
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

const tmp = mkdtempSync(join(tmpdir(), "nested-verify-"));
try {
  const stock = findStockSubagent();
  if (!stock) throw new Error("could not locate pi's examples/extensions/subagent");

  // Clean agent dir: stock extension at user scope, agents left project-local.
  const agentDir = makeAgentDir(creds, tmp);
  mkdirSync(join(agentDir, "extensions", "subagent"), { recursive: true });
  symlinkForce(join(stock, "index.ts"), join(agentDir, "extensions", "subagent", "index.ts"));
  symlinkForce(join(stock, "agents.ts"), join(agentDir, "extensions", "subagent", "agents.ts"));
  const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir };

  // 1 — the documented headless chain (retried: the echo chain is model-
  // nondeterministic and occasionally comes back garbled).
  await run("chain (headless)", async () => {
    let subs = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { events } = await runJson({
        cwd: pattern,
        env,
        timeoutMs: timeout,
        args: [...modelArgs, 'Use the subagent tool with agentScope "both" to run agent orchestrator with task "echo hello". Reply with only the final text.'],
      });
      subs = toolResults(events, "subagent").map((e) => toolText(e.result));
      if (subs.some((t) => /hello/i.test(t))) break;
      if (attempt < 3) console.log(`     retry ${attempt + 1}/3 (no "hello" in result)`);
    }
    check("3-layer chain runs", subs.some((t) => /hello/i.test(t)), subs[0]?.slice(0, 60) ?? "no subagent result");
  });

  // 2 + 3 — the approval gate over RPC. --no-approve forces the untrusted
  // state so the stock tool's "Run project-local agents?" confirm fires.
  const argsB = [...modelArgs, "--no-approve"];
  const msg =
    'Use the subagent tool with agentScope "both" (leave confirmProjectAgents unset) to run agent orchestrator with task "echo hello".';

  await run("approval (accept)", async () => {
    const d = new RpcDriver({ cwd: pattern, env, args: argsB }).start();
    try {
      const ev = await d.promptAndSettle(msg, { timeoutMs: timeout, onUiRequest: (r) => (r.method === "confirm" ? { confirmed: true } : null) });
      const confirms = uiRequests(ev, "confirm");
      const fire = confirms.some((r) => /project-local agents/i.test(`${r.title ?? ""} ${r.message ?? ""}`));
      const ok = toolResults(ev, "subagent").map((e) => toolText(e.result)).some((t) => /hello/i.test(t));
      check("approval confirm fires", fire, `${confirms.length} confirm(s)`);
      check("accept -> chain runs", ok);
    } finally {
      await d.stop();
    }
  });

  await run("approval (decline)", async () => {
    const d = new RpcDriver({ cwd: pattern, env, args: argsB }).start();
    try {
      const ev = await d.promptAndSettle(msg, { timeoutMs: timeout, onUiRequest: (r) => (r.method === "confirm" ? { confirmed: false } : null) });
      const ok = toolResults(ev, "subagent").map((e) => toolText(e.result)).some((t) => t.includes("Canceled: project-local agents not approved"));
      check("decline -> canceled, chain did not run", ok);
      if (verbose) console.log("     " + (toolResults(ev, "subagent").map((e) => toolText(e.result))[0] ?? ""));
    } finally {
      await d.stop();
    }
  });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${checks.length - failures.length}/${checks.length} checks passed`);
process.exitCode = failures.length ? 1 : 0;
