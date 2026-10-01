// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/SaveExcerptModal.tsx
// Modal "salvar trecho/tabela/imagem em…" (artigo existente ou novo) —
// extraído de ArticleView.tsx.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from "react";
import DOMPurify from "dompurify";
import type { Article, ExcerptCategory } from "../shared/types";

// ── Modal para escolher onde salvar o trecho (texto, tabela ou imagem) ────────
export type SaveKind = "text" | "table" | "image";

// Categorias de cor de fundo do trecho (só oferecidas para texto no menu)
const CATEGORY_NOUN: Record<ExcerptCategory, string> = {
  default: "trecho",
  concept: "conceito",
  list: "lista",
  numeric: "dados numéricos",
};

const SAVE_KIND_LABELS: Record<SaveKind, { title: string; previewLabel: string; confirmLabel: string }> = {
  text:  { title: "Salvar trecho",  previewLabel: "Trecho selecionado", confirmLabel: "Salvar trecho" },
  table: { title: "Salvar tabela",  previewLabel: "Tabela selecionada", confirmLabel: "Salvar tabela" },
  image: { title: "Salvar imagem",  previewLabel: "Imagem selecionada", confirmLabel: "Salvar imagem" },
};

interface SaveExcerptModalProps {
  kind: SaveKind;
  category: ExcerptCategory;
  html: string;
  sourceArticleId: string;
  sourceArticleTitle: string;
  articles: Article[];
  onSave: (targetId: string | null, targetTitle: string) => Promise<void>;
  onClose: () => void;
}

export const SaveExcerptModal: React.FC<SaveExcerptModalProps> = ({
  kind, category, html, sourceArticleId, sourceArticleTitle, articles, onSave, onClose,
}) => {
  const candidates = articles.filter(a => a.id !== sourceArticleId);
  const [mode, setMode]         = useState<"existing" | "new">(candidates.length > 0 ? "existing" : "new");
  const [selectedId, setSelectedId] = useState<string>(candidates[0]?.id ?? "");
  const [newTitle, setNewTitle]   = useState("");
  const [saving, setSaving]       = useState(false);
  const [filter, setFilter]       = useState("");

  // Para texto, o rótulo reflete a categoria escolhida (conceito/lista/…)
  const labels = kind === "text" && category !== "default"
    ? { title: `Salvar ${CATEGORY_NOUN[category]}`, previewLabel: "Trecho selecionado",
        confirmLabel: `Salvar ${CATEGORY_NOUN[category]}` }
    : SAVE_KIND_LABELS[kind];
  const filtered = candidates.filter(a => a.title.toLowerCase().includes(filter.toLowerCase()));

  async function handleConfirm() {
    setSaving(true);
    try {
      if (mode === "existing") {
        const target = candidates.find(a => a.id === selectedId);
        if (!target) return;
        await onSave(target.id, target.title);
      } else {
        if (!newTitle.trim()) return;
        await onSave(null, newTitle.trim());
      }
      onClose();
    } finally { setSaving(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal excerpt-modal" onClick={e => e.stopPropagation()}>
        <h2>{labels.title}</h2>

        <div className={`excerpt-preview excerpt-cat-${category}`}>
          <span className="excerpt-preview-label">{labels.previewLabel}</span>
          {/* Renderiza o HTML do trecho na prévia, com o fundo da categoria */}
          <div
            className="excerpt-preview-html wiki-content"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
          />
          <span className="excerpt-preview-source">de: {sourceArticleTitle}</span>
        </div>

        <div className="excerpt-dest-tabs">
          <button className={mode === "existing" ? "active" : ""} onClick={() => setMode("existing")} disabled={candidates.length === 0}>
            Artigo existente
          </button>
          <button className={mode === "new" ? "active" : ""} onClick={() => setMode("new")}>
            Novo artigo
          </button>
        </div>

        {mode === "existing" ? (
          <div className="excerpt-dest-list">
            <input type="search" placeholder="Filtrar artigos…" value={filter}
              onChange={e => setFilter(e.target.value)} autoFocus />
            <ul>
              {filtered.map(a => (
                <li key={a.id}
                  className={`excerpt-dest-item ${a.id === selectedId ? "selected" : ""}`}
                  onClick={() => setSelectedId(a.id)}>
                  <span className={`dot dot-${a.source}`} />
                  {a.title}
                  {(a.excerpts?.length ?? 0) > 0 && (
                    <span className="excerpt-count">{a.excerpts.length} trecho{a.excerpts.length > 1 ? "s" : ""}</span>
                  )}
                </li>
              ))}
              {filtered.length === 0 && <li className="excerpt-dest-empty">Nenhum artigo encontrado.</li>}
            </ul>
          </div>
        ) : (
          <div className="excerpt-new-title">
            <label>
              Título do novo artigo
              <input type="text" autoFocus value={newTitle} onChange={e => setNewTitle(e.target.value)}
                placeholder="Ex.: Minhas anotações sobre fotossíntese"
                onKeyDown={e => { if (e.key === "Enter" && newTitle.trim()) handleConfirm(); }} />
            </label>
            <p className="excerpt-new-hint">Um artigo manual será criado com este título.</p>
          </div>
        )}

        <div className="modal-actions">
          <button onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="primary" onClick={handleConfirm}
            disabled={saving || (mode === "existing" && !selectedId) || (mode === "new" && !newTitle.trim())}>
            {saving ? "Salvando…" : labels.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
