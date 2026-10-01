// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/BacklinksPanel.tsx
// Painel "Referenciado por" — extraído de ArticleView.tsx.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import { Icon } from "./Icon";

// ── Painel de backlinks ("Referenciado por") ──────────────────────────────────
export interface Backlink { sourceId: string; sourceTitle: string; anchorText: string; }

export const BacklinksPanel: React.FC<{
  backlinks: Backlink[];
  onOpen: (id: string) => void;
}> = ({ backlinks, onOpen }) => {
  return (
    <div className="backlinks-panel">
      <h2 className="section-heading">Referenciado por</h2>
      {backlinks.length === 0 ? (
        <p className="backlinks-empty">Nenhum artigo referencia este ainda.</p>
      ) : (
      <ul className="backlinks-list">
        {backlinks.map((b, i) => (
          <li key={`${b.sourceId}-${i}`} className="backlink-item">
            <button className="backlink-source" onClick={() => onOpen(b.sourceId)}>
              <Icon name="back" /><span>{b.sourceTitle}</span>
            </button>
            <span className="backlink-anchor">via "{b.anchorText}"</span>
          </li>
        ))}
      </ul>
      )}
    </div>
  );
};
