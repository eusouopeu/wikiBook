// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/lib/searchHighlight.tsx
// Realce do termo buscado nos resultados — usado por App.tsx (desktop) e
// ArticleListScreen.tsx (mobile). Quando o match está só no corpo (não no
// título), monta um trecho de contexto ao redor da primeira ocorrência.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";

// Marca a primeira ocorrência de qualquer token da query dentro de `text`,
// preservando o texto original (só quebra em 3 pedaços: antes/match/depois).
export function highlightMatch(text: string, query: string): React.ReactNode {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return text;
  const lower = text.toLowerCase();
  let bestIdx = -1;
  let bestLen = 0;
  for (const tok of tokens) {
    const idx = lower.indexOf(tok);
    if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) { bestIdx = idx; bestLen = tok.length; }
  }
  if (bestIdx === -1) return text;
  return (
    <>
      {text.slice(0, bestIdx)}
      <mark className="search-highlight">{text.slice(bestIdx, bestIdx + bestLen)}</mark>
      {text.slice(bestIdx + bestLen)}
    </>
  );
}

// Trecho de ~90 caracteres ao redor da primeira ocorrência de um token da
// query dentro de `body` (já em texto puro, sem HTML) — null se não achar
// nada (título já cobre o match, ou blob não contém a query por algum motivo
// de tokenização diferente do índice).
export function extractSnippet(body: string, query: string, radius = 60): { before: string; match: string; after: string } | null {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const lower = body.toLowerCase();
  let bestIdx = -1;
  let bestLen = 0;
  for (const tok of tokens) {
    const idx = lower.indexOf(tok);
    if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) { bestIdx = idx; bestLen = tok.length; }
  }
  if (bestIdx === -1) return null;
  const start = Math.max(0, bestIdx - radius);
  const end = Math.min(body.length, bestIdx + bestLen + radius);
  return {
    before: (start > 0 ? "…" : "") + body.slice(start, bestIdx),
    match: body.slice(bestIdx, bestIdx + bestLen),
    after: body.slice(bestIdx + bestLen, end) + (end < body.length ? "…" : ""),
  };
}
