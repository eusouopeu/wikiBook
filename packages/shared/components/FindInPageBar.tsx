// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/FindInPageBar.tsx
// Barra do "buscar na página" — extraído de ArticleView.tsx. O destaque
// das ocorrências fica em lib/findInPage.ts.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useRef } from "react";
import { Icon } from "./Icon";

export const FindInPageBar: React.FC<{
  query: string; count: number; index: number;
  onQueryChange: (q: string) => void;
  onNext: () => void; onPrev: () => void; onClose: () => void;
}> = ({ query, count, index, onQueryChange, onNext, onPrev, onClose }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  return (
    <div className="find-in-page-bar">
      <input
        ref={inputRef} type="text" value={query} placeholder="Buscar na página…"
        onChange={e => onQueryChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") { e.preventDefault(); e.shiftKey ? onPrev() : onNext(); }
          if (e.key === "Escape") { e.preventDefault(); onClose(); }
        }}
      />
      <span className="find-in-page-count">{count > 0 ? `${index + 1}/${count}` : "0/0"}</span>
      <button type="button" title="Anterior" aria-label="Anterior" onClick={onPrev} disabled={count === 0}><Icon name="prev" /></button>
      <button type="button" title="Próximo" aria-label="Próximo" onClick={onNext} disabled={count === 0}><Icon name="next" /></button>
      <button type="button" className="find-in-page-close" title="Fechar" aria-label="Fechar" onClick={onClose}><Icon name="close" /></button>
    </div>
  );
};
