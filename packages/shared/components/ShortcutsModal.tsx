// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/ShortcutsModal.tsx
// Lista de atalhos de teclado do desktop (tecla "?").
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import { useEscToClose } from "../lib/useEscToClose";

const SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: "⌘N", label: "Novo artigo" },
  { keys: "⌘F", label: "Buscar na sidebar" },
  { keys: "⌘B", label: "Mostrar/ocultar sidebar" },
  { keys: "⌘[", label: "Artigo anterior" },
  { keys: "⌘]", label: "Próximo artigo" },
  { keys: "?", label: "Esta lista de atalhos" },
  { keys: "Esc", label: "Fechar modal/painel" },
];

export const ShortcutsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useEscToClose(onClose);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Atalhos de teclado</h2>
        <ul className="shortcuts-list">
          {SHORTCUTS.map(s => (
            <li key={s.keys}><kbd>{s.keys}</kbd><span>{s.label}</span></li>
          ))}
        </ul>
        <div className="modal-actions">
          <button onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
};
