// ─────────────────────────────────────────────────────────────────────────────
// src/shared/types.ts
// ─────────────────────────────────────────────────────────────────────────────

// Um trecho salvo manualmente pelo usuário a partir de outro artigo.
// html: fragmento HTML sanitizado (formatação mantida, hrefs removidos) — captura ORIGINAL, imutável
// plainText: versão em texto puro do html original — baseline imutável usada para
//   diff de edição (marcação de adições/remoções) e para busca/dedup
//   - kind "text"  → texto extraído do html
//   - kind "table" → tabela Markdown equivalente (colunas/linhas preservadas)
//   - kind "image" → alt text (ou rótulo padrão)
// editedMarkdown: presente em trechos "text"/"table" que o usuário editou pelo
//   editor — fonte de verdade para exibição e (para "text") para o parser de
//   flashcards. Em "table", é a tabela em Markdown editada célula a célula.
// category: cor de fundo semântica escolhida ao salvar o trecho
//   default (creme) | concept (azul) | list (verde) | numeric (roxo)
// kind ausente (dados legados) equivale a "text"; category ausente = "default"
export type ExcerptCategory = "default" | "concept" | "list" | "numeric";

export interface ArticleExcerpt {
  id: string;
  kind?: "text" | "image" | "table";
  category?: ExcerptCategory;
  html: string;
  plainText: string;
  editedMarkdown?: string;
  sourceArticleId: string;
  sourceArticleTitle: string;
  savedAt: string;
  updatedAt?: string;
}

// Item do sumário/ordem de exibição dos trechos — permite agrupar sob headings
// e reordenar por arraste. Ausência de outline no artigo = ordem padrão de excerpts.
export type ExcerptOutlineItem =
  | { type: "excerpt"; id: string }
  | { type: "heading"; id: string; text: string };

export interface Article {
  id: string;
  title: string;
  source: "wikipedia" | "claude" | "manual";
  // wikipedia: HTML sanitizado; manual: Markdown editado pelo usuário; claude: vazio
  content: string;
  summary: string;
  links: ArticleLink[];
  excerpts: ArticleExcerpt[];
  excerptOutline?: ExcerptOutlineItem[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ArticleLink {
  id: string;
  anchorText: string;
  targetId: string;
  targetTitle: string;
  createdAt: string;
}

export interface GraphNode {
  id: string;
  title: string;
  source: Article["source"];
  tags: string[];
  depth: number;
  radius: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  anchorText: string;
}

// ── Flashcards (repetição espaçada, estilo Obsidian Spaced Repetition) ───────
// Gerados a partir de padrões Markdown no conteúdo de artigos manuais e em
// trechos editados ("==destaque==" → cloze c1, "++destaque++" → cloze c2,
// listas → cloze simultâneo, "Pergunta? resposta" / "Termo: definição" → card
// pergunta/resposta, "=" → básico, "==" solto → invertido).
// Agendamento via SM-2 simplificado.
export type FlashcardKind = "basic" | "reversed" | "cloze" | "enum-cloze" | "qa";
export type FlashcardGrade = "again" | "hard" | "good" | "easy";

export interface Flashcard {
  id: string;
  articleId: string;
  articleTitle: string;
  kind: FlashcardKind;
  front?: string;          // basic/reversed
  back?: string;           // basic/reversed
  clozeText?: string;      // cloze/enum-cloze — contém {{c1::...}}
  clozeGroup?: number;     // cloze/enum-cloze — grupo escondido por este card (1 = c1, 2 = c2…)
  sourceLine: string;      // texto de origem, usado para preservar agendamento entre regenerações
  sourceExcerptId?: string;
  frontBackIndex?: number; // 0/1 (direções de "reversed") ou nº do grupo de cloze
  createdAt: string;
  due: string;
  interval: number;
  ease: number;
  reps: number;
  lapses: number;
}

export type IpcChannel =
  | "article:list"
  | "article:get"
  | "article:save"
  | "article:delete"
  | "article:addLink"
  | "article:removeLink"
  | "article:appendExcerpt"
  | "article:appendImage"
  | "article:removeExcerpt"
  | "article:updateExcerpt"
  | "article:updateExcerptOutline"
  | "article:exportMarkdown"
  | "article:exportFlashcardsCsv"
  | "wikipedia:fetch"
  | "wikipedia:search"
  | "claude:summarize"
  | "claude:generate"
  | "claude:ask"
  | "flashcards:regenerate"
  | "flashcards:list"
  | "flashcards:listDue"
  | "flashcards:grade"
  | "config:get"
  | "config:set";

export interface IpcRequest<T = unknown> { channel: IpcChannel; payload?: T; }
export interface IpcResponse<T = unknown> { ok: boolean; data?: T; error?: string; }
