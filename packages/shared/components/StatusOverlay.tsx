// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/StatusOverlay.tsx
// Toasts + indicador de tarefa em andamento do desktop.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import { useStore } from "../store/useStore";

export const StatusOverlay: React.FC = () => {
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
};
