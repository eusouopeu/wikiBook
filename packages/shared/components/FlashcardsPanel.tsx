// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/FlashcardsPanel.tsx
// Lista de flashcards do artigo + botão de revisão — extraído de
// ArticleView.tsx (a revisão em si é o ReviewModal).
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import type { Flashcard } from "../shared/types";
import { Icon } from "./Icon";
import { stripInlineMarkers, renderClozePreview } from "../lib/flashcardDisplay";

// ── Flashcards ─────────────────────────────────────────────────────────────────
const FLASHCARD_KIND_LABEL: Record<string, string> = {
  basic: "Básico", reversed: "Invertido", cloze: "Cloze", "enum-cloze": "Cloze (enumeração)",
  qa: "Pergunta",
};

export const FlashcardsPanel: React.FC<{
  cards: Flashcard[];
  loading: boolean;
  onStartReview: () => void;
}> = ({ cards, loading, onStartReview }) => {
  const now = new Date().toISOString();
  const dueCount = cards.filter(c => c.due <= now).length;
  return (
    <div className="flashcards-panel">
      <div className="excerpts-panel-header">
        <h2 className="section-heading">Flashcards ({cards.length})</h2>
        <div className="flashcards-panel-actions">
          {/* Sem botão manual de regenerar: já roda sozinho depois de cada
              salvamento de artigo/trecho (ver handleRegenerateFlashcards) —
              loading só desabilita a revisão enquanto isso acontece. */}
          <button
            type="button"
            className="icon-btn primary flashcards-review-btn"
            onClick={onStartReview}
            disabled={dueCount === 0 || loading}
            title={`Revisar flashcards (${dueCount} vencido${dueCount === 1 ? "" : "s"})`}
            aria-label={`Revisar flashcards (${dueCount} vencido${dueCount === 1 ? "" : "s"})`}
          >
            <Icon name="flashcards" />
            {dueCount > 0 && <span className="flashcards-review-badge">{dueCount}</span>}
          </button>
        </div>
      </div>
      {cards.length === 0 ? (
        <p className="flashcards-empty-hint">
          Nenhum flashcard ainda. Use "==amarelo==" (cloze c1), "++laranja++" (cloze c2),
          listas ("1.", "a)", "-") viram cloze escondendo os itens, "Pergunta? resposta"
          ou "Termo: definição" viram card frente/verso, "texto = texto" (básico) e
          "texto == texto" solto (invertido) — no conteúdo manual ou em trechos editados.
        </p>
      ) : (
        <ul className="flashcards-list">
          {cards.map(c => (
            <li key={c.id} className="flashcard-item">
              <span className="flashcard-kind-badge">{FLASHCARD_KIND_LABEL[c.kind]}</span>
              <span className="flashcard-preview">
                {c.kind === "cloze" || c.kind === "enum-cloze"
                  ? renderClozePreview(c.clozeText ?? "", c.clozeGroup ?? 1)
                  : `${stripInlineMarkers(c.front ?? "")} → ${stripInlineMarkers(c.back ?? "")}`}
              </span>
              <span className="flashcard-due">
                {c.due <= now ? "vencido" : `revisar em ${new Date(c.due).toLocaleDateString("pt-BR")}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
