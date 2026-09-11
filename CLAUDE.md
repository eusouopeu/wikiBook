# Instruções para o Claude neste repositório

- Pode usar agentes em segundo plano (subagentes) para tarefas independentes,
  desde que elas sejam bem simples.
- Ao final de toda resposta que alterar o código do app, deve fazer commit e
  push (local e no repositório do GitHub) e gerar o APK atualizado do mobile.

## Skill obrigatória

SEMPRE usar a skill `/caveman` (modo de comunicação ultra-comprimido) em toda resposta neste projeto.


## Padrões técnicos e visuais obrigatórios

- Sempre usar **TypeScript** e fonte **Montserrat** com espaçamento entrelinhas (line-height) de 1.5.
- Logo do app: livro aberto em degradê roxo (`#8B5CF6`) → azul (`#2563EB`) sobre fundo branco. Fonte
  única em `assets/brand/mark.svg` (transparente, usado no ícone do desktop), `icon-square.svg`/
  `icon-round.svg` (mesmo desenho com fundo branco, usados no ícone do iOS) e embutida como JSX em
  `packages/shared/components/LogoMark.tsx` (usada só na sidebar do desktop, `App.tsx`). Ícone do
  Android (`android/app/src/main/res/mipmap-*/ic_launcher*`) ainda é o padrão genérico do Capacitor,
  não gerado a partir de `assets/brand/` — pendente de regenerar quando alguém tratar do launcher.
- Dar preferência a **botões-ícone** em vez de botões com texto.
- Estado real do projeto (diferente do que pedimos em app novo): CSS puro (sem Tailwind) e ícones
  **Heroicons** (`@heroicons/react/24/outline`, mapeados em `components/Icon.tsx`) — não Lucide.
  Seguir o padrão já existente em vez de introduzir Tailwind/Lucide no meio do código atual.
  `packages/shared/styles.css` é só o índice de `@import` (ordem = cascata, não reordenar) das
  fatias em `packages/shared/styles/*.css` (variables/layout/main-area/topbar/article/modals/
  article-extras/excerpts-flashcards/path/misc); `packages/mobile/src/mobile.css` continua à
  parte, só com o shell mobile.
- `tsconfig.json` na raiz (`strict`, `checkJs: false`) + `npm run typecheck` — cobre todo `.ts`/
  `.tsx` de shared/desktop/mobile. `.js` (main do Electron, libs antigas de `shared/lib`) fica de
  fora do checkJs até serem convertidas; libs `.js` NOVAS usam `// @ts-check` + JSDoc (ver
  `lib/graphPath.js`/`lib/syncPolicy.js`) — daí SÃO checadas mesmo com checkJs desligado.
- Toda tela/aba (desktop e mobile) usa a `TopBar` compartilhada (`components/TopBar.tsx`):
  nome da aba + ícones específicos da aba + pesquisar (global) + central de erros (só aparece
  se houver erro na sessão) + alternar tema, nessa ordem. Todas as abas devem passar `onSearch`
  (no mobile, abas que não são "Artigos" usam `requestSearchFocus()` do store, que leva de volta
  pra lá com a busca já aberta).
- Desktop: navegação entre Artigo/Grafo/Trilha/Configurações é a `NavRail` (App.tsx) — coluna
  flutuante de ícones à esquerda da sidebar de artigos, não mais tabs dentro do TopBar.
- Artigos são sincronizados automaticamente em `.md` (Obsidian) para uma pasta — não existe mais
  exportação manual de Markdown. Ver `mdSyncHandlers.js` (desktop, pasta escolhida pelo usuário)
  e `platform/mdSync.ts` (mobile, pasta fixa `Documents/Wikibook` — sem SAF/bookmark, não dá pra
  escolher pasta arbitrária ainda). Desktop: bidirecional só para artigos `manual` — `resyncAll()`
  (chamado no boot e em "Ressincronizar") compara mtime do `.md` com `updatedAt` do artigo
  (`resolveMdSyncDirection` em `shared/lib/syncPolicy.js`) e PUXA de volta se o arquivo foi editado
  fora do app; `wikipedia`/`claude` continuam só empurrando (sem inverso de `htmlToMarkdown`).
  Mobile continua só empurrando (sem essa checagem de mtime ainda).
- Sincronização HTTP entre dispositivos (`sync:run`) pede confirmação antes de sobrescrever
  artigo local com versão diferente vinda do merge — `computeSyncConflicts` (mesma lib) lista os
  conflitos; a UI (`SettingsModal`) chama de novo com `confirmed: true` só depois que o usuário
  aceita, e a versão substituída vai para `.history/` do artigo antes da escrita.
- Geração de trilha salva rascunho (`pathDraft` no store, config `pathGenerationDraft`) assim que
  o Claude responde, ANTES de `importPathArticles` — fechar o app ou falhar a importação no meio
  não perde a geração já paga; o assistente oferece "Retomar importação" na tela inicial se achar
  um rascunho pendente.
- Build do Android (`assembleDebug`) exige **JDK 21** (`brew install openjdk@21` já feito nesta
  máquina) — `JAVA_HOME=/opt/homebrew/opt/openjdk@21`. JDK 17 (padrão do `java_home`) não compila.
- `ReviewModal` vive em `components/ReviewModal.tsx` (não mais dentro de `ArticleView.tsx`) —
  formatação de exibição de flashcard (`stripInlineMarkers`/`renderClozePreview`/
  `renderClozeForReview`) está em `lib/flashcardDisplay.ts`, compartilhada com o painel de
  flashcards do próprio `ArticleView`. `ArticleView.tsx` ainda é grande (leitor + editor de
  trechos + histórico + anexos); continuar puxando pedaços autocontidos pra fora em vez de
  crescer o arquivo.
- `GraphView` colore um badge por `folderId` (paleta própria, ver `folderColor`) e esmaece nós
  fora da pasta selecionada na sidebar (`highlightFolderId`, mesmo padrão de `highlightTag`).
  Ctrl/Cmd+clique em dois nós calcula o menor caminho (`lib/graphPath.js`, BFS não-direcionado) e
  destaca a rota; um terceiro clique normal ou trocar de grafo limpa.

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

