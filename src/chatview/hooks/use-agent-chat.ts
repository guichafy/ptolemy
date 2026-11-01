import { useCallback, useEffect, useReducer, useRef } from "react";
import type { AgentKind, ApproveBehavior } from "@/shared/agent-protocol";
import { onAgentEvent, rpc } from "../rpc";
import {
	type AgentMessage,
	type AgentState,
	appendUserMessage,
	hasPendingTurn,
	hydrateMessages,
	initialAgentState,
	markTurnStart,
	reduceAgentState,
	resolvePermission,
	storedToAgentMessage,
} from "./agent-state";

type Action =
	| {
			type: "event";
			sessionId: string;
			event: import("@/shared/agent-protocol").AgentEvent;
	  }
	| { type: "optimistic-user"; id: string; text: string; modelUsed?: string }
	| { type: "resolve-permission"; permissionId: string }
	| { type: "hydrate"; messages: AgentMessage[] }
	| { type: "set-session-model"; model: string | null }
	| { type: "set-session-agent"; agent: AgentKind }
	| { type: "mark-turn-start" }
	| { type: "reset" };

function reducer(state: AgentState, action: Action): AgentState {
	switch (action.type) {
		case "event":
			return reduceAgentState(state, action.event);
		case "optimistic-user":
			// Mark the turn as in-flight so the TurnIndicator flips to
			// "waiting" immediately, without waiting for the first
			// session-state-change event from the backend.
			return markTurnStart(
				appendUserMessage(state, action.id, action.text, action.modelUsed),
			);
		case "resolve-permission":
			return resolvePermission(state, action.permissionId);
		case "hydrate": {
			const hydrated = hydrateMessages(state, action.messages);
			// For sessions opened via the palette (createSession flow), the
			// persisted transcript may already contain a user prompt with no
			// assistant reply — the backend is streaming but hasn't emitted a
			// session-state-change yet. Infer the in-flight state from disk.
			return hasPendingTurn(action.messages)
				? markTurnStart(hydrated)
				: hydrated;
		}
		case "set-session-model":
			return { ...state, sessionModel: action.model };
		case "set-session-agent":
			return { ...state, sessionAgent: action.agent };
		case "mark-turn-start":
			return markTurnStart(state);
		case "reset":
			return initialAgentState();
	}
}

export interface UseAgentChatResult {
	state: AgentState;
	sendMessage: (
		text: string,
		opts?: { modelOverride?: string },
	) => Promise<void>;
	approveTool: (
		permissionId: string,
		behavior: ApproveBehavior,
		modifiedArgs?: unknown,
	) => Promise<void>;
	rejectTool: (permissionId: string, reason?: string) => Promise<void>;
	cancel: () => Promise<void>;
	reset: () => void;
}

/**
 * Hook consuming the typed agentEvent stream and exposing command helpers.
 * Runs alongside the legacy `useChatSession` until phase 5 retires the
 * `claudeStreamChunk` channel; does not persist or load messages itself
 * (that still flows through `claudeGetSessionMessages` + StoredMessageV2).
 */
export function useAgentChat(sessionId: string | null): UseAgentChatResult {
	const [state, dispatch] = useReducer(reducer, undefined, initialAgentState);
	// Guards hydrate responses against out-of-order resolution. Incremented on
	// every hydrate request; the `.then()` drops stale reads. Without this,
	// a late reply to an earlier sessionId could overwrite a newly-hydrated
	// state (e.g. after a rapid session switch).
	const hydrateGenRef = useRef(0);

	const hydrate = useCallback(async (sid: string) => {
		const gen = ++hydrateGenRef.current;
		try {
			const [stored, sessions] = await Promise.all([
				rpc.request.claudeGetSessionMessages({ sessionId: sid }),
				rpc.request.claudeListSessions(),
			]);
			if (gen !== hydrateGenRef.current) return;
			const messages = stored.map((m, i) => storedToAgentMessage(m, i));
			dispatch({ type: "hydrate", messages });
			const meta = sessions.find((s) => s.id === sid);
			if (meta) {
				dispatch({ type: "set-session-model", model: meta.model });
				dispatch({ type: "set-session-agent", agent: meta.agent ?? "claude" });
			}
		} catch (err) {
			console.error("[agent-chat] hydrate failed:", err);
		}
	}, []);

	// Initial hydration when the session id becomes known. Also re-runs if the
	// user switches sessions within the same chat window.
	useEffect(() => {
		if (!sessionId) return;
		hydrate(sessionId);
	}, [sessionId, hydrate]);

	useEffect(() => {
		if (!sessionId) return;
		const unsubscribe = onAgentEvent((args) => {
			if (args.sessionId !== sessionId) return;
			dispatch({ type: "event", sessionId: args.sessionId, event: args.event });
			// After a turn finishes the backend has already appended the complete
			// assistant message to disk (see streaming.ts — persist BEFORE sendEnd).
			// Reload from disk so any deltas missed during the window-creation race
			// (or before `useAgentChat` subscribed) are recovered.
			if (args.event.type === "finish") {
				hydrate(sessionId);
			}
		});
		return unsubscribe;
	}, [sessionId, hydrate]);

	const sendMessage = useCallback(
		async (text: string, opts: { modelOverride?: string } = {}) => {
			if (!text.trim()) return;
			const id = `user-${Date.now()}`;
			dispatch({
				type: "optimistic-user",
				id,
				text,
				modelUsed: opts.modelOverride,
			});
			try {
				await rpc.request.claudeSendMessage({
					message: text,
					modelOverride: opts.modelOverride,
				});
			} catch (err) {
				console.error("[agent-chat] sendMessage RPC failed:", err);
			}
		},
		[],
	);

	const approveTool = useCallback<UseAgentChatResult["approveTool"]>(
		async (permissionId, behavior, modifiedArgs) => {
			try {
				await rpc.request.agentApproveTool({
					permissionId,
					behavior,
					modifiedArgs:
						behavior === "allow-modified" && modifiedArgs
							? (modifiedArgs as Record<string, unknown>)
							: undefined,
				});
			} catch (err) {
				console.error("[agent-chat] approveTool RPC failed:", err);
			} finally {
				dispatch({ type: "resolve-permission", permissionId });
			}
		},
		[],
	);

	const rejectTool = useCallback<UseAgentChatResult["rejectTool"]>(
		async (permissionId, reason) => {
			try {
				await rpc.request.agentRejectTool({ permissionId, reason });
			} catch (err) {
				console.error("[agent-chat] rejectTool RPC failed:", err);
			} finally {
				dispatch({ type: "resolve-permission", permissionId });
			}
		},
		[],
	);

	const cancel = useCallback(async () => {
		try {
			await rpc.request.claudeStopGeneration();
		} catch (err) {
			console.error("[agent-chat] cancel RPC failed:", err);
		}
	}, []);

	const reset = useCallback(() => dispatch({ type: "reset" }), []);

	return { state, sendMessage, approveTool, rejectTool, cancel, reset };
}
