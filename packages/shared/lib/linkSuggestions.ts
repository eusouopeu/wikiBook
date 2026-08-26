// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/lib/linkSuggestions.ts
// Sugestão automática de links internos. Antes só funcionava para artigos da
// Wikipedia, casando <span class="wiki-term"> (o que era <a> no HTML
// original) por igualdade exata de título em minúsculas — artigos gerados
// pelo Claude e manuais (a maioria da base de quem usa o app há algum tempo)
// nunca recebiam sugestão nenhuma, e "fotossíntese" no texto não casava com
// "Fotossíntese (processo)".
//
// Agora combina dois sinais:
//   1. wiki-term (só Wikipedia) — sinal mais confiável, a própria Wikipedia
//      já marcou aquele termo como conceito linkável.
//   2. varredura do texto puro de QUALQUER fonte em busca do título de outro
//      artigo já existente, por palavra inteira, sem diferenciar acento ou
//      maiúsculas/minúsculas.
// ─────────────────────────────────────────────────────────────────────────────

import type { Article } from "../shared/types";

export interface LinkSuggestion { term: string; target: Article }

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

const WIKI_TERM_RE = /<span class="wiki-term">([\s\S]*?)<\/span>/g;

export function findLinkSuggestions(article: Article, articles: Article[]): LinkSuggestion[] {
  const linkedTargetIds = new Set(article.links.map(l => l.targetId));
  const others = articles.filter(a => a.id !== article.id && !linkedTargetIds.has(a.id));
  if (others.length === 0) return [];

  const seenTargetIds = new Set<string>();
  const suggestions: LinkSuggestion[] = [];

  // 1) Wikipedia: termos que eram <a> no HTML original
  if (article.source === "wikipedia" && article.content) {
    const titleIndex = new Map(others.map(a => [normalize(a.title), a]));
    let m: RegExpExecArray | null;
    WIKI_TERM_RE.lastIndex = 0;
    while ((m = WIKI_TERM_RE.exec(article.content)) !== null) {
      const raw = m[1].replace(/<[^>]+>/g, "").trim();
      if (!raw) continue;
      const target = titleIndex.get(normalize(raw));
      if (!target || seenTargetIds.has(target.id)) continue;
      seenTargetIds.add(target.id);
      suggestions.push({ term: raw, target });
    }
  }

  // 2) Qualquer fonte: título de outro artigo aparecendo no texto puro, por
  // palavra inteira (evita casar "sol" dentro de "solução"). Títulos mais
  // longos primeiro — "Fotografia digital" deve vencer "Fotografia" quando
  // os dois aparecem no mesmo trecho.
  const plainText = (article.content || article.summary || "").replace(/<[^>]+>/g, " ");
  const normalizedPlain = normalize(plainText);
  const candidates = others
    .filter(a => !seenTargetIds.has(a.id) && a.title.trim().length >= 3)
    .sort((a, b) => b.title.length - a.title.length);

  for (const target of candidates) {
    const normTitle = normalize(target.title.trim());
    const idx = normalizedPlain.indexOf(normTitle);
    if (idx === -1) continue;
    const before = idx === 0 ? " " : normalizedPlain[idx - 1];
    const afterIdx = idx + normTitle.length;
    const after = afterIdx >= normalizedPlain.length ? " " : normalizedPlain[afterIdx];
    if (/[a-z0-9]/i.test(before) || /[a-z0-9]/i.test(after)) continue;
    const original = plainText.slice(idx, afterIdx).trim();
    if (!original) continue;
    seenTargetIds.add(target.id);
    suggestions.push({ term: original, target });
  }

  return suggestions;
}
