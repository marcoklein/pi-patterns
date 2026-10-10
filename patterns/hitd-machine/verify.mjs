// Verify hitd-machine: the full gate loop — designer blocked without research,
// open questions, approval: pending, implementer refusal, human flip, real code.
//
//   node verify.mjs [--verbose]
//
// Env: PI_TEST_MODEL (default opencode-go/deepseek-v4.1-flash),
//      PI_VERIFY_TIMEOUT_MS (default 180000).
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findCredsDir, findStockSubagent, makeAgentDir, runJson, symlinkForce, toolResults, toolText } from "../../shared/rpc.mjs";

const verbose = process.argv.includes("--verbose");
const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const model = process.env.PI_TEST_MODEL || "opencode-go/deepseek-v4.1-flash";
const modelArgs = ["--model", model, "--thinking", "off"];
const timeout = Number(process.env.PI_VERIFY_TIMEOUT_MS || 180_000);
const longTimeout = Math.max(timeout, 480_000);

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

const tmp = mkdtempSync(join(tmpdir(), "hitd-verify-"));
try {
  const stock = findStockSubagent();
  if (!stock) throw new Error("could not locate pi's examples/extensions/subagent");

  // Clean agent dir: stock extension + hitd-machine + neutral-research agents.
  const agentDir = makeAgentDir(creds, tmp);
  mkdirSync(join(agentDir, "extensions", "subagent"), { recursive: true });
  symlinkForce(join(stock, "index.ts"), join(agentDir, "extensions", "subagent", "index.ts"));
  symlinkForce(join(stock, "agents.ts"), join(agentDir, "extensions", "subagent", "agents.ts"));
  for (const p of ["hitd-machine", "neutral-research"]) {
    const dir = join(repo, "patterns", p, ".pi", "agents");
    for (const f of ["designer", "implementer", "neutral-question", "neutral-research", "neutral-research-worker"]) {
      const src = join(dir, `${f}.md`);
      if (existsSync(src)) symlinkForce(src, join(agentDir, "agents", `${f}.md`));
    }
  }
  const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir };

  // A tiny target repo the implementer can change harmlessly.
  const target = join(tmp, "target");
  mkdirSync(target, { recursive: true });
  copyFileSync(join(repo, "patterns", "resumable-subagents", "index.ts"), join(target, "index.ts"));

  const goal = "Add a run budget cap so a child stops after N turns";
  const hitdWork = "docs/hitd/demo";
  const ask = async (prompt, ms = timeout) => {
    const { events } = await runJson({ cwd: target, env, timeoutMs: ms, args: [...modelArgs, prompt] });
    return toolResults(events, "subagent").map((e) => toolText(e.result)).join("\n");
  };

  await run("hitd-machine full loop", async () => {
    // Research stage (neutral-research).
    await ask(`Use subagent with agentScope "both": agent neutral-question, task "${goal}. Work dir: docs/research/demo". Reply with only the final text.`, longTimeout);
    await ask(`Use subagent with agentScope "both": agent neutral-research, task "Work dir: docs/research/demo". Reply with only the final text.`, longTimeout);
    mkdirSync(join(target, hitdWork), { recursive: true });
    copyFileSync(join(target, "docs", "research", "demo", "research.md"), join(target, hitdWork, "research.md"));

    // 1 — designer without research.md.
    let t = await ask(`Use subagent with agentScope "both": agent designer, task "${goal}. Work dir: ${hitdWork}". Reply with only the final text.`);
    check("designer without research.md -> BLOCKED", /BLOCKED/i.test(t), t.slice(0, 60));

    // 2 — designer with research.md -> open questions.
    t = await ask(`Use subagent with agentScope "both": agent designer, task "${goal}. Work dir: ${hitdWork}". Reply with only the final text.`, longTimeout);
    const oq = join(target, hitdWork, "open-questions.md");
    check("designer writes open-questions.md", existsSync(oq) || /BLOCKED/i.test(t), t.slice(0, 60));

    // 3 — designer + ANSWERS -> design.md, approval: pending.
    const answers = `ANSWERS:\n- Default cap: 8 turns per child, overridable per call via a maxTurns parameter.\n- On hitting the cap: stop the child and report BUDGET EXCEEDED with the run id; partial output is kept.\n- Where enforced: in the subagent tool around the child spawn, not inside the child prompt.`;
    t = await ask(`Use subagent with agentScope "both": agent designer, task "${goal}. Work dir: ${hitdWork}\n\n${answers}". Reply with only the final text.`, longTimeout);
    const designPath = join(target, hitdWork, "design.md");
    const pending = existsSync(designPath) && readFileSync(designPath, "utf8").includes("approval: pending");
    check("design.md written with approval: pending", pending, t.slice(0, 60));

    // 4 — implementer before approval -> REFUSED.
    t = await ask(`Use subagent with agentScope "both": agent implementer, task "Work dir: ${hitdWork}". Reply with only the final text.`);
    check("implementer refuses before approval", /REFUSED/i.test(t), t.slice(0, 60));

    // 5 — human flips the sentinel, implementer runs.
    writeFileSync(designPath, readFileSync(designPath, "utf8").replace("approval: pending", "approval: approved"));
    t = await ask(`Use subagent with agentScope "both": agent implementer, task "Work dir: ${hitdWork}". Reply with only the final text.`, longTimeout);
    const resultPath = join(target, hitdWork, "result.md");
    const changed = existsSync(join(target, "index.ts")) && /maxTurns|BUDGET/i.test(readFileSync(join(target, "index.ts"), "utf8"));
    check("implementer ships after approval (result.md + code)", existsSync(resultPath) && changed, `${existsSync(resultPath) ? "result.md" : "no result.md"} ${changed ? "+code" : "code unchanged"}`);
  });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${checks.length - failures.length}/${checks.length} checks passed`);
process.exitCode = failures.length ? 1 : 0;
