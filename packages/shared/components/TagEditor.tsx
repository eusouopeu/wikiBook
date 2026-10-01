// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/TagEditor.tsx
// Chips de tags do cabeçalho do artigo — extraído de ArticleView.tsx.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useId, useState } from "react";
import { Icon } from "./Icon";

// ── Editor de tags (chips no cabeçalho) ───────────────────────────────────────
// existingTags alimenta um <datalist> com as tags já usadas em outros artigos
// da base — evita criar quase-duplicatas (ex.: "biologia" vs "biológica") por
// não saber que uma variante já existe.
export const TagEditor: React.FC<{
  tags: string[];
  existingTags: string[];
  onChange: (tags: string[]) => void;
}> = ({ tags, existingTags, onChange }) => {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const datalistId = useId();

  function commit() {
    const tag = draft.trim().toLowerCase().replace(/\s+/g, "-");
    if (tag && !tags.includes(tag)) onChange([...tags, tag]);
    setDraft("");
    setAdding(false);
  }

  const suggestions = existingTags.filter(t => !tags.includes(t));

  return (
    <div className="tag-editor">
      {tags.map(t => (
        <span key={t} className="tag-chip">
          #{t}
          <button className="tag-remove" title="Remover tag" aria-label="Remover tag"
                  onClick={() => onChange(tags.filter(x => x !== t))}><Icon name="close" /></button>
        </span>
      ))}
      {adding ? (
        <>
          <input
            className="tag-input" autoFocus value={draft}
            list={datalistId}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") { setDraft(""); setAdding(false); }
            }}
            onBlur={commit}
            placeholder="nova tag…"
          />
          <datalist id={datalistId}>
            {suggestions.map(t => <option key={t} value={t} />)}
          </datalist>
        </>
      ) : (
        <button className="tag-add-btn" onClick={() => setAdding(true)}>+ tag</button>
      )}
    </div>
  );
};
