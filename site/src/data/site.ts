export const SITE = {
	name: "Ptolemy",
	tagline: "Seu dia a dia a um atalho de distância",
	description:
		"Um app leve que mora na barra de menu do Mac. Abra aplicativos, faça contas, pesquise na web e converse com o Claude ou o Codex sem tirar as mãos do teclado.",
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
	icon: "apps" | "github" | "calc" | "web" | "claude" | "codex";
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
			"Abra uma conversa com o Claude numa janela própria para resumir um texto, revisar um e-mail ou tirar uma dúvida. Você vê o modelo em uso, quanto do contexto já foi ocupado e o custo da conversa. As conversas ficam salvas para você retomar depois.",
		example: "Nova conversa → janela de chat",
		icon: "claude",
	},
	{
		id: "codex",
		name: "Codex",
		tagline: "O agente da OpenAI na mesma janela",
		description:
			"Prefere o Codex? Ative o plugin e converse com ele na mesma janela de chat, com os mesmos recursos. Cada conversa trabalha numa pasta própria, isolada do resto do Mac.",
		example: "Nova conversa → Codex",
		icon: "codex",
		audience: "Opcional",
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
		body: "Além do básico, um plugin de busca no GitHub com filtros salvos e uma janela de agentes (Claude Code ou Codex) com sessões isoladas, MCP servers, suporte a Bedrock e o detalhamento da janela de contexto.",
		examples: ["Buscar repositórios", "Sessões do Claude Code e do Codex"],
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
		a: "Não. Basta baixar, arrastar para a pasta Aplicativos e apertar ⌘ + Shift + Space. Apps, Calculadora, Busca Web e Claude funcionam para qualquer pessoa; os plugins do GitHub e do Codex são opcionais.",
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
		q: "Posso usar o Codex em vez do Claude?",
		a: "Pode. Ative o plugin Codex nas preferências; o Ptolemy usa o Codex CLI já instalado e o login dele (conta do ChatGPT ou chave de API). A janela de chat é a mesma, e cada conversa trabalha numa pasta própria, sem acesso ao resto do Mac.",
	},
	{
		q: "Como sei quanto do contexto já foi usado e quanto a conversa custou?",
		a: "O indicador no topo do chat mostra a porcentagem da janela de contexto ocupada. Passe o mouse para ver o custo do último turno, o custo total da conversa e quantas compactações já aconteceram; clique para ver o que ocupa o contexto (prompt do sistema, ferramentas, arquivos de memória, mensagens). O Codex não informa custo, então para ele o detalhamento é uma estimativa.",
	},
	{
		q: "Posso esconder as ferramentas que não uso?",
		a: "Sim. Nas preferências você ativa, desativa e reordena os plugins. Quem não programa pode simplesmente desligar o GitHub.",
	},
] as const;

export type ChatFeature = {
	title: string;
	body: string;
};

/** What the agent chat shows, for the "Chat" section of the landing page. */
export const CHAT_FEATURES: readonly ChatFeature[] = [
	{
		title: "Claude Code ou Codex",
		body: "Escolha o agente em cada conversa. Os dois usam a mesma janela e as conversas ficam salvas para retomar depois.",
	},
	{
		title: "O modelo que está rodando",
		body: "O seletor mostra o modelo real por trás do padrão, como Claude Opus 4.5 ou GPT-6 Astra, e cada resposta diz qual modelo a escreveu e quanto tempo levou.",
	},
	{
		title: "Janela de contexto à vista",
		body: "Um indicador mostra quanto do contexto já foi usado. Um clique abre o detalhamento: prompt do sistema, ferramentas, MCP, arquivos de memória e mensagens.",
	},
	{
		title: "Custo e compactações",
		body: "Custo do último turno e da conversa inteira, além de quantas vezes o agente precisou compactar o histórico.",
	},
	{
		title: "Cada passo do agente",
		body: "Comandos, arquivos editados, buscas na web e o plano do agente aparecem como cartões que você abre para ver os detalhes.",
	},
	{
		title: "Seguro por padrão",
		body: "Cada conversa trabalha numa pasta própria. Ações arriscadas do Claude pedem sua aprovação antes de rodar.",
	},
] as const;

export type ChatShot = {
	src: string;
	alt: string;
	caption: string;
};

/** Generated by `bun run screenshots:chat` (test/e2e-chat). */
export const CHAT_SCREENSHOTS: readonly ChatShot[] = [
	{
		src: "chat-claude.png",
		alt: "Chat do Ptolemy com o Claude Code: o agente cria um arquivo, roda cat no terminal e responde; abaixo de cada resposta aparecem o modelo, o tempo e o custo",
		caption: "Claude Code: cartões para cada ferramenta, modelo, tempo e custo por resposta",
	},
	{
		src: "chat-codex.png",
		alt: "Chat do Ptolemy com o Codex: o agente aplica um patch, roda cat no terminal e responde; o seletor mostra GPT-6.1 Sol como modelo padrão",
		caption: "Codex: a mesma janela, com o modelo configurado no Codex CLI",
	},
	{
		src: "chat-claude-contexto.png",
		alt: "Painel Janela de contexto: custo total da conversa, compactações, o uso da janela de contexto e as categorias Ferramentas do sistema, Skills e Mensagens",
		caption: "O que ocupa o contexto, custo total da conversa e compactações",
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
