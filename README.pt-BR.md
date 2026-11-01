# Ptolemy

Suas ferramentas do dia, orbitando você. Um command center para a barra de menus do macOS, feito para engenheiros de software.

Ptolemy é um app de menu bar para macOS construído com [Electrobun](https://electrobun.dev/) (runtime Bun) e React. Ele abre uma command palette global (`⌘+Shift+Space`) extensível por plugins: cada plugin é um provider que adiciona uma nova capacidade. Vem com 6 plugins integrados, incluindo uma janela de chat com o Claude Code e o Codex da OpenAI.

> Antes chamado **Ptolomeu**. Os releases até a v0.10.x foram publicados com esse nome; configurações, sessões e itens do Keychain já existentes continuam funcionando após a renomeação.

🇺🇸 [Read in English](README.md)

## Instalação

Requisitos: macOS 13+ em Apple Silicon (arm64).

1. Baixe o `.zip` mais recente em [GitHub Releases](https://github.com/guichafy/ptolemy/releases) ou no [site do projeto](https://guichafy.github.io/ptolemy/).
2. Descompacte e arraste o app para `/Applications`. Na primeira execução, autorize em Ajustes do Sistema → Privacidade e Segurança.
3. Aperte `⌘+Shift+Space`. O ícone fica na barra de menus (não há ícone no Dock).

O plugin do Claude também precisa do Claude Code CLI (`claude`) instalado e autenticado (as configurações do plugin podem instalá-lo e abrir o login), ou de um perfil AWS Bedrock configurado ali. O plugin do Codex (desligado por padrão, ative em **Configurações → Plugins**) precisa do Codex CLI (`codex`) instalado e autenticado com o ChatGPT ou uma API key; as configurações dele também podem instalá-lo e abrir o login.

## Início rápido (desenvolvimento)

```bash
# Pré-requisitos: macOS (arm64), Bun, Xcode Command Line Tools
bun install
bun run dev:hmr
```

## Plugins integrados

| Plugin | Descrição |
|--------|-----------|
| **Apps** | Abrir aplicativos do macOS direto da palette. |
| **GitHub** | Buscar repositórios, código, issues e usuários. Filtros customizados, builder de qualifiers, repos de times. |
| **Calculadora** | Avaliar expressões matemáticas inline. |
| **Busca Web** | Atalho para Google, DuckDuckGo, Stack Overflow e YouTube. |
| **Claude Code** | Conversar com o Claude em uma janela dedicada: respostas em streaming, sessões persistentes, seletor de modelo, aprovação de ferramentas e servidores MCP. Cada conversa roda em um workspace isolado. |
| **Codex** | Conversar com o Codex da OpenAI na mesma janela de chat, via Codex SDK e o seu Codex CLI: sessões persistentes, seletor de modelo e de esforço de raciocínio, comandos, alterações de arquivos e plano ao vivo. Roda no sandbox do Codex, restrito ao workspace da conversa. Opcional. |

## Skills dos agentes

Claude e Codex usam um composer AI Elements para escolher o modelo e preparar Skills antes da primeira mensagem. O seletor é o mesmo da janela de conversa e vale desde o primeiro turno, sem alterar o modelo padrão do agente. Mantenha os padrões do harness, importe Skills adicionais de um repositório público do GitHub, selecione-as para uma conversa e salve padrões separados por agente. A importação valida o formato Agent Skills e os arquivos de apoio, fixa um commit e mantém os arquivos no workspace de cada conversa. Enter inicia a conversa; Shift+Enter insere uma linha. A configuração de MCP continua nas preferências existentes. Tab/Shift+Tab percorre os controles; ←/→ muda a aba de plugin em foco; ↑/↓ navega nos resultados e opções; Ctrl+Tab/Ctrl+Shift+Tab troca de plugin a partir dos controles da paleta. Consulte o [guia de Skills](docs/skills.md) para URLs aceitas, limites de validação e persistência.

## Sistema de plugins

Todo plugin implementa a interface `SearchProvider`:

```typescript
interface SearchProvider {
  id: string;
  label: string;
  icon: IconComponent;
  placeholder: string;
  search(query: string, signal?: AbortSignal, context?: unknown): Promise<SearchResult[]>;
  useSearchContext?: () => unknown;   // contexto reativo opcional
  configComponent?: ComponentType;    // UI de configuração opcional
}
```

Resultados retornados por `search()`:

```typescript
interface SearchResult {
  id: string;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  badge?: string;
  onSelect: () => void;
}
```

### Criando um plugin

```typescript
// src/mainview/providers/npm-provider.ts
import { Package } from "lucide-react";
import type { SearchProvider } from "./types";

export const npmProvider: SearchProvider = {
  id: "npm",
  label: "npm",
  icon: Package,
  placeholder: "Buscar pacotes npm...",

  async search(query) {
    if (!query) return [];
    const res = await fetch(
      `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=10`
    );
    const data = await res.json();
    return data.objects.map((obj: any) => ({
      id: obj.package.name,
      title: obj.package.name,
      subtitle: obj.package.description,
      badge: obj.package.version,
      onSelect: () => window.open(`https://npmjs.com/package/${obj.package.name}`),
    }));
  },
};
```

Registre em `src/mainview/providers/registry.ts`:

```typescript
import { npmProvider } from "./npm-provider";

export const PLUGIN_REGISTRY: Record<string, SearchProvider> = {
  // ... plugins existentes
  npm: npmProvider,
};

export const PLUGIN_META: PluginMeta[] = [
  // ... entradas existentes
  { id: "npm", label: "npm", description: "Buscar pacotes npm", icon: Package },
];
```

Labels e descrições da UI ficam em português (pt-BR), como no resto do app.

### Ideias de plugins

Procurando inspiração? Alguns plugins que a comunidade pode construir:

- **Jira / Linear**: issues, boards, status de sprint
- **Slack**: canais, mensagens, pessoas
- **AWS Console**: serviços, recursos, CloudWatch
- **Docker**: containers, imagens, compose stacks
- **npm / PyPI**: busca em registry de pacotes
- **Homebrew**: formulae, casks
- **Kubernetes**: pods, deployments, services
- **CI/CD**: status de runs do GitHub Actions, CircleCI
- **Bookmarks**: busca em favoritos do navegador
- **Notas**: Apple Notes, vault do Obsidian

Não viu sua ferramenta? Construa um plugin e abra um PR.

## Arquitetura

| Processo / view | Caminho | Papel |
|-----------------|---------|-------|
| **Main (Bun)** | `src/bun/` | System tray, janelas, FFI nativo, atalho global, gerente de sessões dos agentes (Claude e Codex), fetch com proxy. |
| **Renderer da palette** | `src/mainview/` | App React da command palette em uma BrowserWindow oculta, alternada por `⌘+Shift+Space`. |
| **Renderer do chat** | `src/chatview/` | App React separado para a janela de chat dos agentes (Claude ou Codex), criada na primeira abertura. |

```
                       ┌───────────────────┐
                  RPC  │  Palette (React)  │
              ┌──────► │  cmdk, plugins    │
┌──────────────┐       └───────────────────┘
│  Main (Bun)   │
│  tray, FFI,   │       ┌───────────────────┐
│  Claude/Codex │  RPC  │  Chat (React)     │
│  proxy, RPC   ├─────► │  AI Elements      │
└──────────────┘       └───────────────────┘
```

Cada janela tem sua própria instância RPC do Electrobun (um transporte por janela), mas compartilha o mesmo conjunto de handlers. Veja o [AGENTS.md](AGENTS.md) para a arquitetura detalhada, a referência de RPC e as convenções. Ele também é o arquivo de instruções para agentes de IA que trabalham neste repositório.

## Desenvolvimento

**Dev com HMR (recomendado)**

```bash
bun run dev:hmr            # Vite (mainview + chatview) + Electrobun, todos em watch
```

**Build**

```bash
bun run build:native       # Compila Objective-C → liboverlay.dylib
bun run build:vite         # Build do mainview (dist/) e do chatview (dist-chat/)
bun run build:dev-bundle   # Bundle .app de dev (necessário para E2E)
bun run build:canary       # Build de produção (canal canary)
bun run build:release      # Build de produção (canal stable)
```

**Testes**

```bash
bun run test               # Vitest: projetos node + jsdom
bun run test:watch         # Vitest em modo watch
bun run test:coverage      # Relatório de cobertura (HTML em ./coverage/)
bun run test:e2e           # E2E (Appium Mac2; precisa do dev bundle)
bun run test:integration   # Integração Claude + Codex, contra mocks locais das APIs (offline)
bun run test:integration:live  # O mesmo, contra os serviços reais (usa os CLIs logados)
bun run screenshots        # Build do dev bundle + E2E + regenera docs/screenshots/
bun run screenshots:chat   # E2E do chat (Claude + Codex contra mocks locais) + regenera site/public/screenshots/chat-*.png
```

A suíte E2E controla o app real do macOS via Appium Mac2 e grava screenshots PNG em `docs/screenshots/`. Tanto o job `e2e` da CI quanto o script `screenshots` geram o dev bundle com `electrobun build --env=dev` antes de rodar.

O Vitest roda dois projetos lado a lado:

- `node`: módulos de backend (`src/bun/**`, `src/chatview/lib/**`, `src/chatview/hooks/**`)
- `jsdom`: UI React (`src/mainview/**`, `src/chatview/components/**`, `src/lib/**`)

Os testes de integração dos agentes (`test/integration/`) rodam uma conversa por agente pelo session manager real: criar um arquivo, rodar um comando e conferir que o agente lembra da conversa, inclusive depois de trocar de agente. O `test:integration` usa os SDKs reais e os CLIs que vêm com eles, conversando com mocks locais das APIs da Anthropic e da OpenAI, então não precisa de rede nem de login e roda na CI. O `test:integration:live` roda o mesmo cenário com os CLIs `claude` e `codex` instalados e logados na sua máquina (`claude /login`, `codex login`); um agente ausente ou deslogado é pulado com aviso. Para rodar só um agente ou escolher modelos, use `PTOLEMY_IT_AGENTS=claude` (ou `codex`), `PTOLEMY_IT_CLAUDE_MODEL=sonnet` ou `PTOLEMY_IT_CODEX_MODEL=gpt-6-luna`, na linha de comando ou num arquivo `.env.test.local` (ignorado pelo git e lido pelo `bun test`). Suas configurações e sessões do Ptolemy nunca são tocadas: os testes usam uma pasta de dados temporária. Guia completo: [docs/testing/integration-tests.md](docs/testing/integration-tests.md).

O `screenshots:chat` (`test/e2e-chat/`) roda o mesmo cenário pela interface real do chat: os handlers RPC do Bun, o session manager, os SDKs e os CLIs que vêm com eles são reais (contra os mocks locais), e o chat é compilado pelo Vite e controlado pelo Playwright no Chromium, com um WebSocket no lugar do RPC do Electrobun. Ele confere os cartões de ferramentas, o modelo exibido, o indicador e o detalhamento do contexto, e grava as capturas usadas no site. Roda em qualquer sistema; instale o navegador uma vez com `bunx playwright install chromium`.

**Lint e tipos**

```bash
bun run lint               # Biome check
bun run lint:fix           # Biome auto-fix
bun run typecheck          # tsc --noEmit
```

**Git hooks (lefthook)**

O lefthook é instalado automaticamente via `bun install` (o script `prepare` executa `lefthook install`). Cada commit roda o Biome nos arquivos staged e o Vitest nos testes afetados pela mudança. Para pular uma vez: `LEFTHOOK=0 git commit …`.

**Landing page**

O site do projeto fica em `site/` (Astro). Rode com `bun run dev:site`; o deploy no GitHub Pages é feito por `.github/workflows/site.yml`, que roda depois do workflow Release e é o único que publica no `gh-pages` (site, mirror da release e `latest.json` num só commit; depois espera o Pages servir esse commit). Para publicar de novo, rode o workflow Site; não repita execuções antigas de "pages build and deployment".

## Releases

Os releases são automatizados com semantic-release na `main`, a partir dos Conventional Commits. Cada release publica `ptolemy-<versão>-macos-arm64.zip` no GitHub Releases, espelha o arquivo no GitHub Pages e atualiza o [`CHANGELOG.md`](CHANGELOG.md).

## Contribuindo

### Reportar bugs

Abra uma issue com passos para reproduzir. Inclua sua versão do macOS, a versão do Bun e os passos.

### Sugerir um plugin

Abra uma issue com a tag `plugin-idea`. Descreva a ferramenta ou serviço e quais buscas ele permitiria.

### Construir um plugin

1. Implemente a interface `SearchProvider` (veja [Sistema de plugins](#sistema-de-plugins) acima)
2. Adicione seu provider ao `PLUGIN_REGISTRY` em `src/mainview/providers/registry.ts`
3. Adicione uma entrada `PluginMeta` com ícone, label e descrição
4. Abra um PR

### Padrões de código

- **Linter/formatter:** Biome; rode `bun run lint:fix` antes de commitar
- **Commits:** Conventional Commits (`feat(scope):`, `fix(scope):`)
- **Labels da UI:** português (pt-BR), por exemplo "Abrir", "Sair", "Buscar"
- **Gerenciador de pacotes:** apenas Bun (`bun install`, `bun run`)
- **Path alias:** `@/*` mapeia para `src/*`

### Processo de PR

1. Faça fork do repo
2. Crie uma branch (`feat/meu-plugin`)
3. Rode `bun run lint:fix && bun run typecheck && bun run test`
4. Abra um PR descrevendo as mudanças

## Licença

Apache 2.0, veja [LICENSE](LICENSE) para detalhes.

---

> O nome vem de Cláudio Ptolomeu (Claudius Ptolemy), que colocou a Terra no centro do cosmos. O Ptolemy coloca você no centro do seu workflow.
