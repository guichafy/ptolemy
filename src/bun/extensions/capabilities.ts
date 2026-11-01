import type { AgentKind } from "@/shared/agent-protocol";
import type { ExtensionComponent } from "@/shared/extensions";
export interface ComponentCapability {
	packageId?: string;
	componentId: string;
	status: "native" | "adapted" | "requires-configuration" | "incompatible";
	reason: string;
}
export const COMMON_HOOK_EVENTS = [
	"SessionStart",
	"SessionEnd",
	"PreToolUse",
	"PostToolUse",
	"Stop",
	"SubagentStart",
	"SubagentStop",
	"PreCompact",
	"UserPromptSubmit",
];
export function componentCapability(
	component: ExtensionComponent,
	agent: AgentKind,
	trusted: boolean,
): ComponentCapability {
	const result = (status: ComponentCapability["status"], reason: string) => ({
		componentId: component.id,
		status,
		reason,
	});
	if (!component.sources.some((s) => s.effective))
		return result("incompatible", "Declaração substituída pelo catálogo.");
	if (
		!component.definition ||
		component.diagnostics.some((d) => d.severity === "error")
	)
		return result(
			"incompatible",
			"Definição inválida; examine os diagnósticos do componente.",
		);
	if (component.kind === "hook") {
		const d = component.definition!;
		if (!COMMON_HOOK_EVENTS.includes(d.event))
			return result(
				"incompatible",
				`Evento ${d.event} sem contrato equivalente verificado no runtime.`,
			);
		if (
			d.matcher &&
			d.matcher !== "*" &&
			["PreToolUse", "PostToolUse"].includes(d.event) &&
			(agent === "codex"
				? !component.sources.some((s) => s.effective && s.harness === "codex")
				: component.sources.some((s) => s.effective && s.harness === "codex") &&
					!component.sources.some((s) => s.effective && s.harness === "claude"))
		)
			return result(
				"incompatible",
				`Matcher de ferramentas ${d.matcher} requer nomes e payloads ${agent} nativos; não há tradução segura de regex arbitrária entre ferramentas dos agentes.`,
			);
		if (
			agent === "codex" &&
			d.event === "SessionEnd" &&
			Number(d.handler.timeout ?? 1) > 3
		)
			return result(
				"incompatible",
				"SessionEnd do Codex tem prazo nativo máximo de 3 segundos.",
			);
		if (d.handler.type === "prompt") {
			if (agent === "codex")
				return result(
					"incompatible",
					"Codex 0.166.0 reconhece o tipo prompt, mas seu discovery não executa prompt hooks.",
				);
			const unknown = Object.keys(d.handler).filter(
				(k) =>
					!["type", "prompt", "model", "timeout", "statusMessage"].includes(k),
			);
			if (
				unknown.length ||
				typeof d.handler.prompt !== "string" ||
				!d.handler.prompt.trim()
			)
				return result(
					"incompatible",
					`Prompt hook inválido ou com campos sem equivalente: ${unknown.join(", ")}.`,
				);
			if (
				![
					"PreToolUse",
					"PostToolUse",
					"UserPromptSubmit",
					"Stop",
					"SubagentStop",
				].includes(d.event)
			)
				return result(
					"incompatible",
					`Evento ${d.event} sem contrato de prompt hook verificado no Claude.`,
				);
			if (!trusted)
				return result(
					"requires-configuration",
					"Autorize hooks desta revisão imutável antes de executar.",
				);
			return result(
				"native",
				"Prompt hook Claude nativo sem ferramentas, via plugin sanitizado; exige exclusividade no evento para preservar ordem.",
			);
		}
		if (d.handler.type !== "command")
			return result(
				"incompatible",
				d.handler.type === "agent"
					? "Agent-hook cria um ciclo de ferramentas separado sem callback de autorização/jail verificado; não equivale à delegação de agentes configurada da conversa."
					: `Handler ${String(d.handler.type)} não tem transporte e contrato de autorização implementados.`,
			);

		const unknown = Object.keys(d.handler).filter(
			(k) =>
				!["type", "command", "timeout", "async", "statusMessage"].includes(k),
		);
		if (unknown.length)
			return result(
				"incompatible",
				`Campos de hook sem equivalente: ${unknown.join(", ")}.`,
			);
		if (d.handler.async === true)
			return result(
				"incompatible",
				"Hook async não pode preservar bloqueio e ordem síncrona.",
			);
		const unknownGroup = Object.keys(d.group).filter(
			(k) => !["matcher", "hooks"].includes(k),
		);
		if (unknownGroup.length)
			return result(
				"incompatible",
				`Campos do grupo de hooks sem equivalente: ${unknownGroup.join(", ")}.`,
			);
		if (d.matcher && d.matcher !== "*")
			try {
				new RegExp(d.matcher);
			} catch {
				return result(
					"incompatible",
					"Matcher de hook não é uma expressão regular válida.",
				);
			}
		if (typeof d.handler.command !== "string" || !d.handler.command.trim())
			return result("incompatible", "Hook command ausente.");
		if (
			d.handler.timeout !== undefined &&
			(typeof d.handler.timeout !== "number" ||
				d.handler.timeout <= 0 ||
				d.handler.timeout > 600)
		)
			return result(
				"incompatible",
				"Timeout de hook deve estar entre 0 e 600 segundos.",
			);
		if (!trusted)
			return result(
				"requires-configuration",
				"Autorize hooks desta revisão imutável antes de executar.",
			);
		return result(
			"adapted",
			"Evento nativo, escrita restrita ao projeto; pacote executável somente leitura (use PLUGIN_DATA para dados). Grants e updatedInput não elevam permissões.",
		);
	}
	if (
		component.kind === "agent" ||
		component.kind === "command" ||
		component.kind === "skill"
	) {
		const metadata = component.definition?.metadata ?? {};
		const allowed =
			component.kind === "agent"
				? [
						"name",
						"description",
						"model",
						"tools",
						"disallowedTools",
						"skills",
						"maxTurns",
						"background",
						"effort",
					]
				: component.kind === "command"
					? [
							"name",
							"description",
							"argument-hint",
							"arguments",
							"allowed-tools",
						]
					: [
							"name",
							"description",
							"user-invocable",
							"disable-model-invocation",
							"argument-hint",
							"allowed-tools",
							"license",
							"compatibility",
							"metadata",
						];
		const unknown = Object.keys(metadata).filter((k) => !allowed.includes(k));
		if (unknown.length)
			return result(
				"incompatible",
				`Metadados sem adaptação segura: ${unknown.join(", ")}.`,
			);
		if (
			component.kind === "skill" &&
			agent === "codex" &&
			["user-invocable", "disable-model-invocation"].some((k) => k in metadata)
		)
			return result(
				"incompatible",
				"Codex não preserva controles Claude user-invocable/disable-model-invocation neste frontmatter.",
			);
		if (component.kind === "agent" && agent === "codex") {
			const unsupported = Object.keys(metadata).filter(
				(k) => !["name", "description", "model"].includes(k),
			);
			if (unsupported.length)
				return result(
					"incompatible",
					`Agente Codex não tem configuração equivalente para: ${unsupported.join(", ")}.`,
				);
		}
		return result(
			"adapted",
			component.kind === "agent"
				? "Delegação nativa com instruções e configuração preservadas."
				: "Conteúdo selecionado com recursos relativos; permissões permanecem no gate.",
		);
	}
	if (component.kind === "mcp") {
		const config = component.definition.config;
		const unknown = Object.keys(config).filter(
			(k) =>
				![
					"type",
					"command",
					"args",
					"env",
					"url",
					"headers",
					"oauth_resource",
				].includes(k),
		);
		if (unknown.length)
			return result(
				"incompatible",
				`Campos MCP sem equivalente: ${unknown.join(", ")}.`,
			);
		if (
			config.type !== undefined &&
			!["http", "stdio"].includes(String(config.type))
		)
			return result(
				"incompatible",
				`Transporte MCP ${String(config.type)} não é HTTP Streamable ou stdio.`,
			);
		return result(
			"requires-configuration",
			"Vincule este componente a um servidor do registro MCP compartilhado.",
		);
	}
	const type =
		component.kind === "other" ? component.definition?.type : component.kind;
	return result(
		"incompatible",
		type === "apps"
			? "Conector proprietário sem endpoint MCP público utilizável."
			: `Recurso ${type} sem contrato de runtime equivalente.`,
	);
}
