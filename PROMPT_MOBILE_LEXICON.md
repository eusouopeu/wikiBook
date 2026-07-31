# Criar versão mobile do Lexicon

## Contexto

Tenho um app desktop chamado **Lexicon** — uma base de conhecimento pessoal com grafo de conceitos, construído em Electron + React + TypeScript. Quero uma **versão mobile** (iOS/Android) com a mesma proposta de valor, adaptada aos padrões de interação mobile. Este documento descreve a arquitetura e as funcionalidades do app original para você usar como especificação.

## O que o app faz

Lexicon é uma "Wikipedia pessoal com hipertexto": o usuário cria artigos (vindos da Wikipedia, gerados pela API da Anthropic, ou escritos manualmente), liga trechos de um artigo a outros artigos (criando uma rede de conhecimento), visualiza tudo como um grafo interativo, e pode transformar trechos de texto em flashcards com repetição espaçada (estilo Anki/SM-2).

## Arquitetura atual (desktop)

- **Shell**: Electron 31 — processo main (Node) + processo renderer (Chromium)
- **UI**: React 18 + TypeScript, bundlado com esbuild
- **Estado**: Zustand (store único em `useStore.ts`)
- **Grafo**: D3 v7 (force-directed graph, zoom/pan via `d3-zoom`)
- **Persistência**: arquivos JSON locais em disco (um arquivo por artigo), sem banco de dados, sem sync em nuvem
- **IPC**: bridge segura via `contextBridge`/`ipcRenderer`, handlers organizados por domínio (`articleHandlers.js`, `wikipediaHandlers.js`, `claudeHandlers.js`, `flashcardHandlers.js`, `configHandlers.js`)
- **APIs externas**: Wikipedia REST API (conteúdo) e Anthropic API (resumos/geração — requer API key do usuário, salva localmente)

## Modelo de dados

```ts
interface Article {
  id: string;
  title: string;
  source: "wikipedia" | "claude" | "manual";
  content: string;          // HTML sanitizado (wikipedia) ou Markdown (manual); vazio para "claude"
  summary: string;          // resumo em bullet points
  links: ArticleLink[];     // hiperlinks para outros artigos, registrados no artigo-PAI
  excerpts: ArticleExcerpt[]; // trechos salvos de OUTROS artigos (citações internas)
  excerptOutline?: ExcerptOutlineItem[]; // ordem de exibição, com headings agrupadores
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface ArticleLink {
  id: string;
  anchorText: string;       // texto selecionado que virou o link
  targetId: string;
  targetTitle: string;
  createdAt: string;
}

interface ArticleExcerpt {
  id: string;
  kind?: "text" | "image" | "table";
  category?: "default" | "concept" | "list" | "numeric"; // cor semântica
  html: string;             // captura original imutável
  plainText: string;        // baseline para diff de edição
  editedMarkdown?: string;  // versão editada pelo usuário (fonte de verdade p/ exibição)
  sourceArticleId: string;
  sourceArticleTitle: string;
  savedAt: string;
  updatedAt?: string;
}

interface Flashcard {
  id: string;
  articleId: string;
  kind: "basic" | "reversed" | "cloze" | "enum-cloze" | "qa";
  front?: string; back?: string;        // basic/reversed
  clozeText?: string; clozeGroup?: number; // cloze — sintaxe {{c1::...}}
  sourceLine: string;       // preserva agendamento entre regenerações
  due: string; interval: number; ease: number; reps: number; lapses: number; // SM-2
}
```

Cálculo do grafo: nós-raiz (sem pai) são os maiores; cada nível de profundidade (BFS a partir das raízes) fica 20% menor (`BASE_RADIUS × 1.2^(maxDepth - depth)`). Um nó com múltiplos pais usa a menor profundidade encontrada.

## Funcionalidades a portar

1. **Lista de artigos** (sidebar no desktop) — busca full-text (título + resumo + conteúdo + trechos + tags), filtro por tag, indicador de nº de links, badge de origem (cor por `source`).
2. **Criar artigo**:
   - Buscar na Wikipedia (autocomplete com debounce de 400ms) → busca, sanitiza HTML (remove todos os `href`, infoboxes, referências, navegação — vira `<span class="wiki-term">`), gera resumo em bullets via Claude.
   - Gerar com Claude — a partir de um título, gera artigo-resumo em bullets.
   - Manual — usuário escreve em Markdown.
3. **Visualização de artigo** — conteúdo renderizado, seleção de texto (uma ou mais palavras) aciona menu de ação: "Pesquisar na Wikipedia" ou "Gerar artigo com Claude" → cria o artigo-filho e registra o link automaticamente no artigo-pai. Trechos importados de outros artigos (excerpts) aparecem com cor de fundo por categoria, editáveis, reordenáveis, agrupáveis sob headings.
4. **Grafo interativo** — todos os artigos como nós conectados por arestas (hover mostra o `anchorText`); zoom/pan; toggle Global vs Local (artigo ativo + N saltos, 1 ou 2); botões de zoom in/out/reset; clique no nó abre o artigo.
5. **Flashcards** — geração automática a partir de padrões Markdown (`==destaque==` → cloze c1, `++destaque++` → cloze c2, listas → cloze simultâneo, "Pergunta? resposta" ou "Termo: definição" → qa, `=` → básico, `==` solto → invertido). Revisão com agendamento SM-2 (again/hard/good/easy), badge de cards vencidos, revisão global (todos os artigos) ou por artigo.
6. **Exportação** — Markdown (compatível com Obsidian, um arquivo por artigo) e flashcards em CSV (formato Anki).
7. **Configurações** — API key da Anthropic (input tipo password, persistida localmente), idioma da busca Wikipedia (pt/en/es/fr/de/it).
8. **Toasts e indicador de tarefa em andamento** (loading state para chamadas assíncronas).

## Stack escolhida: Capacitor

Já decidi ir de **Capacitor**, não React Native — o app é 100% React + D3 + Zustand rodando em Chromium (Electron), e Capacitor embala essa mesma base web numa WebView nativa (iOS/Android) trocando só a camada de host (Electron → Capacitor). Isso preserva quase todo o código do renderer sem reescrita, incluindo o grafo D3 (que roda em WebView normalmente, ao contrário de React Native onde precisaria virar SVG nativo).

O que se reaproveita quase sem alteração:
- `App.tsx`, `GraphView.tsx` (D3 puro — zoom, force-directed, tudo funciona em WebView), `ArticleView.tsx`, `useStore.ts`, `styles.css`, `src/shared/types.ts`
- `dompurify` para sanitização do HTML da Wikipedia (WebView tem DOM real)
- Chamadas `fetch` para Wikipedia REST API e Anthropic API

O que precisa trocar (Electron → Capacitor):
- **IPC (`ipcRenderer`/`contextBridge`) → Plugins Capacitor**: os handlers atuais (`articleHandlers.js`, `configHandlers.js`, `wikipediaHandlers.js`, `claudeHandlers.js`, `flashcardHandlers.js`) fazem operações que hoje rodam no processo main do Node; em Capacitor viram chamadas diretas a plugins a partir do próprio renderer (não há processo main separado).
- **Persistência de artigos (JSON em disco)** → `@capacitor/filesystem`, mantendo a mesma modelagem (um arquivo por artigo) ou migrando para `@capacitor-community/sqlite` se quiser full-text search mais robusto. Pode manter a estratégia de arquivos JSON do desktop como MVP.
- **API key da Anthropic** → armazenamento seguro nativo via `capacitor-secure-storage-plugin` (Keychain/Keystore), nunca `localStorage`/`Preferences` puro.
- **Menu de contexto por seleção de texto** (hoje botão direito): adaptar para toque longo → `@capacitor/action-sheet` ou menu customizado em React, com as mesmas duas opções ("Pesquisar na Wikipedia" / "Gerar artigo com Claude").
- **Layout de 3 colunas (sidebar fixa + conteúdo + grafo)**: repensar como navegação por tabs/stack mobile (ex.: tab bar inferior Artigos / Grafo / Flashcards / Config) — isso é CSS/React, não exige trocar de framework.
- **CORS para chamadas à Wikipedia/Anthropic a partir da WebView**: validar se precisa do plugin `@capacitor/http` (contorna CORS fazendo a chamada nativa) em vez de `fetch` direto.
- **Diálogos de exportação (Markdown/CSV)** hoje usam APIs de filesystem do Electron (`dialog.showSaveDialog`) → trocar por `@capacitor/filesystem` + `@capacitor/share` (compartilhar o arquivo gerado) ou salvar direto na pasta de Documentos do app.

## Peço que você

1. Rode `npx cap init` sobre a base atual do projeto (ou um novo diretório mobile, a definir comigo) e proponha a estrutura final: o quanto reaproveitamos do `src/renderer` como está vs. o que precisa de um diretório separado por causa das diferenças de host.
2. Liste explicitamente, antes de codar, quais plugins Capacitor vai usar para cada ponto de troca acima (filesystem, secure storage, action sheet, http) e por quê.
3. Depois de eu aprovar a estrutura, comece pela camada de persistência (substituindo os handlers do Electron) + a tela de lista de artigos, e siga incrementalmente pelas funcionalidades listadas na seção anterior, em ordem de prioridade a combinar comigo.
4. Sinalize explicitamente qualquer funcionalidade do desktop que for simplificar, adiar ou substituir por uma alternativa mobile — não decida silenciosamente.
