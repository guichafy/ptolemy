import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
export interface ExtensionAgent {
	name: string;
	prompt: string;
	metadata: Record<string, unknown>;
}
const list = (value: unknown): string[] | undefined =>
	Array.isArray(value) && value.every((v) => typeof v === "string")
		? value
		: typeof value === "string"
			? value
					.split(",")
					.map((v) => v.trim())
					.filter(Boolean)
			: undefined;
export function claudeAgent(agent: ExtensionAgent): AgentDefinition {
	const m = agent.metadata;
	return {
		description: String(m.description ?? agent.name),
		prompt: agent.prompt,
		...(typeof m.model === "string" ? { model: m.model } : {}),
		...(list(m.tools) ? { tools: list(m.tools) } : {}),
		...(list(m.disallowedTools)
			? { disallowedTools: list(m.disallowedTools) }
			: {}),
		...(list(m.skills) ? { skills: list(m.skills) } : {}),
		...(typeof m.maxTurns === "number" ? { maxTurns: m.maxTurns } : {}),
		...(typeof m.background === "boolean" ? { background: m.background } : {}),
		...(typeof m.effort === "number" ||
		["low", "medium", "high", "xhigh", "max"].includes(String(m.effort))
			? { effort: m.effort as AgentDefinition["effort"] }
			: {}),
	};
}
