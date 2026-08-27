// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/ArticleView.tsx
// ─────────────────────────────────────────────────────────────────────────────

import React, { useRef, useEffect, useLayoutEffect, useState, useCallback, useMemo, useId } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import DOMPurify from "dompurify";
import type { Article, ArticleExcerpt, ArticleHistoryEntry, ExcerptCategory, ExcerptOutlineItem, Flashcard, FlashcardGrade } from "../shared/types";
import { useStore } from "../store/useStore";
import { computeTrackedEdit, stripTrackedMarkup } from "../lib/excerptDiff";
import { confirmDialog } from "../lib/confirmDialog";
import { buildWikiAccordions, openAncestorDetails } from "../lib/wikiAccordions";
import { findLinkSuggestions } from "../lib/linkSuggestions";
import { Icon, type IconName } from "./Icon";
import {
  escapeHtml, inlineMarkdown, markdownToHtml, excerptHtmlToMarkdown,
  parseMarkdownTable, serializeMarkdownTable, markdownTableToHtml,
} from "../lib/markdown";

interface Props {
  article: Article;
  // Quando informado (shell mobile), os 4 ícones "primários" do cabeçalho
  // (buscar/sumário/chat/flashcards) são renderizados via portal dentro
  // desse elemento — a barra de navegação superior do próprio shell — em vez
  // de ficarem ao lado do <h1>, liberando espaço no título numa tela estreita.
  // No desktop (sem slot), continuam inline como sempre.
  headerActionsSlot?: HTMLElement | null;
}

// Sanitização final antes de qualquer dangerouslySetInnerHTML
function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    // data-article-id: âncora dos links internos; style: necessário para as
    // cores personalizáveis de destaque/texto ([texto]{bg=...}/{color=...})
    ADD_ATTR: ["data-article-id", "style"],
  });
}

// Transforma bullet points do Claude em HTML com âncoras de seção
function summaryToHtml(summary: string): string {
  return summary
    ? summary.split("\n").filter(Boolean).map(line => {
        const text = escapeHtml(line.startsWith("•") ? line : "• " + line);
        return `<p class="summary-bullet">${text}</p>`;
      }).join("")
    : "<p class='no-content'>Nenhum resumo disponível.</p>";
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
      <button type="button" title="Negrito — ⌘B (**texto**)" aria-label="Negrito — ⌘B (**texto**)" onClick={() => wrap("**", "**")}><strong>B</strong></button>
      <button type="button" className="hl-swatch hl-swatch-yellow"
              title="Amarelo: destaque padrão, vira flashcard cloze — ⌘⇧1 (==texto==)" aria-label="Amarelo: destaque padrão, vira flashcard cloze — ⌘⇧1 (==texto==)"
              onClick={() => wrap("==", "==")}>A</button>
      <button type="button" className="hl-swatch hl-swatch-def"
              title="Azul: definição de conceito — ⌘⇧2 ([texto]{.def})" aria-label="Azul: definição de conceito — ⌘⇧2 ([texto]{.def})"
              onClick={() => wrap("[", "]{.def}")}>D</button>
      <button type="button" className="hl-swatch hl-swatch-enum"
              title="Verde: divisão de estrutura / enumeração — ⌘⇧3 ([texto]{.enum})" aria-label="Verde: divisão de estrutura / enumeração — ⌘⇧3 ([texto]{.enum})"
              onClick={() => wrap("[", "]{.enum}")}>E</button>
      <button type="button" className="hl-swatch hl-swatch-num"
              title="Roxo: dado numérico importante — ⌘⇧4 ([texto]{.num})" aria-label="Roxo: dado numérico importante — ⌘⇧4 ([texto]{.num})"
              onClick={() => wrap("[", "]{.num}")}>N</button>
      <button type="button" className="hl-swatch hl-swatch-orange"
              title="Laranja — ⌘⇧5 (++texto++)" aria-label="Laranja — ⌘⇧5 (++texto++)"
              onClick={() => wrap("++", "++")}>L</button>
      <span className="excerpt-toolbar-color-group">
        <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)} title="Cor do marca-texto" />
        <button type="button" title="Aplicar marca-texto colorido" aria-label="Aplicar marca-texto colorido" onClick={() => wrap("[", `]{bg=${bgColor}}`)}>
          Marcar
        </button>
      </span>
      <span className="excerpt-toolbar-color-group">
        <input type="color" value={textColor} onChange={e => setTextColor(e.target.value)} title="Cor do texto" />
        <button type="button" title="Aplicar cor no texto" aria-label="Aplicar cor no texto" onClick={() => wrap("[", `]{color=${textColor}}`)}>
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
  const removeRow = async (r: number) => {
    if (matrix.length <= 1) return;
    const hasContent = matrix[r].some(cell => cell.trim().length > 0);
    if (hasContent && !(await confirmDialog("Esta linha tem conteúdo preenchido. Remover mesmo assim?"))) return;
    setMatrix(m => m.filter((_, ri) => ri !== r));
  };
  const addCol = () => setMatrix(m => m.map(row => {
    const copy = [...row];
    while (copy.length < colCount) copy.push("");
    copy.push("");
    return copy;
  }));
  const removeCol = async () => {
    if (colCount <= 1) return;
    const hasContent = matrix.some(row => (row[colCount - 1] ?? "").trim().length > 0);
    if (hasContent && !(await confirmDialog("Esta coluna tem conteúdo preenchido. Remover mesmo assim?"))) return;
    setMatrix(m => m.map(row => row.slice(0, colCount - 1)));
  };

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
                  <button type="button" title="Remover linha" aria-label="Remover linha" onClick={() => removeRow(r)}
                          disabled={matrix.length <= 1}><Icon name="close" /></button>
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
  editBaseline: string;
  onStartEdit: (excerptId: string) => void;
  onEditDraftChange: (text: string) => void;
  onSaveEdit: () => void;
  onSaveTableEdit: (excerptId: string, markdown: string) => void;
  onCancelEdit: () => void;
}

const EXCERPT_KIND_ICON: Record<string, IconName> = { text: "text", table: "table", image: "image" };

const ExcerptsPanel: React.FC<ExcerptsPanelProps> = ({
  article, outline, onOpenSource, onRemoveExcerpt, onReorder,
  editingExcerptId, editDraft, editBaseline, onStartEdit, onEditDraftChange, onSaveEdit,
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
                    {editDraft !== editBaseline && (
                      <span className="unsaved-indicator" title="Alterações ainda não salvas">
                        ● Não salvo
                      </span>
                    )}
                    <button onClick={onCancelEdit}>Cancelar</button>
                    <button className="primary" onClick={onSaveEdit}>Salvar</button>
                  </div>
                </div>
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
              <Icon name="back" /><span>{b.sourceTitle}</span>
            </button>
            <span className="backlink-anchor">via "{b.anchorText}"</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

// ── Editor de tags (chips no cabeçalho) ───────────────────────────────────────
// existingTags alimenta um <datalist> com as tags já usadas em outros artigos
// da base — evita criar quase-duplicatas (ex.: "biologia" vs "biológica") por
// não saber que uma variante já existe.
const TagEditor: React.FC<{
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
  onStartReview: () => void;
}> = ({ cards, loading, onStartReview }) => {
  const now = new Date().toISOString();
  const dueCount = cards.filter(c => c.due <= now).length;
  return (
    <div className="flashcards-panel">
      <div className="excerpts-panel-header">
        <h2 className="section-heading">Flashcards ({cards.length})</h2>
        <div className="flashcards-panel-actions">
          {/* Sem botão manual de regenerar: já roda sozinho depois de cada
              salvamento de artigo/trecho (ver handleRegenerateFlashcards) —
              loading só desabilita a revisão enquanto isso acontece. */}
          <button
            type="button"
            className="icon-btn primary flashcards-review-btn"
            onClick={onStartReview}
            disabled={dueCount === 0 || loading}
            title={`Revisar flashcards (${dueCount} vencido${dueCount === 1 ? "" : "s"})`}
            aria-label={`Revisar flashcards (${dueCount} vencido${dueCount === 1 ? "" : "s"})`}
          >
            <Icon name="flashcards" />
            {dueCount > 0 && <span className="flashcards-review-badge">{dueCount}</span>}
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
  // Total fixado no início da sessão — a fila (queue) só encolhe conforme o
  // usuário avalia cartões, então "total - queue.length" é a posição atual.
  const [total] = useState(cards.length);

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
          <h2>Revisão concluída <Icon name="done" /></h2>
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
          <span className="review-progress">
            {total - queue.length + 1} de {total}
            <span className="review-progress-remaining"> · {queue.length} restante{queue.length > 1 ? "s" : ""}</span>
          </span>
          <span className="review-article-title">{current.articleTitle}</span>
        </div>
        <div className="review-progress-bar">
          <div className="review-progress-bar-fill" style={{ width: `${((total - queue.length) / total) * 100}%` }} />
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

// ── Buscar na página ──────────────────────────────────────────────────────────
// Destaca ocorrências de `query` no container ativo (artigo ou resumo) com
// <mark>, navegável. Mutação de DOM direta (fora do controle do React), no
// mesmo espírito do efeito de fallback de imagem quebrada mais abaixo —
// seguro porque só roda entre re-renders do dangerouslySetInnerHTML, nunca
// durante um deles.
function clearFindMarks(container: HTMLElement) {
  container.querySelectorAll("mark.find-match").forEach(mark => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
    parent.normalize();
  });
}

function highlightFindMatches(container: HTMLElement, query: string): HTMLElement[] {
  clearFindMarks(container);
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.toLowerCase().includes(q)) return NodeFilter.FILTER_SKIP;
      const tag = node.parentElement?.tagName;
      if (tag === "MARK" || tag === "SCRIPT" || tag === "STYLE") return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const textNodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) textNodes.push(n as Text);

  const matches: HTMLElement[] = [];
  for (const node of textNodes) {
    const text = node.nodeValue ?? "";
    const lower = text.toLowerCase();
    const frag = document.createDocumentFragment();
    let cursor = 0;
    let idx = lower.indexOf(q, cursor);
    while (idx !== -1) {
      if (idx > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, idx)));
      const mark = document.createElement("mark");
      mark.className = "find-match";
      mark.textContent = text.slice(idx, idx + q.length);
      frag.appendChild(mark);
      matches.push(mark);
      cursor = idx + q.length;
      idx = lower.indexOf(q, cursor);
    }
    if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
    node.parentNode?.replaceChild(frag, node);
  }
  return matches;
}

const FindInPageBar: React.FC<{
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

// ── Sumário (Conteúdo) — lista de seções do artigo, estilo app da Wikipedia ──
interface TocItem { id: string; text: string; level: number; }

function slugifyHeading(text: string, used: Set<string>): string {
  const base = text.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "secao";
  let id = base, n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

const SectionsTocPanel: React.FC<{
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

// ── Histórico de versões ────────────────────────────────────────────────────
// Extrai um texto comparável de uma versão (snapshot ou atual) para o diff:
// artigos manuais já são Markdown; wikipedia/claude viram texto puro (tags
// HTML fora, para o diff por token não se perder em atributos/markup).
function comparableVersionText(source: Article["source"], content: string, summary: string): string {
  const raw = content && content.trim() ? content : summary;
  if (source === "manual") return raw;
  return raw.replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function formatHistoryDate(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

const HistoryModal: React.FC<{
  article: Article;
  onClose: () => void;
  onReverted: () => Promise<void>;
  showToast: (message: string, type?: "info" | "error") => void;
}> = ({ article, onClose, onReverted, showToast }) => {
  const [entries, setEntries] = useState<ArticleHistoryEntry[] | null>(null);
  const [expandedAt, setExpandedAt] = useState<string | null>(null);
  const [reverting, setReverting] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.lexicon.invoke("article:getHistory", { id: article.id }).then(res => {
      if (!cancelled && res.ok) setEntries((res.data as ArticleHistoryEntry[]) ?? []);
    });
    return () => { cancelled = true; };
  }, [article.id]);

  const handleRevert = useCallback(async (entry: ArticleHistoryEntry) => {
    const ok = await confirmDialog(
      `Reverter "${article.title}" para a versão de ${formatHistoryDate(entry.updatedAt)}? A versão atual também fica salva no histórico.`,
      "Reverter versão"
    );
    if (!ok) return;
    setReverting(entry.updatedAt);
    try {
      const res = await window.lexicon.invoke("article:revertVersion", { id: article.id, updatedAt: entry.updatedAt });
      if (res.ok) {
        showToast("Artigo revertido para a versão selecionada.");
        await onReverted();
        onClose();
      } else {
        showToast(res.error ?? "Falha ao reverter versão.", "error");
      }
    } finally {
      setReverting(null);
    }
  }, [article.id, article.title, onReverted, onClose, showToast]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal history-modal" onClick={e => e.stopPropagation()}>
        <h2>Histórico de versões</h2>
        {entries === null && <p className="no-content">Carregando…</p>}
        {entries !== null && entries.length === 0 && (
          <p className="no-content">Nenhuma versão anterior salva ainda — o histórico começa a ser guardado na próxima edição deste artigo.</p>
        )}
        {entries !== null && entries.length > 0 && (
          <ul className="history-list">
            {entries.map(entry => {
              const expanded = expandedAt === entry.updatedAt;
              return (
                <li key={entry.updatedAt} className="history-item">
                  <div className="history-item-row">
                    <span className="history-item-date">{formatHistoryDate(entry.updatedAt)}</span>
                    <span className="history-item-title">{entry.title}</span>
                    <div className="history-item-actions">
                      <button type="button" onClick={() => setExpandedAt(expanded ? null : entry.updatedAt)}>
                        {expanded ? "Ocultar diff" : "Ver diff"}
                      </button>
                      <button type="button" disabled={reverting === entry.updatedAt}
                              onClick={() => handleRevert(entry)}>
                        {reverting === entry.updatedAt ? "Revertendo…" : "Reverter"}
                      </button>
                    </div>
                  </div>
                  {expanded && (() => {
                    const oldText = comparableVersionText(article.source, entry.content, entry.summary);
                    const newText = comparableVersionText(article.source, article.content, article.summary);
                    const diffMd = computeTrackedEdit(oldText, newText);
                    return (
                      <div className="history-diff" dangerouslySetInnerHTML={{ __html: sanitize(markdownToHtml(diffMd || "_Sem diferenças de texto._")) }} />
                    );
                  })()}
                </li>
              );
            })}
          </ul>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
};

// ── Anexos (imagem/PDF/qualquer arquivo) ────────────────────────────────────
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentIcon(mimeType: string): IconName {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "file";
  return "attachment";
}

// Lê um File do input como base64 puro (sem o prefixo "data:...;base64,")
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Falha ao ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

const AttachmentsSection: React.FC<{
  article: Article;
  onChanged: () => Promise<void>;
  showToast: (message: string, type?: "info" | "error") => void;
}> = ({ article, onChanged, showToast }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ name: string; dataUrl: string } | null>(null);
  const attachments = article.attachments ?? [];

  const handleFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const dataBase64 = await fileToBase64(file);
      const res = await window.lexicon.invoke("article:addAttachment", {
        articleId: article.id, name: file.name, mimeType: file.type || "application/octet-stream", dataBase64,
      });
      if (res.ok) await onChanged();
      else showToast(res.error ?? "Falha ao anexar arquivo.", "error");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Falha ao anexar arquivo.", "error");
    } finally {
      setUploading(false);
    }
  }, [article.id, onChanged, showToast]);

  const handlePreview = useCallback(async (attachmentId: string) => {
    setBusyId(attachmentId);
    try {
      const res = await window.lexicon.invoke("article:getAttachmentData", { articleId: article.id, attachmentId });
      if (res.ok) {
        const { dataBase64, mimeType, name } = res.data as { dataBase64: string; mimeType: string; name: string };
        setPreview({ name, dataUrl: `data:${mimeType};base64,${dataBase64}` });
      } else {
        showToast(res.error ?? "Falha ao abrir anexo.", "error");
      }
    } finally {
      setBusyId(null);
    }
  }, [article.id, showToast]);

  const handleExport = useCallback(async (attachmentId: string) => {
    setBusyId(attachmentId);
    try {
      const res = await window.lexicon.invoke("article:exportAttachment", { articleId: article.id, attachmentId });
      if (!res.ok) showToast(res.error ?? "Falha ao exportar anexo.", "error");
    } finally {
      setBusyId(null);
    }
  }, [article.id, showToast]);

  const handleRemove = useCallback(async (attachmentId: string, name: string) => {
    const ok = await confirmDialog(`Remover o anexo "${name}"?`, "Remover anexo");
    if (!ok) return;
    setBusyId(attachmentId);
    try {
      const res = await window.lexicon.invoke("article:removeAttachment", { articleId: article.id, attachmentId });
      if (res.ok) await onChanged();
      else showToast(res.error ?? "Falha ao remover anexo.", "error");
    } finally {
      setBusyId(null);
    }
  }, [article.id, onChanged, showToast]);

  return (
    <div className="attachments-section">
      <div className="attachments-header">
        <span className="attachments-label">Anexos{attachments.length > 0 ? ` (${attachments.length})` : ""}</span>
        <button type="button" className="attachments-add-btn" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
          {uploading ? "Anexando…" : "+ Anexar arquivo"}
        </button>
        <input ref={fileInputRef} type="file" hidden onChange={handleFileSelected} />
      </div>
      {attachments.length > 0 && (
        <ul className="attachments-list">
          {attachments.map(a => (
            <li key={a.id} className="attachment-item">
              <span className="attachment-icon"><Icon name={attachmentIcon(a.mimeType)} /></span>
              <span className="attachment-name" title={a.name}>{a.name}</span>
              <span className="attachment-size">{formatBytes(a.size)}</span>
              <div className="attachment-actions">
                {a.mimeType.startsWith("image/") && (
                  <button type="button" disabled={busyId === a.id} onClick={() => handlePreview(a.id)}>Ver</button>
                )}
                <button type="button" disabled={busyId === a.id} onClick={() => handleExport(a.id)}>Exportar</button>
                <button type="button" disabled={busyId === a.id} onClick={() => handleRemove(a.id, a.name)}>Remover</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {preview && (
        <div className="modal-overlay" onClick={() => setPreview(null)}>
          <div className="modal attachment-preview-modal" onClick={e => e.stopPropagation()}>
            <h2>{preview.name}</h2>
            <img src={preview.dataUrl} alt={preview.name} className="attachment-preview-img" />
            <div className="modal-actions">
              <button onClick={() => setPreview(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────────────────────

export const ArticleView: React.FC<Props> = ({ article, headerActionsSlot }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const summaryRef   = useRef<HTMLDivElement>(null);
  const [showSummary, setShowSummary]         = useState(false);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  // Prévia do resumo regenerado — nunca sobrescreve o resumo atual direto;
  // o usuário compara e decide aplicar ou descartar (evita perder o resumo
  // anterior se a nova geração vier pior).
  const [summaryPreview, setSummaryPreview] = useState<string | null>(null);
  // Se o resumo automático falhou na criação (ver useStore.ts/fetchFromWikipedia),
  // o artigo é salvo com esse texto fixo — o botão "Regenerar resumo" fica na
  // aba Resumo normalmente. A aba padrão ao abrir qualquer artigo é sempre
  // "Artigo": como este componente não é remontado ao trocar de artigo (só a
  // prop muda), sem este reset a aba "Resumo" ficaria "grudada" ao navegar
  // para outro artigo enquanto ela estivesse aberta.
  const summaryFailed = article.summary.trim() === "• Resumo não disponível.";
  useEffect(() => { setShowSummary(false); }, [article.id]);
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
  // Índices de mensagens do assistente já salvas como trecho no artigo — evita
  // duplicar ao clicar "Salvar" mais de uma vez na mesma resposta
  const [savedChatIndices, setSavedChatIndices] = useState<Set<number>>(new Set());
  // Sugestões de link descartadas pelo usuário nesta sessão de visualização
  // (não persistido — reabrir o artigo mostra as sugestões de novo)
  const [dismissedTerms, setDismissedTerms] = useState<Set<string>>(new Set());
  // Quantas sugestões de link mostrar de uma vez ("carregar mais" avança isso)
  const [suggestionLimit, setSuggestionLimit] = useState(20);
  // Edição de trechos salvos (texto)
  const [editingExcerptId, setEditingExcerptId] = useState<string | null>(null);
  const [excerptEditDraft, setExcerptEditDraft] = useState("");
  const [excerptEditBaseline, setExcerptEditBaseline] = useState("");
  // Flashcards
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [flashcardsLoading, setFlashcardsLoading] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  // Histórico de versões
  const [historyOpen, setHistoryOpen] = useState(false);
  // Buscar na página
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findCount, setFindCount] = useState(0);
  const [findIndex, setFindIndex] = useState(0);
  const findMatchesRef = useRef<HTMLElement[]>([]);
  // Sumário (Conteúdo)
  const [tocOpen, setTocOpen] = useState(false);
  const [tocItems, setTocItems] = useState<TocItem[]>([]);

  const { contextMenu, showContextMenu, hideContextMenu,
          fetchFromWikipedia, generateWithClaude, addLink, removeLink,
          openArticle, articles, saveArticle, deleteArticle, restoreArticle, loadArticles,
          updateTags, updateExcerptMarkdown, updateExcerptOutline,
          showToast, selectionHintSeen, dismissSelectionHint } = useStore(useShallow(s => ({
    contextMenu: s.contextMenu, showContextMenu: s.showContextMenu,
    hideContextMenu: s.hideContextMenu, fetchFromWikipedia: s.fetchFromWikipedia,
    generateWithClaude: s.generateWithClaude, addLink: s.addLink,
    removeLink: s.removeLink, openArticle: s.openArticle, articles: s.articles,
    saveArticle: s.saveArticle, deleteArticle: s.deleteArticle, restoreArticle: s.restoreArticle,
    loadArticles: s.loadArticles, updateTags: s.updateTags,
    updateExcerptMarkdown: s.updateExcerptMarkdown, updateExcerptOutline: s.updateExcerptOutline,
    showToast: s.showToast, selectionHintSeen: s.selectionHintSeen,
    dismissSelectionHint: s.dismissSelectionHint,
  })));

  const outline = useMemo(() => resolveOutline(article), [article]);

  // Todas as tags já usadas na base — alimenta o autocomplete do TagEditor
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const a of articles) for (const t of a.tags ?? []) set.add(t);
    return Array.from(set).sort();
  }, [articles]);


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
    setHistoryOpen(false);
    setFindOpen(false);
    setFindQuery("");
    setTocOpen(false);
    loadFlashcards();
  }, [article.id, loadFlashcards]);

  // ── Buscar na página: (re)destaca as ocorrências no container ativo ────────
  useEffect(() => {
    const container = showSummary ? summaryRef.current : containerRef.current;
    if (!findOpen || !container) {
      [containerRef.current, summaryRef.current].forEach(el => el && clearFindMarks(el));
      findMatchesRef.current = [];
      setFindCount(0);
      return;
    }
    const matches = highlightFindMatches(container, findQuery);
    findMatchesRef.current = matches;
    setFindCount(matches.length);
    setFindIndex(0);
  }, [findOpen, findQuery, showSummary, article.id]);

  // Marca o resultado atual e rola até ele — abrindo antes qualquer
  // accordion/toggle fechado em que o match esteja (senão o match existe no
  // DOM mas fica invisível, escondido pelo <details> recolhido)
  useEffect(() => {
    findMatchesRef.current.forEach((m, i) => m.classList.toggle("find-match-current", i === findIndex));
    const current = findMatchesRef.current[findIndex];
    if (current) openAncestorDetails(current);
    current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [findIndex, findCount]);

  const handleFindNext = useCallback(() => {
    setFindIndex(i => findMatchesRef.current.length ? (i + 1) % findMatchesRef.current.length : 0);
  }, []);
  const handleFindPrev = useCallback(() => {
    setFindIndex(i => findMatchesRef.current.length ? (i - 1 + findMatchesRef.current.length) % findMatchesRef.current.length : 0);
  }, []);
  const handleFindClose = useCallback(() => { setFindOpen(false); setFindQuery(""); }, []);

  // Atalho Cmd/Ctrl+F abre a busca-na-página enquanto este artigo está montado
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f" && !isEditing) {
        e.preventDefault();
        setFindOpen(true);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isEditing]);

  // ── Sumário (Conteúdo): extrai os headings do artigo renderizado ───────────
  // Só roda quando o container do artigo está montado (aba "Artigo", não "Resumo") —
  // o sumário reflete a última varredura enquanto o usuário estiver na aba Resumo.
  useEffect(() => {
    if (showSummary) return;
    const container = containerRef.current;
    if (!container) { setTocItems([]); return; }
    const headings = Array.from(container.querySelectorAll<HTMLElement>("h1, h2, h3, h4"));
    const used = new Set<string>();
    const items: TocItem[] = headings.map(h => {
      if (h.id) used.add(h.id);
      else h.id = slugifyHeading(h.textContent ?? "", used);
      return { id: h.id, text: h.textContent ?? "", level: Number(h.tagName[1]) };
    });
    setTocItems(items);
  }, [showSummary, article.id, article.content, article.links]);

  const handleJumpToHeading = useCallback((id: string) => {
    setTocOpen(false);
    const jump = () => {
      const el = document.getElementById(id);
      if (!el) return;
      openAncestorDetails(el);
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    if (showSummary) {
      setShowSummary(false);
      requestAnimationFrame(() => requestAnimationFrame(jump));
    } else {
      jump();
    }
  }, [showSummary]);

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
    // Usar o menu de contexto sobre uma seleção é o próprio usuário
    // descobrindo o fluxo — não precisa mais ver a dica.
    if (sel && !selectionHintSeen) { dismissSelectionHint(); setSelectionHint(null); }
  }, [article.id, showContextMenu, selectionHintSeen, dismissSelectionHint]);

  // ── Dica de descoberta: primeira seleção de texto num artigo ────────────────
  // Some artigos "manuais" também suportam clique-direito; a dica cobre o
  // fluxo mais comum (Wikipedia/Claude) sem exigir configuração adicional.
  const [selectionHint, setSelectionHint] = useState<{ x: number; y: number } | null>(null);

  const handleMouseUpForHint = useCallback(() => {
    if (selectionHintSeen || isEditing) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const text = sel.toString().trim();
    if (text.length < 2) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    setSelectionHint({ x: rect.left, y: rect.bottom + 8 });
  }, [selectionHintSeen, isEditing]);

  // ── Clique em link interno ──────────────────────────────────────────────────
  const handleClick = useCallback((e: MouseEvent) => {
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>("a.internal-link");
    if (link) {
      e.preventDefault();
      const tid = link.getAttribute("data-article-id");
      if (tid) openArticle(tid);
    }
  }, [openArticle]);

  // ── Preview ao passar o mouse sobre um link interno ─────────────────────────
  // Mostra título + início do resumo do artigo-alvo sem precisar navegar até
  // ele — só depende do que já está em memória (articles já carrega summary
  // de todos os artigos), sem chamada extra.
  const [linkPreview, setLinkPreview] = useState<{ articleId: string; x: number; y: number } | null>(null);
  const linkPreviewTimerRef = useRef<number | null>(null);

  const handleLinkMouseOver = useCallback((e: MouseEvent) => {
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>("a.internal-link");
    if (!link) return;
    const tid = link.getAttribute("data-article-id");
    if (!tid) return;
    const rect = link.getBoundingClientRect();
    if (linkPreviewTimerRef.current) window.clearTimeout(linkPreviewTimerRef.current);
    linkPreviewTimerRef.current = window.setTimeout(() => {
      setLinkPreview({ articleId: tid, x: rect.left, y: rect.bottom + 6 });
    }, 350);
  }, []);

  const handleLinkMouseOut = useCallback((e: MouseEvent) => {
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>("a.internal-link");
    if (!link) return;
    if (linkPreviewTimerRef.current) { window.clearTimeout(linkPreviewTimerRef.current); linkPreviewTimerRef.current = null; }
    setLinkPreview(null);
  }, []);

  useEffect(() => () => { if (linkPreviewTimerRef.current) window.clearTimeout(linkPreviewTimerRef.current); }, []);

  // Registra eventos nos dois containers (artigo completo e resumo)
  useEffect(() => {
    const refs = [containerRef.current, summaryRef.current].filter(Boolean);
    refs.forEach(el => {
      el!.addEventListener("contextmenu", handleContextMenu);
      el!.addEventListener("click", handleClick);
      el!.addEventListener("mouseover", handleLinkMouseOver);
      el!.addEventListener("mouseout", handleLinkMouseOut);
      el!.addEventListener("mouseup", handleMouseUpForHint);
    });
    return () => refs.forEach(el => {
      el!.removeEventListener("contextmenu", handleContextMenu);
      el!.removeEventListener("click", handleClick);
      el!.removeEventListener("mouseover", handleLinkMouseOver);
      el!.removeEventListener("mouseout", handleLinkMouseOut);
      el!.removeEventListener("mouseup", handleMouseUpForHint);
    });
  }, [handleContextMenu, handleClick, handleLinkMouseOver, handleLinkMouseOut, handleMouseUpForHint, showSummary]);

  // Fecha a dica ao clicar em qualquer lugar fora dela (sem persistir "visto" —
  // só um dispensar temporário; reaparece na próxima seleção, até o usuário
  // efetivamente usar o menu de contexto ou ela ser fechada pelo X)
  useEffect(() => {
    if (!selectionHint) return;
    const handler = () => setSelectionHint(null);
    const id = window.setTimeout(() => document.addEventListener("mousedown", handler, { once: true }), 0);
    return () => { window.clearTimeout(id); document.removeEventListener("mousedown", handler); };
  }, [selectionHint]);

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
  // A exclusão move o artigo para a lixeira (ver articleHandlers.js/articles.ts) —
  // guardamos aqui os links removidos de outros artigos para poder reconstituir
  // tudo se o usuário clicar em "Desfazer" no toast (janela de ~5s).
  const handleDeleteArticle = useCallback(async () => {
    const ok = window.confirm(
      `Excluir "${article.title}"?\n\nOs links que apontam para ele também serão removidos.`
    );
    if (!ok) return;
    const removedLinks = articles.flatMap(a =>
      a.links
        .filter(l => l.targetId === article.id)
        .map(l => ({ parentId: a.id, anchorText: l.anchorText, targetId: l.targetId, targetTitle: l.targetTitle }))
    );
    const title = article.title;
    const id = article.id;
    await deleteArticle(id);
    showToast(`Artigo "${title}" excluído.`, "info", {
      durationMs: 5000,
      action: {
        label: "Desfazer",
        onClick: async () => {
          await restoreArticle(id);
          for (const link of removedLinks) {
            await addLink(link.parentId, link.anchorText, link.targetId, link.targetTitle);
          }
          showToast(`Artigo "${title}" restaurado.`);
        },
      },
    });
  }, [article.id, article.title, articles, deleteArticle, restoreArticle, addLink, showToast]);

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
      const baseline = stripTrackedMarkup(ex.editedMarkdown ?? excerptHtmlToMarkdown(ex.html));
      setExcerptEditDraft(baseline);
      setExcerptEditBaseline(baseline);
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
        bypassCache: true,
      });
      if (res.ok && res.data) setSummaryPreview((res.data as any).summary);
      else showToast(res.error ?? "Falha ao gerar resumo.", "error");
    } finally { setIsLoadingSummary(false); }
  }, [article, showToast]);

  const handleApplySummaryPreview = useCallback(async () => {
    if (summaryPreview === null) return;
    await saveArticle({ ...article, summary: summaryPreview });
    setSummaryPreview(null);
    showToast("Resumo atualizado.");
  }, [article, summaryPreview, saveArticle, showToast]);

  const handleDiscardSummaryPreview = useCallback(() => setSummaryPreview(null), []);

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

  // Persiste uma resposta do chat como trecho do próprio artigo (mesmo
  // mecanismo de excerto já existente) — decisão explícita do usuário, já
  // que por design o chat em si não guarda histórico entre sessões.
  const handleSaveChatAnswer = useCallback(async (index: number, text: string) => {
    const res = await window.lexicon.invoke("article:appendExcerpt", {
      targetId: article.id, targetTitle: article.title,
      html: `<p>${escapeHtml(text)}</p>`, kind: "text", category: "default",
      sourceArticleId: article.id, sourceArticleTitle: article.title,
    });
    if (res.ok) {
      setSavedChatIndices(s => new Set(s).add(index));
      await loadArticles();
      showToast("Resposta salva como trecho do artigo.");
    } else {
      showToast(res.error ?? "Falha ao salvar resposta.", "error");
    }
  }, [article.id, article.title, loadArticles, showToast]);

  // Manual: content é Markdown → HTML + links por texto puro.
  // Wikipedia: content é HTML com spans .wiki-term para ancorar os links —
  // e, só para essa fonte, os títulos viram accordions/toggles recolhíveis
  // (ver lib/wikiAccordions.ts).
  const processedHtml = article.source === "manual"
    ? sanitize(linkifyPlainText(markdownToHtml(article.content), article.links))
    : buildWikiAccordions(sanitize(injectInternalLinks(article.content, article.links)));
  const excerpts: ArticleExcerpt[] = article.excerpts ?? [];

  // Backlinks: artigos cujos links apontam para este
  const backlinks: Backlink[] = articles.flatMap(a =>
    a.links
      .filter(l => l.targetId === article.id)
      .map(l => ({ sourceId: a.id, sourceTitle: a.title, anchorText: l.anchorText }))
  );

  // Sugestão automática de links: os termos que eram <a> no HTML original da
  // Wikipedia viram <span class="wiki-term"> na importação (ver wikipedia.ts)
  // — a marcação de "isso era um conceito linkável" não se perde, só o href.
  // Cruza esses termos com títulos já existentes na base e sugere o link, em
  // vez de exigir que o usuário selecione o trecho manualmente toda vez.
  const linkSuggestions = useMemo(
    () => findLinkSuggestions(article, articles),
    [article, articles]
  );

  const visibleSuggestions = linkSuggestions.filter(s => !dismissedTerms.has(s.term));
  const shownSuggestions = visibleSuggestions.slice(0, suggestionLimit);

  const handleAcceptSuggestion = useCallback(async (term: string, target: Article) => {
    await addLink(article.id, term, target.id, target.title);
    showToast(`Link criado: "${term}" → ${target.title}`);
  }, [article.id, addLink, showToast]);

  // "Vincular todos": cria um link por sugestão visível, em sequência (a
  // mesma chamada addLink recarrega o artigo a cada vez — em paralelo,
  // escritas concorrentes no mesmo JSON poderiam se sobrescrever).
  const handleAcceptAllSuggestions = useCallback(async (suggestions: Array<{ term: string; target: Article }>) => {
    for (const { term, target } of suggestions) {
      await addLink(article.id, term, target.id, target.title);
    }
    showToast(`${suggestions.length} link${suggestions.length > 1 ? "s" : ""} criado${suggestions.length > 1 ? "s" : ""}.`);
  }, [article.id, addLink, showToast]);

  const summaryHtml = summaryToHtml(article.summary);

  // Os 4 ícones "primários" do cabeçalho — no mobile, vão via portal para a
  // barra de navegação do shell (ver prop headerActionsSlot); no desktop
  // (sem slot) renderizam aqui mesmo, ao lado do <h1>.
  const primaryHeaderActions = (
    <>
      <span className="header-popover-anchor">
        <button className={`icon-btn ${findOpen ? "icon-btn-active" : ""}`} title="Buscar na página" aria-label="Buscar na página"
                onClick={() => setFindOpen(o => !o)}><Icon name="search" /></button>
        {findOpen && (
          <FindInPageBar
            query={findQuery} count={findCount} index={findIndex}
            onQueryChange={setFindQuery}
            onNext={handleFindNext} onPrev={handleFindPrev} onClose={handleFindClose}
          />
        )}
      </span>
      {tocItems.length > 0 && (
        <button className="icon-btn" title="Conteúdo" aria-label="Conteúdo" onClick={() => setTocOpen(true)}><Icon name="densityCompact" /></button>
      )}
      <span className="header-popover-anchor">
        <button className={`icon-btn ${chatOpen ? "icon-btn-active" : ""}`} title="Perguntar ao Claude" aria-label="Perguntar ao Claude"
                onClick={() => setChatOpen(o => !o)}><Icon name="chat" /></button>
        {chatOpen && (
          <div className="ask-claude-panel ask-claude-popover">
            {chatMessages.length > 0 && (
              <button
                type="button"
                className="icon-btn ask-claude-clear-btn"
                title="Limpar conversa"
                aria-label="Limpar conversa"
                onClick={() => { setChatMessages([]); setSavedChatIndices(new Set()); }}
              >
                <Icon name="clear" />
              </button>
            )}
            <div className="ask-claude-messages">
              {chatMessages.length === 0 && (
                <p className="ask-claude-hint">
                  Pergunte algo sobre este artigo — o Claude responde usando o conteúdo
                  e os artigos vinculados como contexto.
                </p>
              )}
              {chatMessages.map((m, i) => (
                <div key={i} className={`ask-claude-msg ask-claude-${m.role}`}>
                  {m.text}
                  {m.role === "assistant" && (
                    <button
                      type="button"
                      className="ask-claude-save-btn"
                      disabled={savedChatIndices.has(i)}
                      onClick={() => handleSaveChatAnswer(i, m.text)}
                      title="Salvar esta resposta como trecho do artigo"
                    >
                      {savedChatIndices.has(i)
                        ? <><Icon name="check" /><span>Salvo</span></>
                        : <><Icon name="save" /><span>Salvar no artigo</span></>}
                    </button>
                  )}
                </div>
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
      </span>
      <button className="icon-btn" title="Revisar flashcards deste artigo" aria-label="Revisar flashcards deste artigo"
              onClick={() => setReviewOpen(true)}
              disabled={flashcards.filter(c => c.due <= new Date().toISOString()).length === 0}><Icon name="flashcards" /></button>
    </>
  );

  return (
    <div className="article-view">

      {/* ── Cabeçalho estilo Wikipedia ──────────────────────────────────── */}
      <div className="article-header">
        <div className="article-title-row">
          <h1 className="article-title">{article.title}</h1>
          <div className="article-header-actions">
            {!headerActionsSlot && primaryHeaderActions}
            <button className="icon-btn" title="Histórico de versões" aria-label="Histórico de versões"
                    onClick={() => setHistoryOpen(true)}><Icon name="history" /></button>
            {article.source === "manual" && !isEditing && (
              <button className="icon-btn" title="Editar artigo" aria-label="Editar artigo" onClick={handleStartEdit}><Icon name="edit" /></button>
            )}
            <button className="icon-btn article-delete-btn" title="Excluir artigo" aria-label="Excluir artigo"
                    onClick={handleDeleteArticle}><Icon name="trash" /></button>
          </div>
        </div>
        {headerActionsSlot && createPortal(primaryHeaderActions, headerActionsSlot)}

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
          existingTags={allTags}
          onChange={tags => updateTags(article.id, tags)}
        />

        <AttachmentsSection
          article={article}
          onChanged={() => openArticle(article.id)}
          showToast={showToast}
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
                  <button className="toc-remove-btn" title="Remover link" aria-label="Remover link"
                          onClick={() => handleRemoveLink(link.id)}><Icon name="close" /></button>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Sugestões de link automáticas — termos marcados como conceito na
            Wikipedia original, ou o título de outro artigo já existente
            encontrado no texto de qualquer fonte (Claude/manual incluídos) */}
        {visibleSuggestions.length > 0 && !showSummary && (
          <div className="wiki-toc link-suggestions">
            <div className="wiki-toc-title link-suggestions-title-row">
              <span>
                Links sugeridos
                {visibleSuggestions.length > shownSuggestions.length && (
                  <span className="link-suggestions-count">
                    {" "}— mostrando {shownSuggestions.length} de {visibleSuggestions.length}
                  </span>
                )}
              </span>
              <button type="button" className="link-suggestions-accept-all-btn"
                      onClick={() => handleAcceptAllSuggestions(shownSuggestions)}>
                Vincular todos
              </button>
            </div>
            <ol className="wiki-toc-list">
              {shownSuggestions.map(({ term, target }) => (
                <li key={term}>
                  <span className="suggestion-term">{term}</span>
                  <span className="toc-target"> → {target.title}</span>
                  <button className="suggestion-accept-btn" title="Criar link" aria-label="Criar link"
                          onClick={() => handleAcceptSuggestion(term, target)}><Icon name="check" /></button>
                  <button className="toc-remove-btn" title="Descartar sugestão" aria-label="Descartar sugestão"
                          onClick={() => setDismissedTerms(s => new Set(s).add(term))}><Icon name="close" /></button>
                </li>
              ))}
            </ol>
            {visibleSuggestions.length > shownSuggestions.length && (
              <button
                type="button"
                className="link-suggestions-more-btn"
                onClick={() => setSuggestionLimit(n => n + 20)}
              >
                Carregar mais ({visibleSuggestions.length - shownSuggestions.length} restantes)
              </button>
            )}
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
              {editDraft !== article.content && (
                <span className="unsaved-indicator" title="Alterações ainda não salvas">
                  ● Não salvo
                </span>
              )}
              <button onClick={() => setIsEditing(false)}>Cancelar</button>
              <button className="primary" onClick={handleSaveEdit}>Salvar</button>
            </div>
          </div>
        ) : showSummary ? (
          <div ref={summaryRef} className="wiki-content summary-content">
            {summaryFailed && (
              <p className="summary-failed-notice">
                O resumo automático falhou ao criar este artigo. Tente gerar novamente.
              </p>
            )}
            <div dangerouslySetInnerHTML={{ __html: summaryHtml }} />
            <div className="summary-actions">
              <button className="wiki-btn" onClick={handleRegenerateSummary} disabled={isLoadingSummary}>
                {isLoadingSummary ? "Gerando…" : <><Icon name="refresh" /><span>Regenerar resumo</span></>}
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
          editBaseline={excerptEditBaseline}
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
          onStartReview={() => setReviewOpen(true)}
        />

        {/* Backlinks */}
        <BacklinksPanel backlinks={backlinks} onOpen={id => openArticle(id)} />

      </div>

      {/* ── Sumário (Conteúdo) ──────────────────────────────────────────────── */}
      {tocOpen && (
        <SectionsTocPanel items={tocItems} onJump={handleJumpToHeading} onClose={() => setTocOpen(false)} />
      )}

      {/* ── Prévia do resumo regenerado — nunca sobrescreve sem confirmação ─── */}
      {summaryPreview !== null && (
        <div className="modal-overlay" onClick={handleDiscardSummaryPreview}>
          <div className="modal summary-preview-modal" onClick={e => e.stopPropagation()}>
            <h2>Novo resumo gerado</h2>
            <p className="excerpt-new-hint">
              Compare com o resumo atual antes de substituir — a versão antiga se perde ao aplicar.
            </p>
            <div className="summary-preview-columns">
              <div className="summary-preview-col">
                <span className="summary-preview-label">Atual</span>
                <div className="summary-preview-html wiki-content"
                     dangerouslySetInnerHTML={{ __html: summaryToHtml(article.summary) }} />
              </div>
              <div className="summary-preview-col summary-preview-col-new">
                <span className="summary-preview-label">Novo</span>
                <div className="summary-preview-html wiki-content"
                     dangerouslySetInnerHTML={{ __html: summaryToHtml(summaryPreview) }} />
              </div>
            </div>
            <div className="modal-actions">
              <button onClick={handleDiscardSummaryPreview}>Descartar</button>
              <button className="primary" onClick={handleApplySummaryPreview}>Aplicar novo resumo</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Dica: primeira seleção de texto ensina o menu de contexto ──────── */}
      {selectionHint && (
        <SelectionHintBubble
          x={selectionHint.x} y={selectionHint.y}
          onDismiss={() => { dismissSelectionHint(); setSelectionHint(null); }}
        />
      )}

      {/* ── Preview do artigo-alvo ao passar o mouse sobre um link interno ─── */}
      {linkPreview && (() => {
        const target = articles.find(a => a.id === linkPreview.articleId);
        if (!target) return null;
        return (
          <LinkHoverPreview
            x={linkPreview.x} y={linkPreview.y}
            title={target.title}
            snippet={(target.summary || "").replace(/^•\s*/, "").slice(0, 140) || "Sem resumo disponível."}
          />
        );
      })()}

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

      {/* ── Histórico de versões ────────────────────────────────────────────── */}
      {historyOpen && (
        <HistoryModal
          article={article}
          onClose={() => setHistoryOpen(false)}
          onReverted={() => openArticle(article.id)}
          showToast={showToast}
        />
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SelectionHintBubble — dica de descoberta mostrada na primeira seleção de
// texto de um artigo, ensinando o fluxo central do produto (menu de contexto
// para criar link / salvar trecho) sem exigir um wizard de onboarding.
// ─────────────────────────────────────────────────────────────────────────────

// Toque longo dispara o mesmo "contextmenu" no mobile (ver ArticleScreen.tsx
// no shell mobile) — sem instrução própria, a dica herdava texto de mouse
// ("clique com o botão direito"), que não existe em iOS/Android.
const isTouchPlatform =
  typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0);

const SelectionHintBubble: React.FC<{ x: number; y: number; onDismiss: () => void }> = ({
  x, y, onDismiss,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: y, left: x });

  useLayoutEffect(() => {
    const el = ref.current;
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
    <div ref={ref} className="selection-hint-bubble"
         style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 998 }}
         onClick={e => e.stopPropagation()}>
      <Icon name="hint" /> {isTouchPlatform
        ? "Toque e segure para criar um link ou salvar este trecho."
        : "Clique com o botão direito para criar um link ou salvar este trecho."}
      <button type="button" className="selection-hint-dismiss" title="Entendi" aria-label="Fechar dica" onClick={onDismiss}><Icon name="close" /></button>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// LinkHoverPreview — prévia (título + início do resumo) ao passar o mouse
// sobre um link interno, sem precisar navegar até o artigo-alvo.
// ─────────────────────────────────────────────────────────────────────────────

const LinkHoverPreview: React.FC<{ x: number; y: number; title: string; snippet: string }> = ({
  x, y, title, snippet,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: y, left: x });

  useLayoutEffect(() => {
    const el = ref.current;
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
    <div ref={ref} className="link-hover-preview"
         style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 999 }}>
      <strong className="link-hover-preview-title">{title}</strong>
      <p className="link-hover-preview-snippet">{snippet}</p>
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
      {hasText && (
        <>
          <button className="context-menu-item" title="Pesquisar na Wikipédia" aria-label="Pesquisar na Wikipédia" onClick={onSearchWiki}><Icon name="search" /></button>
          <button className="context-menu-item" title="Gerar artigo com Claude" aria-label="Gerar artigo com Claude" onClick={onSearchClaude}><Icon name="semantic" /></button>
          <span className="context-menu-divider" />
          <button className="context-menu-item context-menu-save" title="Salvar trecho" aria-label="Salvar trecho"
                  onClick={() => onSaveExcerpt("default")}><Icon name="pin" /></button>
          <button className="context-menu-item context-menu-save" title="Salvar como conceito" aria-label="Salvar como conceito"
                  onClick={() => onSaveExcerpt("concept")}>
            <span className="ctx-cat-swatch ctx-cat-concept" />
          </button>
          <button className="context-menu-item context-menu-save" title="Salvar como lista" aria-label="Salvar como lista"
                  onClick={() => onSaveExcerpt("list")}>
            <span className="ctx-cat-swatch ctx-cat-list" />
          </button>
          <button className="context-menu-item context-menu-save" title="Salvar como dados numéricos" aria-label="Salvar como dados numéricos"
                  onClick={() => onSaveExcerpt("numeric")}>
            <span className="ctx-cat-swatch ctx-cat-numeric" />
          </button>
        </>
      )}
      {hasTable && (
        <button className="context-menu-item context-menu-save" title="Salvar tabela em…" aria-label="Salvar tabela em…" onClick={onSaveTable}><Icon name="table" /></button>
      )}
      {hasImage && (
        <button className="context-menu-item context-menu-save" title="Salvar imagem em…" aria-label="Salvar imagem em…" onClick={onSaveImage}><Icon name="image" /></button>
      )}
      <span className="context-menu-divider" />
      <button className="context-menu-item context-menu-cancel" title="Cancelar" aria-label="Cancelar" onClick={onClose}><Icon name="close" /></button>
    </div>
  );
};
