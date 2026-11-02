# Decisões da integração de extensões

Registro durável das decisões tomadas durante a implementação aprovada em 2026-11-01. A [especificação](../specs/2026-11-01-agent-extensions-design.md) descreve a intenção; este documento descreve a implementação final e o custo de cada escolha. Os módulos citados são relativos à raiz do repositório. Provas locais usam diretórios descartáveis e serviços loopback; não representam validação de todas as contas/provedores reais.

## 1. Arquivos imutáveis por raw, metadados pela API

A inspeção de catálogos completos consumia a cota anônima de 60 chamadas/hora ao buscar um blob pela API para cada arquivo. `extensions/github.ts` resolve refs/árvore pela API, baixa conteúdo raw no commit imutável, verifica tamanho/hash Git e limita concorrência, tempo, quantidade e bytes. `catalog.ts` preserva declarações de ambos os manifests e proveniência, inclusive variantes supersedidas; `activation.ts` só ativa a variante efetiva do harness.

Custo se a estratégia estiver errada: um ref mutável ou verificação incompleta poderia instalar bytes diferentes dos inspecionados; por isso o commit, hash e revisão final fazem parte da identidade. A API ainda pode limitar metadados; raw não elimina toda cota. Os três catálogos padrão foram percorridos/inspecionados/instalados em uma validação pública descartável; testes offline cobrem fixtures e corrupção sem depender desse serviço.

## 2. Migração em etapas, com reconciliação no corte final

O registro v2 MCP e cofre foram introduzidos antes do runtime/UI novos, preservando leitura legada durante as etapas de desenvolvimento. O estado final usa `mcp/cutover.ts`: uma promessa compartilhada executa reconciliação de mudanças tardias e finalização antes da UI, criação e retomada. A remoção do arquivo v1 exige digest e referências válidas do cofre, inclusive proveniência da migração. Falhas preservam os bytes legados e permitem nova tentativa. Os handlers e formulário que escreviam plaintext v1 foram retirados; o loader antigo só permanece em fixtures/testes históricos.

Custo se o corte estiver errado: credenciais/argumentos recentes poderiam desaparecer ou os dois escritores divergir. Por isso um marcador histórico de migração sozinho não basta para apagar a origem. A pré-validação de padrões entre Skills/extensões/MCP também não é uma transação entre seus três arquivos: uma falha de IO posterior pode exigir repetir o salvamento.

## 3. Ausência legada e vazio explícito são contratos diferentes

Campos ausentes nas sessões antigas continuam com a semântica legada; não se infere uma seleção antiga pelos padrões atuais. Sessões novas congelam os quatro conjuntos e os snapshots necessários. `[]` significa nenhum recurso daquele conjunto; não é fallback para o CLI. `extensions/store.ts` remove a instalação selecionável sem apagar revisões arquivadas necessárias para retomar. `skills/store.ts` separa IDs de padrões persistidos da disponibilidade descoberta; atualizar inventário não deve sobrescrever escolhas não salvas.

Custo se a distinção for perdida: uma pessoa que desligou um recurso poderia executá-lo por herança, ou a retomada mudaria após atualizar/remover uma instalação. O custo intencional é manter dados históricos e mostrar sessões legadas como tais.

## 4. Aprovação Codex limitada aos servidores MCP selecionados

O SDK usa `approvalPolicy: never`; manter o modo padrão de ferramentas MCP bloqueava a chamada real dos servidores selecionados. `mcp/runtime.ts` fornece `default_tools_approval_mode=approve` somente nas tabelas selecionadas e desabilita fontes herdadas quando há seleção explícita. A UI informa que essas ferramentas podem executar sem confirmação por chamada. O sandbox de arquivos permanece `workspace-write` ou `read-only`; `danger-full-access` não é exposto. A ausência legada não recebe uma aprovação global nova.

Custo se a aprovação vazar: ferramentas não selecionadas poderiam executar. A prova usa chamadas reais dos dois CLIs, seleção vazia com turno bem-sucedido e contador de todos os contatos herdados, inclusive GET de discovery. Essa política não cria um permission gate por chamada no Codex.

## 5. Inventário nativo sem contato de rede

`codex mcp list --json` pode consultar autenticação HTTP ao listar; portanto inventário não é presumido passivo. O processo de inventário relevante roda sob política que nega rede, sem thread/modelo. Claude usa `/clear` em configuração descartável, hooks desabilitados e customização estrita para obter `supportedCommands()` e classificar Skills pelo `init`. Codex usa `plugin list --json` para instalações reais, não diretórios de cache; hooks selecionados usam `app-server initialize` + `hooks/list`, sem `thread/start`.

Custo se fontes não forem observadas: um hook/plugin herdado poderia continuar ativo apesar do toggle. Fontes desconhecidas, erros/avisos de listagem, hooks gerenciados ativos e plugins obrigatórios não desabilitáveis falham com motivo explícito. Com nenhum hook selecionado, `features.hooks=false` desliga o recurso inteiro e evita exigir inventário de hooks para Skills/comandos/MCP independentes. Não há seletor `--profile`; o inventário não promete cobrir perfis que o app não aplica.

## 6. Rotas e nomes MCP pertencem ao Ptolemy

Tabelas TOML Codex mesclam campos herdados de mesmo nome. O runtime usa alias estável com hash do ID do registro + nome sanitizado, rejeitando colisão herdada desse alias, para impedir mescla de transporte/aprovação. O gateway usa rotas por sessão/servidor, token local efêmero e definições validadas; não aceita destinos arbitrários enviados pelo agente. Segredos remotos ficam no backend/cofre. O launcher stdio e as expansões de ambiente verificadas evitam serializar segredos em argv dos SDKs.

Custo se identidade/isolamento falhar: configuração de outro servidor, token ou ambiente poderia ser reutilizado. Os testes verificam identidade HTTP/OAuth, mesmo nome de variável em processos stdio separados, limpeza de processos e ausência de segredos nos argumentos/configurações públicas. O bundle usa seu próprio Bun e launchers imutáveis, sem fallback para arquivos do workspace ou Bun externo.

## 7. Falha de transporte fecha a conexão; nova inicialização é explícita

O SDK MCP não fornece metadados suficientes em `onerror` para distinguir com segurança cada falha recuperável/fatal ou associá-la a um request. `mcp/gateway.ts` liquida pendências com erro sanitizado e fecha aquela ponte; o CLI pode inicializar uma nova conexão na rota. Resultados normais de erro MCP preservam a ponte. Foi removido o timeout universal de 15 segundos que encerrava ferramentas/SSE legítimos; testes incluem ferramentas/streams de 16 segundos, notificações tardias, idle e disposal.

Custo assumido: perde-se a retomada transparente após um erro de transporte relatado. A alternativa sem metadados podia deixar chamadas penduradas ou repetir efeitos. Não se promete replay de chamada interrompida.

## 8. Snapshot protegido para código autorizado por revisão

Um único espelho gravável no projeto permitia alterar scripts depois de autorizar o digest. `extensions/activation.ts` agora regenera o snapshot executável dos bytes arquivados validados em `~/.ptolomeu/extensions/execution/<sessão>/…`, fora da raiz gravável do agente; Skills/espelho continuam no projeto. Hooks e expansões dinâmicas usam essa raiz em ROOT; processos MCP também resolvem seus tokens ROOT para ela. Cwd e DATA continuam na conversa. Launcher/policy são recursos do app, não arquivos do projeto.

O executor de hooks/comandos usa sandbox-exec, escrita limitada ao workspace (ou nenhuma no modo read-only), ambiente filtrado com PATH de login/proxy vivo, limite de saída e cancelamento do grupo de processos no exit/close. Hash, matchers, ordem, prazo e resultado não viram um bypass de autorização. Uma substituição por symlink no espelho não altera o código autorizado. O sandbox Codex não recebe grants automáticos de `/tmp` que tornariam um backend temporário gravável.

Custo assumido: scripts de hooks/comandos que escrevem junto ao pacote precisam usar PLUGIN_DATA, sem reescrita arbitrária para acomodá-los. Código deliberadamente autorizado pode ler entradas mutáveis e usar rede; não há prova estática de dependências arbitrárias nem isolamento geral de leitura/rede. O confinamento do executor não é uma promessa de sandbox adicional para todo servidor MCP externo.

## 9. Exceção exata para leitura nativa de installation_id

Experimentos tentaram reconstruir hooks com parser TOML/JSON local após falha do app-server em modo somente leitura. O dump `--print-startup-config` continha requisitos, sem todas as camadas; o parser e uma restrição ampla por tipo de conta foram abandonados. **Eles não são a estratégia entregue.** A fonte final é o inventário nativo `hooks/list`.

Codex 0.166.0 abre o `installation_id` existente com read/write/create para ler. `extensions/codex-hook-inventory.ts` exige arquivo canônico existente, sem symlink, UUID válido e modo 0644; permite somente a operação `file-write-data` nesse arquivo exato, além do scratch descartável para sqlite/log/TMPDIR. Não permite chmod, unlink ou escrita geral no CODEX_HOME. Falta/invalidade falha antes do CLI; produção não cria/repara ID. Após inventário, bytes, inode, mtime, ctime e modo devem permanecer iguais. HOME/CODEX_HOME efetivos são preservados, config/auth ficam somente leitura e rede permanece negada. Unix sockets para IPC local não são liberação de TCP.

Custo se o comportamento do CLI mudar: uma abertura antes passiva poderia tentar alterar o ID. A validação de versão/fonte, restrição de operação e verificações posteriores detectam esse risco; não são licença para mutar configurações globais. Fixtures reais comprovaram ID intacto e operações de metadados/remoção negadas. Instalações com ID ausente/incompatível recebem diagnóstico, em vez de reparo silencioso.

## 10. MCP de pacote não é uma segunda escolha independente

O ID de binding inclui pacote, componente e revisão. `extensions/ui-service.ts` e o session manager rejeitam qualquer binding com `packageId` em escolhas/defaults de MCP independente, inclusive HTTP sem tokens ROOT/DATA. O editor preserva a proveniência; a ativação ocorre pelo componente selecionado, com irmãos independentes. A configuração é congelada na sessão; alterar o binding atual não altera a retomada já criada.

Custo assumido: MCP fornecido pelo pacote exige o fluxo do componente, não duas caixas concorrentes. Se isso estivesse errado, desligar o pacote poderia deixar seu MCP ativo por uma segunda seleção. Um servidor realmente independente possui seu próprio cadastro.

## Evidência e manutenção

[Testes de integração](../testing/integration-tests.md) distingue unitários com HTTP real, CLIs contra mocks locais, UI com RPC fake, chat com backend real e launchers no bundle. O teste `extension-snapshot.test.ts` liga catálogo HTTP local, instalação completa, seleção parcial, comando dinâmico, MCP de pacote e retomada após remoção da instalação/alteração do binding/troca de agente. O histórico arquivado permanece; não há novo download na retomada. Não se deve substituir esses limites por alegações de validação com provedores reais ou atualizar a semântica de inventário só com documentação de um CLI mais novo.
