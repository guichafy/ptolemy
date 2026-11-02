import type { McpEditableServer } from "@/shared/mcp";

const revision = "a".repeat(64),
	packageId = `extension:${"b".repeat(64)}`;
const sources = [
	{
		id: "source",
		name: "Exemplo / ferramentas de desenvolvimento",
		url: "https://github.com/example/tools",
	},
];
const pkg = {
	id: packageId,
	name: "Ferramentas de revisão e manutenção de projetos com nomes extensos",
	description: "Skills, comandos, hooks e MCP selecionáveis separadamente.",
	sourceId: "source",
	url: "https://github.com/example/tools/tree/main/review",
	revision,
	diagnostics: [],
	components: [
		{
			id: "review",
			name: "Revisar alteração",
			kind: "skill",
			description: "Revisão de código",
			diagnostics: [],
			sources: [{ effective: true, harness: "portable" }],
		},
		{
			id: "command",
			name: "review",
			kind: "command",
			diagnostics: [],
			sources: [{ effective: true, harness: "portable" }],
		},
		{
			id: "hook",
			name: "Antes de executar ferramenta",
			kind: "hook",
			diagnostics: [],
			sources: [{ effective: true, harness: "portable" }],
		},
		{
			id: "mcp",
			name: "Documentação da equipe",
			kind: "mcp",
			diagnostics: [],
			sources: [{ effective: true, harness: "portable" }],
		},
		{
			id: "other",
			name: "Conector proprietário",
			kind: "other",
			diagnostics: [],
			sources: [{ effective: true, harness: "portable" }],
		},
	],
};
let installed = [pkg];
let oauth = "disconnected";
let draft: McpEditableServer = {
	id: "docs",
	name: "Documentação e referências internas da equipe",
	transport: "http",
	url: "https://mcp.example.test",
	headers: { Authorization: { preserve: true } },
	auth: {
		type: "oauth",
		clientId: "native-client",
		clientSecret: { preserve: true },
	},
	defaults: { claude: false, codex: true },
};
const capabilities = (trusted = false) =>
	pkg.components.map((c) => ({
		packageId,
		componentId: c.id,
		status:
			c.kind === "other"
				? "incompatible"
				: c.kind === "mcp"
					? "requires-configuration"
					: c.kind === "hook" && !trusted
						? "requires-configuration"
						: "adapted",
		reason:
			c.kind === "other"
				? "Conector proprietário sem endpoint MCP público utilizável."
				: c.kind === "mcp"
					? "Vincule este componente a um servidor do registro MCP compartilhado."
					: c.kind === "hook" && !trusted
						? "Autorize hooks desta revisão imutável antes de executar."
						: "Compatível com o agente selecionado; escrita restrita ao projeto.",
	}));
const settings = {
	version: 1,
	plugins: { enabledOrder: ["github", "claude", "codex"] },
	github: { customFilters: [], hasToken: false },
	analytics: { consentGiven: false, anonymousId: "fixture" },
	claude: {
		authMode: "anthropic",
		model: "sonnet",
		permissionMode: "acceptEdits",
	},
	codex: {
		model: "default",
		sandboxMode: "workspace-write",
		reasoningEffort: "",
	},
	proxy: { mode: "none" },
};
const request: Record<string, (args?: any) => Promise<any>> = {
	loadSettings: async () => settings,
	saveSettings: async () => true,
	agentExtensionSources: async () => sources,
	agentExtensionAddSource: async () => sources[0],
	agentExtensionRemoveSource: async () => true,
	agentExtensionInstalled: async () => installed,
	agentExtensionBrowse: async () => [pkg],
	agentExtensionInspect: async () => ({
		summary: pkg,
		capabilities: capabilities(),
	}),
	agentExtensionInstall: async () => {
		throw Error(
			"Falha ao baixar o pacote. Verifique a conexão e tente novamente. A biblioteca foi preservada.",
		);
	},
	agentExtensionRemove: async () => {
		installed = [];
		return true;
	},
	agentExtensionInventory: async (args) => {
		if (location.search.includes("missing-cli"))
			throw Error(
				"Claude Code CLI não encontrado. Instale o CLI para validar os recursos.",
			);
		return {
			installed,
			nativePlugins: [
				{
					id: "native-local",
					name: "Pacote instalado localmente no CLI",
					enabled: true,
					canImport: true,
					managed: false,
				},
				{
					id: "remote",
					name: "Conector remoto sem pacote exportável",
					enabled: true,
					canImport: false,
					managed: false,
					importLimitation:
						"O CLI não expõe um pacote local exportável para este plugin.",
				},
			],
			builtins:
				args.agent === "claude"
					? [
							{
								id: "builtin:debug",
								name: "debug",
								kind: "skill",
								origin: "builtin",
								description: "Investigar um problema no projeto",
								limitation:
									"Controle de execução; a descrição pode continuar visível.",
							},
							{
								id: "builtin:clear",
								name: "clear",
								kind: "command",
								origin: "builtin",
								description: "Limpar contexto",
								limitation: "",
							},
						]
					: [],
			defaults: {
				selections: [],
				builtinCommandNames: args.agent === "claude" ? ["debug"] : [],
			},
			verifiedRuntime: "0.166.0",
		};
	},
	agentExtensionImportNative: async () => pkg,
	agentExtensionReview: async (args) => capabilities(!!args.trustedHookDigest),
	agentExtensionCapabilities: async () => [],
	agentExtensionSetDefaults: async () => true,
	agentExtensionCommands: async () => [
		{ name: "ferramentas:review", description: "Revisar com argumentos" },
	],
	agentListSkills: async () => [
		{
			id: "imported",
			name: "Revisão importada",
			description: "Convenções de revisão",
			source: {
				kind: "github",
				url: "https://github.com/example/review",
				commit: "d".repeat(40),
			},
			defaultFor: [],
		},
		{
			id: "skill",
			name: "Revisão local",
			description: "Revisar código e testes",
			source: { kind: "harness", agent: "codex" },
			origin: "local",
			defaultFor: ["codex", "claude"],
		},
	],
	agentSetDefaultSkills: async () => true,
	agentMcpList: async () => [
		{
			id: draft.id,
			name: draft.name,
			transport: draft.transport,
			defaults: draft.defaults,
			credentials: {
				env: [],
				headers: ["Authorization"],
				oauthClientSecret: true,
			},
			connection: { state: oauth },
		},
	],
	agentMcpGetEditable: async () => draft,
	agentMcpSave: async (args) => {
		draft = args.draft;
		return true;
	},
	agentMcpStatus: async () => ({ state: oauth }),
	agentMcpRegistration: async () => ({
		issuer: "https://issuer.example.test",
		resource: "https://mcp.example.test",
		redirectUri: `http://127.0.0.1/oauth/callback/${"c".repeat(64)}`,
	}),
	agentMcpConnect: async () => {
		oauth = "waiting";
		return { state: "connecting" };
	},
	agentMcpCancel: async () => {
		oauth = "cancelled";
		return true;
	},
	agentMcpDisconnect: async () => {
		oauth = "disconnected";
		return true;
	},
	codexListModels: async () => ({
		models: [
			{
				value: "default",
				displayName: "Padrão do Codex",
				description: "Modelo configurado no CLI",
			},
		],
	}),
	claudeListSupportedModels: async () => ({
		models: [
			{
				value: "sonnet",
				displayName: "Sonnet",
				description: "Modelo configurado",
			},
		],
	}),
	openUrl: async () => true,
};
export const rpc = { request };
export const setOpenPreferencesHandler = () => {};
export const onWindowShown = () => () => {};
export const onAgentEvent = () => () => {};
export const setClaudeSessionsUpdateHandler = () => {};
