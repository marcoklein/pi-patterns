// RPC harness: drive `pi --mode rpc`, answer extension UI dialogs, assert.
//
// Why RPC and not the in-process SDK: the SDK session has no way to answer
// `ctx.ui` dialogs (no UI responder in createAgentSession options), and the
// exported RpcClient does not expose the extension_ui_request/response
// subprotocol either. The raw RPC wire protocol does, and it exercises the
// real CLI + extensions + child spawning that the patterns rely on.
//
// Usage: see verify/interactive.mjs (the actual tests). No dependencies.
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { copyFileSync, existsSync, mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// RpcDriver
// ---------------------------------------------------------------------------

export class RpcDriver {
  constructor({ cliPath = process.env.PI_BIN || "pi", cwd, env, args = [] } = {}) {
    this.cliPath = cliPath;
    this.cwd = cwd;
    this.env = env ?? process.env;
    this.args = args;
    this.proc = null;
    this.buffer = "";
    this.decoder = new StringDecoder("utf8");
    this.handlers = new Map();
    this.stderr = "";
    this.requestId = 0;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    const list = this.handlers.get(type);
    list.push(fn);
    return () => {
      const i = list.indexOf(fn);
      if (i !== -1) list.splice(i, 1);
    };
  }

  start() {
    this.proc = spawn(this.cliPath, ["--mode", "rpc", "--no-session", ...this.args], {
      cwd: this.cwd,
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.stderr.on("data", (d) => (this.stderr += d.toString()));
    this.proc.stdout.on("data", (chunk) => {
      this.buffer += this.decoder.write(chunk);
      let i;
      while ((i = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, i).replace(/\r$/, "");
        this.buffer = this.buffer.slice(i + 1);
        this.handleLine(line);
      }
    });
    return this;
  }

  handleLine(line) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      return;
    }
    for (const fn of this.handlers.get(obj.type) ?? []) fn(obj);
  }

  send(obj) {
    this.proc.stdin.write(JSON.stringify(obj) + "\n");
  }

  /** Send a prompt, answer UI dialogs via onUiRequest, resolve on agent_settled. */
  promptAndSettle(message, { onUiRequest, timeoutMs = 180_000 } = {}) {
    return new Promise((resolve, reject) => {
      const events = [];
      const offs = [];
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`timeout waiting for agent_settled (${timeoutMs}ms)`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        offs.forEach((o) => o());
      };

      offs.push(
        this.on("extension_ui_request", (req) => {
          events.push(req);
          if (onUiRequest) {
            Promise.resolve(onUiRequest(req)).then((resp) => {
              if (resp) this.send({ type: "extension_ui_response", id: req.id, ...resp });
            });
          }
        }),
      );
      for (const t of ["message_end", "tool_execution_start", "tool_execution_end", "agent_settled", "agent_end"]) {
        offs.push(this.on(t, (e) => events.push(e)));
      }
      offs.push(
        this.on("agent_settled", () => {
          cleanup();
          resolve(events);
        }),
      );
      this.proc.once("exit", (code) => {
        cleanup();
        reject(new Error(`pi exited early (code ${code})\nstderr: ${this.stderr.slice(-2000)}`));
      });

      const id = `req-${++this.requestId}`;
      this.send({ type: "prompt", id, message });
    });
  }

  async stop() {
    if (this.proc && this.proc.exitCode === null) {
      this.proc.kill("SIGTERM");
      await new Promise((r) => {
        const t = setTimeout(r, 2000);
        this.proc.once("exit", () => {
          clearTimeout(t);
          r();
        });
      });
      if (this.proc.exitCode === null) this.proc.kill("SIGKILL");
    }
  }
}

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------

export function assistantText(events) {
  let out = "";
  for (const e of events) {
    if (e.type === "message_end" && e.message?.role === "assistant") {
      for (const c of e.message.content ?? []) {
        if (c.type === "text" && c.text?.trim()) out = c.text.trim();
      }
    }
  }
  return out;
}

export function toolResults(events, name) {
  const out = [];
  for (const e of events) {
    if (e.type === "tool_execution_end" && (!name || e.toolName === name)) out.push(e);
  }
  return out;
}

export function toolText(result) {
  const parts = [];
  for (const c of result?.content ?? []) {
    if (typeof c === "string") parts.push(c);
    else if (c?.type === "text") parts.push(c.text);
  }
  return parts.join(" ").trim();
}

export function uiRequests(events, method) {
  return events.filter((e) => e.type === "extension_ui_request" && (!method || e.method === method));
}

// ---------------------------------------------------------------------------
// Environment setup
// ---------------------------------------------------------------------------

export function findCredsDir() {
  const candidates = [
    process.env.PI_CODING_AGENT_DIR,
    join(homedir(), ".config", ".pi", "agent"),
    join(homedir(), ".pi", "agent"),
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(join(c, "auth.json"))) return c;
  }
  return null;
}

export function makeAgentDir(src, tmpRoot) {
  const dir = join(tmpRoot, "agent");
  mkdirSync(join(dir, "extensions"), { recursive: true });
  mkdirSync(join(dir, "agents"), { recursive: true });
  for (const f of ["auth.json", "settings.json", "trust.json", "models-store.json", "mcp.json"]) {
    const p = join(src, f);
    if (existsSync(p)) copyFileSync(p, join(dir, f));
  }
  return dir;
}

/** Locate pi's bundled subagent example by walking up from the pi binary. */
export function findStockSubagent() {
  if (process.env.PI_STOCK_SUBAGENT_DIR && existsSync(join(process.env.PI_STOCK_SUBAGENT_DIR, "index.ts"))) {
    return process.env.PI_STOCK_SUBAGENT_DIR;
  }
  let root;
  try {
    root = realpathSync(whichBin(process.env.PI_BIN || "pi"));
  } catch {
    return null;
  }
  for (;;) {
    const candidate = join(root, "examples", "extensions", "subagent");
    if (existsSync(join(candidate, "index.ts")) && existsSync(join(candidate, "agents.ts"))) return candidate;
    const parent = dirname(root);
    if (parent === root) return null;
    root = parent;
  }
}

function whichBin(name) {
  try {
    return execFileSync("sh", ["-c", `command -v "${name}"`], { encoding: "utf8" }).trim().split("\n")[0];
  } catch {
    return name;
  }
}

export function symlinkForce(target, link) {
  try {
    symlinkSync(target, link);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
}
