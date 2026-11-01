/**
 * Append-only audit log of tool-permission decisions per session. Each
 * decision produced by the `PermissionGate` is persisted here so the user
 * can later review what was allowed, rejected, or auto-decided.
 *
 * File layout mirrors the rest of chatview persistence:
 *   ~/.ptolomeu/sessions/<sessionId>/tool-decisions.json
 * holding a JSON array of `StoredToolDecision` entries sorted by time.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	DecisionRecord,
	DecisionSource,
} from "@/bun/claude/permission-gate";
import type { RiskLevel } from "@/bun/claude/risk-classifier";
import { backupCorruptJson, writeJsonAtomic } from "../../atomic-json";
import { ptolemyDataDir } from "../../paths";

export interface StoredToolDecision {
	version: 1;
	sessionId: string;
	permissionId: string;
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	decision: { behavior: "allow" | "deny"; message?: string };
	source: DecisionSource;
	risk: { level: RiskLevel; reason?: string };
	decidedAt: string;
}

export interface ToolDecisionStoreOptions {
	/** Override the sessions root (tests). Defaults to `~/.ptolomeu/sessions`. */
	sessionsRoot?: string;
}

export class ToolDecisionStore {
	private readonly sessionsRoot: string;
	// Serialize writes per session so concurrent decisions don't truncate each
	// other. The gate's onDecision fires synchronously but the persist call is
	// async — without this queue, two near-simultaneous decisions would read
	// the same file snapshot and clobber one entry.
	private readonly queues = new Map<string, Promise<void>>();

	constructor(options: ToolDecisionStoreOptions = {}) {
		this.sessionsRoot =
			options.sessionsRoot ?? join(ptolemyDataDir(), "sessions");
	}

	path(sessionId: string): string {
		return join(this.sessionsRoot, sessionId, "tool-decisions.json");
	}

	async append(sessionId: string, record: DecisionRecord): Promise<void> {
		const stored: StoredToolDecision = {
			version: 1,
			sessionId,
			permissionId: record.permissionId,
			toolCallId: record.toolCallId,
			toolName: record.toolName,
			args: record.args,
			decision:
				record.decision.behavior === "allow"
					? { behavior: "allow" }
					: { behavior: "deny", message: record.decision.message },
			source: record.source,
			risk: { level: record.risk.level, reason: record.risk.reason },
			decidedAt: new Date(record.decidedAt).toISOString(),
		};
		const next = (this.queues.get(sessionId) ?? Promise.resolve()).then(() =>
			this.write(sessionId, stored),
		);
		this.queues.set(
			sessionId,
			next.catch(() => {}),
		);
		return next;
	}

	async read(sessionId: string): Promise<StoredToolDecision[]> {
		// Wait for any pending write to drain so reads see the latest append.
		await (this.queues.get(sessionId) ?? Promise.resolve());
		return this.readRaw(sessionId);
	}

	private async write(
		sessionId: string,
		record: StoredToolDecision,
	): Promise<void> {
		const dir = join(this.sessionsRoot, sessionId);
		await mkdir(dir, { recursive: true });
		const existing = await this.readRaw(sessionId);
		existing.push(record);
		await writeJsonAtomic(this.path(sessionId), existing);
	}

	private async readRaw(sessionId: string): Promise<StoredToolDecision[]> {
		const path = this.path(sessionId);
		if (!existsSync(path)) return [];
		try {
			const parsed = JSON.parse(await readFile(path, "utf8"));
			if (!Array.isArray(parsed)) return [];
			return parsed as StoredToolDecision[];
		} catch {
			await backupCorruptJson(path);
			return [];
		}
	}
}
