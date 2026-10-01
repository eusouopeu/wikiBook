// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/screens/ReviewScreen.tsx
// Aba "Revisão" do mobile: ReviewDashboard compartilhado + a sessão de
// revisão global (ReviewModal) aberta pelo botão "Revisar agora".
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from "react";
import { ReviewDashboard, ReviewModal, TopBar, useStore } from "@lexicon/shared";
import type { Flashcard, FlashcardGrade } from "@lexicon/shared";

export function ReviewScreen() {
  const requestSearchFocus = useStore(s => s.requestSearchFocus);
  const loadReviewOverview = useStore(s => s.loadReviewOverview);
  const [dueCards, setDueCards] = useState<Flashcard[] | null>(null);

  async function handleStartReview() {
    const res = await window.lexicon.invoke("flashcards:listDue");
    if (res.ok) setDueCards(res.data as Flashcard[]);
  }

  async function handleGrade(articleId: string, cardId: string, grade: FlashcardGrade) {
    await window.lexicon.invoke("flashcards:grade", { articleId, cardId, grade });
  }

  return (
    <div className="mobile-review-screen">
      <TopBar title="Revisão" onSearch={requestSearchFocus} />
      <ReviewDashboard onStartReview={handleStartReview} />
      {dueCards && (
        <ReviewModal
          cards={dueCards}
          onGrade={handleGrade}
          onClose={() => { setDueCards(null); loadReviewOverview().catch(() => {}); }}
        />
      )}
    </div>
  );
}
