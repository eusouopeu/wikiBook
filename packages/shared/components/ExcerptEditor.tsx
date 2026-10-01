// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/ExcerptEditor.tsx
// Editores de trecho salvo (texto e tabela) + barra/atalhos de formatação
// Markdown — extraído de ArticleView.tsx. handleFormatShortcut também é usado
// pelo editor de artigo manual do próprio ArticleView.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useRef, useState } from "react";
import { confirmDialog } from "../lib/confirmDialog";
import { parseMarkdownTable, serializeMarkdownTable } from "../lib/markdown";
import { Icon } from "./Icon";

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
export function handleFormatShortcut(
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
export const ExcerptEditToolbar: React.FC<{
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
export const TableExcerptEditor: React.FC<{
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

// ── Editor de trecho de texto (Markdown com marcação de edição) ──────────────
// O rascunho/baseline ficam no ArticleView (o diff rastreado é calculado lá ao
// salvar); aqui só a textarea, a barra de formatação e as ações.
export const TextExcerptEditor: React.FC<{
  draft: string;
  baseline: string;
  onDraftChange: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
}> = ({ draft, baseline, onDraftChange, onSave, onCancel }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="excerpt-editor">
      <ExcerptEditToolbar textareaRef={textareaRef} onChange={onDraftChange} />
      <textarea ref={textareaRef} className="excerpt-editor-textarea"
                value={draft} onChange={e => onDraftChange(e.target.value)}
                onKeyDown={e => handleFormatShortcut(e, onDraftChange)} autoFocus />
      <p className="excerpt-editor-hint">
        O que você escrever a mais fica em itálico; o que apagar vira "(...)".
        Formatação (negrito, marca-textos) não conta como edição.
      </p>
      <div className="excerpt-editor-actions">
        {draft !== baseline && (
          <span className="unsaved-indicator" title="Alterações ainda não salvas">
            ● Não salvo
          </span>
        )}
        <button onClick={onCancel}>Cancelar</button>
        <button className="primary" onClick={onSave}>Salvar</button>
      </div>
    </div>
  );
};
