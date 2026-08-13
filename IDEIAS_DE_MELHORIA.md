# Ideias de melhoria — Lexicon (wikiBook)

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
