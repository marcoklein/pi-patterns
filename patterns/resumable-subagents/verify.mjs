// Verify resumable-subagents: a fresh run gets a RUN id and writes haiku.md,
// and `resume <run-id>` continues the SAME child from memory.
//
//   node verify.mjs [--verbose]
//
// Env: PI_TEST_MODEL (default opencode-go/deepseek-v4.1-flash),
//      PI_VERIFY_TIMEOUT_MS (default 180000).
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findCredsDir, makeAgentDir, runJson, toolResults, toolText } from "../../verify/rpc.mjs";

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

const tmp = mkdtempSync(join(tmpdir(), "resume-verify-"));
try {
  const agentDir = makeAgentDir(creds, tmp);
  const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir };

  // The child writes .subagent-runs/ and haiku.md into cwd; run in a scratch
  // copy so this folder stays clean.
  const work = join(tmp, "work");
  mkdirSync(work, { recursive: true });
  copyFileSync(join(pattern, "index.ts"), join(work, "index.ts"));
  mkdirSync(join(work, "agents"), { recursive: true });
  copyFileSync(join(pattern, "agents", "poet.md"), join(work, "agents", "poet.md"));

  const fresh = await runJson({
    cwd: work,
    env,
    timeoutMs: timeout,
    args: ["-e", "./index.ts", ...modelArgs, "Use the subagent tool with agent poet and task 'write a haiku about the desert to haiku.md'. Reply with only the final text."],
  });
  const runIds = toolResults(fresh.events, "subagent").map((e) => toolText(e.result).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)).filter(Boolean).map((m) => m[0]);
  const runId = runIds[0];
  const haikuPath = join(work, "haiku.md");
  const haikuExists = existsSync(haikuPath);
  check("fresh run returns a RUN id", !!runId, runId ?? "none");
  check("fresh run writes haiku.md", haikuExists);

  if (runId && haikuExists) {
    const before = readFileSync(haikuPath, "utf8");
    const resumed = await runJson({
      cwd: work,
      env,
      timeoutMs: timeout,
      args: ["-e", "./index.ts", ...modelArgs, `Use the subagent tool with resume '${runId}' and task 'revision: make the second line about a solitary cactus'. Reply with only the final text.`],
    });
    const resText = toolResults(resumed.events, "subagent").map((e) => toolText(e.result)).join("\n");
    const after = readFileSync(haikuPath, "utf8");
    const lines = after.split("\n").filter((l) => l.trim()).length;
    check("resume continues the same child (REVISED)", /REVISED|DRAFT/i.test(resText), resText.slice(0, 80));
    check("haiku.md has 3 lines after resume", lines === 3, `${lines} lines`);
    if (verbose) {
      console.log(`     before: ${before.replace(/\n/g, " | ")}`);
      console.log(`     after:  ${after.replace(/\n/g, " | ")}`);
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${checks.length - failures.length}/${checks.length} checks passed`);
process.exitCode = failures.length ? 1 : 0;
