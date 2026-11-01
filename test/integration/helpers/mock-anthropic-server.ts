/**
 * Minimal stand-in for the Anthropic Messages API, enough for the real
 * Claude Code CLI (spawned by the Agent SDK) to run full turns offline:
 * streaming `POST /v1/messages` with text and `tool_use` blocks.
 *
 * It plays `scenario.ts`: Write the requested file, run `cat` through Bash,
 * then answer; memory questions are answered from the conversation history
 * the CLI resends on every request.
 */

import {
	chunk,
	createPromptCache,
	estimateTokens,
	nextMockStep,
	sse,
} from "./scenario";

export interface MockAnthropicServer {
	url: string;
	requests: Array<Record<string, unknown>>;
	stop: () => void;
}

type Block = {
	type?: string;
	text?: string;
	content?: unknown;
};
type Message = { role: string; content: string | Block[] };

function blocksOf(message: Message): Block[] {
	return typeof message.content === "string"
		? [{ type: "text", text: message.content }]
		: message.content;
}

/** Text the person typed (not tool results, not injected reminders). */
function userText(message: Message): string {
	return blocksOf(message)
		.filter(
			(b) => b.type === "text" && !b.text?.startsWith("<system-reminder>"),
		)
		.map((b) => b.text ?? "")
		.join("\n");
}

function isToolResultMessage(message: Message): boolean {
	return blocksOf(message).some((b) => b.type === "tool_result");
}

function cwdFrom(system: unknown): string {
	const match = JSON.stringify(system ?? "").match(
		/Primary working directory: ([^\\"]+)/,
	);
	return match ? match[1].trim() : ".";
}

const OUTPUT_TOKENS = 20;

interface RequestUsage {
	input_tokens: number;
	cache_read_input_tokens: number;
	cache_creation_input_tokens: number;
	output_tokens: number;
}

/**
 * Usage shaped like Claude Code's real traffic: it caches the whole prompt
 * on every request, so the reused prefix is a cache read, the new tail is a
 * cache write, and only a few tokens are plain input.
 */
function requestUsage(cached: number, fresh: number): RequestUsage {
	const input = Math.min(fresh, 40);
	return {
		input_tokens: input,
		cache_read_input_tokens: cached,
		cache_creation_input_tokens: fresh - input,
		output_tokens: OUTPUT_TOKENS,
	};
}

function stream(
	n: number,
	model: string,
	usage: RequestUsage,
	block:
		| { type: "text"; text: string }
		| { type: "tool_use"; name: string; input: Record<string, unknown> },
): string {
	const id = `msg_mock_${n}`;
	const start =
		block.type === "text"
			? { type: "text", text: "" }
			: {
					type: "tool_use",
					id: `toolu_mock_${n}`,
					name: block.name,
					input: {},
				};
	const deltas =
		block.type === "text"
			? chunk(block.text).map((text) => ({
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text },
				}))
			: [
					{
						type: "content_block_delta",
						index: 0,
						delta: {
							type: "input_json_delta",
							partial_json: JSON.stringify(block.input),
						},
					},
				];
	return sse([
		{
			type: "message_start",
			message: {
				id,
				type: "message",
				role: "assistant",
				model,
				content: [],
				stop_reason: null,
				stop_sequence: null,
				usage: { ...usage, output_tokens: 1 },
			},
		},
		{ type: "content_block_start", index: 0, content_block: start },
		...deltas,
		{ type: "content_block_stop", index: 0 },
		{
			type: "message_delta",
			delta: {
				stop_reason: block.type === "text" ? "end_turn" : "tool_use",
				stop_sequence: null,
			},
			usage: { output_tokens: usage.output_tokens },
		},
		{ type: "message_stop" },
	]);
}

export function startMockAnthropicServer(): MockAnthropicServer {
	const requests: MockAnthropicServer["requests"] = [];
	const promptCache = createPromptCache();
	let counter = 0;
	const server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		async fetch(req) {
			const url = new URL(req.url);
			if (req.method === "HEAD") return new Response(null, { status: 200 });
			// Used by the CLI to size the context categories (`/context`).
			if (
				req.method === "POST" &&
				url.pathname.endsWith("/v1/messages/count_tokens")
			) {
				const body = (await req.json()) as Record<string, unknown>;
				return Response.json({
					input_tokens: estimateTokens({
						system: body.system,
						tools: body.tools,
						messages: body.messages,
					}),
				});
			}
			if (req.method !== "POST" || !url.pathname.endsWith("/v1/messages")) {
				return new Response("{}", { status: 404 });
			}
			const body = (await req.json()) as {
				model: string;
				stream?: boolean;
				system?: unknown;
				tools?: unknown;
				messages: Message[];
			};
			requests.push(body as unknown as Record<string, unknown>);
			const n = ++counter;
			const messages = body.messages ?? [];

			// Walk back to the last message the person typed; count the tool
			// results that came after it (this turn's progress).
			let toolResultsThisTurn = 0;
			let lastUserText = "";
			for (let i = messages.length - 1; i >= 0; i--) {
				const m = messages[i];
				if (m.role !== "user") continue;
				if (isToolResultMessage(m)) {
					toolResultsThisTurn++;
					continue;
				}
				lastUserText = userText(m);
				if (lastUserText) break;
			}

			const { cached, fresh } = promptCache(
				JSON.stringify(messages[0] ?? "").slice(0, 400),
				estimateTokens({
					system: body.system,
					tools: body.tools,
					messages,
				}),
			);
			const usage = requestUsage(cached, fresh);

			const mcpMatch = lastUserText.match(
				/PTOLEMY_MCP_CALL ([a-z0-9_]+) ([a-z0-9_]+)/,
			);
			if (mcpMatch && body.stream) {
				const block =
					toolResultsThisTurn === 0
						? {
								type: "tool_use" as const,
								name: `mcp__${mcpMatch[1]}__${mcpMatch[2]}`,
								input: {},
							}
						: {
								type: "text" as const,
								text: JSON.stringify(messages[messages.length - 1]),
							};
				return new Response(stream(n, body.model, usage, block), {
					headers: { "content-type": "text/event-stream" },
				});
			}
			const step = nextMockStep({
				lastUserText,
				history: JSON.stringify(messages),
				toolResultsThisTurn,
			});
			const cwd = cwdFrom(body.system);
			const block =
				step.kind === "write-file"
					? {
							type: "tool_use" as const,
							name: "Write",
							input: {
								file_path: `${cwd}/${step.file.name}`,
								content: step.file.text,
							},
						}
					: step.kind === "run-cat"
						? {
								type: "tool_use" as const,
								name: "Bash",
								input: {
									command: `cat ${step.file.name}`,
									description: "Mostra o arquivo criado",
								},
							}
						: { type: "text" as const, text: step.text };

			if (!body.stream) {
				// Non-streaming side requests (rare): answer with plain text.
				return Response.json({
					id: `msg_mock_${n}`,
					type: "message",
					role: "assistant",
					model: body.model,
					content: [{ type: "text", text: "ok" }],
					stop_reason: "end_turn",
					stop_sequence: null,
					usage,
				});
			}
			return new Response(stream(n, body.model, usage, block), {
				headers: { "content-type": "text/event-stream" },
			});
		},
	});
	return {
		url: `http://127.0.0.1:${server.port}`,
		requests,
		stop: () => server.stop(true),
	};
}
