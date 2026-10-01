// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/lib/excerptOutline.ts
// Ordem de exibição dos trechos salvos — extraído de ArticleView.tsx. Puro.
// ─────────────────────────────────────────────────────────────────────────────

import type { Article, ExcerptOutlineItem } from "../shared/types";

// ── Resolve a ordem de exibição dos trechos ───────────────────────────────────
// Usa o outline salvo, mas garante que excerpts novos (ainda não presentes
// nele) apareçam ao final, e descarta entradas órfãs (excerpt já removido).
export function resolveOutline(article: Article): ExcerptOutlineItem[] {
  const outline = article.excerptOutline ?? [];
  const existingIds = new Set(article.excerpts.map(e => e.id));
  const pruned = outline.filter(item => item.type === "heading" || existingIds.has(item.id));
  const known = new Set(pruned.filter(item => item.type === "excerpt").map(item => (item as { id: string }).id));
  const missing = article.excerpts
    .filter(e => !known.has(e.id))
    .map((e): ExcerptOutlineItem => ({ type: "excerpt", id: e.id }));
  return [...pruned, ...missing];
}
