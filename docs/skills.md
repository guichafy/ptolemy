# Skills no Claude e Codex

Selecione **Claude** ou **Codex** na paleta. O composer permite escrever uma mensagem com várias linhas e escolher o modelo e preparar Skills antes de iniciar a conversa. O modelo começa com o padrão do agente; uma seleção diferente vale só para a nova sessão e é mantida na janela de conversa e na retomada. **Enter** inicia a conversa; **Shift+Enter** adiciona uma linha. As sessões recentes continuam abaixo do composer.

**Tab/Shift+Tab** percorre os controles. Na barra de plugins, **←/→** troca de aba e **Home/End** vai ao início/fim. **Ctrl+Tab/Ctrl+Shift+Tab** troca de plugin a partir dos controles da paleta. **↑/↓** navega nos resultados e nas opções de Skills/filtros. No composer vazio, as setas alcançam as sessões recentes; com texto, continuam editando a mensagem. Seletores abertos mantêm o foco e as teclas dentro de suas opções até fechar.

Abra **Skills**, cole uma URL pública do GitHub e clique em **Importar Skill**. São aceitos:

- Repositório com `SKILL.md` na raiz: `https://github.com/autor/minha-skill`.
- Pasta: `https://github.com/autor/repo/tree/main/minha-skill`.
- Arquivo: `https://github.com/autor/repo/blob/main/minha-skill/SKILL.md`.

A importação resolve a revisão do GitHub para um commit, valida o pacote e cadastra a Skill somente depois de baixar todos os arquivos. A nova Skill fica selecionada para a próxima conversa. Desmarque-a na lista ou remova o chip para não usá-la. **Usar seleção como padrão** salva as Skills adicionais para futuras conversas daquele agente; Claude e Codex têm padrões independentes. A seleção vazia remove os padrões adicionais.

As Skills nativas dos harnesses são preservadas. A lista identifica Skills locais compatíveis encontradas em `~/.claude/skills`, `~/.agents/skills`, `$CODEX_HOME/skills` e `$CODEX_HOME/skills/.system`, respeitando também `CLAUDE_CONFIG_DIR`. Skills internas que o CLI fornece diretamente continuam sob controle do próprio CLI. O Claude SDK recebe cópias das Skills locais compatíveis em um plugin isolado, sem carregar configurações ou hooks globais. Extensões nativas de metadados, como `argument-hint`, são preservadas; hooks e permissões de ferramentas são removidos da cópia ativa. Pacotes locais que excedam os limites ou contenham links simbólicos aparecem como indisponíveis e não impedem novas conversas. O Codex mantém sua descoberta nativa.

## Formato aceito

O pacote segue a [especificação Agent Skills](https://agentskills.io/specification). O arquivo `SKILL.md` tem frontmatter YAML com `name` e `description`. O nome coincide com a pasta, tem até 64 caracteres e usa letras minúsculas, números e hífens simples. A descrição contém de 1 a 1024 caracteres.

```markdown
---
name: minha-skill
description: Revisar alterações de código quando uma revisão for solicitada.
---

Leia references/guia.md antes de revisar as alterações.
```

Os campos opcionais aceitos são `license`, `compatibility` (até 500 caracteres), `metadata` (mapa de textos) e `allowed-tools`. Extensões específicas de um harness, como `hooks`, e aliases YAML não são aceitos. O campo `allowed-tools` é preservado no catálogo e removido da cópia ativa: a Skill não altera a aprovação de ferramentas do Ptolemy.

Scripts, referências e assets são preservados. O pacote pode conter até 128 arquivos, 1 MiB por arquivo e 5 MiB no total; `SKILL.md` tem limite de 256 KiB. Links simbólicos, submódulos, caminhos que escapem da pasta, conflitos de nomes e árvores incompletas são rejeitados. A importação não executa scripts. A validação verifica o formato do pacote; revise a origem e as instruções antes de utilizá-lo. Repositórios privados não são suportados nesta versão.

## Persistência e isolamento

O catálogo e os padrões ficam em `~/.ptolomeu/skills/index.json`. Cada sessão salva um snapshot independente em `~/.ptolomeu/sessions/<id>/skills.json`; retomar uma sessão preserva a seleção original. `PTOLEMY_HOME` também se aplica a esses dados nos testes.

Os arquivos ativos ficam dentro do projeto da conversa: `.ptolemy/claude-harness/skills` para o plugin do Claude, ou `.agents/skills` para o Codex. A troca entre sessões restaura as Skills gerenciadas pelo Ptolemy; Skills externas já existentes no workspace não são sobrescritas. Nenhuma Skill importada é instalada globalmente. O workspace jail do Claude, a aprovação de ferramentas e o sandbox do Codex permanecem ativos. A configuração de MCP continua nas preferências existentes.
