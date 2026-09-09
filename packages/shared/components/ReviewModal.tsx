// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/ReviewModal.tsx
// Modal de revisão (SM-2) — extraído de ArticleView.tsx (que tinha crescido
// para 2400+ linhas cobrindo leitor, editor de trechos, histórico, anexos e
// isto tudo junto). Reaproveitado tanto pela revisão por artigo quanto pela
// revisão global (ver App.tsx) — sem estado externo além das props.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect } from "react";
import type { Flashcard, FlashcardGrade } from "../shared/types";
import { Icon } from "./Icon";
import { stripInlineMarkers, renderClozeForReview } from "../lib/flashcardDisplay";

export const ReviewModal: React.FC<{
  cards: Flashcard[];
  onGrade: (articleId: string, cardId: string, grade: FlashcardGrade) => Promise<void>;
  onClose: () => void;
}> = ({ cards, onGrade, onClose }) => {
  const [queue, setQueue] = useState(cards);
  const [revealed, setRevealed] = useState(false);
  // Total fixado no início da sessão — a fila (queue) só encolhe conforme o
  // usuário avalia cartões, então "total - queue.length" é a posição atual.
  const [total] = useState(cards.length);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const current = queue[0];

  async function handleGrade(grade: FlashcardGrade) {
    if (!current) return;
    await onGrade(current.articleId, current.id, grade);
    setQueue(q => q.slice(1));
    setRevealed(false);
  }

  if (!current) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal review-modal" onClick={e => e.stopPropagation()}>
          <h2>Revisão concluída <Icon name="done" /></h2>
          <p>Nenhum flashcard vencido no momento.</p>
          <div className="modal-actions"><button className="primary" onClick={onClose}>Fechar</button></div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal review-modal" onClick={e => e.stopPropagation()}>
        <div className="review-modal-header">
          <span className="review-progress">
            {total - queue.length + 1} de {total}
            <span className="review-progress-remaining"> · {queue.length} restante{queue.length > 1 ? "s" : ""}</span>
          </span>
          <span className="review-article-title">{current.articleTitle}</span>
        </div>
        <div className="review-progress-bar">
          <div className="review-progress-bar-fill" style={{ width: `${((total - queue.length) / total) * 100}%` }} />
        </div>

        <div className="review-card">
          {(current.kind === "cloze" || current.kind === "enum-cloze") ? (
            <div className="review-cloze"
                 dangerouslySetInnerHTML={{ __html: renderClozeForReview(current.clozeText ?? "", revealed, current.clozeGroup ?? 1) }} />
          ) : (
            <>
              <div className="review-front">
                {current.kind === "qa"
                  ? <strong>{stripInlineMarkers(current.front ?? "")}</strong>
                  : stripInlineMarkers(current.front ?? "")}
              </div>
              {revealed && <div className="review-back">{stripInlineMarkers(current.back ?? "")}</div>}
            </>
          )}
        </div>

        <div className="review-actions">
          {!revealed ? (
            <button className="primary" onClick={() => setRevealed(true)}>Mostrar resposta</button>
          ) : (
            <>
              <button className="review-grade review-grade-again" onClick={() => handleGrade("again")}>Errei</button>
              <button className="review-grade review-grade-hard" onClick={() => handleGrade("hard")}>Difícil</button>
              <button className="review-grade review-grade-good" onClick={() => handleGrade("good")}>Bom</button>
              <button className="review-grade review-grade-easy" onClick={() => handleGrade("easy")}>Fácil</button>
            </>
          )}
        </div>
        <button className="review-close-btn" onClick={onClose}>Fechar revisão</button>
      </div>
    </div>
  );
};
