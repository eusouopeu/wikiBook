# Instruções para o Claude neste repositório

## Padrões compartilhados

Este projeto segue os padrões comuns aos apps do Pedro, documentados em
`../_shared/tech-standards.md` (stack, testes, commit/push/release, skill
`/caveman` obrigatória, subagentes — até 5 chamadas por rodada —, leitura de
dependências) e `../_shared/design-standards.md` + `../_shared/minimalismo.md`
(visual, ícones, estética minimalista, "ajuda recolhida"). As seções abaixo
cobrem só o que é específico deste projeto.

## Particularidades deste projeto

- Tipografia: exceção ao line-height 1.5 padrão — corpo de artigo
  (`.wiki-content`) usa 1.75 por legibilidade de leitura longa (tabelas dentro
  dele voltam a 1.55 para a grade não inflar).
- Logo do app: livro aberto em degradê roxo (`#8B5CF6`) → azul (`#2563EB`) sobre fundo branco. Fonte
  única em `assets/brand/mark.svg` (transparente, usado no ícone do desktop), `icon-square.svg`/
  `icon-round.svg` (mesmo desenho com fundo branco, usados no ícone do iOS) e embutida como JSX em
  `packages/shared/components/LogoMark.tsx` (usada só na sidebar do desktop, `App.tsx`). Ícone do
  Android (`android/app/src/main/res/mipmap-*/ic_launcher*`) já é gerado a partir de `assets/brand/`:
  `icon-square.svg`/`icon-round.svg` viram os PNGs legados (`ic_launcher`/`ic_launcher_round`) e
  `assets/brand/icon-android-foreground.svg` (logo sem fundo, escalado pra caber na safe zone do
  ícone adaptativo) vira `ic_launcher_foreground`, com fundo branco em
  `values/ic_launcher_background.xml` — rodar `rsvg-convert` de novo (mdpi 48/108, hdpi 72/162,
  xhdpi 96/216, xxhdpi 144/324, xxxhdpi 192/432 — legado/foreground) se o desenho mudar.
- Estado real do projeto (diferente do que pedimos em app novo): CSS puro (sem Tailwind) e ícones
  **Heroicons** (`@heroicons/react/24/outline`, mapeados em `components/Icon.tsx`) — não Lucide.
  Seguir o padrão já existente em vez de introduzir Tailwind no meio do código atual (exceção já
  registrada em `../_shared/design-standards.md`).
- "Ajuda recolhida" (`../_shared/minimalismo.md`): ainda não há candidato mapeado neste projeto —
  aplicar quando uma tela for tocada e tiver texto explicativo permanente que possa confundir o
  usuário.
  `packages/shared/styles.css` é só o índice de `@import` (ordem = cascata, não reordenar) das
  fatias em `packages/shared/styles/*.css` (variables/layout/main-area/topbar/article/modals/
  article-extras/excerpts-flashcards/path/misc/review); `packages/mobile/src/mobile.css` continua à
  parte, só com o shell mobile.
- `tsconfig.json` na raiz (`strict`, `checkJs: false`) + `npm run typecheck` — cobre todo `.ts`/
  `.tsx` de shared/desktop/mobile. `.js` (main do Electron, libs antigas de `shared/lib`) fica de
  fora do checkJs até serem convertidas; libs `.js` NOVAS usam `// @ts-check` + JSDoc (ver
  `lib/graphPath.js`/`lib/syncPolicy.js`) — daí SÃO checadas mesmo com checkJs desligado.
- Lógica pura de artigos (cache da listagem, normalização, ordenação, histórico, sanitização de
  trechos, HTML → Markdown, `.md` Obsidian) vive em `shared/lib/articleCore.js`, usada por
  `articleHandlers.js` (desktop) e `platform/articles.ts` (mobile) — cada lado fica só com o I/O.
  `claudePrompts.js`/`flashcardLogic.js`/`pathMaterialize.js` já foram convertidas (seguem
  CommonJS, com tipos de `shared/types.ts` via `import("../shared/types")` no JSDoc).
- Aba "Artigos" e views de artigo passam `actionsBelow` para a `TopBar`: os ícones da aba saem da
  linha do título e vão para uma segunda barra fixa (`.top-bar-actions-row`, dentro de
  `.top-bar-stack` sticky), sobrando a largura toda para o título. Nessas telas, o `ArticleView`
  manda TODOS os seus ícones de cabeçalho (primários + histórico/editar/excluir) por portal para o
  slot `headerActionsSlot` dessa barra — no desktop o slot é criado em `App.tsx`, no mobile em
  `ArticleScreen.tsx`. Sem slot, eles voltam a renderizar ao lado do `<h1>`.
- Seleção de texto atravessando mais de uma célula de tabela vira trecho do tipo `table`: as células
  tocadas pelo `Range` são remontadas em sub-tabela bem formada (`lib/tableSelection.js`, pura e
  testada; a varredura de DOM é `getSelectionTableHtml` em `ArticleView.tsx`). O menu de contexto
  mostra os dois itens — "salvar só as células selecionadas" e "salvar tabela inteira".
- Toda tela/aba (desktop e mobile) usa a `TopBar` compartilhada (`components/TopBar.tsx`):
  nome da aba + ícones específicos da aba + pesquisar (global) + central de erros (só aparece
  se houver erro na sessão) + alternar tema, nessa ordem. Todas as abas devem passar `onSearch`
  (no mobile, abas que não são "Artigos" usam `requestSearchFocus()` do store, que leva de volta
  pra lá com a busca já aberta).
- Desktop: navegação entre Artigo/Grafo/Trilha/Revisão/Configurações é a `NavRail`
  (`components/NavRail.tsx`) — coluna flutuante de ícones à esquerda da sidebar de artigos, não
  mais tabs dentro do TopBar. `App.tsx` ficou só com layout + atalhos globais + estado que cruza
  peças; a sidebar inteira (busca rankeada, pastas, tags, lista virtualizada) é
  `components/ArticleSidebar.tsx`, o histórico ⌘[/⌘] é `lib/useArticleHistory.ts`, e
  NewArticleModal/OnboardingWizard/StatusOverlay/ShortcutsModal/GraphLegend têm arquivo próprio
  em `components/` (o mobile continua com suas versões em `mobile/src`).
- Store Zustand dividido em fatias: `store/slices/{articles,paths,folders,review,ui}Slice.ts`,
  formato em `store/types.ts` (`AppState` = união das fatias, cada uma enxerga o estado todo via
  `get()`), ponte IPC em `store/ipc.ts`, cálculo do grafo em `store/graphData.ts`. `useStore.ts`
  só junta tudo — ação nova vai na fatia do domínio, não num arquivo único.
- Aba "Revisão" (desktop e mobile, `components/ReviewDashboard.tsx`): vencidos agora, sequência,
  mapa de calor de 12 semanas e previsão de 7 dias. Host expõe `flashcards:overview` (vencimentos
  de todos os cards + `reviewLog.json`, contagem de avaliações por dia LOCAL gravada por
  `flashcards:grade`; fica fora de `flashcards/` porque `listDue` lê todo `*.json` de lá). As contas
  são puras em `lib/reviewStats.ts` (TS, testado — `node --test` roda `.ts` direto no Node 24).
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
  `renderClozeForReview`) está em `lib/flashcardDisplay.ts`, compartilhada com o
  `FlashcardsPanel`. Demais peças do `ArticleView` também já saíram para `components/`:
  `ExcerptEditor` (editores de trecho texto/tabela + atalhos de formatação), `ExcerptsPanel`,
  `SaveExcerptModal`, `ArticleHistoryPanel`, `AttachmentsPanel`, `BacklinksPanel`, `TagEditor`,
  `FindInPageBar`, `SectionsTocPanel` e `ArticleOverlays` (menu de contexto/dica/prévia de link);
  helpers puros em `lib/articleHtml.ts`, `lib/excerptOutline.ts`, `lib/findInPage.ts`,
  `lib/sectionsToc.ts`. `ArticleView.tsx` (~1090 linhas) ficou só com estado + efeitos + layout
  — continuar puxando pedaços autocontidos pra fora em vez de crescer o arquivo.
- `GraphView` colore um badge por `folderId` (paleta própria, ver `folderColor`) e esmaece nós
  fora da pasta selecionada na sidebar (`highlightFolderId`, mesmo padrão de `highlightTag`).
  Ctrl/Cmd+clique em dois nós calcula o menor caminho (`lib/graphPath.js`, BFS não-direcionado) e
  destaca a rota; um terceiro clique normal ou trocar de grafo limpa.

Testes, commit/push, atualização do CLAUDE.md e leitura de dependências: ver
`../_shared/tech-standards.md`.

## Ideias de melhoria e funcionalidades

- Quando pedido para gerar ideias de melhoria, simplificação/exclusão de
  código ou novas funcionalidades, **NÃO** escrever essas ideias em nenhum
  arquivo `.md` (ex.: `IDEIAS_DE_MELHORIA.md`) — apresentá-las diretamente no
  chat, como resposta.

