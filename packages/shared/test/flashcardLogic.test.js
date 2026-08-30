// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/test/flashcardLogic.test.js
// Testes do parser de flashcards e do agendamento SM-2 em
// packages/shared/lib/flashcardLogic.js — funções puras (sem fs/Electron),
// por isso rodáveis com node --test nativo, sem framework nenhum:
//   node --test packages/shared/test/
// ─────────────────────────────────────────────────────────────────────────────

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseFlashcardsFromText, flattenDraftsForExport, gradeCard } = require("../lib/flashcardLogic");

test("card básico: 'frente = verso'", () => {
  const [draft] = parseFlashcardsFromText("Capital da França = Paris");
  assert.equal(draft.kind, "basic");
  assert.equal(draft.front, "Capital da França");
  assert.equal(draft.back, "Paris");
});

test("card invertido: 'frente == verso' gera as duas direções na exportação", () => {
  const [draft] = parseFlashcardsFromText("Água == H2O");
  assert.equal(draft.kind, "reversed");
  const cards = flattenDraftsForExport([draft]);
  assert.deepEqual(cards, [
    { front: "Água", back: "H2O" },
    { front: "H2O", back: "Água" },
  ]);
});

test("cloze c1/c2 na mesma linha, cores independentes", () => {
  const [draft] = parseFlashcardsFromText("A ==mitocôndria== é a ++usina de energia++ da célula.");
  assert.equal(draft.kind, "cloze");
  assert.match(draft.clozeText, /\{\{c1::mitocôndria\}\}/);
  assert.match(draft.clozeText, /\{\{c2::usina de energia\}\}/);
});

test("pergunta/resposta inline com '?'", () => {
  const [draft] = parseFlashcardsFromText("Qual a capital da França? Paris");
  assert.equal(draft.kind, "qa");
  assert.equal(draft.front, "Qual a capital da França?");
  assert.equal(draft.back, "Paris");
});

test("termo/definição inline com ':'", () => {
  const [draft] = parseFlashcardsFromText("Osmose: passagem de água por membrana semipermeável");
  assert.equal(draft.kind, "qa");
  assert.equal(draft.front, "Osmose");
  assert.equal(draft.back, "passagem de água por membrana semipermeável");
});

test("pergunta/resposta multilinha (delimitador no fim da linha)", () => {
  const [draft] = parseFlashcardsFromText("Qual a capital da França?\nParis\n");
  assert.equal(draft.kind, "qa");
  assert.equal(draft.back, "Paris");
});

test("lista de 2+ itens vira um único card cloze com todos os marcadores visíveis", () => {
  const drafts = parseFlashcardsFromText("- Hidrogênio\n- Oxigênio\n- Carbono");
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].kind, "enum-cloze");
  assert.match(drafts[0].clozeText, /- \{\{c1::Hidrogênio\}\}/);
  assert.match(drafts[0].clozeText, /- \{\{c1::Oxigênio\}\}/);
  assert.match(drafts[0].clozeText, /- \{\{c1::Carbono\}\}/);
});

test("parágrafo-guia seguido de lista mantém o parágrafo visível na frente", () => {
  const drafts = parseFlashcardsFromText("Elementos leves:\n- Hidrogênio\n- Hélio");
  assert.equal(drafts.length, 1);
  assert.match(drafts[0].clozeText, /^Elementos leves:\n/);
});

test("enumeração inline com 2+ marcadores na mesma linha", () => {
  const [draft] = parseFlashcardsFromText("a) primeiro item b) segundo item");
  assert.equal(draft.kind, "enum-cloze");
  assert.match(draft.clozeText, /\{\{c1::primeiro item\}\}/);
  assert.match(draft.clozeText, /\{\{c1::segundo item\}\}/);
});

test("atributo de span ({bg=...}) não é confundido com separador básico '='", () => {
  const drafts = parseFlashcardsFromText("Texto {bg=amarelo}destacado{/bg} sem separador aqui");
  assert.equal(drafts.length, 0);
});

test("linha sem nenhum padrão não gera card", () => {
  const drafts = parseFlashcardsFromText("Só uma frase qualquer, sem marcação nenhuma.");
  assert.equal(drafts.length, 0);
});

test("SM-2: 'again' zera reps, incrementa lapses e volta pro intervalo mínimo", () => {
  const card = { interval: 10, ease: 2.5, reps: 3, lapses: 0 };
  const graded = gradeCard(card, "again");
  assert.equal(graded.reps, 0);
  assert.equal(graded.lapses, 1);
  assert.equal(graded.interval, 1);
  assert.ok(graded.ease < card.ease);
});

test("SM-2: 'good' progride 0 → 1 → 6 dias antes de multiplicar pela facilidade", () => {
  let card = { interval: 0, ease: 2.5, reps: 0, lapses: 0 };
  card = gradeCard(card, "good");
  assert.equal(card.interval, 1);
  assert.equal(card.reps, 1);
  card = gradeCard(card, "good");
  assert.equal(card.interval, 6);
  assert.equal(card.reps, 2);
  card = gradeCard(card, "good");
  assert.equal(card.interval, Math.round(6 * 2.5)); // reps >= 2: interval anterior × ease
  assert.equal(card.reps, 3);
});

test("SM-2: ease nunca cai abaixo do piso de 1.3", () => {
  let card = { interval: 5, ease: 1.35, reps: 2, lapses: 0 };
  card = gradeCard(card, "again");
  assert.ok(card.ease >= 1.3);
  card = gradeCard(card, "again");
  assert.equal(card.ease, 1.3);
});

test("SM-2: 'due' é uma data ISO no futuro proporcional ao intervalo", () => {
  const before = Date.now();
  const graded = gradeCard({ interval: 0, ease: 2.5, reps: 0, lapses: 0 }, "easy");
  const due = new Date(graded.due).getTime();
  assert.ok(due > before);
});
