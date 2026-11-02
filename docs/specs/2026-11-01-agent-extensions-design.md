# Skills, marketplaces e MCP no Ptolemy

Status: aprovado pelo usuário em 2026-11-01; implementação autorizada em branch com PR para main e GitHub Actions aprovados.

## Intenção

Permitir que a pessoa veja e controle as Skills disponíveis, descubra novas
extensões em catálogos e use MCP com Claude e Codex. A biblioteca pertence ao
Ptolemy; cada harness recebe uma adaptação das capacidades que efetivamente suporta.
Uma extensão instalada não deve aparecer como utilizável quando seus componentes
ou sua autenticação não funcionarem no agente escolhido.

## Diagnóstico confirmado

- `skill-picker.tsx` mostra Skills locais como texto e seleciona somente importadas.
- `agent-composer.tsx` exclui Skills do harness ao carregar a seleção padrão.
- `skills/store.ts` adiciona todas as Skills locais compatíveis ao Claude,
  independentemente da seleção; Codex usa a descoberta nativa do CLI.
- A importação GitHub atual já resolve commits, valida caminhos e limites e salva
  snapshots por sessão. Essa base deve ser aproveitada.
- `claude/mcp-loader.ts` e `settings/mcp-servers.tsx` aceitam apenas stdio.
  O runtime Codex não recebe esse registro.
- O SDK Codex instalado aceita configuração por execução; o SDK Claude aceita
  MCP HTTP e configuração estrita. Não é necessário escrever nas configurações
  globais dos CLIs para fornecer os servidores gerenciados pelo Ptolemy.

## Decisões do usuário

1. Habilitação por conversa e padrões salvos no Ptolemy, sem alterar os CLIs externos.
2. Reaproveitar todos os recursos dos plugins Claude/Codex, inclusive hooks,
   comandos e agentes. Excluir somente componentes com incompatibilidade explícita.
3. Incluir MCP com OAuth pelo navegador nesta entrega.
4. GitHub é a alternativa autorizada caso a integração skills.sh não seja viável.

## Escolhas propostas de implementação

- Biblioteca compartilhada de pacotes completos, com adaptadores por harness e
  diagnóstico por componente. Evitar converter plugins em um mero saco de Skills.
- GitHub como marketplace inicial; skills.sh como descoberta externa. A API pública
  documentada exige OIDC Vercel e não se encaixa diretamente em um app desktop local.
- Estilo atual React/shadcn e textos em pt-BR. Seletor compacto na conversa;
  gerenciamento e descoberta em Preferências → Extensões.
- OAuth pertence ao Ptolemy: conectar uma vez permite usar o mesmo servidor nos dois
  agentes. Não depender de copiar credenciais internas de um CLI para o outro.

## Experiência

### Skills da conversa

Exibir seções **Built-in / do agente** e **Adicionadas**, ambas com controles reais
de habilitar/desabilitar, nome, descrição e origem. Diferenciar um pacote interno
distribuído pelo CLI de uma Skill que o usuário instalou globalmente quando houver
evidência dessa origem; não chamar toda Skill descoberta de built-in.

A lista mostra as Skills compatíveis do agente escolhido e as importadas na
biblioteca compartilhada. Skills indisponíveis mostram o motivo e não oferecem um
controle que aparente funcionar. O contador e os chips refletem a seleção efetiva.
Uma seleção explicitamente vazia significa nenhuma Skill gerenciada habilitada.
**Usar seleção como padrão** inclui Skills locais e importadas.

A seleção é preparada antes de criar a conversa, como hoje. Retomar preserva a
seleção salva; mudar os padrões não reescreve conversas anteriores. Alterar Skills
de uma conversa já em andamento não está implícito nesta primeira proposta.

### Biblioteca e marketplace

Uma seção compartilhada **Extensões** contém **Instaladas**, **Marketplace** e **MCP**.
O detalhe de um plugin permite controlar seus componentes e configurar dependências.
O seletor da conversa tem um acesso para gerenciar a biblioteca. Os plugins de busca
da paleta continuam identificados separadamente; não são pacotes do marketplace.

Fontes iniciais:

- `anthropics/skills`, incluindo a pasta `skills` fornecida pelo usuário;
- `anthropics/claude-plugins-official`;
- `openai/plugins`.

Permitir adicionar e remover fontes públicas GitHub por URL de repositório ou pasta,
buscar localmente nos resultados, atualizar o catálogo e examinar um item antes de
instalar. O detalhe mostra origem, commit, Skills, MCP, hooks, comandos, agentes e diagnósticos de compatibilidade.
Instalar baixa o pacote; habilitar torna seus componentes configurados disponíveis.
Hooks executáveis têm ativação explícita vinculada à revisão exibida, preservando
o fluxo de confiança do runtime. Não executar hooks durante download/inspeção.
Skills importadas manualmente continuam disponíveis. Remover uma fonte não remove
pacotes instalados; remover uma instalação não destrói snapshots de conversas.

### MCP

Cadastro compartilhado com nome, transporte, comando/argumentos ou URL,
variáveis/headers e habilitação padrão por agente. Usar arrays/mapas estruturados
ou JSON validado em vez de quebrar argumentos por espaços. Formulários têm salvar
explícito, estado de erro e preservação de rascunhos inválidos.

O composer permite escolher os servidores para a nova conversa. A lista indica
**Precisa configurar**, **Desabilitado**, **Disponível** ou incompatibilidade.
Disponível significa configurado; não significa conexão testada. Credenciais
sensíveis ficam no Keychain, com referências no catálogo e na sessão. A configuração
legada stdio é migrada sem descartar argumentos ou variáveis.

Uma seleção vazia não pode reativar silenciosamente servidores globais do CLI.
MCP deve ser aplicado ao Claude e Codex com a mesma seleção explícita. Autenticação
de um CLI não deve ser anunciada como compartilhada com o outro sem implementação.

## Arquitetura

### Modelo compartilhado e adaptadores

Separar fonte de catálogo, pacote instalado, componente e seleção da sessão.
Um pacote tem identidade estável de origem + caminho, revisão imutável, metadados,
Skills, MCP, hooks, comandos, agentes e recursos auxiliares; não usar apenas o nome visível como identidade global.
Duplicatas de nome de Skill na seleção ativa são rejeitadas com erro identificável.
Não sobrescrever silenciosamente instalações de outra fonte.

Adaptadores GitHub reconhecem:

- árvore de diretórios contendo `SKILL.md`;
- `.claude-plugin/marketplace.json` e manifests dos plugins correspondentes;
- `.agents/plugins/marketplace.json` e manifests Codex correspondentes.

Resolver caminhos relativos à origem correta e refs/commits declarados. Fontes
externas GitHub podem ser resolvidas; formatos externos desconhecidos aparecem como
incompatíveis. `skills` explícito no manifest restringe os componentes daquele
pacote: não importar a árvore inteira por conveniência. Inspecionar `.mcp.json`
e os caminhos MCP declarados, além de `plugin.json`/`mcp.json` portáveis.
Preservar scripts, assets e estrutura relativa do pacote completo.

O catálogo não executa `npx skills`, instaladores, hooks ou comandos remotos
durante descoberta ou instalação. Execução pertence à sessão e aos seus adaptadores.
Fetches passam pelo proxy do app, com timeout, limites, erro de rate limit e
rejeição de árvores truncadas. A instalação é transacional: download/validação
antes de publicar o registro. Falhas não deixam componentes parcialmente instalados.
Manter os limites atuais das Skills; limites dos manifests e pacotes são definidos
no plano. Conteúdo remoto é dado, nunca instrução para o processo de instalação.

### Ativação por harness

Claude: materializar somente Skills selecionadas no plugin isolado existente;
preservar o permission gate e impedir que grants declarados em Skills ampliem
permissões. Hooks selecionados são adaptados e ativados explicitamente, em vez
de serem descartados como na implementação atual. Fornecer apenas MCP
selecionado e usar configuração estrita para evitar herança global acidental.

Codex: fornecer overrides por execução para Skills, plugins, hooks e MCP.
Usar o controle documentado `skills.config` com caminhos de `SKILL.md`; não editar
`$CODEX_HOME/config.toml`. Inventariar as fontes locais e plugins herdados, materializar snapshots das Skills
selecionadas e desativar as cópias originais por execução, evitando redescoberta.
Assim, atualizar ou apagar uma Skill global não muda uma sessão já criada. Inspecionar
as fontes herdadas de MCP e desabilitá-las por execução quando não selecionadas.
Fontes impostas por política administrativa que o CLI não permite desabilitar
aparecem como gerenciadas externamente, com motivo explícito e sem toggle enganoso.
A matriz de capacidade considera a versão real do CLI; não prometer suporte apenas
porque uma documentação mais nova descreve o recurso.

Preservar o diretório da conversa, workspace jail, sandbox Codex, PATH de login,
proxy e credenciais existentes. Não usar `danger-full-access` nem trocar HOME.

### Pacotes completos, hooks e recursos específicos

Materializar um snapshot do pacote dentro do projeto da conversa, preservando
caminhos relativos. Resolver `CLAUDE_PLUGIN_ROOT`/`PLUGIN_ROOT` para essa cópia e
`CLAUDE_PLUGIN_DATA`/`PLUGIN_DATA` para dados da extensão naquela conversa. Rejeitar
referências que escapem do pacote. Não reescrever scripts arbitrários para fingir
compatibilidade; adaptar apenas os contratos conhecidos de entrada e saída.

Manter um registro de capacidades por componente, evento, tipo de handler e versão:
**nativo**, **adaptado**, **requer configuração**, **incompatível**. Incompatível deve
indicar o campo/evento/dependência concreto, e não apenas a origem Claude ou Codex.

- Skills: materialização compatível e seleção individual, inclusive as internas
  descobertas e pacotes globais importados para a biblioteca.
- Hooks: preservar eventos, matchers, ordem, timeout, entrada JSON e saídas que
  bloqueiam ações ou acrescentam contexto. Usar execução nativa quando equivalente;
  adaptar eventos comuns quando for possível preservar a semântica. Hooks de
  `PreToolUse` precisam executar antes da ferramenta, nunca como observação tardia
  do JSONL. Uma resposta de hook não pode contornar o workspace jail ou elevar o
  sandbox. Scripts locais executam com restrição de escrita ao projeto; se o
  runtime nativo não a garantir, usar um executor restrito do Ptolemy. Não ativar
  um caminho de execução sem validar essa propriedade.
- Comandos: preservar comandos de prompt, argumentos e nomes do plugin. A UI do
  chat/composer oferece os comandos instalados. Não converter automaticamente um
  comando de shell ou expansão dinâmica em texto de prompt. Execução dinâmica
  segue o mesmo executor restrito e timeout dos hooks.
- Agentes/subagentes: preservar instruções, modelo e ferramentas quando o destino
  disponibiliza configuração equivalente. Opções sem equivalente são identificadas
  no diagnóstico; não alegar delegação real quando só se anexou uma persona ao prompt.
- Apps/conectores proprietários, LSP, output styles e outros campos: reconhecer e
  preservar o manifest; reutilizar se houver recurso no runtime. Identificadores de
  um catálogo SaaS sem endpoint MCP ou API pública utilizável constituem uma
  incompatibilidade explícita. Componentes portáveis do mesmo pacote continuam
  utilizáveis com diagnóstico de instalação parcial visível.

Conflitos de nomes ativos são apresentados antes da sessão. Atualizações de pacotes
não são automáticas: nova revisão é validada e não altera snapshots existentes.
Hooks alterados requerem nova ativação da revisão. Desabilitar um plugin desabilita
seus componentes; selecionar uma Skill isolada não deve ativar hooks irmãos.

### OAuth e transporte MCP compartilhado

Adicionar dependência direta do SDK oficial MCP (já transitivo no repositório) e
usar seu cliente OAuth, em vez de implementar o protocolo manualmente. O serviço
Ptolemy controla discovery, registro dinâmico ou client ID pré-registrado, PKCE,
state, callback loopback, expiração, refresh serializado e desconexão. Callbacks
são correlacionados com a tentativa e servidor corretos; cancelamento e timeout
fecham o listener. Usar o fetch com proxy do app. Metadados remotos e redirects são
validados; HTTPS remoto, HTTP somente para loopback explicitamente configurado.

O botão **Conectar** inicia o navegador; a interface mostra aguardando, conectado,
expirado, falha e desconectar. Um servidor que exige registro prévio permite
configurar client ID e segredo no Keychain. Login cancelado não marca conexão como
concluída. Escopos/issuer/recurso fazem parte da identidade da conexão, evitando
reutilizar um token de outro servidor. Revogar no provedor quando disponível e
apagar credenciais locais ao desconectar.

Para compartilhar autenticação e refresh inclusive durante uma sessão Claude
longa, usar um gateway MCP local do Ptolemy para servidores HTTP autenticados.
Cada sessão recebe uma rota restrita aos servidores selecionados, com credencial
local efêmera; o gateway injeta tokens remotos em memória. Não é um proxy HTTP
aberto: endpoints e capacidades vêm do registro validado, não de URLs fornecidas
pelo agente. Vincular ao loopback, verificar credencial/origem e encerrar rotas no
fim da sessão. Preservar tools, resources, prompts, notificações e erros do MCP.

No Codex, passar o nome da variável da credencial local em `bearer_token_env_var`,
e o valor somente no ambiente do subprocesso. Para stdio, usar referências a
variáveis de ambiente suportadas pelo CLI ou um launcher controlado que injete o
mapa necessário sem passar valores por argv. Aplicar a mesma regra ao Claude: o SDK instalado serializa `mcpServers` em
`--mcp-config`, portanto não inserir segredos diretamente em headers/env dessa
opção. Preferir referências de ambiente cuja expansão tenha sido verificada no
CLI; caso contrário, usar um launcher stdio controlado que lê o ambiente e se
conecta ao gateway. Segredos remotos não entram em `CodexOptions.config`, pois
esse objeto vira argumentos `--config`. O launcher usa um caminho de execução
suportado pelo bundle Electrobun e é verificado também fora do ambiente Bun de dev. A conta Keychain usa identificadores estáveis do
Ptolemy, nunca nome de plugin sem namespace.

### Persistência e migração

Evoluir o índice existente com migração explícita; manter os identificadores
históricos `~/.ptolomeu` e serviços Keychain. Defaults incluem seleções nativas;
sessões novas salvam seleção completa e snapshot dos componentes de arquivo.
MCP salva a configuração selecionada e referências de segredo, sem copiar tokens
para mensagens, logs, JSON de sessão ou parâmetros de linha de comando.

Sessões antigas sem seleção completa mantêm o comportamento legado documentado.
As novas precisam distinguir ausência de seleção de lista vazia. Não inferir a
seleção antiga usando os padrões atuais. Todos os três schemas RPC permanecem iguais.

## Emenda aprovada: raiz executável protegida

A exigência de confiança vinculada à revisão prevalece sobre a formulação anterior
que colocava toda execução na cópia gravável do projeto. Skills e o espelho completo
continuam dentro do workspace. Hooks executáveis, expansões dinâmicas de comandos
e referências ROOT de processos MCP usam bytes validados do arquivo histórico em
`~/.ptolomeu/extensions/execution/<sessão>/…`, fora da raiz gravável do agente.
Nesses contextos, `PLUGIN_ROOT`/`CLAUDE_PLUGIN_ROOT` apontam para o snapshot protegido;
`PLUGIN_DATA`/`CLAUDE_PLUGIN_DATA` e o cwd continuam na conversa. A execução não pode
modificar esse snapshot. Scripts que escrevem junto ao próprio pacote devem usar
PLUGIN_DATA; não há reescrita arbitrária do código para simular compatibilidade.
A emenda não amplia o sandbox e impede que alterações ou links no espelho gravável
substituam código já autorizado. As decisões e custos estão registrados em
[decisões de arquitetura](../architecture/agent-extension-decisions.md).

## Verificação necessária

- Toggle de Skill local e importada muda o conjunto realmente disponível ao agente;
  seleção vazia, defaults por agente, chips e retomada são cobertos.
- Fixtures de catálogos reais Anthropic/OpenAI: fontes relativas/externas, paths
  explícitos, refs com barra, nomes duplicados e componentes incompatíveis.
- Instalação parcial, timeout, rate limit, traversal, symlink, pacote excessivo,
  referências fora do pacote e árvore truncada não corrompem o catálogo.
- OAuth com servidor local de teste: login via navegador, PKCE/state inválidos,
  cancelamento, timeout, refresh, revogação e retomada. Gateway impede acesso a
  servidor não selecionado e mantém tools/resources/prompts.
- Hooks comuns nos dois CLIs reais: contexto, bloqueio antes de efeito, timeout,
  falha, disable, revisão alterada e escrita fora do workspace rejeitada.
- Comandos com argumentos e agentes preservam semântica ou exibem diagnóstico
  preciso; fixtures incluem apps sem endpoint e recursos auxiliares relativos.
- MCP stdio e HTTP em ambos os adaptadores; desabilitado não aparece no runtime;
  valores com espaços e headers são preservados; segredos não vazam.
- Migração do registro MCP legado e snapshots antigos; conversas permanecem
  independentes dos padrões e da remoção de uma fonte/instalação.
- Integração offline com CLIs reais para seleção e uma chamada MCP em cada agente,
  mais UI com teclado e erros de salvamento. Typecheck, Biome e builds dos renderers.
- README e README.pt-BR com os mesmos fatos; atualizar docs/skills.md e AGENTS.md.

## Fontes consultadas

- https://github.com/anthropics/skills/blob/main/.claude-plugin/marketplace.json
- https://github.com/anthropics/claude-plugins-official/blob/main/.claude-plugin/marketplace.json
- https://github.com/openai/plugins/blob/main/.agents/plugins/marketplace.json
- https://github.com/openai/skills/blob/main/README.md (indica openai/plugins)
- https://www.skills.sh/docs/api (API autenticada por Vercel OIDC)
- https://learn.chatgpt.com/docs/build-skills (skills.config)
- https://learn.chatgpt.com/docs/extend/mcp?surface=cli (MCP e overrides)
- Tipos dos SDKs instalados no repositório.

- https://developers.openai.com/plugins/build/plugins (plugins portáveis e hooks)
- https://learn.chatgpt.com/docs/hooks (eventos, contratos e confiança)
- https://code.claude.com/docs/en/hooks (contratos Claude)
- https://modelcontextprotocol.io/specification/latest/basic/authorization

## Ordem de entrega proposta

1. Inventário e controle efetivo de Skills, seleção e snapshots.
2. Biblioteca de pacotes e catálogos GitHub Anthropic/OpenAI/customizados.
3. MCP compartilhado, gateway e OAuth, seleção e migração da configuração existente.
4. Ativação de plugins completos: hooks, comandos, agentes e matriz de compatibilidade.
5. Fluxos de UI integrados, integração offline com CLIs, build e documentação.

Cada etapa deixa testes de comportamento verificáveis. A entrega solicitada só
estará concluída após todas as etapas; uma UI de catálogo sem ativação efetiva não
satisfaz este desenho. O plano detalhado deve começar provando as capacidades e o
isolamento dos CLIs instalados, antes de assumir equivalência de hooks/plugins.
