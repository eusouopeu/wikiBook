# Ideias de melhoria — Lexicon (wikiBook)

## Rodada 2026-08-29

HEAD `d749fa3`. Desde a rodada anterior entraram três commits: `d951aae`
(implementa 5 das 12 recomendações de UI/UX), `9c43733` (trilha importa
artigos da Wikipedia para pasta própria) e `d749fa3` (status bar mobile,
recursos de imagem na trilha, extração de prompts para `claudePrompts.js`).
Continuam abertas da rodada anterior: menu "⋯" para ações raras (item 2), TOC
como painel lateral (5), "expandir tudo" nos accordions (7), busca de nó no
grafo (9), reabrir onboarding (10), badge de contagem na lixeira (11) e FAB de
novo artigo no mobile (12). Esta rodada olha sobretudo para o que a feature de
**trilhas** trouxe de novo e para a divergência crescente entre os dois shells.
12 recomendações, nenhuma repetindo as acima.

### Simplificação e exclusão

**1. O catálogo de modelos de geração de trilha existe duas vezes, com os
mesmos números escritos à mão em cada uma.** `PATH_MODELS` em
`claudePrompts.js` (linhas 130-134) guarda `apiModel`/`thinking`/`maxTokens`;
`PATH_MODEL_OPTIONS` em `pathModels.ts` guarda os mesmos três modelos de novo,
com `apiModel`, `thinking`, `thinkingBudgetTokens`, `maxOutputTokens` e preços.
Os valores coincidem hoje (8000/10000/8000, budget 6000) só porque foram
copiados; qualquer troca de modelo ou de teto de tokens precisa ser feita nos
dois arquivos, e se divergirem o usuário vê um custo estimado que não
corresponde à chamada de verdade. Como `claudePrompts.js` já é importado pelos
dois shells, o catálogo deveria ser único ali (rótulo, descrição e preço
incluídos) e `pathModels.ts` ficar só com a aritmética de estimativa de custo.

**2. O parser de flashcards e o SM-2 estão duplicados byte a byte entre
desktop e mobile.** `flashcardHandlers.js` (linhas 68-312) e `flashcards.ts`
(linhas 120-310) reimplementam o mesmo `LIST_MARKER`, `ENUM_LINE_RE`,
`buildEnumCloze`, `parseLineForCard` e `gradeCard` — ~250 linhas de lógica
pura, sem nada de plataforma (não tocam `fs` nem `Filesystem`). Isso significa
que corrigir um falso positivo do parser ou ajustar o intervalo do SM-2 exige
duas edições sincronizadas, e um cartão gerado no celular pode ficar diferente
do mesmo trecho no desktop. É exatamente o caso que `claudePrompts.js` já
resolveu para os prompts: extrair para `shared/lib/flashcardParser.ts` +
`shared/lib/sm2.ts` e deixar em cada shell só o I/O de arquivo.

**3. `materializeResources`/`materializeUnits` também estão duplicados nos dois
shells.** `pathHandlers.js` (linhas 79-140) e `claude.ts` (linhas 211-290)
repetem a mesma montagem de unidades, o mesmo encadeamento de pré-requisitos e
o mesmo fallback de página de busca da Wikipédia. O comentário do
`claudePrompts.js` justifica a duplicação por dependerem de `searchWikipedia`,
que é específica de plataforma — mas isso se resolve injetando a função: uma
`materializeUnits(rawUnits, lang, { searchWikipedia })` em `shared/lib` seria
compartilhável sem que o código puro precise saber se por baixo é `https` do
Node ou `CapacitorHttp`.

**4. `PathView.tsx` acumula três telas independentes em um arquivo só.** As 414
linhas cobrem lista de trilhas, assistente de criação de 4 estágios
(`goal`/`interview`/`model`/`generating`, com estado de entrevista, perfil,
modelo e erro) e a serpentina com painel de detalhe — que não compartilham
estado nenhum entre si, só o `activePathId` que já vive no store. É o mesmo
padrão que tornou `ArticleView.tsx` (2411 linhas) difícil de mexer. Separar em
`PathList`, `CreatePathWizard` e `PathDetail` como arquivos próprios agora,
enquanto são pequenos, evita repetir a trajetória do `ArticleView`.

**5. A barra de navegação inferior do mobile define rótulos que nunca aparecem
na tela.** `BottomNav.tsx` (linhas 16-21) declara `label` para cada uma das 4
abas, mas o `<button>` renderiza só o `<Icon>` — o texto vai apenas para
`title`/`aria-label`, e `title` não existe no toque. O resultado é que
"Trilha" e "Grafo" ficam distinguíveis só pelo desenho do ícone, num app cujo
público de fato usa as duas coisas para propósitos diferentes. Como o dado já
está lá e a barra tem só 4 itens, mostrar o rótulo abaixo do ícone (padrão de
tab bar do iOS/Android) é uma mudança de CSS mais do que de código.

### Alteração de fundamento

**6. Excluir uma trilha deixa para trás a pasta e os artigos que ela criou.**
`importPathArticles` (`useStore.ts`, linhas 542-589) cria uma pasta com o nome
do objetivo e importa dentro dela um artigo por recurso da Wikipédia; mas
`deletePathRecord` (linhas 519-525) e o `path:delete` do handler só apagam o
JSON da trilha. Quem cria uma trilha, não gosta do resultado e exclui fica com
uma pasta órfã cheia de artigos numerados ("1/Escala maior", "2/Acordes") sem
nada que os ligue de volta a uma trilha que não existe mais — e a sidebar de
pastas acumula essas sobras a cada tentativa. O diálogo de exclusão deveria
perguntar o que fazer com a pasta (manter ou excluir junto, com os artigos indo
para a lixeira já existente), como faz qualquer app que gera conteúdo derivado.

**7. A importação dos artigos da trilha é estritamente sequencial.** Ainda em
`importPathArticles`: três laços aninhados com `await` dentro, um
`wikipedia:fetch` + `saveArticle` de cada vez. Uma trilha típica gerada pelo
prompt atual (~6 unidades × ~5 passos, com recurso de Wikipédia em boa parte
deles) são dezenas de round-trips em série logo depois de o usuário já ter
esperado até um minuto pela geração — no mobile, em rede móvel, é a diferença
entre segundos e minutos. Um `Promise.all` com limite de concorrência (4-6 em
voo) sobre a lista achatada de recursos resolveria sem mudar a modelagem, já
que os artigos são independentes entre si.

**8. Concluir um passo da trilha é irreversível pela interface.** `completeStep`
(`useStore.ts`, linhas 590-608) só caminha para frente: marca `done` e
desbloqueia o seguinte. Não existe "desmarcar" — um toque errado na serpentina
(alvos grandes, lado a lado, no celular) grava progresso falso permanentemente,
e a única saída é excluir a trilha inteira e refazer a entrevista. Como o
desbloqueio é derivado dos `prerequisiteIds`, um `uncompleteStep` que reverta o
passo para `available` e re-tranque os posteriores é simétrico ao que já existe,
não uma exceção ao modelo.

**9. A sincronização cobre só artigos e pastas — flashcards e trilhas não
sincronizam.** `syncHandlers.js` envia `listAllArticles()` + a config `folders`,
e o servidor (`server.js`) tem tabelas só para essas duas coisas. Na prática,
quem usa desktop e celular tem a biblioteca sincronizada mas o agendamento
SM-2 de cada cartão isolado por dispositivo (revisar no celular não adianta o
`due` no desktop, e vice-versa) e as trilhas invisíveis do outro lado — sendo
que revisar no celular e ler no desktop é justamente o uso natural das duas
features. Como flashcards já são um JSON por artigo com `updatedAt` implícito,
a mesma estratégia LWW por id se estende diretamente; trilhas idem.

**10. Cada sincronização empurra a biblioteca inteira, sem delta.** Ainda em
`syncHandlers.js`: `listAllArticles()` monta todos os artigos com conteúdo
completo e faz um POST único (o servidor aceita corpo de até 50 MB), e a
resposta devolve o estado completo de volta. Com poucas dezenas de artigos isso
é irrelevante; com centenas de artigos da Wikipédia (HTML inteiro cada) é um
upload de vários MB a cada toque em "Sincronizar", o que no celular é
custo de dados real. Enviar só o que mudou desde `syncLastRunAt` (que a config
já grava) e pedir ao servidor só os ids mais novos que essa marca resolveria
sem mudar o modelo de merge.

### Novas funcionalidades

**11. A trilha não tem como ser ajustada depois de gerada.** Hoje a única
operação sobre uma trilha existente é concluir passos ou excluí-la inteira: não
dá para renomear o objetivo, reordenar, remover um passo que não interessa,
acrescentar um passo próprio, nem regenerar uma única unidade que ficou ruim.
Isso obriga a refazer a entrevista de 6 perguntas e pagar outra geração
completa (US$ 0,08 a US$ 0,38 pela estimativa do próprio
`estimatePathGenerationCostUsd`) por causa de um bloco ruim entre seis bons.
Edição local de passos (título, objetivo, prática, duração) é puro CRUD sobre
o JSON que já está em disco; "regenerar esta unidade" reaproveita o
`path:generate` com o escopo reduzido.

**12. Não existe nenhum teste automatizado no repositório — e agora há lógica
pura o bastante para justificar os primeiros.** O `package.json` da raiz não
tem script `test` nem dependência de runner, e não há um só arquivo de teste
nos quatro pacotes. As rodadas anteriores já apontavam isso de forma genérica;
o que mudou é que as recomendações 1-3 desta rodada extraem justamente os
candidatos ideais para uma primeira bateria: o parser de flashcards (dezenas de
padrões de Markdown, o tipo de código que quebra em silêncio ao ganhar um caso
novo), o `gradeCard` do SM-2, o `scoreQueryMatch` da busca, o
`estimatePathGenerationCostUsd` e o merge LWW do servidor de sync. Todos são
funções puras, sem Electron nem Capacitor — dá para rodar com o
`node --test` nativo, sem adicionar framework nenhum ao projeto.

---

## Rodada 2026-08-27

Dois commits novos desde a última rodada: `4286aff` (refaz UI mobile/desktop,
accordions de artigo, reduz duplicação Claude) e `47ed441` (abas reais no
mobile, popovers, remoção do resumo automático, contraste dark, view
pastas/soltos) — HEAD atual. Vários itens de rodadas anteriores já foram
resolvidos nesses commits (`TrashModal`, `SettingsModal` unificado em
`shared/components`, busca local via `searchRelevance.ts` no lugar da busca
semântica via Claude, accordions de seção via `wikiAccordions.ts`). Esta
rodada, a pedido, focou **só em usabilidade e UI**: o que simplificar/cortar
na interface atual e o que falta como funcionalidade de interface. 12
recomendações.

### Simplificação e exclusão

**1. Três padrões diferentes de diálogo de confirmação convivem no mesmo
app.** `handleDeleteFolder` no desktop (`App.tsx`) ainda usa `window.confirm`
nativo do SO; a mesma ação no mobile (`ArticleListScreen.tsx`, linhas 55-64)
usa `Dialog.confirm` do Capacitor; e `PathView.tsx` (linhas 61-71) e o
`TrashModal` usam um terceiro componente próprio, `confirmDialog` custom. O
usuário vê três aparências distintas de "tem certeza?" dependendo de qual
ação está confirmando e em qual plataforma — quebra a sensação de app coeso
bem no momento mais sensível (ação destrutiva). Adotar só o `confirmDialog`
custom (o único que já respeita tema e é cross-platform) em todos os pontos
de exclusão eliminaria a inconsistência e ainda reduziria código.

**2. Fileira de ícones sem rótulo se repete em três lugares com o mesmo
problema de descoberta.** A sidebar desktop (`App.tsx`, linhas 590-605), o
cabeçalho de `ArticleListScreen.tsx` no mobile (linhas 155-177) e o
cabeçalho de `ArticleView.tsx` (até 7 ícones em linha, linhas 1941-1997) só
têm `title`/`aria-label` como identificação — nada visível sem hover (que no
touch nem existe). São ações de frequência muito desigual (exportar
Markdown/CSV é raro; buscar-na-página e revisar flashcards são comuns)
tratadas com o mesmo peso visual. Agrupar as ações raras (exportar MD,
exportar CSV, densidade de lista) num menu "Mais ações" (⋯) libera espaço
para dar rótulo textual às ações frequentes que sobram — e reduz o mesmo
problema simultaneamente nos três lugares, já que hoje uma correção não
atravessa as telas.

**3. "Conceitos vinculados" e "Links sugeridos" ocupam o topo do artigo
sempre expandidos, mesmo quando o usuário só quer ler.** `ArticleView.tsx`
(linhas 2006-2062): os dois painéis renderizam sempre que há dados,
empilhados acima do conteúdo, sem opção de recolher — em artigos bem
conectados (o caso que a própria funcionalidade de sugestão de link foi
pensada para beneficiar) o usuário rola por dois blocos de metadado antes de
chegar ao texto que veio ler. Tornar os dois colapsáveis (como os accordions
de seção que o próprio `wikiAccordions.ts` já introduz para o corpo do
artigo) e lembrar o estado por sessão resolveria sem tirar a funcionalidade.

**4. Botão "Salvar" do `SettingsModal` é ambíguo sobre o que realmente
salva.** `SettingsModal.tsx` (linhas 202-204): o botão único no rodapé só
persiste a API key — URL/token de sincronização já gravam sozinhos via
`onBlur` (linhas 68-75), e tema é aplicado on-click. O usuário não tem como
saber, olhando a tela, que só um dos cinco campos depende daquele botão;
clicar "Salvar" depois de mexer só no tema, por exemplo, não faz nada visível
além do toast genérico "✓ Salvo". Ou se remove o botão e cada campo ganha seu
próprio indicador inline de estado salvo (como já ocorre para sync/tema), ou
o botão passa a salvar tudo de uma vez, com um único fluxo consistente.

### Alteração de fundamento

**5. Sumário (TOC) é um modal central que precisa ser reaberto a cada
consulta, em vez de painel lateral persistente.** `ArticleView.tsx` (linha
996, `toc-modal`): consultar o sumário durante a leitura de um artigo longo
exige abrir o modal, clicar no item, ele fecha, e para conferir de novo é
preciso reabrir — em vez do padrão scroll-spy (sumário sempre visível numa
coluna, com o item atual destacado conforme o scroll) mais comum nesse tipo
de app de leitura/estudo. Como o app já tem espaço lateral livre no desktop
quando nenhum painel extra está aberto, um TOC de coluna fixa e colapsável
resolveria o atrito sem regredir no mobile (onde o modal continua fazendo
sentido, por espaço de tela).

**6. Cor de UI definida fora do sistema de variáveis em ~170 pontos do CSS, e
o bloco de tema escuro está espalhado em 7 lugares do arquivo.**
`styles.css` (3016 linhas): a paleta cíclica dos accordions
(`wikiAccordions.ts`, linhas 24-37), os swatches de destaque `.hl-swatch-*`
(linhas 2678-2682, com `!important`) e a paleta de fontes do grafo usam hex
literal em vez das custom properties `--accent`/`--fg`/etc. já definidas em
`:root`. Na prática isso significa que um retint de tema (ex.: usuário pede
"deixa o app mais azul") não se propaga para essas cores, e o próprio tema
escuro — que deveria ser uma decisão central — está reaberto em 7 blocos
`@media (prefers-color-scheme: dark)` diferentes ao longo do arquivo,
dificultando garantir contraste consistente. Migrar essas cores para tokens
nomeados (ex.: `--accordion-1` a `--accordion-12`) e consolidar os blocos de
dark mode resolveria na raiz, não por página.

**7. Accordions de seção da Wikipedia vêm todos fechados, sem ação
"expandir tudo".** `wikiAccordions.ts`: todo H1/H2/H3 do artigo importado
vira `<details>` fechado por padrão (only reabre automaticamente quando a
busca-na-página encontra algo dentro, via `openAncestorDetails`, linhas
120-126). Para quem quer ler o artigo inteiro de uma vez — não só consultar
uma seção pontual — isso obriga abrir cada seção manualmente, inclusive as
aninhadas (H3 dentro de H2). Um botão "expandir tudo / recolher tudo" no
cabeçalho do artigo (estado persistido por artigo, não global) cobriria os
dois modos de leitura sem regredir o comportamento atual como padrão.

**8. Passos bloqueados da trilha de aprendizado não dizem por que estão
bloqueados.** `PathView.tsx`: passos em estado `locked` aparecem `disabled`
simplesmente — sem texto tipo "conclua o passo anterior" nem indicação de
qual é o passo que precisa ser feito primeiro. Como o layout é uma
"serpentina" visual sem numeração explícita sempre visível, um usuário que
entra direto numa trilha em andamento (ex.: retomando dias depois) não
recupera o contexto sem clicar em cada passo bloqueado para ver o que
acontece. Um tooltip ou legenda fixa ("bloqueado até concluir passo N")
resolveria com custo mínimo.

### Novas funcionalidades

**9. Não existe busca de nó dentro do próprio grafo.** `GraphView.tsx`: zoom,
pan e clique em nó já funcionam bem, mas achar um artigo específico num
grafo grande é puramente visual — não há input de busca por título que
centralize e destaque o nó correspondente. Como o grafo já tem um mecanismo
de foco por teclado com anel visual e `aria-live` (linhas 220-229, 454-456)
pensado para navegação sem mouse, um campo de busca que reaproveita esse
mesmo destaque (Enter para focar e centralizar) seria uma extensão natural,
não uma feature nova do zero.

**10. Onboarding wizard só aparece na primeira execução, sem forma de
reabrir.** `App.tsx` (linhas 257-334): o tour de 3 passos (colar API key,
criar primeiro artigo, conhecer o grafo) só dispara automaticamente uma vez;
depois disso não existe nenhum botão "ver tour novamente" em Configurações.
Quem reinstala, troca de máquina, ou simplesmente esqueceu como algo
funciona não tem onde recuperar essa introdução guiada sem reler o README. Um
link discreto em Configurações ("Rever introdução") reaproveitaria o
componente já pronto.

**11. Botão da Lixeira em Configurações não mostra quantos itens tem antes de
abrir.** `SettingsModal.tsx` (linhas 189-198): o item "Lixeira" é só um ícone
e um rótulo fixo, sem contagem — o usuário não sabe se há algo para
restaurar/limpar sem entrar no `TrashModal`. Um badge numérico simples (like
o "Revisar flashcards (N)" que a sidebar já usa) tornaria a lixeira visível
como estado, não só como ação.

**12. Criar artigo não é alcançável pela navegação principal do mobile, e o
destaque de aba erra quando se navega a partir do grafo.** `BottomNav.tsx`
(linhas 16-21) tem 4 abas fixas — Artigos, Trilha, Grafo, Ajustes — mas
nenhuma ação de "novo artigo"; criar só existe dentro da tela de Artigos
(botão "+ Novo artigo" em `ArticleListScreen.tsx`, linha 230), então a partir
das abas Trilha/Grafo/Ajustes é preciso voltar para Artigos primeiro. Some a
isso que `MobileApp.tsx` (linha 84) mapeia a tela "artigo aberto" sempre para
a aba "Artigos" — abrir um artigo a partir do Grafo destaca "Artigos" na
barra inferior mesmo a navegação tendo partido do Grafo, o que confunde sobre
"onde eu estou". Um FAB de "novo artigo" acessível de qualquer aba (ou um
botão fixo na própria BottomNav) resolve o primeiro ponto; manter o
destaque na aba de origem (ou introduzir um estado "nenhuma aba destacada"
quando o artigo foi aberto de outro lugar) resolve o segundo.

---

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
