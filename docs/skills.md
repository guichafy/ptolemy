# Skills, extensões e MCP no Claude e Codex

Selecione **Claude** ou **Codex** na paleta. O composer prepara modelo e recursos antes de criar a conversa. **Enter** inicia; **Shift+Enter** insere uma linha. O modelo vale para a sessão, sem mudar o padrão do agente. As sessões recentes continuam abaixo do composer.

**Tab/Shift+Tab** percorre controles; **←/→** troca a aba de plugin focada; **Home/End** alcança os extremos da barra. **Ctrl+Tab/Ctrl+Shift+Tab** troca de plugin. **↑/↓** navega resultados/opções; no texto do composer continua editando a mensagem. Seletores abertos mantêm foco e teclas nas opções. Digite `/` para descobrir comandos selecionados; setas, Enter ou Tab inserem o comando, Escape fecha a lista.

## Seleção da conversa

O botão **Configurar** mantém o Composer compacto. Seu resumo informa quantas Skills, Plugins e MCP estão ativos, sem listar todos os nomes. Abra **Configurar conversa** ou uma categoria do resumo para editar em um modal com busca e uma única área de rolagem. **Cancelar** descarta o rascunho; **Aplicar** confirma a seleção. As listas, detalhes e editores são os mesmos das Preferências.

**Skills** reúne Skills internas classificadas pelo CLI, locais, importadas e de pacotes. **Plugins** reúne comandos internos e componentes dos pacotes; **MCP** reúne servidores independentes e os componentes MCP de plugins. Origem, revisão e motivos de indisponibilidade permanecem visíveis. Selecionar uma Skill ou um MCP de pacote não seleciona os componentes irmãos. Componentes incompatíveis ou sem configuração não são apresentados como ativos.

**Usar seleção como padrão** salva as escolhas para futuras conversas daquele agente; Claude e Codex são independentes. Os quatro conjuntos são independentes: Skills locais/importadas, componentes de pacotes, nomes de builtins e servidores MCP independentes. Esvaziar todos significa nenhum desses recursos gerenciados. Esvaziar apenas componentes de pacotes não desliga os outros conjuntos. A UI envia sempre os quatro arrays efetivos, inclusive vazios.

Se o CLI estiver ausente ou o inventário falhar, Configurar ainda permite abrir e importar Skills. O erro continua visível; a seleção, o salvamento de padrões e a criação da conversa aguardam validação completa. Use a ação de tentar novamente depois de corrigir o runtime.

Uma conversa nova congela IDs, revisões e configurações MCP selecionadas. Mudar padrões ou editar uma instalação não reescreve a sessão. Remover uma instalação tira o pacote da biblioteca selecionável; seu arquivo histórico permanece para retomar conversas existentes. O mesmo botão na janela de chat permite editar uma conversa existente entre mensagens. Aplicar reconstrói o runtime ocioso, preservando identidade, projeto e histórico. A seleção antiga permanece se a preparação falhar; alterações concorrentes ou durante geração são recusadas. Desligar uma Skill não apaga instruções já lidas do histórico. Arquivos materializados alterados no projeto bloqueiam a substituição, preservando o trabalho do usuário. Sessões antigas com campos ausentes preservam seu comportamento legado, inclusive herança nativa quando aplicável; ausência não é tratada como seleção vazia nem reconstruída a partir dos padrões atuais.

## Biblioteca e marketplace

Abra **Preferências → Plugins do aplicativo → Claude Code ou Codex**. Cada agente oferece **Geral**, **Skills**, **Plugins** e **MCP**. Skills e Plugins têm biblioteca e marketplace próprios; MCP tem servidores configurados e descoberta de componentes MCP nos catálogos GitHub existentes.

- **Skills**: locais/integradas/importadas, Skills de pacotes, busca, padrões e importação do GitHub. O marketplace prioriza `anthropics/skills`.
- **Plugins**: instalação, componentes, compatibilidade, padrões e autorização dos hooks da revisão exata. Plugins nativos exportáveis podem ser importados como snapshots, sem instalação global.
- **MCP**: servidores stdio/HTTP, credenciais, OAuth e seleção por agente/conversa. Autenticar uma conta não ativa automaticamente o servidor.

Os marketplaces reutilizam as fontes públicas `anthropics/skills`, `anthropics/claude-plugins-official`, `openai/plugins` e repositórios/pastas GitHub adicionais. Itens sem metadados completos são inspecionados antes de confirmar os componentes disponíveis naquela página. Um pacote misto pode ser descoberto em mais de uma categoria, mantendo uma instalação compartilhada. Remover uma fonte preserva instalações. Instalar não executa código nem ativa todos os componentes. skills.sh mantém descoberta externa, com importação/instalação por URL GitHub.

Instalação, remoção e conexão OAuth são ações da biblioteca compartilhada. Cancelar o rascunho da conversa não desfaz essas ações. **Usar seleção como padrão** altera novas conversas apenas do agente escolhido; a aplicação na conversa não muda os padrões.

Pacotes preservam manifests, scripts, assets e caminhos relativos. Declarações nativas de ambos os agentes são mantidas; o adaptador escolhe a variante efetiva e informa incompatibilidades por componente. Apps/conectores proprietários sem endpoint utilizável, LSP e output styles não viram suporte fictício: o detalhe mostra instalação parcial e os componentes portáveis continuam selecionáveis. Colisões de nomes ativos são rejeitadas antes da conversa. Atualizar exige instalar/revisar a nova revisão; confiança de hooks não é transferida.

Downloads GitHub públicos são fixados em commit e verificados antes da publicação atômica do índice; conteúdo raw imutável evita baixar cada arquivo pela cota de blobs da API. Árvores truncadas, links simbólicos, submódulos, escapes e conflitos de caminhos são rejeitados. Limites de extensão: 2.048 arquivos, 8 MiB por arquivo, 32 MiB por pacote, manifest de 1 MiB; catálogo de 8 MiB; histórico de até 512 revisões e índice de 256 MiB. Repositórios privados não são suportados. Inspeção/instalação não executa hooks ou instaladores.

## Importação manual de Skills

Em **Skills**, cole uma URL pública GitHub e use **Importar Skill**:

- Raiz com `SKILL.md`: `https://github.com/autor/minha-skill`.
- Pasta: `https://github.com/autor/repo/tree/main/minha-skill`.
- Arquivo: `https://github.com/autor/repo/blob/main/minha-skill/SKILL.md`.

A nova Skill fica selecionada no rascunho atual; aplique a seleção à conversa ou salve como padrão explicitamente. O formato portátil segue Agent Skills: frontmatter YAML com `name` e `description`; nome igual à pasta, até 64 caracteres, minúsculas, números e hífens simples; descrição de 1 a 1024 caracteres.

```markdown
---
name: minha-skill
description: Revisar alterações quando uma revisão for solicitada.
---

Leia references/guia.md antes de revisar.
```

Campos opcionais: `license`, `compatibility` (até 500 caracteres), `metadata` de textos e `allowed-tools`. A importação portátil rejeita aliases YAML e extensões específicas de harness, como `hooks`; plugins completos usam a página Plugins do agente. Grants de ferramenta não ampliam permissões do Ptolemy. Scripts, referências e assets são preservados. Limites deste importador: 128 arquivos, 1 MiB/arquivo, 5 MiB no total e `SKILL.md` de 256 KiB.

## MCP e OAuth

Escolha **stdio** para comando + array JSON de argumentos + variáveis; **HTTP** para URL + headers e OAuth opcional. A URL deve ser HTTPS; HTTP é aceito somente em loopback. Campos inválidos permanecem no rascunho e mostram erro; **Salvar** é explícito. Credenciais existentes são mascaradas: preservar, substituir por um valor (inclusive vazio) e remover são operações distintas. Valores sensíveis ficam no Keychain; o renderer recebe apenas IDs e indicadores seguros, nunca valores ou referências do cofre.

Salve antes de conectar. **Conectar** abre o navegador e mostra conectando/aguardando, conectado, expirado, cancelado ou erro. **Cancelar** encerra a tentativa; **Desconectar** remove credenciais OAuth locais e tenta revogação quando o provedor a oferece. Discovery, PKCE, state, callback loopback e refresh são controlados pelo Ptolemy, compartilhados pelos dois agentes. Para registro prévio, consulte/copie a URI de retorno exata do emissor antes de preencher client ID; configure segredo do cliente no campo protegido, quando necessário. Servidores stdio e HTTP sem OAuth podem ser selecionados sem teste de conexão. Para OAuth, uma credencial ausente, desconectada ou expirada sem refresh exige conectar novamente e não entra na contagem de recursos utilizáveis; a criação e os padrões são validados também no backend. Uma credencial renovável permanece disponível, e cancelar ou falhar numa nova tentativa não invalida uma autorização anterior ainda utilizável. A prontidão é consultada localmente, sem sondar endpoints; ela não comprova conexão. A validação offline usa provedores locais; não comprova compatibilidade com todas as contas/provedores reais.

MCP de pacote é configurado no mesmo editor, mas habilitado pelo componente daquela revisão, sem se tornar uma escolha independente que contorne o desligamento do pacote. Pode-se habilitar somente esse componente. Sessões existentes conservam sua definição congelada; disponibilidade de credenciais referenciadas continua necessária.

O gateway local autentica cada rota e fornece somente os servidores selecionados. Tokens remotos não entram em argv, mensagens ou JSON público de sessão; o CLI recebe uma credencial local efêmera pelo ambiente. No **Codex**, ferramentas dos servidores selecionados podem executar sem confirmação por chamada; o sandbox de arquivos da conversa permanece. No **Claude**, continua o permission gate de ferramentas. Falhas de transporte encerram a conexão com erro sanitizado; uma nova conexão pode reabrir a rota. Não há promessa de replay ou retomada transparente da chamada interrompida. Erros normais de ferramenta MCP não fecham a ponte.

O arquivo stdio antigo `~/.ptolomeu/mcp-servers.json` é reconciliado com o registro v2, conferido por digest e referências do cofre e removido apenas após finalização segura. Não há mais escritor v1 na UI/RPC. Se a migração falhar, os bytes legados são preservados e a interface oferece nova tentativa após corrigir acesso ao cofre ou nomes duplicados.

## Execução e limites por runtime

As integrações foram verificadas com Claude Code 2.1.118 / Agent SDK 0.2.118 e Codex CLI/SDK 0.166.0. Isso registra versões testadas; não implica detecção automática de toda mudança futura.

- Claude recebe somente Skills locais selecionadas em plugin isolado, sem configurações/hooks globais herdados. Builtins são inventariados pelo CLI sem chamada de modelo. Desabilitar alguns bloqueia execução, mas pode manter descrições no contexto; desligar todos também suprime a oferta de slash commands. O campo bruto `init.skills` pode continuar desatualizado.
- Codex mantém descoberta nativa com overrides por execução, desabilita cópias originais e materializa as selecionadas na árvore gerenciada `.agents/skills`. Comandos exclusivos da TUI não são comandos de `exec`. Perfis `--profile` não são expostos. Plugins obrigatórios ou políticas/fontes de hook que não possam ser inventariadas/desabilitadas geram diagnóstico explícito.
- Hooks executáveis exigem autorização para o digest da revisão. Eventos, matchers, ordem, JSON de entrada, contexto adicional, bloqueio e prazos são preservados quando há equivalência. Matchers de ferramenta incompatíveis entre harnesses, eventos/campos desconhecidos e handlers assíncronos recebem motivo específico. `allow` nunca eleva autorização; `ask`/entrada substituída são negados quando a semântica não pode ser preservada.
- Hooks de prompt Claude usam o runtime nativo, como único handler selecionado do evento para preservar ordem; handlers de hook do tipo agent não têm um boundary por ferramenta verificado e ficam incompatíveis. Isso é distinto dos agentes de plugin, que delegam nativamente quando modelo/ferramentas têm equivalente. Codex 0.166.0 não suporta handlers de hook prompt/agent; `SessionEnd` tem limite nativo de três segundos e prazo padrão de um segundo.
- Comandos `/pacote:comando` preservam argumentos posicionais/nomeados e expansão dinâmica. Hooks de shell e expansão dinâmica usam executor restrito, limite de saída e encerramento do grupo de processos em timeout/cancelamento/troca de sessão. Respeitam sandbox read-only quando escolhido. Código autorizado ainda pode ler arquivos e usar rede; a garantia é confinamento de escrita e remoção de segredos do ambiente, sem isolamento geral de leitura/rede.

Skills/espelho de assets ficam no projeto. Código executável de hooks/comandos e ROOT dos processos MCP usa snapshot backend protegido, gerado dos bytes arquivados validados, fora da raiz gravável do agente. Nesses contextos `PLUGIN_ROOT`/`CLAUDE_PLUGIN_ROOT` apontam para essa raiz; `PLUGIN_DATA`/`CLAUDE_PLUGIN_DATA` e cwd ficam na conversa. Hooks/comandos executados não podem escrever na raiz do pacote: use DATA. Os dois aliases DATA também são resolvidos no texto autoral estático dos comandos e nas instruções de agentes; argumentos do usuário e saída dinâmica permanecem literais. A cópia de Skill pode referenciar assets no espelho do projeto; isso não torna código mutável um novo hook autorizado. O jail Claude, permission gate e sandbox Codex continuam ativos, sem `danger-full-access`.

## Persistência e arquitetura

Skills/padrões portáteis ficam em `~/.ptolomeu/skills/index.json` e snapshots por sessão em `sessions/<id>/skills.json`. A biblioteca completa e revisões históricas ficam em `~/.ptolomeu/extensions/index.json`; snapshots executáveis em `extensions/execution/<sessão>/…`; MCP em `mcp-registry.json`; dados OAuth e segredos ficam no Keychain. Dados/projetos preservam o identificador histórico `ptolomeu`; testes isolam tudo por `PTOLEMY_HOME`.

Os padrões são pré-validados em conjunto e persistidos em três stores existentes; não há transação atômica entre os três arquivos. Uma falha de IO posterior é informada e pode exigir nova tentativa. Nenhuma configuração global de CLI é reescrita. Veja [decisões de arquitetura](architecture/agent-extension-decisions.md) para inventário nativo e o custo das escolhas e [testes de integração](testing/integration-tests.md) para evidência offline e seus limites.

## Aparência do sistema

As duas janelas acompanham o tema claro/escuro do macOS, inclusive mudanças com o aplicativo aberto. A paleta usa material AppKit nativo: Liquid Glass no macOS 26+ e vibrancy em versões anteriores, com fallback opaco quando a redução de transparência estiver ativa. Tipografia de sistema, contraste e redução de movimento são respeitados. O chat mantém superfícies legíveis para texto e código. O material do desktop deve ser conferido numa janela macOS real; screenshots do Chromium validam somente a interface web.
