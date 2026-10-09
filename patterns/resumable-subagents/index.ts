/**
 * resumable-subagents — stock-style subagent tool + one extra idea: `resume`.
 *
 * Each run gets a UUID and a real pi session file in ./.subagent-runs/.
 * A fresh call spawns:  pi --mode json -p --session-dir ... --session-id <run>
 * A resume call respawns the SAME session id, so the child continues with its
 * full conversational context — no artifact relay needed for revisions.
 * That's ~90% of what pi-subagents' runs machinery provides, in ~150 LOC.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const AGENTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "agents");

interface Agent {
	name: string;
	tools: string[];
	model?: string;
	prompt: string;
}

interface RunRecord {
	agent: string;
}

function parseAgent(file: string): Agent | null {
	const text = readFileSync(file, "utf8");
	const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
	if (!m) return null;
	const name = m[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
	if (!name) return null;
	const tools = (m[1].match(/^tools:\s*(.+)$/m)?.[1] ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const model = m[1].match(/^model:\s*(.+)$/m)?.[1]?.trim();
	return { name, tools, model, prompt: m[2].trim() };
}

function discoverAgents(): Agent[] {
	if (!existsSync(AGENTS_DIR)) return [];
	return readdirSync(AGENTS_DIR)
		.filter((f) => f.endsWith(".md"))
		.map((f) => parseAgent(join(AGENTS_DIR, f)))
		.filter((a): a is Agent => a !== null);
}

/** Spawn a child pi session and resolve with the last assistant text. */
function runChildPi(args: string[], cwd: string): Promise<{ text: string; exitCode: number; stderr: string }> {
	return new Promise((resolve) => {
		const proc = spawn("pi", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
		let buf = "";
		let last = "";
		let stderr = "";
		proc.stderr.on("data", (d) => (stderr += d.toString()));
		proc.stdout.on("data", (d) => {
			buf += d.toString();
			let i;
			while ((i = buf.indexOf("\n")) >= 0) {
				const line = buf.slice(0, i).trim();
				buf = buf.slice(i + 1);
				if (!line) continue;
				try {
					const ev = JSON.parse(line);
					if (ev.type === "message_end" && ev.message?.role === "assistant") {
						last = (ev.message.content ?? [])
							.filter((p: any) => p.type === "text")
							.map((p: any) => p.text)
							.join("");
					}
				} catch {
					/* ignore non-JSON lines */
				}
			}
		});
		proc.on("close", (code) => resolve({ text: last, exitCode: code ?? -1, stderr }));
		proc.on("error", () => resolve({ text: "(failed to spawn pi)", exitCode: -1, stderr: "" }));
	});
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "subagent",
		label: "Resumable Subagent",
		description:
			"Delegate a task to a named agent in an isolated pi session. Returns a RUN id. " +
			"Pass { resume: RUN, task: '...' } to continue the SAME child with its full memory.",
		parameters: Type.Object({
			agent: Type.Optional(Type.String({ description: "Agent name (required for new runs)" })),
			task: Type.String({ description: "Task, or continuation instruction when resuming" }),
			resume: Type.Optional(Type.String({ description: "RUN id of an existing child session" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const runDir = join(ctx.cwd, ".subagent-runs");
			mkdirSync(runDir, { recursive: true });

			let sessionId: string;
			let agent: Agent;

			if (params.resume) {
				sessionId = params.resume;
				const recordPath = join(runDir, `${sessionId}.json`);
				if (!existsSync(recordPath)) {
					return { content: [{ type: "text", text: `REFUSED: unknown RUN ${sessionId}` }], details: undefined };
				}
				const record = JSON.parse(readFileSync(recordPath, "utf8")) as RunRecord;
				const found = discoverAgents().find((a) => a.name === record.agent);
				if (!found) {
					return { content: [{ type: "text", text: `REFUSED: agent "${record.agent}" no longer exists` }], details: undefined };
				}
				agent = found;
			} else {
				if (!params.agent) {
					return { content: [{ type: "text", text: "Error: provide { agent, task } or { resume, task }." }], details: undefined };
				}
				const found = discoverAgents().find((a) => a.name === params.agent);
				if (!found) {
					const names = discoverAgents().map((a) => a.name).join(", ") || "none";
					return { content: [{ type: "text", text: `Unknown agent "${params.agent}". Available: ${names}.` }], details: undefined };
				}
				agent = found;
				sessionId = randomUUID();
				writeFileSync(join(runDir, `${sessionId}.json`), JSON.stringify({ agent: agent.name }));
			}

			const promptFile = join(runDir, `${sessionId}.prompt.md`);
			writeFileSync(promptFile, agent.prompt);

			const args = ["--mode", "json", "-p", "--session-dir", runDir, "--session-id", sessionId];
			if (agent.tools.length > 0) args.push("--tools", agent.tools.join(","));
			if (agent.model) args.push("--model", agent.model);
			args.push("--append-system-prompt", promptFile, `Task: ${params.task}`);

			const result = await runChildPi(args, ctx.cwd);
			if (result.exitCode !== 0 && !result.text) {
				return { content: [{ type: "text", text: `RUN ${sessionId} failed (exit ${result.exitCode}): ${result.stderr.slice(0, 500)}` }], details: undefined };
			}

			return {
				content: [{ type: "text", text: `RUN ${sessionId}\n\n${result.text || "(no output)"}` }],
				details: undefined,
			};
		},
	});
}
