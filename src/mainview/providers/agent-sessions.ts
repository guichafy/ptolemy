import { MessageSquare, Plus } from "lucide-react";
import { type ComponentType, createElement } from "react";
import type { AgentKind } from "@/shared/agent-protocol";
import { rpc, type SessionMeta } from "./rpc";
import type { IconComponent, SearchProvider, SearchResult } from "./types";

/**
 * Shared plumbing for the palette plugins backed by a coding agent (Claude
 * Code and Codex). Both share one session store in the backend; each plugin
 * lists only its own agent's sessions and creates new ones for its agent.
 */

/** Palette plugin id → agent. The plugin ids double as agent ids. */
export const AGENT_PROVIDER_IDS: readonly AgentKind[] = ["claude", "codex"];

export function agentForProviderId(id: string): AgentKind | null {
	return (AGENT_PROVIDER_IDS as readonly string[]).includes(id)
		? (id as AgentKind)
		: null;
}

export function sessionAgent(session: Pick<SessionMeta, "agent">): AgentKind {
	return session.agent ?? "claude";
}

export function sessionsForAgent(
	sessions: SessionMeta[],
	agent: AgentKind,
): SessionMeta[] {
	return sessions.filter((s) => sessionAgent(s) === agent);
}

function timeAgo(isoDate: string): string {
	const diff = Date.now() - new Date(isoDate).getTime();
	const minutes = Math.floor(diff / 60_000);
	if (minutes < 1) return "agora";
	if (minutes < 60) return `${minutes}min`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	return `${days}d`;
}

export function sessionToResult(session: SessionMeta): SearchResult {
	return {
		id: session.id,
		title: session.title,
		subtitle: `${session.projectId} • ${timeAgo(session.updatedAt)}`,
		icon: createElement(MessageSquare, { size: 16 }),
		onSelect: () => rpc.request.claudeOpenChat({ sessionId: session.id }),
	};
}

export interface AgentProviderOptions {
	agent: AgentKind;
	label: string;
	icon: IconComponent;
	placeholder: string;
	configComponent?: ComponentType;
}

export function createAgentSessionProvider(
	options: AgentProviderOptions,
): SearchProvider {
	const { agent } = options;
	return {
		id: agent,
		label: options.label,
		icon: options.icon,
		placeholder: options.placeholder,
		configComponent: options.configComponent,
		search: async (query, signal) => {
			// Empty query: recent sessions of this agent.
			if (!query.trim()) {
				try {
					const sessions = await rpc.request.claudeListSessions();
					if (signal?.aborted) return [];
					const own = sessionsForAgent(sessions, agent);
					console.log(
						`[${agent}] listSessions via RPC: count=${own.length}/${sessions.length}`,
					);
					return own.map(sessionToResult);
				} catch (err) {
					console.error(`[${agent}] claudeListSessions RPC failed:`, err);
					return [];
				}
			}

			// With a query: offer "create new session" immediately. Filtering
			// stored sessions by title would block every keystroke on an RPC.
			return [
				{
					id: `${agent}-new`,
					title: query,
					subtitle: "Iniciar nova sessão",
					icon: createElement(Plus, { size: 16 }),
					onSelect: async () => {
						try {
							console.log(
								`[${agent}] createSession from palette: prompt length=${query.length}`,
							);
							// The backend auto-opens the chat window (see src/bun/rpc.ts).
							// Claude omits `agent` to keep the original request shape.
							const { sessionId } = await rpc.request.claudeCreateSession(
								agent === "claude"
									? { prompt: query }
									: { prompt: query, agent },
							);
							console.log(
								`[${agent}] new session created from palette: sessionId=${sessionId}`,
							);
						} catch (err) {
							console.error(`[${agent}] Failed to create session:`, err);
						}
					},
				},
			];
		},
	};
}
