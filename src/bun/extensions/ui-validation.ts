import type { AgentKind } from "@/shared/agent-protocol";
import type { ExtensionChoices } from "@/shared/extension-rpc";
import type { ExtensionSelection } from "@/shared/extensions";
import type { McpEditableServer } from "@/shared/mcp";
export function record(
	value: unknown,
): asserts value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw Error("Dados inválidos.");
}
export function keys(value: unknown, allowed: string[]) {
	record(value);
	if (Object.keys(value).some((k) => !allowed.includes(k)))
		throw Error("Campos inválidos.");
}
export function text(value: unknown): asserts value is string {
	if (
		typeof value !== "string" ||
		!value ||
		value.length > 4096 ||
		value.includes("\0")
	)
		throw Error("Identificador inválido.");
}
export function agent(value: unknown): asserts value is AgentKind {
	if (value !== "claude" && value !== "codex") throw Error("Agente inválido.");
}
export function ids(value: unknown): asserts value is string[] {
	if (
		!Array.isArray(value) ||
		value.length > 512 ||
		new Set(value).size !== value.length
	)
		throw Error("Seleção inválida.");
	value.forEach(text);
}
export function selections(
	value: unknown,
): asserts value is ExtensionSelection[] {
	if (!Array.isArray(value) || value.length > 128)
		throw Error("Seleção inválida.");
	const seen = new Set();
	for (const s of value) {
		keys(s, ["packageId", "revision", "componentIds", "trustedHookDigest"]);
		text(s.packageId);
		if (
			seen.has(s.packageId) ||
			!/^extension:[a-f0-9]{64}$/.test(s.packageId) ||
			typeof s.revision !== "string" ||
			!/^[a-f0-9]{64}$/.test(s.revision)
		)
			throw Error("Revisão inválida.");
		seen.add(s.packageId);
		ids(s.componentIds);
		if (s.trustedHookDigest !== undefined && s.trustedHookDigest !== s.revision)
			throw Error("Autorização de hooks inválida.");
	}
}
export function choices(
	value: unknown,
): asserts value is ExtensionChoices & { agent: AgentKind } {
	keys(value, [
		"agent",
		"skillIds",
		"extensionSelections",
		"builtinCommandNames",
		"mcpServerIds",
	]);
	record(value);
	agent(value.agent);
	ids(value.skillIds);
	ids(value.builtinCommandNames);
	ids(value.mcpServerIds);
	selections(value.extensionSelections);
}
export function editable(value: unknown): asserts value is McpEditableServer {
	record(value);
	keys(
		value,
		value.transport === "stdio"
			? [
					"id",
					"name",
					"defaults",
					"packageId",
					"transport",
					"command",
					"args",
					"env",
				]
			: [
					"id",
					"name",
					"defaults",
					"packageId",
					"transport",
					"url",
					"headers",
					"auth",
				],
	);
	text(value.id);
	text(value.name);
	keys(value.defaults, ["claude", "codex"]);
	record(value.defaults);
	if (
		typeof value.defaults.claude !== "boolean" ||
		typeof value.defaults.codex !== "boolean"
	)
		throw Error("Padrões inválidos.");
	if (value.packageId !== undefined) text(value.packageId);
	const credential = (c: unknown) => {
		record(c);
		if (c.preserve === true) {
			keys(c, ["preserve"]);
		} else {
			keys(c, ["value"]);
			if (typeof c.value !== "string") throw Error("Credencial inválida.");
		}
	};
	for (const field of ["env", "headers"])
		if (value[field] !== undefined) {
			record(value[field]);
			for (const c of Object.values(value[field])) credential(c);
		}
	if (value.transport === "stdio") {
		text(value.command);
		if (
			value.args !== undefined &&
			(!Array.isArray(value.args) ||
				value.args.some((a) => typeof a !== "string"))
		)
			throw Error("Argumentos inválidos.");
	} else if (value.transport === "http") {
		text(value.url);
		if (value.auth !== undefined) {
			keys(value.auth, [
				"type",
				"issuer",
				"resource",
				"clientId",
				"scopes",
				"clientSecret",
			]);
			record(value.auth);
			if (value.auth.type !== "oauth") throw Error("Autenticação inválida.");
			if (value.auth.clientSecret !== undefined)
				credential(value.auth.clientSecret);
		}
	} else throw Error("Transporte inválido.");
}
