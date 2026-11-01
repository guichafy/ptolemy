/**
 * Maps the Claude CLI's own context accounting (`Query.getContextUsage()`,
 * the data behind Claude Code's `/context`) into the protocol's
 * `ContextBreakdown`. Pure, so it is testable with a fixture.
 */

import type { SDKControlGetContextUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import type {
	ContextBreakdown,
	ContextCategory,
	ContextDetailSection,
} from "@/shared/agent-protocol";

/** Category names Claude Code uses, in pt-BR. Unknown names pass through. */
const CATEGORY_LABELS: Record<string, string> = {
	"System prompt": "Prompt do sistema",
	"System tools": "Ferramentas do sistema",
	"System tools (deferred)": "Ferramentas do sistema (sob demanda)",
	"MCP tools": "Ferramentas MCP",
	"MCP tools (deferred)": "Ferramentas MCP (sob demanda)",
	"Custom agents": "Agentes",
	"Memory files": "Arquivos de memória (CLAUDE.md)",
	Skills: "Skills",
	"Slash commands": "Comandos",
	Messages: "Mensagens",
};

/**
 * Not context in use: free space is the empty part of the bar, and the
 * autocompact buffer is drawn as the threshold marker instead of a slice.
 */
const NOT_IN_USE = new Set(["Free space", "Autocompact buffer"]);

export function translateCategory(name: string): string {
	return CATEGORY_LABELS[name] ?? name;
}

function section(
	title: string,
	items: { name: string; tokens: number; hint?: string }[] | undefined,
	limit = 15,
): ContextDetailSection | null {
	const list = (items ?? [])
		.filter((i) => i.tokens > 0)
		.sort((a, b) => b.tokens - a.tokens)
		.slice(0, limit);
	return list.length > 0 ? { title, items: list } : null;
}

export function mapClaudeContextUsage(
	res: SDKControlGetContextUsageResponse,
): ContextBreakdown {
	const categories: ContextCategory[] = res.categories
		.filter((c) => !NOT_IN_USE.has(c.name) && c.tokens > 0)
		.map((c) => ({
			name: translateCategory(c.name),
			tokens: c.tokens,
			...(c.isDeferred ? { isDeferred: true } : {}),
		}));

	const mb = res.messageBreakdown;
	const sections = [
		mb &&
			section("Mensagens por tipo", [
				{ name: "Chamadas de ferramenta", tokens: mb.toolCallTokens },
				{ name: "Resultados de ferramenta", tokens: mb.toolResultTokens },
				{ name: "Respostas do agente", tokens: mb.assistantMessageTokens },
				{ name: "Mensagens do usuário", tokens: mb.userMessageTokens },
				{ name: "Anexos", tokens: mb.attachmentTokens },
				{ name: "Não atribuído", tokens: mb.unattributedTokens },
			]),
		mb &&
			section(
				"Ferramentas usadas na conversa",
				mb.toolCallsByType.map((t) => ({
					name: t.name,
					tokens: t.callTokens + t.resultTokens,
					hint: `chamada ${t.callTokens} · resultado ${t.resultTokens}`,
				})),
			),
		section(
			"Arquivos de memória",
			res.memoryFiles.map((f) => ({
				name: f.path,
				tokens: f.tokens,
				hint: f.type,
			})),
		),
		section(
			"Ferramentas MCP",
			res.mcpTools
				.filter((t) => t.isLoaded !== false)
				.map((t) => ({ name: t.name, tokens: t.tokens, hint: t.serverName })),
		),
		section("Ferramentas do sistema", res.systemTools),
		section("Seções do prompt do sistema", res.systemPromptSections),
		section(
			"Skills",
			res.skills?.skillFrontmatter.map((s) => ({
				name: s.name,
				tokens: s.tokens,
				hint: s.source,
			})),
		),
		section(
			"Agentes",
			res.agents.map((a) => ({
				name: a.agentType,
				tokens: a.tokens,
				hint: a.source,
			})),
		),
	].filter((s): s is ContextDetailSection => Boolean(s));

	return {
		source: "claude",
		model: res.model,
		usedTokens: res.totalTokens,
		maxTokens: res.maxTokens,
		...(res.isAutoCompactEnabled && res.autoCompactThreshold
			? { autoCompactThreshold: res.autoCompactThreshold }
			: {}),
		categories,
		sections,
	};
}
