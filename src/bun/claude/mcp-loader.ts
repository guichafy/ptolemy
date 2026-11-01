/**
 * Runtime MCP server registry for the Claude Agent SDK session. The app
 * reads user-declared stdio servers from ~/.ptolomeu/mcp-servers.json and
 * injects them via the SDK's `mcpServers` option.
 *
 * This file is separate from the dev-time `.mcp.json` in the repo root —
 * that one is consumed by Claude Code when working in this codebase, not
 * by the Ptolemy app at runtime.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpStdioServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { backupCorruptJson, writeJsonAtomic } from "../atomic-json";
import { ptolemyDataDir } from "../paths";

export interface StoredMcpServer {
	name: string;
	command: string;
	args?: string[];
	env?: Record<string, string>;
	enabled?: boolean;
}

export interface McpServersFile {
	version: 1;
	servers: StoredMcpServer[];
}

export interface McpLoaderOptions {
	/** Override the JSON path (tests). Defaults to ~/.ptolomeu/mcp-servers.json. */
	path?: string;
}

const CONFIG_DIR = ptolemyDataDir();
const DEFAULT_PATH = join(CONFIG_DIR, "mcp-servers.json");

function defaultFile(): McpServersFile {
	return { version: 1, servers: [] };
}

function isValidServer(value: unknown): value is StoredMcpServer {
	if (!value || typeof value !== "object") return false;
	const s = value as Record<string, unknown>;
	if (typeof s.name !== "string" || !s.name.trim()) return false;
	if (typeof s.command !== "string" || !s.command.trim()) return false;
	if (s.args !== undefined) {
		if (!Array.isArray(s.args)) return false;
		if (!s.args.every((arg) => typeof arg === "string")) return false;
	}
	if (s.env !== undefined) {
		if (!s.env || typeof s.env !== "object" || Array.isArray(s.env))
			return false;
		if (
			!Object.values(s.env as Record<string, unknown>).every(
				(v) => typeof v === "string",
			)
		)
			return false;
	}
	if (s.enabled !== undefined && typeof s.enabled !== "boolean") return false;
	return true;
}

function validate(raw: unknown): McpServersFile {
	if (!raw || typeof raw !== "object") return defaultFile();
	const f = raw as Record<string, unknown>;
	if (f.version !== 1 || !Array.isArray(f.servers)) return defaultFile();
	const seen = new Set<string>();
	const servers: StoredMcpServer[] = [];
	for (const entry of f.servers) {
		if (!isValidServer(entry)) continue;
		if (seen.has(entry.name)) continue;
		seen.add(entry.name);
		servers.push(entry);
	}
	return { version: 1, servers };
}

export class McpLoader {
	private readonly path: string;

	constructor(options: McpLoaderOptions = {}) {
		this.path = options.path ?? DEFAULT_PATH;
	}

	getPath(): string {
		return this.path;
	}

	async load(): Promise<McpServersFile> {
		if (!existsSync(this.path)) return defaultFile();
		try {
			return validate(JSON.parse(await readFile(this.path, "utf8")));
		} catch {
			await backupCorruptJson(this.path);
			return defaultFile();
		}
	}

	async save(file: McpServersFile): Promise<void> {
		const clean = validate(file);
		await writeJsonAtomic(this.path, clean);
	}

	/**
	 * Resolve the loaded file into the SDK's mcpServers option shape,
	 * dropping disabled entries. Returned value can be handed directly to
	 * `unstable_v2_createSession({ mcpServers })`.
	 */
	async resolve(): Promise<Record<string, McpStdioServerConfig>> {
		const file = await this.load();
		const result: Record<string, McpStdioServerConfig> = {};
		for (const s of file.servers) {
			if (s.enabled === false) continue;
			result[s.name] = {
				type: "stdio",
				command: s.command,
				...(s.args && s.args.length > 0 ? { args: s.args } : {}),
				...(s.env && Object.keys(s.env).length > 0 ? { env: s.env } : {}),
			};
		}
		return result;
	}
}

export const mcpLoader = new McpLoader();

export type {
	McpServerDefinition,
	McpServerSummary,
	McpSnapshot,
} from "../../shared/mcp";
// Transitional v1 API above is retired by the shared-registry runtime/UI tasks.
// Never expose registry.get()/resolve() over RPC.
export { McpRegistry, mcpRegistry } from "../mcp/registry";
