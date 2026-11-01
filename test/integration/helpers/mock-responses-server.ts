/**
 * Minimal stand-in for the OpenAI Responses API, enough for the real Codex
 * CLI to run full turns offline. It speaks the streaming (SSE) flavour of
 * `POST /v1/responses` and refuses WebSocket upgrades.
 *
 * It plays `scenario.ts`. Codex runs tools in "code mode": one `exec` custom
 * tool call whose JavaScript calls `tools.apply_patch` (creates the file)
 * and `tools.exec_command` (runs `cat`); after its output, it answers.
 * Memory questions are answered from the history the CLI sends back.
 */

import { chunk, nextMockStep, type ScenarioFile, sse } from "./scenario";

export interface MockResponsesServer {
	url: string;
	requests: Array<{ path: string; body: Record<string, unknown> }>;
	stop: () => void;
}

type InputItem = {
	type?: string;
	role?: string;
	content?: Array<{ type?: string; text?: string }> | string;
};

function textOf(item: InputItem): string {
	const parts = Array.isArray(item.content) ? item.content : [];
	return parts.map((p) => p.text ?? "").join("");
}

const USAGE = {
	input_tokens: 120,
	input_tokens_details: { cached_tokens: 20 },
	output_tokens: 30,
	output_tokens_details: { reasoning_tokens: 0 },
	total_tokens: 150,
};

function completed(n: number) {
	return {
		type: "response.completed",
		response: { id: `resp_${n}`, usage: USAGE },
	};
}

function execTurn(n: number, file: ScenarioFile): string {
	const patch = `*** Begin Patch\n*** Add File: ${file.name}\n+${file.text}\n*** End Patch\n`;
	const script = [
		`await tools.apply_patch(${JSON.stringify(patch)});`,
		`const r = await tools.exec_command({ cmd: ${JSON.stringify(`cat ${file.name}`)}, login: false });`,
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
		completed(n),
	]);
}

function messageTurn(n: number, text: string): string {
	const id = `msg_${n}`;
	return sse([
		{ type: "response.created", response: { id: `resp_${n}` } },
		{
			type: "response.output_item.added",
			output_index: 0,
			item: { type: "message", id, role: "assistant", content: [] },
		},
		...chunk(text).map((delta) => ({
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
		completed(n),
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
			const n = ++counter;

			let toolResultsThisTurn = 0;
			let lastUserText = "";
			for (let i = input.length - 1; i >= 0; i--) {
				const item = input[i];
				if (item.type === "custom_tool_call_output") toolResultsThisTurn++;
				if (item.type === "message" && item.role === "user") {
					lastUserText = textOf(item);
					break;
				}
			}
			// One `exec` call does both the write and the `cat`.
			const step = nextMockStep({
				lastUserText,
				history: JSON.stringify(input),
				toolResultsThisTurn: toolResultsThisTurn > 0 ? 2 : 0,
			});
			const payload =
				step.kind === "write-file"
					? execTurn(n, step.file)
					: messageTurn(n, step.kind === "reply" ? step.text : "Ok.");
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

/** `~/.codex/config.toml` contents that point the CLI at the mock server. */
export function mockCodexConfigToml(baseUrl: string): string {
	return [
		'model_provider = "ptolemy_mock"',
		'model = "gpt-6.1-sol"',
		"",
		"[model_providers.ptolemy_mock]",
		'name = "Ptolemy mock"',
		`base_url = "${baseUrl}"`,
		'env_key = "PTOLEMY_MOCK_API_KEY"',
		'wire_api = "responses"',
		"supports_websockets = false",
		"request_max_retries = 0",
		"stream_max_retries = 0",
		"",
	].join("\n");
}
