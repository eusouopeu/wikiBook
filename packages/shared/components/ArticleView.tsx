// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/ArticleView.tsx
// ─────────────────────────────────────────────────────────────────────────────

import React, { useRef, useEffect, useLayoutEffect, useState, useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import DOMPurify from "dompurify";
import type { Article, ArticleExcerpt, ExcerptCategory, ExcerptOutlineItem, Flashcard, FlashcardGrade } from "../shared/types";
import { useStore } from "../store/useStore";
import { computeTrackedEdit, stripTrackedMarkup } from "../lib/excerptDiff";
import {
  escapeHtml, inlineMarkdown, markdownToHtml, excerptHtmlToMarkdown,
  parseMarkdownTable, serializeMarkdownTable, markdownTableToHtml,
} from "../lib/markdown";

interface Props { article: Article; }

// Sanitização final antes de qualquer dangerouslySetInnerHTML
function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    // data-article-id: âncora dos links internos; style: necessário para as
    // cores personalizáveis de destaque/texto ([texto]{bg=...}/{color=...})
    ADD_ATTR: ["data-article-id", "style"],
  });
}

// ── Injeta links internos em HTML de artigo manual ────────────────────────────
// Sem spans .wiki-term para ancorar, substitui a primeira ocorrência do
// anchorText em segmentos de texto (nunca dentro de tags)
function linkifyPlainText(html: string, links: Article["links"]): string {
  if (links.length === 0) return html;
  const parts = html.split(/(<[^>]+>)/);
  for (const link of links) {
    const anchor = escapeHtml(link.anchorText);
    const re = new RegExp(anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith("<") || !re.test(parts[i])) continue;
      parts[i] = parts[i].replace(re,
        `<a class="internal-link" data-article-id="${escapeHtml(link.targetId)}" href="#" title="${escapeHtml(link.targetTitle)}">${anchor}</a>`);
      break;
    }
  }
  return parts.join("");
}

// Injeta links internos definidos pelo usuário no HTML do artigo
function injectInternalLinks(html: string, links: Article["links"]): string {
  let result = html;
  for (const link of links) {
    // O HTML armazenado tem entidades (& → &amp;), então o anchorText precisa
    // ser escapado da mesma forma antes de virar padrão de regex
    const escaped = escapeHtml(link.anchorText).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(
      new RegExp(`(<span class="wiki-term">)(${escaped})(</span>)`, "g"),
      `<a class="internal-link" data-article-id="${escapeHtml(link.targetId)}" href="#" title="${escapeHtml(link.targetTitle)}">$2</a>`
    );
  }
  return result;
}

// ── Captura o HTML da seleção atual via DOM ───────────────────────────────────
// Serializa o fragmento selecionado para string HTML mantendo tags de formatação.
function getSelectionHtml(): { html: string; plainText: string } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const plainText = selection.toString().trim();
  if (!plainText || plainText.length < 2) return null;

  // Clona o conteúdo selecionado em um div temporário para serializar
  const container = document.createElement("div");
  container.appendChild(range.cloneContents());
  const html = container.innerHTML;
  return { html, plainText };
}

// ── Envolve/desenvolve a seleção atual de um textarea com marcadores Markdown ─
// Exige seleção não vazia. Alterna (toggle): se a seleção já estiver formatada —
// seja porque inclui os marcadores nas bordas, seja porque eles a cercam
// imediatamente por fora — a mesma combinação de teclas remove a formatação.
function wrapTextareaSelection(
  textarea: HTMLTextAreaElement, before: string, after: string, onChange: (v: string) => void
) {
  const { selectionStart, selectionEnd, value } = textarea;
  const selected = value.slice(selectionStart, selectionEnd);
  if (!selected) return;

  const apply = (newValue: string, start: number, end: number) => {
    onChange(newValue);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start, end);
    });
  };

  // Toggle 1: os marcadores estão dentro da seleção → remove-os
  if (selected.length >= before.length + after.length &&
      selected.startsWith(before) && selected.endsWith(after)) {
    const inner = selected.slice(before.length, selected.length - after.length);
    apply(value.slice(0, selectionStart) + inner + value.slice(selectionEnd),
          selectionStart, selectionStart + inner.length);
    return;
  }

  // Toggle 2: os marcadores cercam a seleção por fora → remove-os
  const outerStart = selectionStart - before.length;
  const outerEnd = selectionEnd + after.length;
  if (outerStart >= 0 && outerEnd <= value.length &&
      value.slice(outerStart, selectionStart) === before &&
      value.slice(selectionEnd, outerEnd) === after) {
    apply(value.slice(0, outerStart) + selected + value.slice(outerEnd),
          outerStart, outerStart + selected.length);
    return;
  }

  // Caso contrário: aplica a formatação
  apply(value.slice(0, selectionStart) + before + selected + after + value.slice(selectionEnd),
        selectionStart + before.length, selectionEnd + before.length);
}

// ── Atalhos de teclado de formatação (⌘/Ctrl) ────────────────────────────────
// ⌘B = negrito · ⌘⇧1 = amarelo (==) · ⌘⇧2 = azul definição · ⌘⇧3 = verde
// estrutura/enumeração · ⌘⇧4 = roxo dado numérico · ⌘⇧5 = laranja (++)
// Compartilhado entre o editor de trechos e o editor de artigo manual.
function handleFormatShortcut(
  e: React.KeyboardEvent<HTMLTextAreaElement>, onChange: (v: string) => void
): void {
  if (!(e.metaKey || e.ctrlKey)) return;
  const ta = e.currentTarget;
  const wrap = (before: string, after: string) => {
    e.preventDefault();
    wrapTextareaSelection(ta, before, after, onChange);
  };

  if (!e.shiftKey && e.key.toLowerCase() === "b") { wrap("**", "**"); return; }
  if (e.shiftKey) {
    switch (e.code) {
      case "Digit1": wrap("==", "==");      return;   // amarelo (cloze)
      case "Digit2": wrap("[", "]{.def}");  return;   // azul — definição
      case "Digit3": wrap("[", "]{.enum}"); return;   // verde — estrutura/enumeração
      case "Digit4": wrap("[", "]{.num}");  return;   // roxo — dado numérico
      case "Digit5": wrap("++", "++");      return;   // laranja
    }
  }
}

// ── Barra de formatação do editor de trechos ──────────────────────────────────
// Negrito, destaques fixos (amarelo/azul/verde/roxo/laranja) aplicam direto;
// cores livres exigem escolher no seletor nativo e clicar em "Aplicar"
// (evita disparar a cada arraste no picker).
const ExcerptEditToolbar: React.FC<{
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  onChange: (v: string) => void;
}> = ({ textareaRef, onChange }) => {
  const [bgColor, setBgColor] = useState("#ffd54f");
  const [textColor, setTextColor] = useState("#e53935");

  const wrap = (before: string, after: string) => {
    if (textareaRef.current) wrapTextareaSelection(textareaRef.current, before, after, onChange);
  };

  return (
    <div className="excerpt-toolbar">
      <button type="button" title="Negrito — ⌘B (**texto**)" onClick={() => wrap("**", "**")}><strong>B</strong></button>
      <button type="button" className="hl-swatch hl-swatch-yellow"
              title="Amarelo: destaque padrão, vira flashcard cloze — ⌘⇧1 (==texto==)"
              onClick={() => wrap("==", "==")}>A</button>
      <button type="button" className="hl-swatch hl-swatch-def"
              title="Azul: definição de conceito — ⌘⇧2 ([texto]{.def})"
              onClick={() => wrap("[", "]{.def}")}>D</button>
      <button type="button" className="hl-swatch hl-swatch-enum"
              title="Verde: divisão de estrutura / enumeração — ⌘⇧3 ([texto]{.enum})"
              onClick={() => wrap("[", "]{.enum}")}>E</button>
      <button type="button" className="hl-swatch hl-swatch-num"
              title="Roxo: dado numérico importante — ⌘⇧4 ([texto]{.num})"
              onClick={() => wrap("[", "]{.num}")}>N</button>
      <button type="button" className="hl-swatch hl-swatch-orange"
              title="Laranja — ⌘⇧5 (++texto++)"
              onClick={() => wrap("++", "++")}>L</button>
      <span className="excerpt-toolbar-color-group">
        <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)} title="Cor do marca-texto" />
        <button type="button" title="Aplicar marca-texto colorido" onClick={() => wrap("[", `]{bg=${bgColor}}`)}>
          Marcar
        </button>
      </span>
      <span className="excerpt-toolbar-color-group">
        <input type="color" value={textColor} onChange={e => setTextColor(e.target.value)} title="Cor do texto" />
        <button type="button" title="Aplicar cor no texto" onClick={() => wrap("[", `]{color=${textColor}}`)}>
          Colorir
        </button>
      </span>
    </div>
  );
};

// ── Editor de tabela salva (grade de células) ─────────────────────────────────
// Auto-contido: parseia o markdown da tabela numa matriz, edita célula a célula
// e devolve o markdown reserializado. A toolbar de formatação atua sobre a
// célula atualmente focada; atalhos (⌘B, ⌘⇧1…) funcionam dentro de cada célula.
const TableExcerptEditor: React.FC<{
  initialMarkdown: string;
  onSave: (markdown: string) => void;
  onCancel: () => void;
}> = ({ initialMarkdown, onSave, onCancel }) => {
  const [matrix, setMatrix] = useState<string[][]>(() => parseMarkdownTable(initialMarkdown));
  const focusedRef = useRef<HTMLTextAreaElement | null>(null);
  const focusedCellRef = useRef<{ r: number; c: number } | null>(null);

  const colCount = Math.max(1, ...matrix.map(r => r.length));

  const setCell = (r: number, c: number, value: string) =>
    setMatrix(m => m.map((row, ri) => {
      if (ri !== r) return row;
      const copy = [...row];
      while (copy.length < colCount) copy.push("");
      copy[c] = value;
      return copy;
    }));

  // A toolbar aplica formatação ao textarea da célula que estava focada
  const handleToolbarChange = (value: string) => {
    const fc = focusedCellRef.current;
    if (fc) setCell(fc.r, fc.c, value);
  };

  const addRow = () => setMatrix(m => [...m, Array(colCount).fill("")]);
  const removeRow = (r: number) => setMatrix(m => m.length > 1 ? m.filter((_, ri) => ri !== r) : m);
  const addCol = () => setMatrix(m => m.map(row => {
    const copy = [...row];
    while (copy.length < colCount) copy.push("");
    copy.push("");
    return copy;
  }));
  const removeCol = () => setMatrix(m => colCount > 1 ? m.map(row => row.slice(0, colCount - 1)) : m);

  return (
    <div className="excerpt-editor table-editor">
      <ExcerptEditToolbar textareaRef={focusedRef} onChange={handleToolbarChange} />
      <div className="table-editor-grid-wrap">
        <table className="table-editor-grid">
          <tbody>
            {matrix.map((row, r) => (
              <tr key={r}>
                {Array.from({ length: colCount }).map((_, c) => (
                  <td key={c} className={r === 0 ? "table-editor-th" : ""}>
                    <textarea
                      value={row[c] ?? ""}
                      rows={1}
                      onChange={e => setCell(r, c, e.target.value)}
                      onFocus={e => { focusedRef.current = e.currentTarget; focusedCellRef.current = { r, c }; }}
                      onKeyDown={e => handleFormatShortcut(e, v => setCell(r, c, v))}
                    />
                  </td>
                ))}
                <td className="table-editor-rowctrl">
                  <button type="button" title="Remover linha" onClick={() => removeRow(r)}
                          disabled={matrix.length <= 1}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-editor-controls">
        <button type="button" onClick={addRow}>+ linha</button>
        <button type="button" onClick={addCol}>+ coluna</button>
        <button type="button" onClick={removeCol} disabled={colCount <= 1}>− coluna</button>
      </div>
      <p className="excerpt-editor-hint">
        A primeira linha é o cabeçalho. Selecione texto numa célula e use a barra
        (ou ⌘B / ⌘⇧1…) para formatar.
      </p>
      <div className="excerpt-editor-actions">
        <button onClick={onCancel}>Cancelar</button>
        <button className="primary" onClick={() => onSave(serializeMarkdownTable(matrix))}>Salvar</button>
      </div>
    </div>
  );
};

// ── Modal para escolher onde salvar o trecho (texto, tabela ou imagem) ────────
type SaveKind = "text" | "table" | "image";

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

const SaveExcerptModal: React.FC<SaveExcerptModalProps> = ({
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

// ── Painel de trechos salvos: outline com headings, arraste e edição ─────────
// A ordem de exibição vem de `outline` (já resolvida pelo componente pai —
// inclui excerpts ainda não presentes no outline salvo, ao final).
interface ExcerptsPanelProps {
  article: Article;
  outline: ExcerptOutlineItem[];
  onOpenSource: (id: string) => void;
  onRemoveExcerpt: (id: string) => void;
  onReorder: (outline: ExcerptOutlineItem[]) => void;
  editingExcerptId: string | null;
  editDraft: string;
  onStartEdit: (excerptId: string) => void;
  onEditDraftChange: (text: string) => void;
  onSaveEdit: () => void;
  onSaveTableEdit: (excerptId: string, markdown: string) => void;
  onCancelEdit: () => void;
}

const EXCERPT_KIND_ICON: Record<string, string> = { text: "📝", table: "📊", image: "🖼" };

const ExcerptsPanel: React.FC<ExcerptsPanelProps> = ({
  article, outline, onOpenSource, onRemoveExcerpt, onReorder,
  editingExcerptId, editDraft, onStartEdit, onEditDraftChange, onSaveEdit,
  onSaveTableEdit, onCancelEdit,
}) => {
  const excerptById = useMemo(() => new Map(article.excerpts.map(e => [e.id, e])), [article.excerpts]);
  const [addingHeading, setAddingHeading] = useState(false);
  const [headingDraft, setHeadingDraft] = useState("");
  const dragIndexRef = useRef<number | null>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

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
                <button className="excerpt-remove-btn" title="Remover heading"
                        onClick={() => handleRemoveHeading(item.id)}>✕</button>
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
                          onClick={() => onStartEdit(ex.id)}>✎</button>
                )}
              </div>

              {isEditing && kind === "table" ? (
                <TableExcerptEditor
                  initialMarkdown={ex.editedMarkdown ?? ex.plainText}
                  onSave={md => onSaveTableEdit(ex.id, md)}
                  onCancel={onCancelEdit}
                />
              ) : isEditing ? (
                <div className="excerpt-editor">
                  <ExcerptEditToolbar textareaRef={editTextareaRef} onChange={onEditDraftChange} />
                  <textarea ref={editTextareaRef} className="excerpt-editor-textarea"
                            value={editDraft} onChange={e => onEditDraftChange(e.target.value)}
                            onKeyDown={e => handleFormatShortcut(e, onEditDraftChange)} autoFocus />
                  <p className="excerpt-editor-hint">
                    O que você escrever a mais fica em itálico; o que apagar vira "(...)".
                    Formatação (negrito, marca-textos) não conta como edição.
                  </p>
                  <div className="excerpt-editor-actions">
                    <button onClick={onCancelEdit}>Cancelar</button>
                    <button className="primary" onClick={onSaveEdit}>Salvar</button>
                  </div>
                </div>
              ) : (
                <div className="excerpt-html wiki-content"
                     dangerouslySetInnerHTML={{ __html: displayHtml }} />
              )}

              <div className="excerpt-meta">
                <span className="excerpt-kind-badge" title={kind}>{EXCERPT_KIND_ICON[kind]}</span>
                <button className="excerpt-source-btn" onClick={() => onOpenSource(ex.sourceArticleId)}>
                  ↗ {ex.sourceArticleTitle}
                </button>
                <span className="excerpt-date">{new Date(ex.savedAt).toLocaleDateString("pt-BR")}</span>
                <button className="excerpt-remove-btn" onClick={() => onRemoveExcerpt(ex.id)} title="Remover">✕</button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

// ── Painel de backlinks ("Referenciado por") ──────────────────────────────────
interface Backlink { sourceId: string; sourceTitle: string; anchorText: string; }

const BacklinksPanel: React.FC<{
  backlinks: Backlink[];
  onOpen: (id: string) => void;
}> = ({ backlinks, onOpen }) => {
  if (backlinks.length === 0) return null;
  return (
    <div className="backlinks-panel">
      <h2 className="section-heading">Referenciado por</h2>
      <ul className="backlinks-list">
        {backlinks.map((b, i) => (
          <li key={`${b.sourceId}-${i}`} className="backlink-item">
            <button className="backlink-source" onClick={() => onOpen(b.sourceId)}>
              ← {b.sourceTitle}
            </button>
            <span className="backlink-anchor">via "{b.anchorText}"</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

// ── Editor de tags (chips no cabeçalho) ───────────────────────────────────────
const TagEditor: React.FC<{
  tags: string[];
  onChange: (tags: string[]) => void;
}> = ({ tags, onChange }) => {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  function commit() {
    const tag = draft.trim().toLowerCase().replace(/\s+/g, "-");
    if (tag && !tags.includes(tag)) onChange([...tags, tag]);
    setDraft("");
    setAdding(false);
  }

  return (
    <div className="tag-editor">
      {tags.map(t => (
        <span key={t} className="tag-chip">
          #{t}
          <button className="tag-remove" title="Remover tag"
                  onClick={() => onChange(tags.filter(x => x !== t))}>✕</button>
        </span>
      ))}
      {adding ? (
        <input
          className="tag-input" autoFocus value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setDraft(""); setAdding(false); }
          }}
          onBlur={commit}
          placeholder="nova tag…"
        />
      ) : (
        <button className="tag-add-btn" onClick={() => setAdding(true)}>+ tag</button>
      )}
    </div>
  );
};

// ── Resolve a ordem de exibição dos trechos ───────────────────────────────────
// Usa o outline salvo, mas garante que excerpts novos (ainda não presentes
// nele) apareçam ao final, e descarta entradas órfãs (excerpt já removido).
function resolveOutline(article: Article): ExcerptOutlineItem[] {
  const outline = article.excerptOutline ?? [];
  const existingIds = new Set(article.excerpts.map(e => e.id));
  const pruned = outline.filter(item => item.type === "heading" || existingIds.has(item.id));
  const known = new Set(pruned.filter(item => item.type === "excerpt").map(item => (item as { id: string }).id));
  const missing = article.excerpts
    .filter(e => !known.has(e.id))
    .map((e): ExcerptOutlineItem => ({ type: "excerpt", id: e.id }));
  return [...pruned, ...missing];
}

// ── Flashcards ─────────────────────────────────────────────────────────────────
const FLASHCARD_KIND_LABEL: Record<string, string> = {
  basic: "Básico", reversed: "Invertido", cloze: "Cloze", "enum-cloze": "Cloze (enumeração)",
  qa: "Pergunta",
};

// Remove marcadores de formatação inline na EXIBIÇÃO de flashcards — o card
// armazenado mantém a sintaxe crua (estabilidade do merge por sourceLine),
// mas o usuário não precisa ler "**" ou "[x]{.def}" durante a revisão
function stripInlineMarkers(text: string): string {
  return text
    .replace(/\]\{[^}]*\}/g, "")
    .replace(/\*\*|\+\+|==/g, "")
    .replace(/\[/g, "");
}

// Esconde só o grupo ativo (c1 amarelo / c2 laranja); os demais grupos aparecem
// como texto normal — cada grupo é um card separado.
function renderClozePreview(clozeText: string, group = 1): string {
  const replaced = clozeText.replace(/\{\{c(\d+)::(.+?)\}\}/g,
    (_, n, inner) => (Number(n) === group ? "[...]" : inner));
  return stripInlineMarkers(replaced);
}

function renderClozeForReview(clozeText: string, revealed: boolean, group = 1): string {
  // Protege os placeholders de cloze antes de limpar marcadores ("[...]" tem "[")
  const cleaned = clozeText.replace(/\{\{c(\d+)::(.+?)\}\}/g,
    (_, n, inner) => `{{c${n}::${stripInlineMarkers(inner)}}}`);
  const parts = cleaned.split(/(\{\{c\d+::.+?\}\})/);
  const escaped = parts.map(p => {
    const m = p.match(/^\{\{c(\d+)::(.+?)\}\}$/);
    if (m) {
      if (Number(m[1]) !== group) return escapeHtml(m[2]);   // outro grupo: visível
      return revealed
        ? `<mark class="cloze-revealed">${escapeHtml(m[2])}</mark>`
        : '<span class="cloze-blank">[...]</span>';
    }
    return escapeHtml(stripInlineMarkers(p));
  });
  return escaped.join("");
}

const FlashcardsPanel: React.FC<{
  cards: Flashcard[];
  loading: boolean;
  onRegenerate: () => void;
  onStartReview: () => void;
}> = ({ cards, loading, onRegenerate, onStartReview }) => {
  const now = new Date().toISOString();
  const dueCount = cards.filter(c => c.due <= now).length;
  return (
    <div className="flashcards-panel">
      <div className="excerpts-panel-header">
        <h2 className="section-heading">Flashcards ({cards.length})</h2>
        <div className="flashcards-panel-actions">
          <button onClick={onRegenerate} disabled={loading}>{loading ? "Atualizando…" : "🔄 Atualizar"}</button>
          <button className="primary" onClick={onStartReview} disabled={dueCount === 0}>
            🎓 Revisar ({dueCount})
          </button>
        </div>
      </div>
      {cards.length === 0 ? (
        <p className="flashcards-empty-hint">
          Nenhum flashcard ainda. Use "==amarelo==" (cloze c1), "++laranja++" (cloze c2),
          listas ("1.", "a)", "-") viram cloze escondendo os itens, "Pergunta? resposta"
          ou "Termo: definição" viram card frente/verso, "texto = texto" (básico) e
          "texto == texto" solto (invertido) — no conteúdo manual ou em trechos editados.
        </p>
      ) : (
        <ul className="flashcards-list">
          {cards.map(c => (
            <li key={c.id} className="flashcard-item">
              <span className="flashcard-kind-badge">{FLASHCARD_KIND_LABEL[c.kind]}</span>
              <span className="flashcard-preview">
                {c.kind === "cloze" || c.kind === "enum-cloze"
                  ? renderClozePreview(c.clozeText ?? "", c.clozeGroup ?? 1)
                  : `${stripInlineMarkers(c.front ?? "")} → ${stripInlineMarkers(c.back ?? "")}`}
              </span>
              <span className="flashcard-due">
                {c.due <= now ? "vencido" : `revisar em ${new Date(c.due).toLocaleDateString("pt-BR")}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ── Modal de revisão (SM-2) ────────────────────────────────────────────────────
// Reaproveitado tanto pela revisão por artigo quanto pela revisão global.
export const ReviewModal: React.FC<{
  cards: Flashcard[];
  onGrade: (articleId: string, cardId: string, grade: FlashcardGrade) => Promise<void>;
  onClose: () => void;
}> = ({ cards, onGrade, onClose }) => {
  const [queue, setQueue] = useState(cards);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const current = queue[0];

  async function handleGrade(grade: FlashcardGrade) {
    if (!current) return;
    await onGrade(current.articleId, current.id, grade);
    setQueue(q => q.slice(1));
    setRevealed(false);
  }

  if (!current) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal review-modal" onClick={e => e.stopPropagation()}>
          <h2>Revisão concluída 🎉</h2>
          <p>Nenhum flashcard vencido no momento.</p>
          <div className="modal-actions"><button className="primary" onClick={onClose}>Fechar</button></div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal review-modal" onClick={e => e.stopPropagation()}>
        <div className="review-modal-header">
          <span className="review-progress">{queue.length} restante{queue.length > 1 ? "s" : ""}</span>
          <span className="review-article-title">{current.articleTitle}</span>
        </div>

        <div className="review-card">
          {(current.kind === "cloze" || current.kind === "enum-cloze") ? (
            <div className="review-cloze"
                 dangerouslySetInnerHTML={{ __html: renderClozeForReview(current.clozeText ?? "", revealed, current.clozeGroup ?? 1) }} />
          ) : (
            <>
              <div className="review-front">
                {current.kind === "qa"
                  ? <strong>{stripInlineMarkers(current.front ?? "")}</strong>
                  : stripInlineMarkers(current.front ?? "")}
              </div>
              {revealed && <div className="review-back">{stripInlineMarkers(current.back ?? "")}</div>}
            </>
          )}
        </div>

        <div className="review-actions">
          {!revealed ? (
            <button className="primary" onClick={() => setRevealed(true)}>Mostrar resposta</button>
          ) : (
            <>
              <button className="review-grade review-grade-again" onClick={() => handleGrade("again")}>Errei</button>
              <button className="review-grade review-grade-hard" onClick={() => handleGrade("hard")}>Difícil</button>
              <button className="review-grade review-grade-good" onClick={() => handleGrade("good")}>Bom</button>
              <button className="review-grade review-grade-easy" onClick={() => handleGrade("easy")}>Fácil</button>
            </>
          )}
        </div>
        <button className="review-close-btn" onClick={onClose}>Fechar revisão</button>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────────────────────

export const ArticleView: React.FC<Props> = ({ article }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const summaryRef   = useRef<HTMLDivElement>(null);
  const [showSummary, setShowSummary]         = useState(false);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [saveModal, setSaveModal] = useState<{
    visible: boolean; kind: "text" | "table" | "image"; category: ExcerptCategory;
    html: string; src?: string; alt?: string;
  }>({ visible: false, kind: "text", category: "default", html: "" });
  // Edição de artigos manuais (conteúdo em Markdown)
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  // Chat contextual ("Perguntar ao Claude")
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  // Edição de trechos salvos (texto)
  const [editingExcerptId, setEditingExcerptId] = useState<string | null>(null);
  const [excerptEditDraft, setExcerptEditDraft] = useState("");
  // Flashcards
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [flashcardsLoading, setFlashcardsLoading] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  const { contextMenu, showContextMenu, hideContextMenu,
          fetchFromWikipedia, generateWithClaude, addLink, removeLink,
          openArticle, articles, saveArticle, deleteArticle, loadArticles,
          updateTags, updateExcerptMarkdown, updateExcerptOutline,
          showToast } = useStore(useShallow(s => ({
    contextMenu: s.contextMenu, showContextMenu: s.showContextMenu,
    hideContextMenu: s.hideContextMenu, fetchFromWikipedia: s.fetchFromWikipedia,
    generateWithClaude: s.generateWithClaude, addLink: s.addLink,
    removeLink: s.removeLink, openArticle: s.openArticle, articles: s.articles,
    saveArticle: s.saveArticle, deleteArticle: s.deleteArticle,
    loadArticles: s.loadArticles, updateTags: s.updateTags,
    updateExcerptMarkdown: s.updateExcerptMarkdown, updateExcerptOutline: s.updateExcerptOutline,
    showToast: s.showToast,
  })));

  const outline = useMemo(() => resolveOutline(article), [article]);

  // Carrega os flashcards já gerados para este artigo (sem forçar regeneração)
  const loadFlashcards = useCallback(async () => {
    const res = await window.lexicon.invoke("flashcards:list", { articleId: article.id });
    if (res.ok) setFlashcards((res.data as Flashcard[]) ?? []);
  }, [article.id]);

  const handleRegenerateFlashcards = useCallback(async () => {
    setFlashcardsLoading(true);
    try {
      const res = await window.lexicon.invoke("flashcards:regenerate", { articleId: article.id });
      if (res.ok) setFlashcards((res.data as Flashcard[]) ?? []);
      else showToast(res.error ?? "Falha ao gerar flashcards.", "error");
    } finally {
      setFlashcardsLoading(false);
    }
  }, [article.id, showToast]);

  const handleGradeCard = useCallback(async (articleId: string, cardId: string, grade: FlashcardGrade) => {
    await window.lexicon.invoke("flashcards:grade", { articleId, cardId, grade });
    if (articleId === article.id) await loadFlashcards();
  }, [article.id, loadFlashcards]);

  // Sai do modo de edição, reseta o chat e recarrega os flashcards ao trocar de artigo
  useEffect(() => {
    setIsEditing(false);
    setChatOpen(false);
    setChatMessages([]);
    setChatInput("");
    setEditingExcerptId(null);
    setReviewOpen(false);
    loadFlashcards();
  }, [article.id, loadFlashcards]);

  // ── Clique direito — captura seleção de texto, ou tabela/imagem sob o cursor ─
  const handleContextMenu = useCallback((e: MouseEvent) => {
    const sel = getSelectionHtml();
    const targetEl = e.target as HTMLElement;
    const tableEl = targetEl.closest?.("table") as HTMLTableElement | null;
    const imgEl = targetEl.closest?.("img") as HTMLImageElement | null;

    if (!sel && !tableEl && !imgEl) return;   // nada a oferecer neste clique
    e.preventDefault();

    showContextMenu(e.clientX, e.clientY, article.id, {
      selectedText: sel?.plainText ?? "",
      tableHtml: tableEl?.outerHTML,
      imageSrc: imgEl?.src,
      imageAlt: imgEl?.alt,
    });
  }, [article.id, showContextMenu]);

  // ── Clique em link interno ──────────────────────────────────────────────────
  const handleClick = useCallback((e: MouseEvent) => {
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>("a.internal-link");
    if (link) {
      e.preventDefault();
      const tid = link.getAttribute("data-article-id");
      if (tid) openArticle(tid);
    }
  }, [openArticle]);

  // Registra eventos nos dois containers (artigo completo e resumo)
  useEffect(() => {
    const refs = [containerRef.current, summaryRef.current].filter(Boolean);
    refs.forEach(el => {
      el!.addEventListener("contextmenu", handleContextMenu);
      el!.addEventListener("click", handleClick);
    });
    return () => refs.forEach(el => {
      el!.removeEventListener("contextmenu", handleContextMenu);
      el!.removeEventListener("click", handleClick);
    });
  }, [handleContextMenu, handleClick, showSummary]);

  // ── Trata imagens quebradas: reserva caixa com dimensões originais ──────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.querySelectorAll<HTMLImageElement>("img").forEach(img => {
      const applyFallback = () => {
        if (img.naturalHeight === 0) {
          img.style.display = "block";
          img.style.minHeight = img.getAttribute("height") ? `${img.getAttribute("height")}px` : "80px";
        }
      };
      img.addEventListener("error", applyFallback, { once: true });
      if (img.complete) applyFallback();
    });
  }, [article.id, article.content]);

  // ── Pesquisar no menu de contexto ──────────────────────────────────────────
  const handleSearch = useCallback(async (source: "wikipedia" | "claude") => {
    const { selectedText, parentArticleId } = contextMenu;
    hideContextMenu();
    if (!selectedText || !parentArticleId) return;
    try {
      const existing = articles.find(a => a.title.toLowerCase() === selectedText.toLowerCase());
      let target = existing;
      if (!target) {
        target = source === "wikipedia"
          ? await fetchFromWikipedia(selectedText, parentArticleId)
          : await generateWithClaude(selectedText, parentArticleId);
      }
      await addLink(parentArticleId, selectedText, target.id, target.title);
      showToast(`Link criado: "${selectedText}" → ${target.title}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }, [contextMenu, hideContextMenu, articles, fetchFromWikipedia, generateWithClaude, addLink, showToast]);

  // ── Excluir artigo / remover link ───────────────────────────────────────────
  const handleDeleteArticle = useCallback(async () => {
    const ok = window.confirm(
      `Excluir "${article.title}"?\n\nOs links que apontam para ele também serão removidos.`
    );
    if (!ok) return;
    await deleteArticle(article.id);
    showToast(`Artigo "${article.title}" excluído.`);
  }, [article.id, article.title, deleteArticle, showToast]);

  const handleRemoveLink = useCallback(async (linkId: string) => {
    await removeLink(article.id, linkId);
  }, [article.id, removeLink]);

  // ── Edição de artigo manual ─────────────────────────────────────────────────
  const handleStartEdit = useCallback(() => {
    setEditDraft(article.content);
    setIsEditing(true);
  }, [article.content]);

  const handleSaveEdit = useCallback(async () => {
    await saveArticle({ ...article, content: editDraft });
    setIsEditing(false);
    showToast("Artigo salvo.");
    handleRegenerateFlashcards();
  }, [article, editDraft, saveArticle, showToast, handleRegenerateFlashcards]);

  // ── Abrir modal "Salvar trecho / tabela / imagem" ───────────────────────────
  // Para texto, a categoria define a cor de fundo do trecho (conceito/lista/dados)
  const handleOpenSaveExcerpt = useCallback((category: ExcerptCategory) => {
    const sel = getSelectionHtml();
    hideContextMenu();
    if (!sel) return;
    setSaveModal({ visible: true, kind: "text", category, html: sel.html });
  }, [hideContextMenu]);

  const handleOpenSaveTable = useCallback(() => {
    const html = contextMenu.tableHtml;
    hideContextMenu();
    if (!html) return;
    setSaveModal({ visible: true, kind: "table", category: "default", html });
  }, [contextMenu.tableHtml, hideContextMenu]);

  const handleOpenSaveImage = useCallback(() => {
    const { imageSrc, imageAlt } = contextMenu;
    hideContextMenu();
    if (!imageSrc) return;
    setSaveModal({
      visible: true, kind: "image", category: "default",
      html: `<img src="${imageSrc}" alt="${imageAlt ?? ""}">`,
      src: imageSrc, alt: imageAlt,
    });
  }, [contextMenu, hideContextMenu]);

  // ── Confirmar salvamento ────────────────────────────────────────────────────
  const handleConfirmSave = useCallback(async (targetId: string | null, targetTitle: string) => {
    const res = saveModal.kind === "image"
      ? await window.lexicon.invoke("article:appendImage", {
          targetId, targetTitle,
          src: saveModal.src, alt: saveModal.alt ?? "",
          sourceArticleId: article.id, sourceArticleTitle: article.title,
        })
      : await window.lexicon.invoke("article:appendExcerpt", {
          targetId, targetTitle,
          html: saveModal.html, kind: saveModal.kind, category: saveModal.category,
          sourceArticleId: article.id, sourceArticleTitle: article.title,
        });
    if (res.ok) await loadArticles();
    else showToast(res.error ?? "Falha ao salvar.", "error");
  }, [saveModal, article.id, article.title, loadArticles, showToast]);

  const handleRemoveExcerpt = useCallback(async (excerptId: string) => {
    const res = await window.lexicon.invoke("article:removeExcerpt", { targetId: article.id, excerptId });
    if (res.ok) await loadArticles();
  }, [article.id, loadArticles]);

  // ── Edição de trecho salvo ───────────────────────────────────────────────────
  // O rascunho reaberto é reconstruído a partir do editedMarkdown (removendo os
  // marcadores automáticos "(...)" e desembrulhando o itálico de inserção) ou,
  // na primeira edição, a partir do texto puro originalmente capturado.
  const handleStartEditExcerpt = useCallback((excerptId: string) => {
    const ex = article.excerpts.find(e => e.id === excerptId);
    if (!ex) return;
    // Tabelas usam editor próprio (grade); só o editor de texto precisa do draft.
    // Sem edição prévia, o rascunho vem do Markdown derivado do HTML original —
    // preserva negrito, itálico e listas da captura.
    if ((ex.kind ?? "text") === "text") {
      setExcerptEditDraft(stripTrackedMarkup(ex.editedMarkdown ?? excerptHtmlToMarkdown(ex.html)));
    }
    setEditingExcerptId(excerptId);
  }, [article.excerpts]);

  const handleCancelEditExcerpt = useCallback(() => {
    setEditingExcerptId(null);
    setExcerptEditDraft("");
  }, []);

  const handleSaveEditExcerpt = useCallback(async () => {
    const ex = article.excerpts.find(e => e.id === editingExcerptId);
    if (!ex) return;
    // O baseline do diff é o mesmo Markdown formatado mostrado ao abrir o editor,
    // para que a formatação original não seja lida como inserção
    const annotated = computeTrackedEdit(excerptHtmlToMarkdown(ex.html), excerptEditDraft);
    await updateExcerptMarkdown(article.id, ex.id, annotated);
    setEditingExcerptId(null);
    setExcerptEditDraft("");
    showToast("Trecho salvo.");
    handleRegenerateFlashcards();
  }, [article.id, article.excerpts, editingExcerptId, excerptEditDraft, updateExcerptMarkdown, showToast, handleRegenerateFlashcards]);

  // Tabela: edição direta célula a célula (sem o esquema de itálico/"(...)")
  const handleSaveTableEdit = useCallback(async (excerptId: string, markdown: string) => {
    await updateExcerptMarkdown(article.id, excerptId, markdown);
    setEditingExcerptId(null);
    showToast("Tabela salva.");
  }, [article.id, updateExcerptMarkdown, showToast]);

  const handleReorderOutline = useCallback((next: typeof outline) => {
    updateExcerptOutline(article.id, next);
  }, [article.id, updateExcerptOutline]);

  const handleRegenerateSummary = useCallback(async () => {
    setIsLoadingSummary(true);
    try {
      const res = await window.lexicon.invoke("claude:summarize", {
        title: article.title,
        text: article.content.replace(/<[^>]+>/g, " ").slice(0, 6000),
      });
      if (res.ok && res.data) await saveArticle({ ...article, summary: (res.data as any).summary });
    } finally { setIsLoadingSummary(false); }
  }, [article, saveArticle]);

  // ── Perguntar ao Claude sobre este artigo ───────────────────────────────────
  const handleAskClaude = useCallback(async () => {
    const question = chatInput.trim();
    if (!question) return;
    setChatInput("");
    setChatMessages(m => [...m, { role: "user", text: question }]);
    setChatLoading(true);
    try {
      // Contexto: título do artigo, conteúdo em texto puro, e títulos de
      // artigos vinculados/que referenciam este (sem baixar conteúdo deles)
      const relatedTitles = [
        ...article.links.map(l => l.targetTitle),
        ...articles.filter(a => a.links.some(l => l.targetId === article.id)).map(a => a.title),
      ];
      const plainContent = article.content
        ? article.content.replace(/<[^>]+>/g, " ")
        : article.summary;

      const res = await window.lexicon.invoke("claude:ask", {
        question,
        articleTitle: article.title,
        articleText: plainContent || article.summary,
        relatedContext: relatedTitles.map(t => `- ${t}`).join("\n"),
      });

      if (res.ok) {
        setChatMessages(m => [...m, { role: "assistant", text: (res.data as any).answer }]);
      } else {
        setChatMessages(m => [...m, { role: "assistant", text: `Erro: ${res.error}` }]);
      }
    } finally {
      setChatLoading(false);
    }
  }, [chatInput, article, articles]);

  // Manual: content é Markdown → HTML + links por texto puro.
  // Wikipedia: content é HTML com spans .wiki-term para ancorar os links.
  const processedHtml = article.source === "manual"
    ? sanitize(linkifyPlainText(markdownToHtml(article.content), article.links))
    : sanitize(injectInternalLinks(article.content, article.links));
  const excerpts: ArticleExcerpt[] = article.excerpts ?? [];

  // Backlinks: artigos cujos links apontam para este
  const backlinks: Backlink[] = articles.flatMap(a =>
    a.links
      .filter(l => l.targetId === article.id)
      .map(l => ({ sourceId: a.id, sourceTitle: a.title, anchorText: l.anchorText }))
  );

  // Transforma bullet points do Claude em HTML com âncoras de seção
  const summaryHtml = article.summary
    ? article.summary.split("\n").filter(Boolean).map((line, i) => {
        const text = escapeHtml(line.startsWith("•") ? line : "• " + line);
        return `<p class="summary-bullet">${text}</p>`;
      }).join("")
    : "<p class='no-content'>Nenhum resumo disponível.</p>";

  return (
    <div className="article-view">

      {/* ── Cabeçalho estilo Wikipedia ──────────────────────────────────── */}
      <div className="article-header">
        <div className="article-title-row">
          <h1 className="article-title">{article.title}</h1>
          <div className="article-header-actions">
            <button className={`icon-btn ${chatOpen ? "icon-btn-active" : ""}`} title="Perguntar ao Claude"
                    onClick={() => setChatOpen(o => !o)}>💬</button>
            <button className="icon-btn" title="Revisar flashcards deste artigo"
                    onClick={() => setReviewOpen(true)}
                    disabled={flashcards.filter(c => c.due <= new Date().toISOString()).length === 0}>🎓</button>
            {article.source === "manual" && !isEditing && (
              <button className="icon-btn" title="Editar artigo" onClick={handleStartEdit}>✎</button>
            )}
            <button className="icon-btn article-delete-btn" title="Excluir artigo"
                    onClick={handleDeleteArticle}>🗑</button>
          </div>
        </div>

        <div className="article-header-meta">
          <span className={`source-badge source-${article.source}`}>
            {article.source === "wikipedia" ? "Wikipédia" :
             article.source === "claude"    ? "Claude (IA)" : "Manual"}
          </span>
          <span className="header-sep">·</span>
          <span className="article-date">Atualizado em {new Date(article.updatedAt).toLocaleDateString("pt-BR")}</span>
          {excerpts.length > 0 && (
            <>
              <span className="header-sep">·</span>
              <span className="article-date">{excerpts.length} trecho{excerpts.length > 1 ? "s" : ""} salvos</span>
            </>
          )}
        </div>

        <TagEditor
          tags={article.tags ?? []}
          onChange={tags => updateTags(article.id, tags)}
        />

        {/* Abas de modo (igual à "discussão / editar" da Wikipedia) */}
        <div className="wiki-tabs">
          <button className={!showSummary ? "wiki-tab active" : "wiki-tab"} onClick={() => setShowSummary(false)}>
            Artigo
          </button>
          <button className={showSummary ? "wiki-tab active" : "wiki-tab"} onClick={() => setShowSummary(true)}>
            Resumo
          </button>
        </div>
      </div>

      {/* ── Linha divisória ─────────────────────────────────────────────── */}
      <div className="wiki-divider" />

      {/* ── Corpo ───────────────────────────────────────────────────────── */}
      <div className="article-body">

        {/* Chat contextual — pergunta usando o artigo (e vínculos) como contexto */}
        {chatOpen && (
          <div className="ask-claude-panel">
            <div className="ask-claude-messages">
              {chatMessages.length === 0 && (
                <p className="ask-claude-hint">
                  Pergunte algo sobre este artigo — o Claude responde usando o conteúdo
                  e os artigos vinculados como contexto.
                </p>
              )}
              {chatMessages.map((m, i) => (
                <div key={i} className={`ask-claude-msg ask-claude-${m.role}`}>{m.text}</div>
              ))}
              {chatLoading && (
                <div className="ask-claude-msg ask-claude-assistant ask-claude-loading">Pensando…</div>
              )}
            </div>
            <form className="ask-claude-form" onSubmit={e => { e.preventDefault(); handleAskClaude(); }}>
              <input
                value={chatInput} onChange={e => setChatInput(e.target.value)}
                placeholder="Pergunte sobre este artigo…" disabled={chatLoading}
              />
              <button type="submit" className="primary" disabled={chatLoading || !chatInput.trim()}>
                Perguntar
              </button>
            </form>
          </div>
        )}

        {/* Índice de links internos (estilo "Sumário" da Wikipedia) */}
        {article.links.length > 0 && !showSummary && (
          <div className="wiki-toc">
            <div className="wiki-toc-title">Conceitos vinculados</div>
            <ol className="wiki-toc-list">
              {article.links.map((link, i) => (
                <li key={link.id}>
                  <a href="#" className="toc-link"
                     onClick={e => { e.preventDefault(); openArticle(link.targetId); }}>
                    {link.anchorText}
                  </a>
                  <span className="toc-target"> — {link.targetTitle}</span>
                  <button className="toc-remove-btn" title="Remover link"
                          onClick={() => handleRemoveLink(link.id)}>✕</button>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Conteúdo principal */}
        {isEditing ? (
          <div className="manual-editor">
            <textarea
              autoFocus
              value={editDraft}
              onChange={e => setEditDraft(e.target.value)}
              onKeyDown={e => handleFormatShortcut(e, setEditDraft)}
              placeholder={"Escreva em Markdown…\n\n# Título de seção\n- item de lista\n**negrito**, *itálico*, ==amarelo==, ++laranja++\n[definição]{.def}  [estrutura]{.enum}  [dado numérico]{.num}"}
            />
            <div className="manual-editor-actions">
              <button onClick={() => setIsEditing(false)}>Cancelar</button>
              <button className="primary" onClick={handleSaveEdit}>Salvar</button>
            </div>
          </div>
        ) : showSummary ? (
          <div ref={summaryRef} className="wiki-content summary-content">
            <div dangerouslySetInnerHTML={{ __html: summaryHtml }} />
            <div className="summary-actions">
              <button className="wiki-btn" onClick={handleRegenerateSummary} disabled={isLoadingSummary}>
                {isLoadingSummary ? "Gerando…" : "↺ Regenerar resumo"}
              </button>
            </div>
          </div>
        ) : article.content ? (
          <div ref={containerRef} className="wiki-content"
               dangerouslySetInnerHTML={{ __html: processedHtml }} />
        ) : (
          <div ref={containerRef} className="wiki-content">
            <div dangerouslySetInnerHTML={{ __html: summaryHtml }} />
          </div>
        )}

        {/* Trechos salvos */}
        <ExcerptsPanel
          article={article}
          outline={outline}
          onOpenSource={id => openArticle(id)}
          onRemoveExcerpt={handleRemoveExcerpt}
          onReorder={handleReorderOutline}
          editingExcerptId={editingExcerptId}
          editDraft={excerptEditDraft}
          onStartEdit={handleStartEditExcerpt}
          onEditDraftChange={setExcerptEditDraft}
          onSaveEdit={handleSaveEditExcerpt}
          onSaveTableEdit={handleSaveTableEdit}
          onCancelEdit={handleCancelEditExcerpt}
        />

        {/* Flashcards */}
        <FlashcardsPanel
          cards={flashcards}
          loading={flashcardsLoading}
          onRegenerate={handleRegenerateFlashcards}
          onStartReview={() => setReviewOpen(true)}
        />

        {/* Backlinks */}
        <BacklinksPanel backlinks={backlinks} onOpen={id => openArticle(id)} />

      </div>

      {/* ── Menu de contexto ─────────────────────────────────────────────── */}
      {contextMenu.visible && contextMenu.parentArticleId === article.id && (
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y}
          text={contextMenu.selectedText}
          hasTable={!!contextMenu.tableHtml}
          hasImage={!!contextMenu.imageSrc}
          onSearchWiki={() => handleSearch("wikipedia")}
          onSearchClaude={() => handleSearch("claude")}
          onSaveExcerpt={handleOpenSaveExcerpt}
          onSaveTable={handleOpenSaveTable}
          onSaveImage={handleOpenSaveImage}
          onClose={hideContextMenu}
        />
      )}

      {/* ── Modal de trecho / tabela / imagem ──────────────────────────────── */}
      {saveModal.visible && (
        <SaveExcerptModal
          kind={saveModal.kind}
          category={saveModal.category}
          html={saveModal.html}
          sourceArticleId={article.id}
          sourceArticleTitle={article.title}
          articles={articles}
          onSave={handleConfirmSave}
          onClose={() => setSaveModal({ visible: false, kind: "text", category: "default", html: "" })}
        />
      )}

      {/* ── Modal de revisão de flashcards (deste artigo) ───────────────────── */}
      {reviewOpen && (
        <ReviewModal
          cards={flashcards.filter(c => c.due <= new Date().toISOString())}
          onGrade={handleGradeCard}
          onClose={() => setReviewOpen(false)}
        />
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ContextMenu
// ─────────────────────────────────────────────────────────────────────────────

interface ContextMenuProps {
  x: number; y: number; text: string;
  hasTable: boolean; hasImage: boolean;
  onSearchWiki: () => void; onSearchClaude: () => void;
  onSaveExcerpt: (category: ExcerptCategory) => void;
  onSaveTable: () => void; onSaveImage: () => void;
  onClose: () => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({
  x, y, text, hasTable, hasImage,
  onSearchWiki, onSearchClaude, onSaveExcerpt, onSaveTable, onSaveImage, onClose,
}) => {
  const hasText = text.length > 0;
  const label = hasText
    ? (text.length > 30 ? text.slice(0, 28) + "…" : text)
    : hasImage ? "Imagem" : hasTable ? "Tabela" : "";

  useEffect(() => {
    let handler: (() => void) | undefined;
    const id = setTimeout(() => {
      handler = () => onClose();
      document.addEventListener("click", handler, { once: true });
    }, 0);
    return () => {
      clearTimeout(id);
      if (handler) document.removeEventListener("click", handler);
    };
  }, [onClose]);

  // Encaixa o menu dentro da viewport — sem isso, um toque/clique perto da
  // borda (comum em telas estreitas de celular) renderiza o menu cortado ou
  // fora da tela por completo, já que x/y vêm crus do evento de origem.
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: y, left: x });

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) { setPos({ top: y, left: x }); return; }
    const margin = 8;
    const rect = el.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - margin;
    const maxTop = window.innerHeight - rect.height - margin;
    setPos({
      left: Math.max(margin, Math.min(x, maxLeft)),
      top: Math.max(margin, Math.min(y, maxTop)),
    });
  }, [x, y]);

  return (
    <div ref={menuRef} className="context-menu" style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 1000 }}
         onClick={e => e.stopPropagation()}>
      <div className="context-menu-header">"{label}"</div>
      {hasText && (
        <>
          <button className="context-menu-item" onClick={onSearchWiki}>🔍 Pesquisar na Wikipédia</button>
          <button className="context-menu-item" onClick={onSearchClaude}>✦ Gerar artigo com Claude</button>
          <hr className="context-menu-divider" />
          <button className="context-menu-item context-menu-save" onClick={() => onSaveExcerpt("default")}>
            📌 Salvar trecho
          </button>
          <button className="context-menu-item context-menu-save" onClick={() => onSaveExcerpt("concept")}>
            <span className="ctx-cat-swatch ctx-cat-concept" /> Salvar como conceito
          </button>
          <button className="context-menu-item context-menu-save" onClick={() => onSaveExcerpt("list")}>
            <span className="ctx-cat-swatch ctx-cat-list" /> Salvar como lista
          </button>
          <button className="context-menu-item context-menu-save" onClick={() => onSaveExcerpt("numeric")}>
            <span className="ctx-cat-swatch ctx-cat-numeric" /> Salvar como dados numéricos
          </button>
        </>
      )}
      {hasTable && (
        <button className="context-menu-item context-menu-save" onClick={onSaveTable}>📊 Salvar tabela em…</button>
      )}
      {hasImage && (
        <button className="context-menu-item context-menu-save" onClick={onSaveImage}>🖼 Salvar imagem em…</button>
      )}
      <hr className="context-menu-divider" />
      <button className="context-menu-item context-menu-cancel" onClick={onClose}>Cancelar</button>
    </div>
  );
};
