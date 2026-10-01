// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/SectionsTocPanel.tsx
// Modal "Conteúdo" (sumário de seções) — extraído de ArticleView.tsx.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import type { TocItem } from "../lib/sectionsToc";

export const SectionsTocPanel: React.FC<{
  items: TocItem[]; onJump: (id: string) => void; onClose: () => void;
}> = ({ items, onJump, onClose }) => (
  <div className="modal-overlay" onClick={onClose}>
    <div className="modal toc-modal" onClick={e => e.stopPropagation()}>
      <h2>Conteúdo</h2>
      <ul className="toc-sections-list">
        {items.map(item => (
          <li key={item.id} className={`toc-sections-item toc-level-${item.level}`}>
            <button type="button" onClick={() => onJump(item.id)}>{item.text}</button>
          </li>
        ))}
      </ul>
      <div className="modal-actions">
        <button onClick={onClose}>Fechar</button>
      </div>
    </div>
  </div>
);
