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

import {
	chunk,
	createPromptCache,
	estimateTokens,
	nextMockStep,
	type ScenarioFile,
	sse,
} from "./scenario";

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

const OUTPUT_TOKENS = 30;

interface ResponseUsage {
	input_tokens: number;
	input_tokens_details: { cached_tokens: number };
	output_tokens: number;
	output_tokens_details: { reasoning_tokens: number };
	total_tokens: number;
}

/** OpenAI convention: `input_tokens` includes the cached part. */
function responseUsage(cached: number, fresh: number): ResponseUsage {
	const input = cached + fresh;
	return {
		input_tokens: input,
		input_tokens_details: { cached_tokens: cached },
		output_tokens: OUTPUT_TOKENS,
		output_tokens_details: { reasoning_tokens: 0 },
		total_tokens: input + OUTPUT_TOKENS,
	};
}

function completed(n: number, usage: ResponseUsage) {
	return {
		type: "response.completed",
		response: { id: `resp_${n}`, usage },
	};
}

function execTurn(n: number, file: ScenarioFile, usage: ResponseUsage): string {
	const patch = `*** Begin Patch\n*** Add File: ${file.name}\n+${file.text}\n*** End Patch\n`;
	const script = [
		`await tools.apply_patch(${JSON.stringify(patch)});`,
		`const r = await tools.exec_command({ cmd: ${JSON.stringify(`cat ${file.name}`)}, login: false });`,
		"text(r.output);",
	].join("\n");
	return scriptTurn(n, script, usage);
}
function scriptTurn(n: number, script: string, usage: ResponseUsage): string {
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
		completed(n, usage),
	]);
}

function messageTurn(n: number, text: string, usage: ResponseUsage): string {
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
		completed(n, usage),
	]);
}

type ProbeFunction = {
	name: string;
	namespace: string;
	arguments: Record<string, unknown>;
};
function functionTurn(
	n: number,
	probe: ProbeFunction,
	usage: ResponseUsage,
): string {
	const item = {
		type: "function_call",
		id: `fc_${n}`,
		call_id: `call_${n}`,
		name: probe.name,
		namespace: probe.namespace,
		arguments: JSON.stringify(probe.arguments),
		status: "completed",
	};
	return sse([
		{ type: "response.created", response: { id: `resp_${n}` } },
		{
			type: "response.output_item.added",
			output_index: 0,
			item: { ...item, arguments: "" },
		},
		{ type: "response.output_item.done", output_index: 0, item },
		completed(n, usage),
	]);
}

export function startMockResponsesServer(
	probeScript?: string | ProbeFunction,
	options?: {
		beforeRequest?: (body: Record<string, unknown>) => Promise<void>;
		respond?: (
			body: Record<string, unknown>,
		) => ProbeFunction | { text: string };
	},
): MockResponsesServer {
	const requests: MockResponsesServer["requests"] = [];
	const promptCache = createPromptCache();
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
			await options?.beforeRequest?.(body);
			requests.push({ path: url.pathname, body });
			const input = (body.input ?? []) as InputItem[];
			const n = ++counter;

			let toolResultsThisTurn = 0;
			let lastUserText = "";
			for (let i = input.length - 1; i >= 0; i--) {
				const item = input[i];
				if (
					item.type === "custom_tool_call_output" ||
					item.type === "function_call_output"
				)
					toolResultsThisTurn++;
				if (item.type === "message" && item.role === "user") {
					lastUserText = textOf(item);
					break;
				}
			}
			const firstUser = input.find(
				(i) => i.type === "message" && i.role === "user",
			);
			const { cached, fresh } = promptCache(
				JSON.stringify(firstUser ?? "").slice(0, 400),
				estimateTokens({
					instructions: body.instructions,
					tools: body.tools,
					input,
				}),
			);
			const usage = responseUsage(cached, fresh);

			if (options?.respond) {
				const response = options.respond(body);
				return new Response(
					"text" in response
						? messageTurn(n, response.text, usage)
						: functionTurn(n, response, usage),
					{ headers: { "content-type": "text/event-stream" } },
				);
			}

			const mcpMatch = lastUserText.match(
				/PTOLEMY_MCP_CALL ([a-z0-9_]+) ([a-z0-9_]+)/,
			);
			if (mcpMatch) {
				const payload =
					toolResultsThisTurn === 0
						? scriptTurn(
								n,
								`const result=await tools.mcp__${mcpMatch[1]}__${mcpMatch[2]}({});text(result);`,
								usage,
							)
						: messageTurn(n, JSON.stringify(input[input.length - 1]), usage);
				return new Response(payload, {
					headers: { "content-type": "text/event-stream" },
				});
			}
			// One `exec` call does both the write and the `cat`.
			const step = nextMockStep({
				lastUserText,
				history: JSON.stringify(input),
				toolResultsThisTurn: toolResultsThisTurn > 0 ? 2 : 0,
			});
			const payload =
				step.kind === "write-file"
					? typeof probeScript === "string"
						? scriptTurn(n, probeScript, usage)
						: probeScript
							? functionTurn(n, probeScript, usage)
							: execTurn(n, step.file, usage)
					: messageTurn(n, step.kind === "reply" ? step.text : "Ok.", usage);
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
