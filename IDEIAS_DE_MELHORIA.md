# Ideias de melhoria — Lexicon (wikiBook)

## Rodada 2026-08-26

Dois commits novos desde a última rodada: `edaa7cb` (trilhas de aprendizado
guiadas — `PathView`, `pathHandlers.js`, `platform/paths.ts`) e `dd32b19`
(Heroicons no lugar dos emojis) — HEAD atual. Os itens em aberto das rodadas
anteriores continuam de pé e não são repetidos aqui. Esta rodada olhou o app
inteiro com foco em **arquitetura e escopo**: o que duplicar/quebrar, o que
cortar, o que mudar de fundamento e o que falta. 12 recomendações, agrupadas
por natureza da mudança.

### Simplificação e exclusão

**1. Unificar o núcleo duplicado entre desktop (JS) e mobile (TS).**
`packages/desktop/src/main/handlers/` e `packages/mobile/src/platform/` são
duas implementações independentes da MESMA lógica, e não só do I/O:
`claudeHandlers.js` (374 linhas) e `platform/claude.ts` (506) repetem os
prompts (`SYSTEM_SUMMARIZE` é idêntico byte a byte nos dois), a tabela
`GENERATE_TEMPLATES`, a política de retry e a tabela de modelos de trilha
(`claudeHandlers.js`… `pathHandlers.js` linhas 43-45 vs. `claude.ts` linhas
409-411 — mesmos três modelos, mesmos budgets). O mesmo vale para
`articleHandlers.js` (837) vs. `platform/articles.ts` (582) e
`flashcardHandlers.js` (451) vs. `platform/flashcards.ts` (424). São ~1.200
linhas de regra de negócio mantidas em dobro: qualquer mudança de prompt,
modelo, schema de SM-2 ou formato de arquivo precisa ser feita duas vezes, e
a divergência é silenciosa (nada quebra em compilação). A correção é extrair
para `@lexicon/shared/core` tudo que é puro — prompts, templates, parser de
flashcards, agendamento SM-2, merge de links, sanitização — deixando em cada
shell só o que realmente muda: acesso a disco (`fs` vs. `Filesystem`),
transporte HTTP (`https` do Node vs. `CapacitorHttp`) e armazenamento de
segredos (`safeStorage` vs. `SecureStoragePlugin`).

**2. Três componentes de UI existem em duas cópias em vez de morar em
`shared`.** `OnboardingWizard` (desktop: `App.tsx` linhas 424-540; mobile:
`screens/OnboardingWizard.tsx`, 87 linhas) duplica inclusive o texto do tour
— mudar uma frase de boas-vindas exige editar dois arquivos. `StatusOverlay`
(desktop: `App.tsx` linhas 500-540; mobile: `StatusOverlay.tsx`, 42 linhas) e
`SettingsModal` (desktop: `App.tsx` linhas 260-420; mobile:
`screens/SettingsModal.tsx`, 186 linhas) têm o mesmo problema — e o
`SettingsModal` já provou o custo disso: o bug de `handleSave` que ignora
`res.ok` foi identificado no desktop na rodada 2026-08-14 e teve de ser
reportado de novo, separadamente, no mobile na rodada 2026-08-17. Como
`GraphScreen` e `PathScreen` já demonstram (envolvem `GraphView`/`PathView`
de `@lexicon/shared` sem alterar lógica), o padrão certo já existe no
projeto: componente compartilhado + casca fina por plataforma.

**3. Quebrar `ArticleView.tsx` (2.368 linhas) e `styles.css` (2.842
linhas).** `ArticleView.tsx` hospeda hoje quinze componentes e funções de
alto nível que não têm relação direta entre si: `TableExcerptEditor`,
`SaveExcerptModal`, `ExcerptsPanel`, `BacklinksPanel`, `TagEditor`,
`FlashcardsPanel`, `ReviewModal`, `FindInPageBar`, `SectionsTocPanel`,
`HistoryModal`, `AttachmentsSection` — mais o próprio `ArticleView`, que
sozinho tem ~1.100 linhas e mais de 30 `useCallback`. Sintoma concreto da
confusão: `App.tsx` importa `ReviewModal` de dentro de `ArticleView.tsx`
para a revisão **global** de flashcards, que não tem nada a ver com a
visualização de um artigo. Extrair `components/article/*` (um arquivo por
painel/modal) e fatiar o CSS por componente reduziria o custo de qualquer
alteração nessa tela — que é a tela central do produto.

**4. Cortar ou substituir a busca semântica via Claude
(`claude:searchRank`).** `App.tsx` (linhas 435-460) envia `{id, title,
summary}` de **toda a base** para a API a cada busca com debounce de 400 ms,
e o retorno é uma lista de ids ordenada. O custo cresce linearmente com a
biblioteca (numa base de 500 artigos, cada tecla estabilizada manda um
payload de dezenas de KB), a latência entra no caminho de digitação, e a
falha é invisível: `catch` zera `semanticResultIds` e o app cai
silenciosamente para o `includes()` de substring — o usuário vê resultados
diferentes sem saber por quê (linhas 461-470). Ou se remove o toggle "✦" e
se investe num ranking local decente (fuzzy + BM25 sobre o índice que já
existe), ou se troca por embeddings calculados **uma vez por artigo** e
guardados no JSON — nesse caso a busca vira produto escalar local, sem
chamada de rede por tecla.

### Alteração de fundamento

**5. `article:list` devolve o `Article` completo de todos os artigos.**
`articleHandlers.js` (`listAllArticles`, linhas 121-131) lê todo JSON do
diretório e o `article:list` entrega o objeto inteiro — `content` (HTML
completo da Wikipedia, tipicamente 50-200 KB por artigo), `excerpts`,
`links`, `tags` — para o renderer, a cada `loadArticles()`. O histórico e os
anexos já foram tirados do payload justamente por isso (comentário nas
linhas 39-41), mas o `content`, que é de longe o campo mais pesado, ficou.
Toda a cascata de custo do cliente vem daí: o `searchIndex` que reprocessa a
base inteira (item 7 da rodada 2026-08-14), a virtualização da lista, o
`filteredArticles`. No mobile é pior — o mesmo payload atravessa a ponte do
WebView. O certo é `article:list` devolver um índice leve (id, título, fonte,
tags, folderId, contagem de links, `updatedAt`, resumo truncado) e mover a
busca full-text para o backend (`article:search`), que já tem os arquivos em
mãos e um cache (`articlesCache`).

**6. A sincronização nunca propaga exclusões — e isso a torna insegura de
usar em dois aparelhos.** `sync-server/src/server.js` (comentário do
cabeçalho e `mergeArticlesForToken`) faz last-write-wins por `updatedAt` e
declara exclusões fora de escopo. Na prática: apagar um artigo no celular e
sincronizar faz o desktop reenviá-lo na sincronização seguinte — o artigo
ressuscita, e não há nenhum sinal disso para o usuário. Como o app **já
tem** lixeira com 30 dias nos dois shells, a peça que falta é pequena:
gravar tombstones (`{id, deletedAt}`) junto do artigo na lixeira, enviá-los
no `push`, e o servidor remover a linha quando `deletedAt > updated_at`. Na
mesma mudança vale eliminar o "Sincronizar agora" manual como único gatilho
(`App.tsx`, linhas 405-410): sincronizar na abertura do app e alguns
segundos depois de cada escrita cobre o caso real de uso.

**7. O agendamento SM-2 dos flashcards é frágil por depender do texto de
origem.** `shared/types.ts` documenta que `sourceLine` é "usado para
preservar agendamento entre regenerações", e `ArticleView.tsx` chama
`handleRegenerateFlashcards()` depois de **todo** salvamento de artigo
(linha 1611) e de trecho (linha 1696). A consequência: corrigir uma vírgula
numa linha marcada com `==destaque==` gera uma `sourceLine` diferente, o
card antigo não é reencontrado e o histórico de repetição (intervalo, ease,
reps, lapses) é perdido silenciosamente — justamente na base de usuários que
mais edita o material que está estudando. Duas correções complementares:
identidade estável do card (hash do par artigo+posição no outline, ou id
gravado no próprio Markdown) com casamento por similaridade como fallback; e
regeneração incremental e assíncrona, só do trecho alterado, para o salvar
não esperar o parser da base inteira.

**8. Um `⌘K` unificado no lugar de quatro ícones sem rótulo.** A sidebar
concentra exportar-Markdown, exportar-flashcards, densidade da lista e
configurações em quatro `icon-btn` só com `title` (`App.tsx`, linhas
790-805) — nenhum deles descobrível sem hover, e três são ações raras
ocupando o lugar mais nobre da tela. Os únicos atalhos existentes são ⌘N e
⌘F (linhas 649-668). Uma paleta de comandos única (buscar artigo, criar,
exportar, revisar vencidos, abrir grafo/trilha, alternar tema) resolveria
descoberta e velocidade ao mesmo tempo, e permitiria tirar da sidebar tudo o
que não é navegação.

### Novas funcionalidades

**9. Tela de Lixeira.** O backend já implementa lixeira completa nos dois
shells — `article:delete` move para `TRASH_DIR`, `article:restore` traz de
volta, `purgeOldTrashOnce` (`articleHandlers.js`, linhas 69-90) limpa itens
com mais de 30 dias. Mas a **única** porta de entrada para restaurar é o
botão "Desfazer" do toast, com janela de 5 segundos (`ArticleView.tsx`,
linhas 1580-1596). Passados esses 5 segundos, o artigo continua existindo em
disco por um mês inteiro, completamente inacessível pela interface. Uma
listagem simples ("Lixeira" nas Configurações ou na sidebar) com restaurar e
excluir em definitivo aproveita infraestrutura que já está pronta e paga.

**10. Painel de revisão com filtros e estatísticas.** Hoje só existem dois
recortes: "todos os cards vencidos" (`flashcards:listDue`, botão global da
sidebar) e "os deste artigo" (ícone no cabeçalho). Não dá para revisar por
pasta, por tag ou por trilha — que é exatamente como o usuário organiza o
material —, nem existe qualquer visão de progresso: nada mostra quantos
cards foram revisados hoje, qual a taxa de acerto, quantos vencem amanhã, ou
a curva de carga dos próximos dias. Os dados para isso já estão gravados em
cada card (`reps`, `lapses`, `ease`, `interval`, `due`); falta só a tela.

**11. Sugestão de links além do caso exato da Wikipedia.** `linkSuggestions`
(`ArticleView.tsx`, linhas 1800-1825) só funciona quando `source ===
"wikipedia"`, e casa `<span class="wiki-term">` com título de artigo por
igualdade exata em minúsculas. Ou seja: artigos gerados pelo Claude e
artigos manuais — que são a maioria da base de quem usa o app há algum tempo
— nunca recebem sugestão nenhuma, e "fotossíntese" no texto não casa com o
artigo "Fotossíntese (processo)". Ampliar para varrer o texto puro de
qualquer fonte contra o índice de títulos (com normalização de acento,
plural e sufixo comum), oferecer "vincular todos" em vez de aceitar um a um,
e — do outro lado — sinalizar no grafo os artigos órfãos, sem nenhuma
aresta, que hoje só aparecem como pontos soltos sem explicação.

**12. Importar de URL, PDF ou texto colado.** As duas únicas portas de
entrada de conteúdo são "buscar na Wikipedia" e "gerar com Claude"
(`NewArticleModal`). Todo o resto do que uma pessoa lê — um artigo de blog,
um paper em PDF, um trecho copiado de outro app — só entra no Wikibook se
for redigitado à mão como artigo manual. A infraestrutura necessária já
existe quase inteira: o pipeline de sanitização de HTML
(`wikipediaHandlers.js`), o resumo automático (`claude:summarize`) e o
suporte a anexos PDF (`article:addAttachment`, que hoje guarda o arquivo mas
não lê nada dele). Fechar esse ciclo — colar uma URL e receber artigo
sanitizado + resumo + sugestões de link; soltar um PDF e receber o texto
extraído — transforma o app de "leitor de Wikipedia com grafo" em base de
conhecimento de verdade.

---

## Rodada 2026-08-17

Nenhum commit novo desde a rodada anterior (`cc089c5` continua sendo o HEAD)
— os 8 itens da rodada 2026-08-14 foram conferidos novamente no código atual
e nenhum foi corrigido ainda (ficam de pé, não repetidos aqui). Uma exceção
boa: o item 2 da rodada 2026-08-13 ("tema manual não propagado para a janela
nativa") **já está resolvido** — `main.js` (linhas 65-70) registra
`onThemeChange` e atualiza `nativeTheme.themeSource`/`setBackgroundColor` no
processo principal. Esta rodada focou no shell mobile
(`NewArticleModal.tsx`, `SettingsModal.tsx`, `export.ts`), ainda pouco
auditado nas rodadas anteriores.

### UX/UI

**1. Falha de busca na Wikipedia dentro de "Novo artigo" (mobile) é
indistinguível de "sem resultados".** `NewArticleModal.tsx` (linhas 30-39): o
`useEffect` de busca com debounce chama `wikipedia:search` e só atualiza
`results` quando `res.ok` é verdadeiro — se a chamada falhar (rede
instável, limite de taxa da Wikipedia), o `catch` não existe e o `finally`
apenas desliga `searching`, deixando `results` vazio. A tela então mostra
"Nenhum resultado ainda." (linha 97), a mesma mensagem de uma busca
genuinamente sem resultado — o usuário não tem como saber que a causa foi
uma falha de rede, e a única saída é tentar de novo às cegas. Capturar o
erro e distinguir "sem resultados" de "falha ao buscar" (com opção de tentar
de novo) resolveria.

**2. `SettingsModal` do mobile repete o mesmo bug de `handleSave` já
identificado no desktop, mas em arquivo próprio.** O item 3 da rodada
2026-08-14 cobre `App.tsx`; `packages/mobile/src/screens/SettingsModal.tsx`
(linhas 38-42) tem exatamente o mesmo problema, em código duplicado (a tela
mobile não reaproveita o `handleSave` do desktop): `config:set` é chamado
sem checar `.ok`, e `saved(true)` é setado incondicionalmente. Como as duas
implementações são independentes, corrigir uma sem a outra deixa a
inconsistência entre plataformas — vale corrigir as duas juntas ou, melhor
ainda, extrair a lógica de salvar para um helper único em
`packages/shared` que ambas as telas chamem.

### Performance

**3. Exportação para Markdown no mobile nunca limpa arquivos antigos do
diretório de cache.** `export.ts` (`EXPORT_DIR = "lexicon-export"`,
`exportMarkdown`, linhas 144-166): cada chamada grava `.md` novos por cima
do diretório existente, mas nunca roda `Filesystem.rmdir` antes — se um
artigo for renomeado, apagado, ou movido de pasta entre duas exportações, o
arquivo antigo (nome antigo, conteúdo desatualizado) permanece em
`Directory.Cache` para sempre e é reexibido ao usuário se ele navegar até a
pasta de cache do app pelo Files/iCloud Drive, mesmo não fazendo mais parte
da base atual. Como o app já lida com dezenas/centenas de artigos ao longo
do tempo, isso acumula lixo silenciosamente a cada exportação repetida.
Limpar `EXPORT_DIR` (`Filesystem.rmdir({ recursive: true })`, ignorando erro
se não existir) no início de `exportMarkdown` antes do laço resolveria.

---

## Rodada 2026-08-14

Dois commits novos desde a última rodada: `7df6d71` (as 8 correções da
rodada 2026-08-13 — todas implementadas, confirmadas no código atual) e
`cc089c5` (renomeação do app de "Lexicon" para "Wikibook", nova marca/logo,
ícones desktop/Android/iOS) — HEAD atual. Esta rodada auditou especificamente
as consequências da renomeação/logo, revisou telas ainda não cobertas
(`SettingsModal`, `ReviewModal`, `FolderPicker`) e voltou a checar os itens
"conhecidos mas não corrigidos" das rodadas anteriores para não repetir o que
já foi resolvido.

### UX/UI

**1. `aria-label` duplicado no `LogoMark` gera anúncio repetido em leitor de
tela.** `packages/shared/components/LogoMark.tsx` (linhas 18-19) define
`role="img" aria-label="Wikibook"` no SVG da nova marca, e ele é sempre
renderizado ao lado do texto literal "Wikibook" (`App.tsx`, linha 520;
`ArticleListScreen.tsx`, linha 202). Um leitor de tela anuncia "Wikibook
Wikibook" nesses dois cabeçalhos — regressão introduzida pela própria
renomeação desta rodada. Como o texto adjacente já identifica a marca, o SVG
deveria usar `aria-hidden="true"` (puramente decorativo) em vez de label
próprio.

**2. `window.confirm()` nativo ainda usado para excluir artigo e pasta.** A
correção da rodada anterior trocou `window.confirm()` por diálogo
cross-platform só no `TableExcerptEditor` (remoção de linha/coluna). Ficaram
de fora `handleDeleteArticle` (`ArticleView.tsx`, linhas 1326-1328) e
`handleDeleteFolder` (`App.tsx`, linha 307), que ainda disparam o confirm
nativo do SO — quebra a identidade visual do app (ignora o tema
claro/escuro) bem no meio da ação destrutiva mais comum do produto. Aplicar
o mesmo helper de confirmação já adotado no restante do app resolveria os
dois pontos remanescentes.

**3. `SettingsModal.handleSave` ignora falha ao salvar a API key.**
`App.tsx` (linhas 176-180): `handleSave` chama
`window.lexicon.invoke("config:set", ...)` e nunca lê `.ok` do retorno —
sempre marca `saved(true)` e mostra "✓ Salvo", mesmo que a gravação
falhe. O usuário acredita que a chave da Anthropic foi salva e só descobre o
problema quando os recursos de IA (resumo, busca semântica, geração de
flashcards) falharem silenciosamente depois, sem relação óbvia com a causa.
Checar `res.ok` e mostrar um toast de erro nesse caso resolveria.

**4. `ReviewModal` sem atalhos de teclado para revisar flashcards.**
`ArticleView.tsx` (linhas 792-876): o único listener de teclado no modal de
revisão é Escape para fechar (linha 804-807). Revelar a resposta e aplicar
as quatro notas (Errei/Difícil/Bom/Fácil) só funcionam via clique do mouse.
Numa sessão com dezenas de cards — o caso de uso central do sistema SM-2 —
isso é bem mais lento que o padrão já consagrado pelo Anki (espaço para
revelar, teclas 1-4 para notar). Adicionar esses handlers enquanto o modal
está aberto tornaria a revisão diária muito mais fluida.

**5. `FolderPicker` sem Escape para fechar e sem navegação por teclado na
lista.** `FolderPicker.tsx`: o fechamento só ocorre por clique fora (linhas
44-54); não há handler de `keydown` para Escape no popover inteiro (o único
Escape existente é local ao input de "nova pasta", linha 93). A lista de
pastas (linhas 72-85) também não responde a setas/Enter. Inconsistente com
outros popovers do app, como o `FindInPageBar`, que já fecha com Escape.

**6. Toggle de busca semântica sem estado ARIA de "pressionado".**
`ArticleListScreen.tsx` (linhas 227-236): o botão `semantic-search-toggle`
tem `title` mas não `aria-label` nem `aria-pressed`, apesar de ser um toggle
com estado visual (classe `active`). Um leitor de tela não informa se a
busca semântica está ligada ou desligada — só o ícone muda (✦ / "…").

### Performance

**7. Índice de busca full-text é reconstruído por inteiro a cada mudança em
`articles`.** `App.tsx` (linhas 396-408): `searchIndex` é um `useMemo` com
dependência no array `articles` completo, e para cada artigo roda uma regex
(`a.content.replace(/&lt;[^&gt;]+&gt;/g, " ")`) sobre o HTML inteiro. Qualquer
edição isolada — renomear uma tag, mover um artigo de pasta — recria a
referência de `articles` e reprocessa o conteúdo de **todos** os artigos da
base, não só do que mudou. Em bases grandes isso é custo O(n) repetido a
cada ação trivial, não só na digitação da busca. Memoizar por artigo
individual (`Map` com cache por `id`+`updatedAt`) e só reprocessar o item
alterado resolveria.

### Funcionalidades

**8. Não existe exportação de um único artigo para Markdown.** A ação
"Exportar para Markdown" só existe em lote, via `article:exportMarkdown`
(`articleHandlers.js`, linhas 519-555), disparada pelo botão global da
sidebar (`App.tsx`, linha 480). O cabeçalho do artigo
(`ArticleView.tsx`, linhas 1600-1616 — busca/TOC/chat/revisar/editar/excluir)
não tem opção "Exportar este artigo". Quem quer levar só um artigo
específico para o Obsidian (ex.: compartilhar um resumo com alguém) precisa
rodar a exportação completa da biblioteca e depois procurar o arquivo entre
todos os outros.

---

## Rodada 2026-08-13

Dois commits novos desde a última rodada: `eb9a89e` (virtualização de lista,
sugestão de links, cache e filtros) e `6a6e6e0` (tema manual, densidade de
lista, acessibilidade e outras melhorias) — HEAD atual. Vários itens das
rodadas anteriores (virtualização, sugestão de links, cache/debounce,
acessibilidade) já foram implementados nesses commits. Esta rodada focou nos
arquivos que mais mudaram (`ArticleView.tsx`, `VirtualList.tsx`, `App.tsx`,
`useStore.ts`, handlers do Electron) em busca de problemas concretos
introduzidos pelas próprias features novas, evitando repetir itens já
cobertos nas rodadas de 2026-08-03, 2026-08-04 e 2026-08-05.

### UX/UI

**1. Navegação por teclado na busca fica "cega" com a lista virtualizada.**
Em `packages/shared/App.tsx` (linhas 535-546), `ArrowDown`/`ArrowUp` no campo
de busca incrementam `highlightedIndex`, aplicado como classe `highlighted`
no `renderItem` do `VirtualList` (linha 635). Acima de 80 artigos, o
`VirtualList` passa a usar `FixedSizeList` do react-window, que só monta no
DOM os itens visíveis na janela de rolagem — se o item destacado estiver
fora da janela, ele não é renderizado (nenhum feedback visual) e nada rola
até ele automaticamente. Em bases grandes, exatamente o cenário que a
virtualização foi feita para suportar, navegar com as setas além da tela
visível faz o destaque "sumir" silenciosamente. Usar a ref do
`FixedSizeList` (`scrollToItem(highlightedIndex, "smart")`) a cada mudança
de `highlightedIndex` resolveria.

**2. Tema manual não é propagado para a janela nativa do Electron.**
`packages/desktop/src/main/main.js` (linha 24) define o `backgroundColor` da
`BrowserWindow` uma única vez, a partir do tema do SO
(`nativeTheme.shouldUseDarkColors`). O novo toggle de tema
(`setTheme`/`applyTheme` em `useStore.ts`, linhas 32-38 e 470-474) só seta
`data-theme` no `<html>` do renderer via CSS — nunca avisa o main process.
Se o usuário força "Escuro" com o SO em modo claro (ou vice-versa), qualquer
repaint da janela nativa (resize, restore) pisca com a cor de fundo errada
antes do React repintar por cima. Um handler IPC `theme:set` que atualize
`nativeTheme.themeSource` e `mainWindow.setBackgroundColor(...)` resolveria.

**3. Dica de seleção de texto usa linguagem de mouse na versão mobile.**
`SelectionHintBubble` (`ArticleView.tsx`, linha 1953) exibe literalmente
"Clique com o botão direito para criar um link ou salvar este trecho." Como
`ArticleView` é reaproveitado sem alteração pelo mobile
(`ArticleScreen.tsx` só embrulha `<ArticleView article={article} />`), a
dica aparece igual em iOS/Android, onde não existe botão direito — o gesto
real é toque longo, e o próprio comentário em `ArticleScreen.tsx` (linhas
9-15) já registra incerteza sobre se ele dispara `contextmenu` de forma
confiável nas WebViews mobile. Parametrizar o texto por plataforma (ou
detectar `ontouchstart`) e trocar para "toque e segure" resolveria.

**4. Confirmação de remoção reintroduz `window.confirm()` num componente
compartilhado com o mobile.** `TableExcerptEditor.removeRow`/`removeCol`
(`ArticleView.tsx`, linhas 237-252, adicionadas nesta rodada) usam
`window.confirm(...)` — exatamente o padrão já trocado por `Dialog.confirm`
do Capacitor na exclusão de pasta (`ArticleListScreen.tsx`) por render
inconsistente na WebView. Só que essa confirmação nova foi escrita em
`ArticleView.tsx`, componente compartilhado, então no mobile ela volta a
usar o `confirm()` nativo do browser em vez do `Dialog` já adotado no resto
do app. Extrair um helper de confirmação cross-platform e reutilizá-lo em
todos os pontos de confirmação do `ArticleView` resolveria.

### Performance

**5. Exportação para Markdown trava o processo principal do Electron por
completo.** `article:exportMarkdown` (`articleHandlers.js`, linhas 519-555)
roda um `for` síncrono sobre todos os artigos, chamando
`fs.mkdirSync`/`fs.writeFileSync` (inclusive decodificando e gravando cada
imagem em base64) dentro do `ipcMain.handle`. Como o Electron main process é
single-threaded, o laço bloqueia todos os canais IPC — não só o da própria
exportação — até terminar; o indicador "Exportando artigos…" mostra um
spinner sem progresso real e o app fica sem responder a nada nesse
intervalo. Em bases com muitas imagens isso pode travar a UI por vários
segundos. Quebrar o laço com `setImmediate`/gravação assíncrona por lote e
emitir progresso real via IPC resolveria.

**6. Alternar densidade da lista faz o `VirtualList` "pular" de posição
quando virtualizado.** A troca de densidade (`setListDensity`) altera
`itemHeight` passado ao `VirtualList` (30→56px no desktop, 46→64px no
mobile). Acima do `virtualizeThreshold` (80 itens), isso vira `itemSize` do
`FixedSizeList` do react-window, mas o `scrollTop` atual (medido com a
altura antiga) não é recalculado — o mapeamento pixel→índice muda na hora,
então a lista visualmente "pula" para um trecho diferente assim que a
densidade muda, em vez de manter o item que estava no topo. Capturar o
índice do primeiro item visível antes da troca e chamar `scrollToItem` com
o novo `itemSize` em seguida resolveria.

**7. `pendingTask` é um slot global único e operações concorrentes se
sobrescrevem.** `useStore.ts` expõe `pendingTask: string | null` (linha 78)
como estado compartilhado, e `setPendingTask` (linha 575) foi exposto nesta
rodada para reaproveitar o `StatusOverlay` na exportação. Só que
`fetchFromWikipedia`, `generateWithClaude` e agora
`handleExport`/`handleExportFlashcards` cada um limpa `pendingTask` no
próprio `finally` sem checar se a mensagem atual ainda é a deles. Se o
usuário dispara uma exportação e, enquanto ela roda em segundo plano, busca
outro termo na Wikipédia, a operação mais rápida limpa o `pendingTask`
global e o spinner some mesmo com a exportação ainda em andamento. Usar um
token/id por operação (como já existe para `searchRequestId` na busca
semântica) e só limpar se `pendingTask` ainda corresponder à própria
operação resolveria.

### Funcionalidades

**8. Exportação de flashcards para Anki ignora completamente o modelo de
cloze do app.** `article:exportFlashcardsCsv` (`articleHandlers.js`, linhas
560-586) gera uma linha de CSV por trecho salvo, com verso = o excerto
inteiro (`ex.plainText`). Isso não tem relação com o parser real de
flashcards (`parseFlashcardsFromText`, `flashcardHandlers.js`), que quebra o
mesmo texto em múltiplos cards por grupo de destaque (`==amarelo==`→cloze
c1, `++laranja++`→c2 etc.) — exatamente o que é revisado dentro do app via
SM-2. Quem exporta para o Anki estuda algo completamente diferente (um card
genérico gigante por trecho) do que revisa no Lexicon. Reusar
`parseFlashcardsFromText` no export e converter os grupos cloze para a
sintaxe `{{c1::...}}` do Anki resolveria.

**9. Não existe renomear/mesclar tag em lote, mesmo com o autocomplete novo
estimulando reuso.** O `TagEditor` ganhou um `<datalist>` alimentado por
todas as tags da base para evitar quase-duplicatas ("biologia" vs
"biológica") — mas `updateTags` (`useStore.ts`, linha 536) só opera no
artigo aberto: não há nenhuma ação que troque uma tag por outra em todos os
artigos de uma vez. Se as quase-duplicatas já existem (o caso comum, já que
o autocomplete só age daqui pra frente), corrigi-las exige abrir cada
artigo manualmente. Um painel simples de gestão de tags (lista com contagem
de uso + "renomear em todos os artigos") resolveria.

**10. Sugestões de link se limitam a 20 sem indicar que há mais.**
`linkSuggestions` (`ArticleView.tsx`, linha 1577) corta o resultado com
`.slice(0, 20)`, e o painel "Links sugeridos" lista só isso, sem contador
("20 de 45") nem paginação. Em artigos importados da Wikipedia com muitos
termos em comum com a base — justo o caso mais provável em bases grandes,
onde a funcionalidade é mais útil — o usuário nunca fica sabendo que
existem mais candidatos além dos 20 primeiros na ordem do documento. Mostrar
a contagem total e oferecer "carregar mais" em vez de truncar
silenciosamente resolveria.

---

## Rodada 2026-08-05

Nenhum commit novo desde a última rodada (`9f184a5` continua sendo o HEAD).
Esta rodada revisou arquivos ainda não cobertos nas duas anteriores —
`GraphView.tsx` (versão canvas atual), `wikipedia.ts` e `claude.ts` do
shell mobile, `ArticleListScreen.tsx`, `bridge.ts` e `FolderPicker.tsx` —
em busca de problemas concretos de implementação, não apenas lacunas de
produto já registradas antes (onboarding, busca full-text, sync, tags,
diff de edição, retry de resumo, fila de toast, grafo incremental, índice
de flashcards, clamp de nó, passos de aprendizagem, auto-update, sandbox).

### UX/UI

**1. Confirmação de exclusão de pasta usa `window.confirm()` no mobile.**
Em `ArticleListScreen.tsx`, excluir uma pasta dispara o diálogo nativo do navegador (`window.confirm`), que dentro da WebView do Capacitor aparece com estilo inconsistente e às vezes atrasado em relação ao resto da UI nativa do app — quebra a sensação de app nativo bem no meio de uma ação destrutiva, que é justamente onde a confirmação precisa passar confiança. Trocar por um `ActionSheet`/`Dialog` do próprio Capacitor resolveria isso sem mudar o fluxo.

**2. Rótulos do grafo sem nível de detalhe (LOD) por zoom.**
`GraphView.tsx` desenha o título de todo nó em todo frame, independentemente do zoom — em bases com muitos artigos bem conectados, ao afastar o zoom os rótulos se sobrepõem e viram um borrão ilegível de texto. Ocultar rótulos abaixo de um limiar de zoom (mostrando só ao aproximar, ou ao hover/foco) manteria o grafo legível conforme a base cresce, sem perder a informação — ela já reaparece ao aproximar.

### Performance

**3. Busca semântica reenvia a lista inteira de candidatos a cada tecla, sem cancelar requisições antigas.**
Em `ArticleListScreen.tsx`, cada busca semântica (após o debounce de 400ms) reenvia ao Claude os resumos de até 200 artigos por inteiro — não há cache do resultado anterior nem reaproveitamento quando a nova consulta é apenas uma continuação da anterior. Pior: como a chamada de rede em si não é abortada ao digitar de novo, uma resposta mais lenta de uma busca anterior pode chegar depois de uma mais recente e sobrescrever o resultado errado na tela — vale adicionar um `AbortController`/token de requisição para descartar respostas obsoletas.

**4. User-Agent da Wikipedia usa e-mail de contato placeholder fixo.**
Em `packages/mobile/src/platform/wikipedia.ts` (linha 47), o `User-Agent` enviado à API da Wikipedia traz `contato@exemplo.com` — um valor de exemplo que nunca foi trocado por um contato real. A própria política de uso da Wikipedia pede um UA identificável para não limitar/bloquear o tráfego; um valor placeholder é o tipo de coisa que passa despercebida em desenvolvimento e só aparece como problema quando a Wikipedia decide aplicar a regra (rate limit silencioso). Vale corrigir para um contato real antes de publicar o app.

### Funcionalidades

**5. Sugestão automática de links internos a partir dos termos da Wikipedia.**
Ao importar um artigo da Wikipedia, `wikipedia.ts` converte cada link original (`<a>`) em um `<span class="wiki-term">`, descartando a informação de que aquele termo era um conceito linkável — mas o texto continua marcado e identificável. Cruzar esses termos com os títulos já existentes na base do usuário e sugerir a criação do link (em vez de exigir selecionar o trecho manualmente) tornaria o grafo de conexões muito mais rico, já que hoje ele só cresce por ação manual do usuário.

**6. Opção de salvar a resposta do "Perguntar ao Claude" como anotação permanente no artigo.**
`claude.ts`/`SYSTEM_ASK` já responde perguntas contextuais sobre o artigo, mas por design não persiste histórico (comentário explícito no código: "sem histórico persistido"). Isso é razoável para não inflar o arquivo do artigo a cada pergunta trivial, mas significa que um insight útil do chat se perde ao fechar a tela. Um botão "salvar esta resposta no artigo" (viraria um trecho/nota, com o mesmo mecanismo de excerto já existente) deixaria a decisão de persistir com o usuário, sem mudar o comportamento padrão.

---

## Rodada 2026-08-04

Nenhum commit novo desde a última rodada (`9f184a5` continua sendo o HEAD).
Por isso, em vez de repetir a revisão de superfície do dia anterior, esta
rodada mergulhou no código-fonte (`useStore.ts`, `flashcards.ts`,
`GraphView.tsx`, `main.js`, `excerptDiff.ts`) para levantar problemas
concretos, não apenas lacunas óbvias de produto. As ideias abaixo são novas
em relação à rodada de 2026-08-03 (que cobriu onboarding, estados de
carregamento, modo leitura, acessibilidade do grafo, virtualização, cache de
API, busca full-text, sincronização e tags — nenhuma delas é repetida aqui).

### UX/UI

**1. Aviso quando o diff de edição de trecho degrada para substituição de linha inteira.**
`excerptDiff.ts` limita o diff fino a blocos de até 2000 tokens (`MAX_DIFF_TOKENS`); acima disso, a edição vira substituição de linha inteira silenciosamente. Para quem cola ou edita trechos longos, isso pode gerar uma alteração maior do que a pretendida sem qualquer aviso. Um indicador simples ("edição grande — comparação simplificada") evitaria surpresas ao revisar o histórico do artigo.

**2. Retry visível quando o resumo automático falha na criação via Wikipedia.**
Em `useStore.ts`, se a chamada ao Claude falhar durante a criação de um artigo a partir da Wikipedia, o artigo é salvo com o texto fixo "Resumo não disponível" e não há ação de regenerar depois. Um botão "tentar resumir novamente" no próprio artigo evitaria que o usuário precise recriar o artigo do zero para obter o resumo.

**3. Fila de toasts em vez de slot único.**
O estado de toast em `useStore.ts` guarda uma única mensagem por vez; se uma segunda notificação diferente chegar enquanto a primeira ainda está visível, ela substitui a anterior sem que o usuário a tenha lido. Isso é mais perceptível no mobile, onde ações em sequência (salvar, gerar flashcard, exportar) são comuns. Uma pequena fila com no máximo 2–3 toasts empilhados resolveria isso sem redesenho grande.

### Performance

**4. Recomputar o grafo de forma incremental, não do zero a cada edição.**
`computeGraphData` roda um recálculo completo do grafo a cada save/delete/link individual (várias chamadas em `useStore.ts`), o que reinicia a simulação de força do D3 mesmo para mudanças de um único nó. Para bases maiores isso significa releitura de tudo e uma animação de "tremor" no grafo inteiro a cada pequena edição. Atualizar incrementalmente (adicionar/remover apenas o nó/aresta afetado) manteria a simulação estável e mais rápida.

**5. Indexar cartões de flashcard em vez de reler/reparsear todos os arquivos a cada revisão.**
`listDue()` em `flashcards.ts` lê e faz parse de todos os arquivos de flashcard do disco toda vez que a fila global de revisão é montada — sem cache ou índice, diferente do que já existe para artigos (`articleHandlers.js` cacheia a listagem). Conforme o número de cartões cresce, isso vira gargalo sensível especialmente no mobile. Um índice leve (título + próxima data de revisão) atualizado incrementalmente resolveria.

**6. Limitar o tamanho do nó do grafo por profundidade.**
O raio do nó cresce exponencialmente com a profundidade (`BASE_RADIUS * 1.2^(maxDepth - depth)` em `useStore.ts`), sem teto. Em grafos com 6–7 níveis de profundidade, os nós raiz ficam desproporcionalmente enormes em relação às folhas, prejudicando a legibilidade. Um clamp no fator de crescimento (ex.: máximo 3x o raio base) manteria o grafo legível em bases mais profundas.

### Funcionalidades

**7. Passos de aprendizagem intradiários no SM-2 (estilo Anki).**
Hoje `gradeCard` em `flashcards.ts` só trabalha em granularidade de dias — errar um cartão ("de novo") já agenda para o dia seguinte, sem a fila de curto prazo (1 min/10 min) que o Anki usa para reforçar cartões recém-errados na mesma sessão. Adicionar passos de aprendizagem sub-diários melhoraria a retenção de cartões difíceis, que é o ponto central de um sistema de repetição espaçada.

**8. Auto-update no app desktop (Electron).**
`main.js` não tem nenhum mecanismo de atualização automática (`electron-updater` ou similar) nem persistência do tamanho/posição da janela entre execuções. Hoje o único caminho de atualização é reinstalar manualmente. Isso importa porque o projeto está em desenvolvimento ativo (várias features novas por semana) — sem auto-update, o desktop tende a ficar desatualizado em relação ao mobile.

### Observação de segurança (não é ideia de produto, mas vale registrar)

`main.js` cria a janela com `sandbox: false` apesar de `contextIsolation: true` e `nodeIntegration: false`, e não há `setWindowOpenHandler`/guarda de `will-navigate` para impedir que o renderer abra janelas externas arbitrárias. Vale avaliar habilitar o sandbox e adicionar essas guardas — é um endurecimento de segurança de baixo custo, não uma feature nova.

---

## Rodada 2026-08-03

Gerado automaticamente em 2026-08-03 via tarefa agendada. Baseado na revisão do
estado atual do repositório: monorepo com `@lexicon/shared` (React/D3/Zustand),
shell desktop (Electron) e shell mobile (Capacitor), grafo de conceitos com
tamanho em cascata por profundidade, criação de artigos via Wikipedia/Claude,
flashcards com SM-2, exportação (Markdown/Obsidian, CSV/Anki), context menu,
busca/TOC, pastas e undo delete (commit mais recente: `9f184a5`).

### UX/UI

**1. Onboarding guiado na primeira execução.** Hoje o fluxo de primeira execução depende do usuário ler o README para saber que precisa colar a API Key do Claude antes de criar o primeiro artigo. Um wizard de 2–3 telas (colar API key → criar primeiro artigo de exemplo → tour rápido do grafo) reduziria a fricção inicial, especialmente no app mobile, que não tem um README ao lado.

**2. Estados vazios e de carregamento mais informativos.** `GraphView.tsx` e `ArticleView.tsx` já são arquivos grandes (459 e 1704 linhas); vale conferir se todos os estados de carregamento (buscando na Wikipedia, gerando com Claude, salvando) têm feedback visual consistente entre desktop e mobile — o mobile já tem um `StatusOverlay`/toast, mas o desktop pode não ter o mesmo nível de feedback.

**3. Modo de leitura sem distração no artigo.** Como o produto é uma "base de conhecimento pessoal" para leitura e estudo, um modo de leitura (tipografia maior, sem sidebar, com scroll suave entre âncoras do TOC) ajudaria sessões de leitura longa.

**4. Acessibilidade do grafo D3.** Grafos force-directed em D3/SVG costumam ser difíceis para leitores de tela e para usuários que dependem só de teclado. Adicionar navegação por teclado entre nós e uma visão alternativa em lista/árvore tornaria o grafo mais utilizável.

### Performance

**5. Virtualização da lista de artigos e do grafo em bases grandes.** Como cada artigo é um arquivo JSON independente, a lista de artigos e o cálculo do grafo podem começar a pesar conforme a base cresce para centenas de artigos. Vale considerar `react-window` na lista.

**6. Cache/debounce nas chamadas à API do Claude e Wikipedia.** Um cache local simples (por termo normalizado) evitaria chamadas duplicadas, reduzindo custo e latência — relevante porque a API da Anthropic é paga por uso.

### Funcionalidades

**7. Busca full-text entre artigos.** Já existe busca/TOC dentro de um artigo, mas não ficou claro se há busca full-text cruzando todos os artigos da base — essencial para uma base que cresce com o tempo.

**8. Sincronização opcional entre desktop e mobile.** Hoje os dados são 100% locais. Uma sincronização opt-in via iCloud Drive/Dropbox (apontar a mesma pasta) preservaria a filosofia "seus dados, seu disco" sem exigir backend próprio.

**9. Tags e coleções além de pastas.** Tags multi-valoradas (ortogonais a pastas hierárquicas) permitiriam cruzar artigos por tema sem forçar uma única hierarquia.

---

## Observações finais (acumuladas)

- O projeto está em ritmo de desenvolvimento ativo. Antes de novas features, vale garantir que mobile e desktop compartilhem o máximo possível via `@lexicon/shared` para não duplicar manutenção.
- Não foram encontrados testes automatizados no repositório — para lógica não-trivial (SM-2, cálculo de profundidade do grafo, diff de edição, exportação), testes unitários reduziriam o risco de regressão silenciosa.
- Nenhuma das duas rodadas encontrou um mecanismo de atualização automática para o desktop nem endurecimento total do sandbox do Electron — vale revisitar isso como item de manutenção, não apenas de feature.
