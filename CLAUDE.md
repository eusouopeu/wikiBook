# Instruções para o Claude neste repositório

- Pode usar agentes em segundo plano (subagentes) para tarefas independentes,
  desde que elas sejam bem simples.
- Ao final de toda resposta que alterar o código do app, deve fazer commit e
  push (local e no repositório do GitHub) e gerar o APK atualizado do mobile.

## Skill obrigatória

SEMPRE usar a skill `/caveman` (modo de comunicação ultra-comprimido) em toda resposta neste projeto.


## Padrões técnicos e visuais obrigatórios

- Sempre usar **TypeScript**, **Tailwind CSS**, ícones **Lucide** e fonte **Montserrat** com
  espaçamento entrelinhas (line-height) de 1.5.
- Dar preferência a **botões-ícone** em vez de botões com texto.

## Testes

- Por rodada de alterações, realizar apenas os **2 ou 3 testes mais essenciais** — não mais que isso.
- Esses testes devem ser **elaborados ANTES** da implementação das mudanças de código, para que não
  sejam enviesados pelo resultado da implementação.


## Commit, push e atualização do CLAUDE.md

- A cada rodada em que o código do app/site for alterado, deve ser feito o **commit** e o **push**
  para o repositório remoto no GitHub.
- Nessa mesma rodada, atualizar o conteúdo deste **CLAUDE.md** no que couber (novas convenções,
  decisões, mudanças de stack, etc.), mantendo-o coerente com o estado atual do projeto.

## Ideias de melhoria e funcionalidades

- Quando pedido para gerar ideias de melhoria, simplificação/exclusão de
  código ou novas funcionalidades, **NÃO** escrever essas ideias em nenhum
  arquivo `.md` (ex.: `IDEIAS_DE_MELHORIA.md`) — apresentá-las diretamente no
  chat, como resposta.

## Proibição de leitura de dependências

- NUNCA ler arquivos de dependências (ex.: `node_modules/`, `dist/`, `build/`, pastas de vendor
  ou qualquer artefato gerado/instalado) para obter contexto. Usar apenas o código-fonte do
  próprio projeto.

