// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/store/useStore.ts
// Store Zustand central — compartilhado entre desktop e mobile. Só junta as
// fatias de store/slices/*.ts; o formato de cada uma está em store/types.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import type { AppState } from "./types";
import { createArticlesSlice } from "./slices/articlesSlice";
import { createPathsSlice } from "./slices/pathsSlice";
import { createFoldersSlice } from "./slices/foldersSlice";
import { createReviewSlice } from "./slices/reviewSlice";
import { createUiSlice } from "./slices/uiSlice";

export type { ThemeMode, AppView } from "./types";
export { computeLocalSubgraph } from "./graphData";

export const useStore = create<AppState>()((...a) => ({
  ...createArticlesSlice(...a),
  ...createPathsSlice(...a),
  ...createFoldersSlice(...a),
  ...createReviewSlice(...a),
  ...createUiSlice(...a),
}));
