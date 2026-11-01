/**
 * Minimal stand-in for the OpenAI Responses API, enough for the real Codex
 * CLI to run full turns offline. It speaks the streaming (SSE) flavour of
 * `POST /v1/responses` and refuses WebSocket upgrades.
 *
 * Behaviour per request, decided from the conversation the CLI sends:
 * - the last item is the user's message and it contains TOOL_MARKER: answer
 *   with an `exec` custom tool call (Codex's code-mode tool) that creates a
 *   file through `apply_patch` and reads it back with `exec_command`;
 * - otherwise (plain question, or right after a tool output): answer with an
 *   assistant message streamed as text deltas.
 */

export const TOOL_MARKER = "[usar-ferramentas]";
export const CODEX_FILE_NAME = "ola-codex.txt";
export const CODEX_FILE_TEXT = "Olá do Codex";

export interface MockResponsesServer {
	url: string;
	requests: Array<{ path: string; body: Record<string, unknown> }>;
	stop: () => void;
}

type InputItem = {
	type?: string;
	role?: string;
	content?: Array<{ type?: string; text?: string }> | string;
	output?: unknown;
};

function lastUserText(input: InputItem[]): string {
	for (let i = input.length - 1; i >= 0; i--) {
		const item = input[i];
		if (item.type === "message" && item.role === "user") {
			const parts = Array.isArray(item.content) ? item.content : [];
			return parts.map((p) => p.text ?? "").join("");
		}
	}
	return "";
}

function sse(events: Array<Record<string, unknown>>): string {
	return events
		.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
		.join("");
}

const USAGE = {
	input_tokens: 120,
	input_tokens_details: { cached_tokens: 20 },
	output_tokens: 30,
	output_tokens_details: { reasoning_tokens: 0 },
	total_tokens: 150,
};

function toolCallTurn(n: number): string {
	const script = [
		`await tools.apply_patch("*** Begin Patch\\n*** Add File: ${CODEX_FILE_NAME}\\n+${CODEX_FILE_TEXT}\\n*** End Patch\\n");`,
		`const r = await tools.exec_command({ cmd: "cat ${CODEX_FILE_NAME}", login: false });`,
		"text(r.output);",
	].join("\n");
	const item = {
		type: "custom_tool_call",
		id: `ctc_${n}`,
		call_id: `call_${n}`,
		name: "exec",
		input: script,
		status: "completed",
	};
	return sse([
		{ type: "response.created", response: { id: `resp_${n}` } },
		{
			type: "response.output_item.added",
			output_index: 0,
			item: { ...item, input: "" },
		},
		{ type: "response.output_item.done", output_index: 0, item },
		{
			type: "response.completed",
			response: { id: `resp_${n}`, usage: USAGE },
		},
	]);
}

function messageTurn(n: number, text: string): string {
	const id = `msg_${n}`;
	const chunks = text.match(/.{1,12}/gs) ?? [text];
	return sse([
		{ type: "response.created", response: { id: `resp_${n}` } },
		{
			type: "response.output_item.added",
			output_index: 0,
			item: { type: "message", id, role: "assistant", content: [] },
		},
		...chunks.map((delta) => ({
			type: "response.output_text.delta",
			item_id: id,
			output_index: 0,
			content_index: 0,
			delta,
		})),
		{
			type: "response.output_item.done",
			output_index: 0,
			item: {
				type: "message",
				id,
				role: "assistant",
				status: "completed",
				content: [{ type: "output_text", text, annotations: [] }],
			},
		},
		{
			type: "response.completed",
			response: { id: `resp_${n}`, usage: USAGE },
		},
	]);
}

export function startMockResponsesServer(): MockResponsesServer {
	const requests: MockResponsesServer["requests"] = [];
	let counter = 0;
	const server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		async fetch(req) {
			const url = new URL(req.url);
			if (req.headers.get("upgrade")) {
				return new Response("websocket not supported", { status: 426 });
			}
			if (req.method !== "POST" || !url.pathname.endsWith("/responses")) {
				return new Response("not found", { status: 404 });
			}
			const body = (await req.json()) as Record<string, unknown>;
			requests.push({ path: url.pathname, body });
			const input = (body.input ?? []) as InputItem[];
			const last = input[input.length - 1];
			const n = ++counter;
			let payload: string;
			if (last?.type === "custom_tool_call_output") {
				payload = messageTurn(n, `Pronto: criei ${CODEX_FILE_NAME}.`);
			} else if (lastUserText(input).includes(TOOL_MARKER)) {
				payload = toolCallTurn(n);
			} else {
				payload = messageTurn(n, "Continuo na mesma conversa.");
			}
			return new Response(payload, {
				headers: { "content-type": "text/event-stream" },
			});
		},
	});
	return {
		url: `http://127.0.0.1:${server.port}/v1`,
		requests,
		stop: () => server.stop(true),
	};
}

/** Codex `--config` overrides that point the CLI at the mock server. */
export function mockProviderConfig(baseUrl: string) {
	return {
		model_provider: "ptolemy_mock",
		model: "gpt-6.1-sol",
		model_providers: {
			ptolemy_mock: {
				name: "Ptolemy mock",
				base_url: baseUrl,
				env_key: "PTOLEMY_MOCK_API_KEY",
				wire_api: "responses",
				supports_websockets: false,
				request_max_retries: 0,
				stream_max_retries: 0,
			},
		},
	};
}
