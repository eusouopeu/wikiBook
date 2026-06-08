// ─────────────────────────────────────────────────────────────────────────────
// src/shared/types.ts
// ─────────────────────────────────────────────────────────────────────────────

// Um trecho salvo manualmente pelo usuário a partir de outro artigo.
// html: fragmento HTML sanitizado (formatação mantida, hrefs removidos)
// plainText: versão em texto puro usada para prévia e deduplicação
export interface ArticleExcerpt {
  id: string;
  html: string;
  plainText: string;
  sourceArticleId: string;
  sourceArticleTitle: string;
  savedAt: string;
}

export interface Article {
  id: string;
  title: string;
  source: "wikipedia" | "claude" | "manual";
  content: string;
  summary: string;
  links: ArticleLink[];
  excerpts: ArticleExcerpt[];
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

export type IpcChannel =
  | "article:list"
  | "article:get"
  | "article:save"
  | "article:delete"
  | "article:addLink"
  | "article:removeLink"
  | "article:appendExcerpt"
  | "article:removeExcerpt"
  | "wikipedia:fetch"
  | "claude:summarize"
  | "claude:generate"
  | "config:get"
  | "config:set";

export interface IpcRequest<T = unknown> { channel: IpcChannel; payload?: T; }
export interface IpcResponse<T = unknown> { ok: boolean; data?: T; error?: string; }
