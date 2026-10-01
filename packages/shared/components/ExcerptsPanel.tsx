// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/ExcerptsPanel.tsx
// Painel "Trechos salvos" do artigo (outline com headings, arraste,
// edição) — extraído de ArticleView.tsx. Estado de edição vem do pai.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import type { Article, ExcerptOutlineItem } from "../shared/types";
import { sanitize } from "../lib/articleHtml";
import { markdownToHtml, markdownTableToHtml } from "../lib/markdown";
import { Icon, type IconName } from "./Icon";
import { TableExcerptEditor, TextExcerptEditor } from "./ExcerptEditor";

// ── Painel de trechos salvos: outline com headings, arraste e edição ─────────
// A ordem de exibição vem de `outline` (já resolvida pelo componente pai —
// inclui excerpts ainda não presentes no outline salvo, ao final).
export interface ExcerptsPanelProps {
  article: Article;
  outline: ExcerptOutlineItem[];
  onOpenSource: (id: string) => void;
  onRemoveExcerpt: (id: string) => void;
  onReorder: (outline: ExcerptOutlineItem[]) => void;
  editingExcerptId: string | null;
  editDraft: string;
  editBaseline: string;
  onStartEdit: (excerptId: string) => void;
  onEditDraftChange: (text: string) => void;
  onSaveEdit: () => void;
  onSaveTableEdit: (excerptId: string, markdown: string) => void;
  onCancelEdit: () => void;
}

const EXCERPT_KIND_ICON: Record<string, IconName> = { text: "text", table: "table", image: "image" };

export const ExcerptsPanel: React.FC<ExcerptsPanelProps> = ({
  article, outline, onOpenSource, onRemoveExcerpt, onReorder,
  editingExcerptId, editDraft, editBaseline, onStartEdit, onEditDraftChange, onSaveEdit,
  onSaveTableEdit, onCancelEdit,
}) => {
  const excerptById = useMemo(() => new Map(article.excerpts.map(e => [e.id, e])), [article.excerpts]);
  const [addingHeading, setAddingHeading] = useState(false);
  const [headingDraft, setHeadingDraft] = useState("");
  const dragIndexRef = useRef<number | null>(null);

  if (article.excerpts.length === 0) return null;

  function handleDragStart(e: React.DragEvent, index: number) {
    dragIndexRef.current = index;
    e.dataTransfer.effectAllowed = "move";
  }
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }
  function handleDrop(e: React.DragEvent, targetIndex: number) {
    e.preventDefault();
    const from = dragIndexRef.current;
    dragIndexRef.current = null;
    if (from === null || from === targetIndex) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const dropBefore = e.clientY < rect.top + rect.height / 2;
    let insertAt = targetIndex + (dropBefore ? 0 : 1);
    const next = [...outline];
    const [moved] = next.splice(from, 1);
    if (from < insertAt) insertAt -= 1;
    next.splice(insertAt, 0, moved);
    onReorder(next);
  }

  function handleAddHeading() {
    const text = headingDraft.trim();
    if (!text) { setAddingHeading(false); return; }
    onReorder([...outline, { type: "heading", id: crypto.randomUUID(), text }]);
    setHeadingDraft("");
    setAddingHeading(false);
  }

  function handleRemoveHeading(id: string) {
    onReorder(outline.filter(item => !(item.type === "heading" && item.id === id)));
  }

  return (
    <div className="excerpts-panel">
      <div className="excerpts-panel-header">
        <h2 className="section-heading">Trechos salvos</h2>
        <button className="excerpts-add-heading-btn" onClick={() => setAddingHeading(true)}>+ Heading</button>
      </div>

      {addingHeading && (
        <div className="excerpt-heading-form">
          <input autoFocus value={headingDraft} onChange={e => setHeadingDraft(e.target.value)}
                 placeholder="Título do heading…"
                 onKeyDown={e => {
                   if (e.key === "Enter") handleAddHeading();
                   if (e.key === "Escape") setAddingHeading(false);
                 }} />
          <button className="primary" onClick={handleAddHeading}>Adicionar</button>
          <button onClick={() => setAddingHeading(false)}>Cancelar</button>
        </div>
      )}

      <ul className="excerpts-list">
        {outline.map((item, index) => {
          if (item.type === "heading") {
            return (
              <li key={item.id} className="excerpt-heading-row"
                  draggable onDragStart={e => handleDragStart(e, index)}
                  onDragOver={handleDragOver} onDrop={e => handleDrop(e, index)}>
                <span className="drag-handle" title="Arrastar">⠿</span>
                <span className="excerpt-heading-text">{item.text}</span>
                <button className="excerpt-remove-btn" title="Remover heading" aria-label="Remover heading"
                        onClick={() => handleRemoveHeading(item.id)}><Icon name="close" /></button>
              </li>
            );
          }

          const ex = excerptById.get(item.id);
          if (!ex) return null;
          const isEditing = editingExcerptId === ex.id;
          const kind = ex.kind ?? "text";
          const category = ex.category ?? "default";
          const editable = kind === "text" || kind === "table";

          // HTML de exibição: tabela/texto editado renderiza do markdown editado
          const displayHtml =
            kind === "table" && ex.editedMarkdown ? sanitize(markdownTableToHtml(ex.editedMarkdown)) :
            kind === "text"  && ex.editedMarkdown ? sanitize(markdownToHtml(ex.editedMarkdown)) :
            DOMPurify.sanitize(ex.html);

          return (
            <li key={ex.id} className={`excerpt-item excerpt-cat-${category} ${isEditing ? "excerpt-item-editing" : ""}`}
                draggable={!isEditing} onDragStart={e => handleDragStart(e, index)}
                onDragOver={handleDragOver} onDrop={e => handleDrop(e, index)}>
              <div className="excerpt-item-toprow">
                <span className="drag-handle" title="Arrastar">⠿</span>
                {editable && !isEditing && (
                  <button className="excerpt-edit-btn"
                          title={kind === "table" ? "Editar tabela" : "Editar trecho"}
                          aria-label={kind === "table" ? "Editar tabela" : "Editar trecho"}
                          onClick={() => onStartEdit(ex.id)}><Icon name="edit" /></button>
                )}
              </div>

              {isEditing && kind === "table" ? (
                <TableExcerptEditor
                  initialMarkdown={ex.editedMarkdown ?? ex.plainText}
                  onSave={md => onSaveTableEdit(ex.id, md)}
                  onCancel={onCancelEdit}
                />
              ) : isEditing ? (
                <TextExcerptEditor
                  draft={editDraft}
                  baseline={editBaseline}
                  onDraftChange={onEditDraftChange}
                  onSave={onSaveEdit}
                  onCancel={onCancelEdit}
                />
              ) : (
                <div className="excerpt-html wiki-content"
                     dangerouslySetInnerHTML={{ __html: displayHtml }} />
              )}

              <div className="excerpt-meta">
                <span className="excerpt-kind-badge" title={kind}><Icon name={EXCERPT_KIND_ICON[kind] ?? "text"} /></span>
                <button className="excerpt-source-btn" onClick={() => onOpenSource(ex.sourceArticleId)}>
                  <Icon name="externalSource" /><span>{ex.sourceArticleTitle}</span>
                </button>
                <span className="excerpt-date">{new Date(ex.savedAt).toLocaleDateString("pt-BR")}</span>
                <button className="excerpt-remove-btn" onClick={() => onRemoveExcerpt(ex.id)} title="Remover"><Icon name="close" /></button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
