export const SITE = {
	name: "Ptolemy",
	tagline: "Seu dia a dia a um atalho de distância",
	description:
		"Um app leve que mora na barra de menu do Mac. Abra aplicativos, faça contas, pesquise na web e converse com o Claude sem tirar as mãos do teclado.",
	githubUrl: "https://github.com/guichafy/ptolemy",
	releasesUrl: "https://github.com/guichafy/ptolemy/releases",
	hotkey: "⌘ + Shift + Space",
	requirements: "macOS 13 ou superior · Macs com chip Apple",
} as const;

export type Plugin = {
	id: string;
	name: string;
	tagline: string;
	description: string;
	example: string;
	icon: "apps" | "github" | "calc" | "web" | "claude";
	/** Rótulo opcional para plugins de nicho, exibido como selo no card. */
	audience?: string;
};

// Ordem pensada para quem chega sem contexto técnico: o que todo mundo usa
// primeiro, o que é de nicho por último.
export const PLUGINS: readonly Plugin[] = [
	{
		id: "apps",
		name: "Apps",
		tagline: "Abra qualquer aplicativo",
		description:
			"Digite as primeiras letras e aperte Enter. Safari, Zoom, Notas, Spotify: tudo o que está instalado no seu Mac, sem procurar no Dock ou no Launchpad.",
		example: "zoo → Enter",
		icon: "apps",
	},
	{
		id: "calc",
		name: "Calculadora",
		tagline: "Contas rápidas, na hora",
		description:
			"Digite a conta e o resultado aparece enquanto você escreve. Enter copia o valor para colar onde quiser.",
		example: "380 / 4 = 95",
		icon: "calc",
	},
	{
		id: "web",
		name: "Busca Web",
		tagline: "Pesquise sem abrir o navegador antes",
		description:
			"Escreva o que procura e escolha onde buscar: Google, DuckDuckGo, YouTube ou Stack Overflow. O resultado abre direto no navegador.",
		example: "YouTube · receita de pão",
		icon: "web",
	},
	{
		id: "claude",
		name: "Claude",
		tagline: "Um assistente de IA sempre à mão",
		description:
			"Abra uma conversa com o Claude numa janela própria para resumir um texto, revisar um e-mail ou tirar uma dúvida. As conversas ficam salvas para você retomar depois.",
		example: "Nova conversa → janela de chat",
		icon: "claude",
	},
	{
		id: "github",
		name: "GitHub",
		tagline: "Repositórios, código e issues",
		description:
			"Busca no GitHub com filtros salvos e ordenação por estrelas, atualizações ou linguagem. Não usa? Desative nas preferências.",
		example: "Repositórios · bun",
		icon: "github",
		audience: "Para quem programa",
	},
] as const;

export type UseCase = {
	title: string;
	body: string;
	examples: readonly string[];
};

export const USE_CASES: readonly UseCase[] = [
	{
		title: "Para quem trabalha no computador o dia todo",
		body: "Entre uma reunião e outra, abra o app certo, confira uma conta ou peça ao Claude para melhorar aquele e-mail, sem perder o fio do que estava fazendo.",
		examples: ["Abrir o Zoom em um segundo", "Revisar um e-mail com o Claude"],
	},
	{
		title: "Para quem estuda",
		body: "Pesquise um conceito, encontre uma videoaula no YouTube ou peça uma explicação mais simples, tudo a partir do mesmo atalho, no meio da leitura.",
		examples: ["Buscar uma videoaula", "Resumir um texto longo"],
	},
	{
		title: "Para quem cria e organiza",
		body: "Freelancers, criadores de conteúdo e quem cuida das contas da casa: dividir valores, somar gastos e achar referências fica a um atalho.",
		examples: ["Dividir a conta do mês", "Achar referências na web"],
	},
	{
		title: "Para quem programa",
		body: "Além do básico, um plugin de busca no GitHub com filtros salvos e uma janela do Claude Code com sessões isoladas, MCP servers e suporte a Bedrock.",
		examples: ["Buscar repositórios", "Sessões do Claude Code"],
	},
] as const;

export type Highlight = {
	title: string;
	body: string;
};

export const HIGHLIGHTS: readonly Highlight[] = [
	{
		title: "Mãos no teclado",
		body: "Um único atalho abre a paleta sobre qualquer app. Tab troca de ferramenta, Enter executa.",
	},
	{
		title: "Fica fora do caminho",
		body: "Mora na barra de menu, sem ícone no Dock. Aparece quando você chama e some quando termina.",
	},
	{
		title: "Do seu jeito",
		body: "Escolha quais ferramentas aparecem e em que ordem. Desative o que não usa.",
	},
	{
		title: "Gratuito e aberto",
		body: "Software livre sob licença MIT, com o código inteiro publicado no GitHub.",
	},
] as const;

export type Faq = {
	q: string;
	a: string;
};

export const FAQ: readonly Faq[] = [
	{
		q: "Preciso saber programar para usar?",
		a: "Não. Basta baixar, arrastar para a pasta Aplicativos e apertar ⌘ + Shift + Space. Apps, Calculadora, Busca Web e Claude funcionam para qualquer pessoa; o plugin do GitHub é opcional.",
	},
	{
		q: "Quanto custa?",
		a: "Nada. O Ptolemy é software livre, distribuído sob a licença MIT.",
	},
	{
		q: "Funciona no meu Mac?",
		a: "Funciona em Macs com chip Apple (M1 ou mais recente) rodando macOS 13 Ventura ou superior. Macs com processador Intel ainda não são suportados.",
	},
	{
		q: "O que preciso para conversar com o Claude?",
		a: "Uma conta no Claude. Nas preferências do plugin, o próprio Ptolemy instala a ferramenta de linha de comando do Claude e abre a tela de login para você. Quem usa AWS também pode conectar um perfil do Bedrock.",
	},
	{
		q: "Posso esconder as ferramentas que não uso?",
		a: "Sim. Nas preferências você ativa, desativa e reordena os plugins. Quem não programa pode simplesmente desligar o GitHub.",
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
		alt: "Paleta do Ptolemy aberta sobre a área de trabalho, mostrando as cinco abas de plugins",
		caption: "Um atalho abre a paleta por cima de qualquer app",
		plugin: "Geral",
	},
	{
		src: "busca-apps.png",
		alt: "Aba Apps mostrando o resultado para a busca 'Safari'",
		caption: "Apps: qualquer aplicativo do Mac a poucas letras de distância",
		plugin: "Apps",
	},
	{
		src: "calculadora.png",
		alt: "Aba Calculadora com a expressão 245 * 3 + 17 e o resultado 752 destacado em verde",
		caption: "Calculadora: o resultado aparece enquanto você digita",
		plugin: "Calc",
	},
	{
		src: "busca-github.png",
		alt: "Aba GitHub buscando repositórios com a query 'bun', listando oven-sh/bun, uptrace/bun e outros",
		caption: "GitHub: busca de repositórios, código e issues para quem programa",
		plugin: "GitHub",
	},
] as const;
