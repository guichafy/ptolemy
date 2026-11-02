# Configuração por agente, recursos da conversa e Liquid Glass

Status: aprovado pelo usuário em 2026-11-01.

## Intenção

Corrigir os problemas encontrados no teste da v0.16.0: organização centralizada
em “Extensões”, Composer ocupado por etiquetas das Skills e seletores com scroll
aninhado. Aproximar a paleta da referência do Spotlight enviada pelo usuário,
incluindo material nativo e aparência clara/escura herdada do macOS.

O usuário confirmou duas decisões:

- Skills, Plugins e MCP ficam **dentro de Claude e Codex** nas Preferências.
- A configuração também pode mudar **em conversas já existentes**.

O alcance anterior continua: seleção por conversa e padrões por agente salvos no
Ptolemy, sem modificar as configurações globais dos CLIs.

## Diagnóstico do estado atual

- `settings-dialog.tsx` oferece uma seção principal “Extensões”. Dentro dela,
  `extensions-section.tsx` mistura pacotes instalados, marketplace e MCP, com
  outro seletor de agente. Não há uma página completa dedicada às Skills nas
  Preferências.
- `agent-composer.tsx` imprime uma etiqueta removível para cada Skill selecionada
  e monta dois seletores diferentes, Skills e Extensões.
- `skill-picker.tsx` dá overflow tanto ao Popover quanto à lista interna. O
  Popover contém descrição extensa, importação e ações de persistência, embora
  esteja limitado pela altura restante da janela da paleta.
- `App.tsx` só amplia a janela para Preferências. Um modal de configuração de
  conversa também precisa participar desse cálculo de tamanho.
- Ambos os HTMLs fixam `class="dark"`. O CSS cobre o fundo com uma cor opaca e
  `overlay.m` adiciona um fundo preto com alpha de 0,85. Não há material nativo.
- A seleção da sessão hoje é capturada na criação. Claude mantém uma Query
  duradoura e Codex mantém um runtime com MCP preparado; alterar apenas os
  checkboxes ou os metadados não atualizaria corretamente esses recursos.

## Preferências

Preservar a lista dos plugins de busca do aplicativo, distinguindo-os dos
plugins dos agentes pelos títulos e pelo contexto da navegação. Não renomear
silenciosamente os identificadores de persistência.

Estrutura desejada:

```text
Preferências
  Plugins do aplicativo
    GitHub
    Claude Code
      Geral
      Skills
      Plugins
      MCP
    Codex
      Geral
      Skills
      Plugins
      MCP
  Rede
  Geral
```

A disposição exata da sidebar fica a cargo da implementação, mantendo os
recursos subordinados ao agente e utilizáveis em janelas menores. Remover
“Extensões” como destino visível principal. Links internos antigos devem levar a
um destino válido e específico; manter os schemas RPC dos dois renderers em
sincronia com o backend.

Cada recurso tem sua própria navegação de biblioteca e descoberta:

- **Skills:** instaladas/locais/integradas, busca, origem, disponibilidade,
  ativação padrão do agente, importação por GitHub e marketplace de Skills.
  Skills pertencentes a plugins aparecem com a origem do pacote.
- **Plugins:** instalados, importação dos plugins nativos do agente e marketplace
  de plugins. Detalhes incluem Skills, comandos, agentes, hooks e MCP do pacote,
  compatibilidade e autorização dos hooks da revisão efetiva.
- **MCP:** servidores configurados, transporte, estado, autenticação, edição,
  OAuth e descoberta de componentes MCP disponíveis nos catálogos existentes.
  Conectar uma conta e ativar o servidor para um agente são ações distintas.

Decisão proposta de implementação: reutilizar os provedores GitHub já existentes
e apresentar os resultados por tipo de recurso. Skills: fontes como
`anthropics/skills`; Plugins: catálogos Anthropic e OpenAI; MCP: componentes MCP
dos pacotes dos repositórios cadastrados. Fontes personalizadas continuam
suportadas. Um pacote misto pode aparecer em mais de uma descoberta, sem criar
instalações duplicadas. Não inventar uma API de marketplace MCP nem anunciar um
registro externo integrado que ainda não exista no produto. `skills.sh` mantém
a descoberta externa e a importação por GitHub já suportadas.

Os pacotes e credenciais continuam compartilhados pelo armazenamento do app;
padrões, compatibilidade e seleção pertencem ao agente escolhido. Remover um
pacote compartilhado deve explicitar esse alcance. Instalar não ativa todos os
componentes automaticamente.

## Composer e configuração da conversa

Remover as etiquetas de Skills e os botões separados “Skills”/“Extensões” do
Composer. Manter modelo, texto, envio e um único botão de configuração com ícone
e indicação compacta de recursos ativos. O nome acessível identifica a função.
O botão não cresce proporcionalmente à quantidade de recursos.

O botão abre uma visão resumida, sem listas completas nem scroll aninhado:

```text
Configuração da conversa              Codex
Skills                                  8
Plugins                                 2
MCP                                     1
Aviso compacto, se houver indisponibilidade
                       Configurar conversa
```

As contagens têm definições únicas: Skills incluem as integradas, de arquivos e
de plugins efetivamente selecionadas; Plugins contam pacotes com componentes
selecionados; MCP conta servidores únicos, inclusive os fornecidos por plugins.
Comandos, agentes e hooks ficam nos detalhes dos plugins; comandos integrados do
Claude também têm controles próprios no conteúdo de configuração. Itens
indisponíveis não aumentam o total ativo e não desaparecem da revisão.

O resumo oferece acesso a um **modal amplo de Configuração da conversa**, com
categorias Skills, Plugins e MCP. Cada categoria pode ser aberta diretamente a
partir do resumo. Esse modal reutiliza listas, busca, detalhes de pacote,
compatibilidade, editor MCP e marketplace das Preferências, usando um contexto
de edição diferente:

- Preferências edita os padrões de novas conversas do agente.
- Configuração da conversa edita um rascunho da seleção daquela conversa.
- “Aplicar” salva a seleção; “Cancelar” descarta alterações de seleção.
- “Usar como padrão” é uma ação explícita separada; aplicar à conversa não muda
  os padrões automaticamente.
- Instalação de pacote, remoção e conexão OAuth continuam sendo ações da
  biblioteca/conta; cancelar a seleção não promete desfazer essas ações. Mostrar
  esse alcance junto dessas ações, sem transformar a tela em documentação.

Cabeçalho, navegação, busca e ações permanecem acessíveis. O corpo tem uma única
região principal de scroll por página; detalhes extensos usam expansão ou página
de detalhes, sem uma lista rolável dentro de outra lista rolável. Adequar a
janela nativa à configuração aberta e restaurar suas dimensões ao fechar.
Escape, foco inicial, retorno do foco e navegação por teclado não devem acionar
atalhos ou enviar mensagens no Composer por trás do modal.

## Conversas existentes

Adicionar acesso à mesma configuração também no Composer da janela de chat.
Carregar a seleção real persistida da sessão, incluindo revisões arquivadas;
não reconstruí-la a partir dos padrões atuais ou apenas dos pacotes ainda
instalados. Mostrar claramente itens removidos da biblioteca que continuam no
snapshot da sessão.

Decisões propostas para tornar a troca previsível:

1. Mudanças só são aplicadas **entre turnos**. Durante geração, preparação de
   comando ou chamada de ferramenta, permitir consultar e bloquear a aplicação
   com uma explicação breve. Não interromper a resposta automaticamente.
2. Validar a seleção inteira, compatibilidade, duplicatas, hooks autorizados e
   prontidão de MCP antes de publicar a mudança. Uma seleção vazia é válida e
   explícita; não repor padrões implicitamente.
3. Preparar uma nova revisão da configuração da sessão. Serializar aplicação,
   envio, retomada e exclusão para evitar que um turno use metade da seleção
   antiga e metade da nova.
4. Encerrar o runtime ocioso e reconstruí-lo com a seleção nova, preservando o
   identificador de conversa, projeto, modelo, histórico e identidade da sessão
   do harness quando suportada. Claude precisa reconstruir a Query e MCP;
   Codex precisa reconstruir o runtime/MCP e conservar o thread ID.
5. Limpar permissões e ferramentas em cache cuja validade depende da seleção.
   As ferramentas removidas não podem continuar acessíveis pelo processo antigo.
   Remover materializações obsoletas apenas quando forem arquivos gerenciados
   pelo aplicativo; conflitos com arquivos alterados pelo usuário devem produzir
   erro recuperável, sem apagar seu trabalho. Preservar os arquivos arquivados
   necessários a retomadas e à restauração da revisão anterior.
6. Publicar sucesso somente quando a seleção persistida e a preparação do
   próximo turno forem coerentes. Em falha, manter/restaurar a última revisão
   utilizável; se não for possível restaurá-la, bloquear envio e oferecer nova
   tentativa. Nunca emitir sucesso deixando o runtime antigo ativo.
7. Retomadas frias usam a última configuração confirmada. Conversas antigas
   sem seleção explícita exibem seu estado legado e só migram quando o usuário
   aplicar uma escolha.

Trocar recursos não apaga mensagens nem instruções já presentes no histórico.
A tela informa que a seleção passa a valer nas próximas mensagens. Não prometer
que o modelo esquecerá conteúdo de uma Skill que já leu.

Preservar os limites existentes: jail do projeto no Claude, sandbox do Codex,
segredos no Keychain, OAuth pelo navegador, autorização de hooks por revisão e
ausência de mutações nas instalações globais dos CLIs.

## Aparência do Spotlight e tema do sistema

Usar a imagem do Spotlight como referência para o material e a geometria:
superfície contínua, cantos amplos, borda clara discreta, sombra suave,
separadores leves, tipografia de sistema e itens com espaçamento confortável.
O tom alaranjado da referência vem do desktop atrás do vidro; não fixar uma
textura ou um fundo laranja para imitá-lo. Manter as funções próprias do Ptolemy,
como os modos Apps/Claude/Codex, com hierarquia visual mais discreta.

Decisão proposta de implementação:

- Usar `NSGlassEffectView` no macOS 26+, disponível no SDK local, respeitando o
  contrato de `contentView`. Em sistemas anteriores, usar `NSVisualEffectView`.
- Configurar janela e WebView transparentes para o material nativo aparecer.
  CSS sozinho não produz o desfoque do desktop atrás da janela.
- Adaptar a integração ao Electrobun 1.16 instalado, sem trocar de framework,
  sem APIs do Electron e sem depender de APIs privadas do macOS.
- Respeitar redução de transparência, aumento de contraste e redução de
  movimento. Quando a transparência for reduzida, priorizar fundo legível.
- Herança automática de claro/escuro desde a primeira renderização nas duas
  janelas; acompanhar mudanças do sistema em tempo real. Remover o modo escuro
  fixo e manter classes, CSS e material nativo coerentes.
- Aplicar o vidro principalmente à paleta e às superfícies de navegação e
  configuração. No chat, manter fundos suficientemente legíveis para texto e
  código, usando os mesmos tokens e aparência do sistema.
- Revalidar foco, hotkey, esconder/mostrar, mudança de monitor, resize e abertura
  de modal: não reinstalar camadas de vidro a cada exibição da janela.

Fontes técnicas: [NSGlassEffectView](https://developer.apple.com/documentation/appkit/nsglasseffectview)
e [BrowserWindow](https://docs.electrobun.dev/electrobun/apis/browser-window/).
A implementação também deve conferir os headers locais e a versão instalada.

## Critérios de aceitação

- Claude e Codex oferecem suas páginas Skills, Plugins e MCP e sua descoberta
  dedicada. O agente não muda silenciosamente ao navegar.
- Configuração prévia, padrões e configuração de sessão existente compartilham
  os mesmos controles de recursos, com semântica de persistência explícita.
- O Composer permanece compacto com dezenas de recursos selecionados.
- Resumo e modal não apresentam o duplo scroll das imagens. Buscar, selecionar,
  revisar incompatibilidade, conectar MCP e autorizar hooks são acessíveis por
  teclado e em uma janela de altura limitada.
- Uma sessão de Claude e uma de Codex podem adicionar e remover Skills, plugin
  com componentes e MCP entre mensagens; a próxima mensagem usa a seleção nova
  e mantém a memória anterior. Confirmar também a retomada fria.
- Aplicações concorrentes com envio/geração são rejeitadas ou serializadas de
  modo determinístico. Falhas de validação, preparação e persistência não
  deixam uma seleção parcialmente aplicada.
- Nenhuma configuração de CLI externo muda. Nenhuma permissão de sandbox é
  ampliada. Snapshots removidos da biblioteca continuam retomáveis.
- Validar claro e escuro em screenshots e o material em uma execução nativa
  real sobre um desktop visível; screenshots de Chromium não provam o vidro.
- Executar testes de UI e backend afetados, integração real com mocks dos dois
  harnesses, typecheck, lint e builds Vite/nativo. Ampliar E2E para as novas
  transições de modal/resize e retomada com alteração de recursos.

## Entrega

Depois da revisão deste desenho, produzir o plano e implementar em branch
`codex/` nova baseada na main que recebeu o PR #32. Não misturar a entrega com a
branch já mesclada. Atualizar a documentação funcional em português e inglês
quando necessário e entregar evidências visuais e de testes antes da revisão
do PR. Publicação ou merge não fazem parte desta mudança sem solicitação.
