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
  const toasts = useStore(s => s.toasts);
  const pendingTask = useStore(s => s.pendingTask);
  const dismissToast = useStore(s => s.dismissToast);
  if (toasts.length === 0 && !pendingTask) return null;
  return (
    <div className="status-overlay">
      {pendingTask && (
        <div className="pending-banner">
          <span className="spinner" />
          {pendingTask}
        </div>
      )}
      {toasts.map(toast => (
        <div key={toast.id} className={`toast toast-${toast.type}`} onClick={() => dismissToast(toast.id)}>
          {toast.message}
          {toast.action && (
            <button
              type="button"
              className="toast-action-btn"
              onClick={e => { e.stopPropagation(); toast.action!.onClick(); }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
