/**
 * The conversation every agent goes through in the integration suite, plus
 * the tiny "model" the local mock servers use to play it.
 *
 * The same prompts go to the real models (live mode) and to the mocks
 * (local mode). The mocks follow them literally and answer the memory
 * questions only from the history the CLI sends back, so a broken resume
 * still fails in local mode.
 */

export interface ScenarioFile {
	name: string;
	text: string;
}

export function scenarioFile(agent: "claude" | "codex"): ScenarioFile {
	return agent === "claude"
		? { name: "ola-claude.txt", text: "Olá do Claude" }
		: { name: "ola-codex.txt", text: "Olá do Codex" };
}

/** Turn 1: create a file, then read it back with a shell command. */
export function createFilePrompt(file: ScenarioFile): string {
	return [
		`Crie o arquivo ${file.name} na pasta atual contendo exatamente o texto: ${file.text}`,
		`Depois rode o comando \`cat ${file.name}\` no terminal para conferir.`,
		"Por fim, responda em uma frase curta.",
	].join("\n");
}

/** Turn 2: needs the history of turn 1. */
export const ASK_FILE_NAME =
	"Qual é o nome do arquivo que você criou? Responda só o nome.";

/** Turn 3 (after a cold resume): needs the history of turn 1 again. */
export const ASK_FILE_TEXT =
	"Qual texto você escreveu no arquivo? Responda só o texto.";

const CREATE_RE =
	/Crie o arquivo (\S+) na pasta atual contendo exatamente o texto: (.+)/;

/** Finds the file the user asked for anywhere in `history`. */
export function findRequestedFile(history: string): ScenarioFile | null {
	// History arrives JSON-encoded, so undo the escaping of the line break.
	const match = history.replace(/\\n/g, "\n").match(CREATE_RE);
	return match ? { name: match[1], text: match[2].trim() } : null;
}

export type MockStep =
	| { kind: "write-file"; file: ScenarioFile }
	| { kind: "run-cat"; file: ScenarioFile }
	| { kind: "reply"; text: string };

/**
 * Decides the next step from the latest user text, the whole history and
 * how many tool results this turn already has.
 */
export function nextMockStep(args: {
	lastUserText: string;
	history: string;
	toolResultsThisTurn: number;
}): MockStep {
	const requested = findRequestedFile(args.lastUserText);
	if (requested) {
		if (args.toolResultsThisTurn === 0) {
			return { kind: "write-file", file: requested };
		}
		if (args.toolResultsThisTurn === 1) {
			return { kind: "run-cat", file: requested };
		}
		return { kind: "reply", text: `Pronto: criei ${requested.name}.` };
	}
	const remembered = findRequestedFile(args.history);
	if (args.lastUserText.includes(ASK_FILE_NAME)) {
		return { kind: "reply", text: remembered?.name ?? "não sei" };
	}
	if (args.lastUserText.includes(ASK_FILE_TEXT)) {
		return { kind: "reply", text: remembered?.text ?? "não sei" };
	}
	return { kind: "reply", text: "Ok." };
}

export function sse(events: Array<Record<string, unknown>>): string {
	return events
		.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
		.join("");
}

export function chunk(text: string, size = 12): string[] {
	const out: string[] = [];
	for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
	return out.length > 0 ? out : [""];
}

/**
 * Rough token count of a request payload (~4 characters per token), so the
 * mocks report usage on the scale of the real APIs instead of constants.
 */
export function estimateTokens(value: unknown): number {
	return Math.ceil(JSON.stringify(value ?? "").length / 4);
}

/**
 * Prompt caching as the real APIs report it: the part of a conversation's
 * prompt already sent in its previous request counts as a cache read, the
 * rest is new. Keyed by conversation (its first message), so parallel
 * sessions on one mock do not share a cache.
 */
export function createPromptCache() {
	const previous = new Map<string, number>();
	return (conversationKey: string, promptTokens: number) => {
		const before = previous.get(conversationKey) ?? 0;
		previous.set(conversationKey, promptTokens);
		const cached = Math.min(before, promptTokens);
		return { cached, fresh: promptTokens - cached };
	};
}
