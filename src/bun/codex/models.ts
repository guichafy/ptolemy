import type { ProtocolModelInfo } from "@/shared/agent-protocol";
import { CODEX_DEFAULT_MODEL } from "./constants";

/**
 * Static Codex model catalog. The SDK has no model-listing API, so this list
 * mirrors the slugs documented for Codex (learn.chatgpt.com/codex/models).
 * The first entry defers to whatever the user configured in the Codex CLI
 * (`~/.codex/config.toml`), which is the safe default: not every plan has
 * access to every model.
 */
export const CODEX_MODELS: ProtocolModelInfo[] = [
	{
		value: CODEX_DEFAULT_MODEL,
		displayName: "Padrão do Codex",
		description: "Usa o modelo configurado no Codex CLI",
	},
	{
		value: "gpt-6-astra",
		displayName: "GPT-6 Astra",
		description: "Mais capaz, para trabalho complexo de ponta a ponta",
	},
	{
		value: "gpt-6.1-sol",
		displayName: "GPT-6.1 Sol",
		description: "Quase Astra, com custo menor para tarefas longas",
	},
	{
		value: "gpt-6.1-terra",
		displayName: "GPT-6.1 Terra",
		description: "Rápido e eficiente (requer Codex CLI 0.159+)",
	},
	{
		value: "gpt-6-luna",
		displayName: "GPT-6 Luna",
		description: "Mais econômico, para tarefas focadas",
	},
];

/** Maps the stored model value to the SDK's `model` option. */
export function toSdkModel(model: string | undefined): string | undefined {
	if (!model || model === CODEX_DEFAULT_MODEL) return undefined;
	return model;
}

/**
 * The catalog with the `"default"` entry annotated with the model it
 * currently resolves to (the top-level `model` of the Codex config).
 */
export async function listCodexModels(
	readConfigured: () => Promise<string | null>,
): Promise<ProtocolModelInfo[]> {
	const configured = await readConfigured().catch(() => null);
	if (!configured) return CODEX_MODELS;
	return CODEX_MODELS.map((m) =>
		m.value === CODEX_DEFAULT_MODEL ? { ...m, resolvesTo: configured } : m,
	);
}
