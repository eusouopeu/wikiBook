// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/lib/sectionsToc.ts
// Itens/ids do sumário de seções do artigo — extraído de ArticleView.tsx. Puro.
// ─────────────────────────────────────────────────────────────────────────────



// ── Sumário (Conteúdo) — lista de seções do artigo, estilo app da Wikipedia ──
export interface TocItem { id: string; text: string; level: number; }

export function slugifyHeading(text: string, used: Set<string>): string {
  const base = text.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "secao";
  let id = base, n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}
