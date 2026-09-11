// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/test/tableSelection.test.js
// Testes do construtor de tabela a partir de uma seleção que cruza mais de uma
// célula (packages/shared/lib/tableSelection.js). A parte de DOM (descobrir
// quais células o Range toca) fica em ArticleView.tsx; aqui só a função pura
// que remonta o HTML da sub-tabela — rodável com `npm test`.
// ─────────────────────────────────────────────────────────────────────────────

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSelectionTableHtml } = require("../lib/tableSelection.js");

test("duas células da mesma linha viram uma tabela bem formada", () => {
  const html = buildSelectionTableHtml([
    [{ tag: "td", html: "A" }, { tag: "td", html: "<b>B</b>" }],
  ]);
  assert.equal(html, "<table><tbody><tr><td>A</td><td><b>B</b></td></tr></tbody></table>");
});

test("linha de cabeçalho vira thead e colspan/rowspan são preservados", () => {
  const html = buildSelectionTableHtml([
    [{ tag: "th", html: "Ano", colSpan: 2 }, { tag: "th", html: "Total" }],
    [{ tag: "td", html: "1990", rowSpan: 2 }, { tag: "td", html: "10" }],
  ]);
  assert.equal(
    html,
    "<table><thead><tr><th colspan=\"2\">Ano</th><th>Total</th></tr></thead>" +
    "<tbody><tr><td rowspan=\"2\">1990</td><td>10</td></tr></tbody></table>"
  );
});

test("uma célula só (ou nenhuma) não vira tabela — segue como trecho de texto", () => {
  assert.equal(buildSelectionTableHtml([[{ tag: "td", html: "A" }]]), null);
  assert.equal(buildSelectionTableHtml([[], []]), null);
  assert.equal(buildSelectionTableHtml([]), null);
});
