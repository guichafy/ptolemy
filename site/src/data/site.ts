export const SITE = {
	name: "Ptolemy",
	tagline: "Spotlight, com sotaque de dev.",
	description:
		"Uma menu bar app pra macOS que abre um command palette global em ⌘+Shift+Space. Apps, GitHub, calculadora, web e Claude Code, tudo num único atalho.",
	githubUrl: "https://github.com/guichafy/ptolemy",
	releasesUrl: "https://github.com/guichafy/ptolemy/releases",
	hotkey: "⌘ + Shift + Space",
	requirements: "macOS 13+ · Apple Silicon (arm64)",
} as const;

export type Plugin = {
	id: string;
	name: string;
	tagline: string;
	description: string;
	example: string;
	icon: "apps" | "github" | "calc" | "web" | "claude";
};

export const PLUGINS: readonly Plugin[] = [
	{
		id: "apps",
		name: "Apps",
		tagline: "Lançador de aplicativos",
		description:
			"Indexa /Applications, /System/Applications e ~/Applications. Abra qualquer app sem tirar a mão do teclado.",
		example: "Safari → Enter",
		icon: "apps",
	},
	{
		id: "github",
		name: "GitHub",
		tagline: "Repositórios, código, issues, gente",
		description:
			"Busca filtrável no GitHub com qualifiers customizados. Salve filtros recorrentes e ordene por estrelas, atualizações ou linguagem.",
		example: "Repositories · bun",
		icon: "github",
	},
	{
		id: "calc",
		name: "Calc",
		tagline: "Calculadora inline",
		description:
			"Avaliador de expressões matemáticas. Resultado destacado ao vivo, ↵ copia para o clipboard.",
		example: "245 * 3 + 17 = 752",
		icon: "calc",
	},
	{
		id: "web",
		name: "Web",
		tagline: "Buscas em qualquer engine",
		description:
			"Atalho para Google, DuckDuckGo, Stack Overflow e YouTube. Engine padrão configurável.",
		example: "Stack Overflow · react hooks",
		icon: "web",
	},
	{
		id: "claude",
		name: "Claude Code",
		tagline: "Conversas com o Claude embutidas",
		description:
			"Sessões isoladas por workspace, controle granular de permissões de ferramenta, MCP servers configuráveis e suporte SSO/Bedrock.",
		example: "Nova sessão → janela de chat",
		icon: "claude",
	},
] as const;

export type Screenshot = {
	src: string;
	alt: string;
	caption: string;
	plugin: string;
};

export const SCREENSHOTS: readonly Screenshot[] = [
	{
		src: "estado-inicial.png",
		alt: "Command palette do Ptolemy aberto sobre o desktop, mostrando as cinco abas de plugins",
		caption: "Estado inicial — ⌘+Shift+Space abre a paleta sobre qualquer app",
		plugin: "Geral",
	},
	{
		src: "calculadora.png",
		alt: "Aba Calc com a expressão 245 * 3 + 17 e o resultado 752 destacado em verde",
		caption: "Calc — expressões matemáticas avaliadas ao vivo",
		plugin: "Calc",
	},
	{
		src: "busca-github.png",
		alt: "Aba GitHub buscando repositórios com a query 'bun', listando oven-sh/bun, uptrace/bun e outros",
		caption: "GitHub — busca filtrável de repositórios, código, issues e usuários",
		plugin: "GitHub",
	},
	{
		src: "busca-apps.png",
		alt: "Aba Apps mostrando o resultado para a busca 'Safari'",
		caption: "Apps — qualquer aplicativo do sistema a um atalho de distância",
		plugin: "Apps",
	},
] as const;
