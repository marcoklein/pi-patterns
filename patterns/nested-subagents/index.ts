import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = join(__dirname, "agents");

interface Agent {
	name: string;
	tools: string[];
	prompt: string;
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
	return { name, tools, prompt: m[2].trim() };
}

function discoverAgents(): Agent[] {
	if (!existsSync(AGENTS_DIR)) return [];
	return readdirSync(AGENTS_DIR)
		.filter((f) => f.endsWith(".md"))
		.map((f) => parseAgent(join(AGENTS_DIR, f)))
		.filter((a): a is Agent => a !== null);
}

function runChildPi(args: string[], cwd: string): Promise<string> {
	return new Promise((resolve) => {
		const proc = spawn("pi", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
		let buf = "";
		let last = "";
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
						for (const part of ev.message.content ?? []) {
							if (part.type === "text") last = part.text;
						}
					}
				} catch {
					/* ignore non-JSON lines */
				}
			}
		});
		proc.on("close", () => resolve(last || "(no output)"));
		proc.on("error", () => resolve("(failed to spawn subagent)"));
	});
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description:
			"Delegate a task to a named subagent, which runs in a separate pi process with an isolated context window.",
		parameters: Type.Object({
			agent: Type.String({ description: "Name of the agent to invoke" }),
			task: Type.String({ description: "Task to delegate to the agent" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const agents = discoverAgents();
			const agent = agents.find((a) => a.name === params.agent);
			if (!agent) {
				const names = agents.map((a) => a.name).join(", ") || "none";
				return {
					content: [{ type: "text", text: `Unknown agent "${params.agent}". Available: ${names}.` }],
					details: undefined,
				};
			}

			const dir = mkdtempSync(join(tmpdir(), "nested-subagents-"));
			const promptFile = join(dir, "prompt.md");
			writeFileSync(promptFile, agent.prompt);

			const args = ["--mode", "json", "-p", "--no-session"];
			if (agent.tools.length > 0) args.push("--tools", agent.tools.join(","));
			args.push("--append-system-prompt", promptFile, `Task: ${params.task}`);

			const output = await runChildPi(args, ctx.cwd);
			rmSync(dir, { recursive: true, force: true });

			return { content: [{ type: "text", text: output }], details: undefined };
		},
	});
}
