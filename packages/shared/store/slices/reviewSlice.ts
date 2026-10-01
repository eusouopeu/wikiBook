// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/store/slices/reviewSlice.ts
// Painel de revisão diária — guarda o retrato bruto vindo do host
// (flashcards:overview); as contas ficam em lib/reviewStats.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReviewOverview } from "../../shared/types";
import { ipc } from "../ipc";
import type { ReviewSlice, SliceCreator } from "../types";

export const createReviewSlice: SliceCreator<ReviewSlice> = (set) => ({
  reviewOverview: null,
  loadReviewOverview: async () => {
    const reviewOverview = await ipc<ReviewOverview>("flashcards:overview");
    set({ reviewOverview });
  },
});
