// @ts-check
// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/lib/tableSelection.js
// Seleção de texto que cruza mais de uma célula de tabela.
//
// Problema: `range.cloneContents()` de uma seleção que começa numa célula e
// termina em outra devolve um fragmento com pedaços soltos de <td>/<tr> — ao
// salvar como trecho de texto, o resultado saía embaralhado (células coladas
// numa linha só, sem borda de tabela). Aqui a seleção é remontada como uma
// sub-tabela bem formada, com só as células tocadas pelo Range.
//
// Função pura (sem DOM) para ser testável com `node --test`; quem varre o DOM
// e descobre as células selecionadas é ArticleView.tsx.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SelectedCell
 * @property {"td"|"th"} tag
 * @property {string} html       HTML interno da célula (já serializado)
 * @property {number} [colSpan]
 * @property {number} [rowSpan]
 */

/**
 * Remonta as células selecionadas como uma tabela HTML autocontida.
 * Linhas vazias são descartadas. Devolve null quando sobra menos de duas
 * células — nesse caso a seleção é apenas texto dentro de uma célula e deve
 * seguir o fluxo normal de "salvar trecho".
 *
 * @param {SelectedCell[][]} rows
 * @returns {string|null}
 */
function buildSelectionTableHtml(rows) {
  const kept = (rows || []).filter(r => Array.isArray(r) && r.length > 0);
  const total = kept.reduce((n, r) => n + r.length, 0);
  if (total < 2) return null;

  const renderRow = (/** @type {SelectedCell[]} */ row) =>
    "<tr>" + row.map(cell => {
      const tag = cell.tag === "th" ? "th" : "td";
      const attrs =
        (cell.colSpan && cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : "") +
        (cell.rowSpan && cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : "");
      return `<${tag}${attrs}>${cell.html}</${tag}>`;
    }).join("") + "</tr>";

  const headerIsFirstRow = kept[0].every(c => c.tag === "th");
  const head = headerIsFirstRow ? `<thead>${renderRow(kept[0])}</thead>` : "";
  const bodyRows = kept.slice(headerIsFirstRow ? 1 : 0);
  const body = bodyRows.length > 0 ? `<tbody>${bodyRows.map(renderRow).join("")}</tbody>` : "";

  return `<table>${head}${body}</table>`;
}

module.exports = { buildSelectionTableHtml };
