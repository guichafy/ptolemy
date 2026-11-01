/**
 * Stand-in for `src/chatview/rpc.ts` in the chat screenshot E2E. Same
 * exports, but the transport is a WebSocket to the test's bridge server,
 * which runs the real Bun request handlers (`src/bun/rpc.ts`) and forwards
 * every webview message (`agentEvent`, `claudeOpenSession`) back here.
 * Swapped in by `vite.config.ts`; never shipped.
 */

import { AgentEventBuffer } from "@/chatview/lib/agent-event-buffer";
import type { rpc as RealRpc } from "@/chatview/rpc";
import type { AgentEvent } from "@/shared/agent-protocol";

export type {
	SessionMeta,
	StoredBlock,
	StoredMessage,
} from "@/chatview/rpc";

type ServerFrame =
	| { kind: "response"; id: number; result?: unknown; error?: string }
	| { kind: "message"; name: string; payload: unknown };

// The page URL carries `?session=<id>`; the bridge uses it to send
// `claudeOpenSession`, like the main process does for a new chat window.
const socket = new WebSocket(
	`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/rpc${location.search}`,
);
const ready = new Promise<void>((resolve) =>
	socket.addEventListener("open", () => resolve(), { once: true }),
);

let nextId = 1;
const pending = new Map<
	number,
	{ resolve: (v: unknown) => void; reject: (e: Error) => void }
>();

const agentEventBuffer = new AgentEventBuffer();
let openSessionHandler: ((args: { sessionId: string }) => void) | null = null;
let pendingOpenSession: { sessionId: string } | null = null;

socket.addEventListener("message", (msg) => {
	const frame = JSON.parse(String(msg.data)) as ServerFrame;
	if (frame.kind === "response") {
		const waiter = pending.get(frame.id);
		pending.delete(frame.id);
		if (!waiter) return;
		if (frame.error) waiter.reject(new Error(frame.error));
		else waiter.resolve(frame.result);
		return;
	}
	if (frame.name === "agentEvent") {
		agentEventBuffer.push(
			frame.payload as { sessionId: string; event: AgentEvent },
		);
	} else if (frame.name === "claudeOpenSession") {
		const args = frame.payload as { sessionId: string };
		if (openSessionHandler) openSessionHandler(args);
		else pendingOpenSession = args;
	}
});

async function call(method: string, params: unknown): Promise<unknown> {
	await ready;
	const id = nextId++;
	return new Promise((resolve, reject) => {
		pending.set(id, { resolve, reject });
		socket.send(JSON.stringify({ id, method, params }));
	});
}

export const rpc = {
	request: new Proxy(
		{},
		{
			get: (_target, method: string) => (params?: unknown) =>
				call(method, params),
		},
	),
} as unknown as typeof RealRpc;

export function onAgentEvent(
	listener: (args: { sessionId: string; event: AgentEvent }) => void,
): () => void {
	return agentEventBuffer.subscribe(listener);
}

export function onOpenSession(handler: (args: { sessionId: string }) => void) {
	openSessionHandler = handler;
	if (pendingOpenSession) {
		const args = pendingOpenSession;
		pendingOpenSession = null;
		handler(args);
	}
}
