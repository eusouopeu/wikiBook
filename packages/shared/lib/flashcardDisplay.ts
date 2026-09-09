// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/lib/flashcardDisplay.ts
// Formatação de EXIBIÇÃO de flashcards — extraído de components/ArticleView.tsx
// ao separar ReviewModal em arquivo próprio (ver ReviewModal.tsx): as duas
// telas de revisão (por artigo e global) e a lista de flashcards do artigo
// precisavam das mesmas três funções, então viraram lib em vez de duplicadas.
// Puro — sem estado, sem DOM além de escapeHtml.
// ─────────────────────────────────────────────────────────────────────────────

import { escapeHtml } from "./markdown";

// Remove marcadores de formatação inline na EXIBIÇÃO de flashcards — o card
// armazenado mantém a sintaxe crua (estabilidade do merge por sourceLine),
// mas o usuário não precisa ler "**" ou "[x]{.def}" durante a revisão
export function stripInlineMarkers(text: string): string {
  return text
    .replace(/\]\{[^}]*\}/g, "")
    .replace(/\*\*|\+\+|==/g, "")
    .replace(/\[/g, "");
}

// Esconde só o grupo ativo (c1 amarelo / c2 laranja); os demais grupos aparecem
// como texto normal — cada grupo é um card separado.
export function renderClozePreview(clozeText: string, group = 1): string {
  const replaced = clozeText.replace(/\{\{c(\d+)::(.+?)\}\}/g,
    (_, n, inner) => (Number(n) === group ? "[...]" : inner));
  return stripInlineMarkers(replaced);
}

export function renderClozeForReview(clozeText: string, revealed: boolean, group = 1): string {
  // Protege os placeholders de cloze antes de limpar marcadores ("[...]" tem "[")
  const cleaned = clozeText.replace(/\{\{c(\d+)::(.+?)\}\}/g,
    (_, n, inner) => `{{c${n}::${stripInlineMarkers(inner)}}}`);
  const parts = cleaned.split(/(\{\{c\d+::.+?\}\})/);
  const escaped = parts.map(p => {
    const m = p.match(/^\{\{c(\d+)::(.+?)\}\}$/);
    if (m) {
      if (Number(m[1]) !== group) return escapeHtml(m[2]);   // outro grupo: visível
      return revealed
        ? `<mark class="cloze-revealed">${escapeHtml(m[2])}</mark>`
        : '<span class="cloze-blank">[...]</span>';
    }
    return escapeHtml(stripInlineMarkers(p));
  });
  return escaped.join("");
}
