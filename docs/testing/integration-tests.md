# Testes de integração dos agentes (Claude e Codex)

**Atualizado em:** 2026-11-01
**Código:** `test/integration/`

Este guia explica o que a suíte de integração cobre, como rodar nos modos local e real, como configurar e como estender. Para a arquitetura dos agentes em si, veja as seções *Claude integration* e *Codex integration* do [AGENTS.md](../../AGENTS.md).

## O que é testado

A suíte conduz uma conversa por agente pelo **session manager real** (`src/bun/claude/session-manager.ts`), o mesmo módulo que a camada de RPC chama quando a interface cria ou retoma uma sessão. Nada nesse caminho é simulado: os SDKs, os CLIs, a persistência e o mapeamento de eventos são os de produção. O único ponto trocado no modo local é o servidor do modelo.

O cenário é o mesmo para os dois agentes:

| Etapa | O que a suíte confere |
|---|---|
| 1. Criar a sessão | Entrada no índice com o agente certo, pasta de projeto criada e nenhum evento antes de o chat retomar (deferred start) |
| 2. Turno 1 | O agente cria um arquivo e roda `cat` nele. Chegam `tool-call`, `tool-result`, texto e `finish` sem erro, e o arquivo existe na pasta da conversa com o conteúdo pedido |
| 3. Persistência | `messages.json` tem a mensagem do usuário e a resposta com blocos de ferramenta e texto, e o ID da conversa do agente (`sdkSessionId`) foi gravado |
| 4. Turno 2 | Perguntado sobre o nome do arquivo, o agente responde certo, na mesma sessão e com o mesmo ID |
| 5. Troca de agente | Abre uma sessão do outro agente (o ativo é derrubado), volta para a primeira com retomada a frio e o agente ainda lembra o conteúdo do arquivo. No Claude, confere também que o modelo da sessão não mudou |
| 6. Exclusão | Apagar as sessões remove a pasta do projeto e não deixa sessão ativa |

São 6 testes por agente, 12 no total. As permissões de ferramenta do Claude (HITL) são aprovadas automaticamente pelo teste, como se o usuário clicasse em "Permitir".

## Os dois modos

| | Local (padrão) | Real |
|---|---|---|
| Comando | `bun run test:integration` | `bun run test:integration:live` |
| Modelo | Servidores falsos locais | Os serviços reais da Anthropic e da OpenAI |
| CLIs | Os binários que vêm com cada SDK, em `node_modules` | O `claude` e o `codex` instalados na máquina |
| Login | Nenhum (chave falsa) | O login que já existe na máquina |
| Rede | Só loopback (`127.0.0.1`) | Internet |
| Asserções | Exatas (nomes das ferramentas, arquivos, respostas) | Flexíveis onde o modelo varia (qualquer ferramenta serve), rígidas onde importa (conteúdo do arquivo e memória entre turnos) |
| Duração típica | ~10 s | De segundos a poucos minutos, conforme os modelos |
| Custo | Zero | Centavos por execução (com `haiku` no Claude, menos de US$ 0,02) |
| CI | Roda em todo PR (`build-and-test`, macOS) | Não roda |

## Rodando no modo local

```bash
bun install
bun run test:integration
```

Não precisa de nada além do `bun install`: o `@anthropic-ai/claude-agent-sdk` traz o binário do Claude Code para a plataforma (`@anthropic-ai/claude-agent-sdk-<plataforma>-<arch>`) e o `@openai/codex-sdk` depende do `@openai/codex`, que traz o binário do Codex.

## Rodando com os servidores reais

Pré-requisitos, uma única vez:

```bash
claude /login        # ou já estar logado no Claude Code
codex login          # ChatGPT ou API key
codex login status   # deve dizer "Logged in ..."
```

Depois:

```bash
bun run test:integration:live
```

Na saída aparecem o modo e a pasta temporária usada, e um aviso para cada agente pulado:

```
[integration] codex pulado (live): Codex CLI sem login (rode `codex login`)
[integration] modo=live dados=/var/folders/.../ptolemy-it-AbC123
```

Um agente é pulado quando o CLI não é encontrado ou, no caso do Codex, quando `codex login status` não indica login. Os testes do outro agente rodam normalmente. O teste de troca de agente só roda quando os dois estão disponíveis.

No modo real, os CLIs usam a configuração normal do usuário (`~/.claude`, `~/.codex`), a começar pelo login. As conversas criadas pelo teste também ficam no histórico próprio de cada CLI (por exemplo, `~/.codex/sessions`), como aconteceria usando o app.

## Configuração

Todas as opções são variáveis de ambiente. Dá para passá-las na linha de comando ou num arquivo `.env.test.local` na raiz do repositório. Esse arquivo já é ignorado pelo git e o `bun test` o carrega sozinho.

> O `bun test` **não** lê o `.env.local`, só o `.env.test` e o `.env.test.local`.

| Variável | Modo | Padrão | Para que serve |
|---|---|---|---|
| `PTOLEMY_IT_MODE` | ambos | `local` | `live` liga o modo real. Os scripts já definem isso |
| `PTOLEMY_IT_AGENTS` | ambos | `claude,codex` | Roda só alguns agentes, por exemplo `codex` |
| `PTOLEMY_IT_CLAUDE_MODEL` | real | `haiku` | Modelo do Claude. Use um apelido (`haiku`, `sonnet`, `opus`), veja [Problema conhecido](#problema-conhecido-modelo-do-claude-na-retomada) |
| `PTOLEMY_IT_CODEX_MODEL` | real | modelo do CLI | Modelo do Codex, por exemplo `gpt-6-luna`. Sem a variável, vale o configurado no `~/.codex/config.toml` |
| `PTOLEMY_CLAUDE_PATH` | ambos | detecção normal | Força um binário do Claude Code. O app também respeita essa variável |
| `PTOLEMY_CODEX_PATH` | ambos | detecção normal | Força um binário do Codex. O app também respeita essa variável |

Exemplos:

```bash
# Só o Codex, com o modelo mais econômico
PTOLEMY_IT_AGENTS=codex PTOLEMY_IT_CODEX_MODEL=gpt-6-luna bun run test:integration:live

# Configuração fixa da sua máquina
cat > .env.test.local <<'ENV'
PTOLEMY_IT_CLAUDE_MODEL=sonnet
PTOLEMY_IT_CODEX_MODEL=gpt-6-luna
ENV
bun run test:integration:live
```

## Isolamento: o que o teste toca na sua máquina

- **Dados do Ptolemy:** nunca são tocados. A suíte define `PTOLEMY_HOME` com uma pasta temporária, apagada no fim. O app passa a gravar ali as configurações (`Library/Application Support/com.ptolomeu.app/settings.json`), as sessões, os projetos, as decisões de ferramenta e os MCP servers, em vez de `~/.ptolomeu` e `~/Library` (veja `src/bun/paths.ts`).
- **`$HOME`:** não é alterado, para que os CLIs encontrem o login no modo real.
- **Modo local:** a configuração dos CLIs também fica isolada na pasta temporária (`CLAUDE_CONFIG_DIR` e `CODEX_HOME`), e as variáveis `ANTHROPIC_*` e `CLAUDE_CODE_*` do ambiente são removidas, para que nada desvie o Claude Code para outro servidor.
- **Rodando dentro do Claude Code:** se a suíte rodar numa sessão do próprio Claude Code (um agente trabalhando no repositório, por exemplo), o CLI filho herdaria o ID dessa sessão e retomaria a transcrição errada. A suíte remove `CLAUDE_CODE_SESSION_ID` e `CLAUDE_CODE_REMOTE_SESSION_ID` nos dois modos.

## Como funcionam os servidores falsos

Arquivos em `test/integration/helpers/`:

- **`scenario.ts`:** os prompts do cenário e um "modelo" mínimo que decide o próximo passo. Os mesmos prompts vão para os modelos reais e para os falsos.
- **`mock-anthropic-server.ts`:** imita `POST /v1/messages` da API da Anthropic, com streaming (SSE). O Claude Code chega nele via `ANTHROPIC_BASE_URL`, autenticado com uma `ANTHROPIC_API_KEY` falsa. Responde com `tool_use` de `Write` (caminho absoluto, lido do "Primary working directory" do prompt de sistema), depois `Bash` com `cat` e por fim o texto.
- **`mock-responses-server.ts`:** imita `POST /v1/responses` da API da OpenAI, com streaming (SSE). O Codex chega nele por um provedor próprio no `config.toml` do `CODEX_HOME` temporário (`supports_websockets = false` e sem novas tentativas, para falhar rápido). O Codex 0.166 executa ferramentas em "code mode": uma única chamada da ferramenta `exec`, com JavaScript que chama `tools.apply_patch` para criar o arquivo e `tools.exec_command` para rodar o `cat`. O CLI transforma isso nos itens `file_change` e `command_execution`, que o app mostra como `ApplyPatch` e `Shell`.

Os dois servidores também informam o uso de tokens na escala das APIs reais (cerca de 4 caracteres por token do que foi enviado) e simulam o cache de prompt: a parte do prompt que já tinha ido na requisição anterior da mesma conversa volta como leitura de cache. O servidor da Anthropic responde ainda `POST /v1/messages/count_tokens`, que o Claude Code usa para dividir o contexto por categoria (o painel "Janela de contexto" do chat). Assim o indicador de contexto, o custo e o detalhamento recebem números plausíveis nos testes.

Ponto central do desenho: **os servidores falsos não guardam estado da conversa.** Para responder às perguntas de memória, leem o histórico que o CLI reenvia a cada requisição. Se a retomada quebrar e o histórico não voltar, o servidor falso responde "não sei" e o teste falha, mesmo no modo local. Isso foi verificado quebrando de propósito a retomada do Claude (`resume` sem o ID) e a do Codex (thread novo a cada turno): nos dois casos, o teste de memória falhou.

## Screenshots do chat (E2E)

`bun run screenshots:chat` (`test/e2e-chat/`) roda o mesmo cenário pela interface real do chat e grava as capturas usadas no site (`site/public/screenshots/chat-*.png`):

- **Tudo abaixo da interface é real:** os handlers RPC do Bun (`src/bun/rpc.ts`), o session manager, os SDKs e os CLIs que vêm com eles, conversando com os servidores falsos acima (`helpers/local-agents.ts`). Sem rede e sem login.
- **A interface é o app do chat de verdade** (`src/chatview`), compilado pelo Vite e aberto no Chromium pelo Playwright. A única troca é o transporte: o RPC do Electrobun vira um WebSocket para um servidor ponte dentro do teste (`web/ws-rpc.ts`). O módulo `electrobun/bun` é substituído por um que repassa as mensagens para esse WebSocket, porque o runtime do Electrobun só carrega dentro do app.
- **O que o teste confere:** os cartões das ferramentas de cada agente, a resposta do segundo turno (memória), o seletor mostrando o modelo real e não o apelido, o indicador de contexto, o painel de detalhamento carregado e nenhum erro no console da página.

Variáveis: `PTOLEMY_SCREENSHOTS_DIR` muda a pasta de saída; `PTOLEMY_E2E_SKIP_BUILD=1` reaproveita o último build da interface. Na primeira vez, instale o navegador do Playwright com `bunx playwright install chromium`.

Diferente do `bun run screenshots` (Appium no app do macOS), este roda em qualquer sistema e não precisa do dev bundle. A renderização é do Chromium, não do WebKit do macOS, então fontes e bordas podem variar um pouco em relação ao app.

## CI

O job `build-and-test` do `.github/workflows/ci.yml` roda `bun run test:integration` no `macos-latest`, depois dos testes unitários. Isso cobre os dois agentes com os binários de macOS e o sandbox nativo do Codex no Mac. O modo real não roda no CI, porque precisaria de login e custaria a cada PR.

## Solução de problemas

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `codex pulado (live): Codex CLI sem login` | `codex login status` não indica login | `codex login` e rode de novo |
| `codex pulado: Codex CLI não instalado` | O `codex` não está no `PATH` do shell de login nem nos caminhos comuns | Instale (`npm install -g @openai/codex`) ou defina `PTOLEMY_CODEX_PATH` |
| Timeout no turno do Codex, com erros `Reconnecting... n/5` | O CLI não alcança a OpenAI (rede, proxy ou firewall) | Confira a rede ou o proxy. Esses avisos de reconexão não aparecem no chat, só a causa final |
| Timeout no turno do Claude | CLI deslogado, sem rede ou modelo indisponível | Rode `claude -p "oi"` no terminal para ver o erro direto |
| Erro de modelo no modo real | O modelo pedido não existe no seu plano | Ajuste `PTOLEMY_IT_CLAUDE_MODEL` ou `PTOLEMY_IT_CODEX_MODEL` |
| No modo local, erros de conexão com `127.0.0.1` | Um proxy HTTP está interceptando o loopback | A suíte já acrescenta `127.0.0.1` e `localhost` ao `NO_PROXY`. Confira se o seu proxy respeita essa variável |
| Retomada a frio do Claude com modelo `default` | Problema conhecido abaixo | Use um apelido de modelo |

Os logs do app (`[claude:session]`, `[codex:turn]`, `[claude:stream] result ... cost=...`) saem no console durante a execução e ajudam a ver o custo e onde cada turno parou.

## Problema conhecido: modelo do Claude na retomada

Na retomada a frio de uma sessão do Claude, o session manager confere o modelo da sessão contra a lista do SDK, que só traz apelidos (`default`, `sonnet`, `fable`, `opus`, `haiku`). Um ID completo, como `claude-sonnet-4-6`, que é o padrão de instalação do app, não está nessa lista e é trocado em silêncio por `default`. A suíte usa apelidos para não depender disso, e o teste de retomada confere que o modelo continua o mesmo. O problema já existia antes do Codex e deve ser corrigido à parte.

## Estendendo a suíte

- **Novo passo no cenário:** acrescente o prompt em `scenario.ts`, ensine `nextMockStep` a responder e traduza a resposta em cada servidor falso (bloco da API da Anthropic e item da Responses API). Depois escreva a asserção em `agents.test.ts`, separando o que é exato no modo local do que é flexível no real.
- **Nova ferramenta do Codex:** veja os nomes e assinaturas que o CLI anuncia rodando o `codex exec` contra um servidor que só registra as requisições. A lista fica no primeiro item `additional_tools` do campo `input`.
- **Novo agente:** o cenário é parametrizado por agente (`scenario(agent, other)`). Basta um servidor falso para a API dele e as entradas em `OK_REASON` e `LOCAL_TOOLS`.
