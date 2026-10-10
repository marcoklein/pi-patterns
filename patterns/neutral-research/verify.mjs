// Verify neutral-research: the goal never reaches the questions, the fan-out
// runs, and research.md cites real code locations.
//
//   node verify.mjs [--verbose]
//
// Env: PI_TEST_MODEL (default opencode-go/deepseek-v4.1-flash),
//      PI_VERIFY_TIMEOUT_MS (default 180000).
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findCredsDir, findStockSubagent, makeAgentDir, runJson, symlinkForce, toolText, toolResults } from "../../verify/rpc.mjs";

const verbose = process.argv.includes("--verbose");
const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
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

const tmp = mkdtempSync(join(tmpdir(), "nr-verify-"));
try {
  const stock = findStockSubagent();
  if (!stock) throw new Error("could not locate pi's examples/extensions/subagent");

  // Clean agent dir with the stock extension + this pattern's agents.
  const agentDir = makeAgentDir(creds, tmp);
  mkdirSync(join(agentDir, "extensions", "subagent"), { recursive: true });
  symlinkForce(join(stock, "index.ts"), join(agentDir, "extensions", "subagent", "index.ts"));
  symlinkForce(join(stock, "agents.ts"), join(agentDir, "extensions", "subagent", "agents.ts"));
  for (const n of ["neutral-question", "neutral-research", "neutral-research-worker"]) {
    symlinkForce(join(repo, "patterns", "neutral-research", ".pi", "agents", `${n}.md`), join(agentDir, "agents", `${n}.md`));
  }
  const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir };

  // A tiny target repo so research has something real to cite.
  const target = join(tmp, "target");
  mkdirSync(target, { recursive: true });
  copyFileSync(join(repo, "patterns", "resumable-subagents", "index.ts"), join(target, "index.ts"));
  const workDir = "docs/research/demo";

  const goal = "Add a run budget cap so a child stops after N turns";
  const task1 = `Use subagent with agentScope "both": agent neutral-question, task "${goal}. Work dir: ${workDir}". Reply with only the final text.`;
  const task2 = `Use subagent with agentScope "both": agent neutral-research, task "Work dir: ${workDir}". Reply with only the final text.`;

  await run("neutral-research", async () => {
    await runJson({ cwd: target, env, timeoutMs: timeout, args: [...modelArgs, task1] });
    const qPath = join(target, workDir, "questions.md");
    const qExists = existsSync(qPath);
    check("questions.md written", qExists);

    let clean = false;
    if (qExists) {
      const q = readFileSync(qPath, "utf8");
      clean = !/\bbudget\b|\bcap\b|\bturns?\b/i.test(q);
      if (verbose) console.log(`     questions.md:\n${q}`);
    }
    check("goal unrecoverable from questions", qExists && clean, clean ? "CLEAN" : "goal leaked");

    await runJson({ cwd: target, env, timeoutMs: timeout, args: [...modelArgs, task2] });
    const rPath = join(target, workDir, "research.md");
    const rExists = existsSync(rPath);
    let cited = false;
    if (rExists) {
      const r = readFileSync(rPath, "utf8");
      cited = /index\.ts:\d+/i.test(r);
      if (verbose) console.log(`     citations: ${r.match(/`[^`]*:\d+[^`]*`/g)?.slice(0, 4).join("  ") ?? "none"}`);
    }
    check("research.md written", rExists);
    check("research.md cites real code (index.ts:N)", cited);
  });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${checks.length - failures.length}/${checks.length} checks passed`);
process.exitCode = failures.length ? 1 : 0;
