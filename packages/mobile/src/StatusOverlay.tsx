// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/StatusOverlay.tsx
// Réplica do StatusOverlay inline de App.tsx (desktop) — várias actions do
// store (fetchFromWikipedia, addLink, ArticleView etc.) já chamam
// showToast()/pendingTask desde as fases anteriores; nada no mobile
// renderizava esse estado até agora. Reaproveita .status-overlay/.toast/
// .pending-banner de @lexicon/shared/styles.css sem alteração.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import { useStore } from "@lexicon/shared";

export function StatusOverlay() {
  const toast = useStore(s => s.toast);
  const pendingTask = useStore(s => s.pendingTask);
  if (!toast && !pendingTask) return null;
  return (
    <div className="status-overlay">
      {pendingTask && (
        <div className="pending-banner">
          <span className="spinner" />
          {pendingTask}
        </div>
      )}
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.message}
          {toast.action && (
            <button type="button" className="toast-action-btn" onClick={toast.action.onClick}>
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
