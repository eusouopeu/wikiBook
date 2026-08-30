// ─────────────────────────────────────────────────────────────────────────────
// src/main/handlers/flashcardHandlers.js
// Flashcards de repetição espaçada (estilo Obsidian Spaced Repetition), gerados
// a partir de padrões Markdown no conteúdo de artigos manuais e em trechos
// editados:
//   ==destaque==  → cloze c1 (amarelo; uma linha = um card, todos os destaques
//                   da linha revelados juntos)
//   ++destaque++  → cloze c2 (laranja; combina com os c1 amarelos na mesma linha)
//   listas (ordenadas ou não — "1." "a." "a)" "i." "-" "*" …) na mesma linha ou
//                   em linhas seguidas → um único card cloze c1 que esconde todos
//                   os itens simultaneamente, mantendo os marcadores visíveis
//   "Pergunta? resposta"  /  "Termo: definição"  (delimitador "?"/":" seguido de
//                   conteúdo na mesma linha ou na linha seguinte) → card cuja
//                   frente é a parte anterior ao delimitador (renderizada em
//                   negrito automaticamente) e o verso é o restante, até a
//                   primeira linha vazia
//   texto = texto → card básico (frente = antes do "=", verso = depois)
//   texto == texto (sem par de "==") → card invertido (gera as duas direções)
//
// Agendamento: SM-2 simplificado (mesma família de algoritmo usada pelo plugin
// Spaced Repetition do Obsidian e pelo Anki).
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require("electron");
const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const { readArticle, htmlToMarkdown } = require("./articleHandlers");

// Calculado sob demanda (não numa constante de topo de módulo) só para que
// este arquivo possa ser require()ado fora do Electron sem crashar em
// app.getPath — necessário porque este módulo é require()ado (indiretamente,
// via articleHandlers.js) por outros arquivos que o teste unitário de
// flashcardLogic.js não toca, mas que ainda assim precisam carregar sem erro.
function flashcardsDir() { return path.join(app.getPath("userData"), "flashcards"); }

function ensureFlashcardsDir() {
  const dir = flashcardsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
function flashcardsPath(articleId) { return path.join(flashcardsDir(), `${articleId}.json`); }

// Cache em memória por articleId — evita reler e reparsear os JSONs de todos
// os artigos a cada flashcards:listDue (mesmo padrão de articleHandlers.js/
// articlesCache). Invalidado (atualizado, não apenas limpo) em toda escrita.
const flashcardsCache = new Map();

function readFlashcards(articleId) {
  if (flashcardsCache.has(articleId)) return flashcardsCache.get(articleId);
  ensureFlashcardsDir();
  const p = flashcardsPath(articleId);
  let cards = [];
  if (fs.existsSync(p)) {
    try { cards = JSON.parse(fs.readFileSync(p, "utf8")); } catch { cards = []; }
  }
  flashcardsCache.set(articleId, cards);
  return cards;
}
function writeFlashcards(articleId, cards) {
  ensureFlashcardsDir();
  fs.writeFileSync(flashcardsPath(articleId), JSON.stringify(cards, null, 2), "utf8");
  flashcardsCache.set(articleId, cards);
}

// article:delete/restore movem o arquivo de flashcards direto (rename, sem
// passar por writeFlashcards) — chamado por articleHandlers.js para manter
// o cache coerente nesses casos.
function invalidateFlashcardsCache(articleId) {
  flashcardsCache.delete(articleId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser de flashcards e agendamento SM-2: extraídos para
// packages/shared/lib/flashcardLogic.js — funções puras, sem fs/Electron,
// testadas em packages/desktop/test/flashcards.test.js com node --test.
// ─────────────────────────────────────────────────────────────────────────────

const { parseFlashcardsFromText, flattenDraftsForExport, makeDefaultSchedule, gradeCard } =
  require("../../../../shared/lib/flashcardLogic");

// ─────────────────────────────────────────────────────────────────────────────
// Mescla rascunhos recém-parseados com os flashcards já armazenados,
// preservando o agendamento de cards cuja linha de origem não mudou.
// Cards cuja origem desapareceu do texto são descartados.
// ─────────────────────────────────────────────────────────────────────────────

function mergeFlashcards(existingCards, drafts, articleId, articleTitle) {
  const now = new Date().toISOString();
  const existingByKey = new Map();
  for (const c of existingCards) {
    existingByKey.set(`${c.kind}::${c.sourceLine}::${c.frontBackIndex ?? 0}`, c);
  }

  const result = [];

  const carryOverOrNew = (key, base) => {
    const existing = existingByKey.get(key);
    return {
      id: existing?.id ?? crypto.randomUUID(),
      createdAt: existing?.createdAt ?? now,
      ...(existing
        ? { due: existing.due, interval: existing.interval, ease: existing.ease, reps: existing.reps, lapses: existing.lapses }
        : makeDefaultSchedule(now)),
      ...base,
    };
  };

  for (const draft of drafts) {
    if (draft.kind === "reversed") {
      const pairs = [
        { front: draft.front, back: draft.back, idx: 0 },
        { front: draft.back, back: draft.front, idx: 1 },
      ];
      for (const p of pairs) {
        result.push(carryOverOrNew(`reversed::${draft.sourceLine}::${p.idx}`, {
          articleId, articleTitle, kind: "reversed",
          front: p.front, back: p.back,
          sourceLine: draft.sourceLine, sourceExcerptId: draft.sourceExcerptId,
          frontBackIndex: p.idx,
        }));
      }
    } else if (draft.kind === "cloze" || draft.kind === "enum-cloze") {
      // Um card por grupo de cloze presente (c1 amarelo, c2 laranja, …). Cada
      // card esconde só o seu grupo; os demais grupos ficam visíveis como texto.
      const groups = [...new Set(
        [...(draft.clozeText ?? "").matchAll(/\{\{c(\d+)::/g)].map(m => Number(m[1]))
      )].sort((a, b) => a - b);
      for (const g of (groups.length ? groups : [1])) {
        result.push(carryOverOrNew(`${draft.kind}::${draft.sourceLine}::c${g}`, {
          articleId, articleTitle, kind: draft.kind,
          clozeText: draft.clozeText, clozeGroup: g, frontBackIndex: g,
          sourceLine: draft.sourceLine, sourceExcerptId: draft.sourceExcerptId,
        }));
      }
    } else {
      result.push(carryOverOrNew(`${draft.kind}::${draft.sourceLine}::0`, {
        articleId, articleTitle, kind: draft.kind,
        front: draft.front, back: draft.back, clozeText: draft.clozeText,
        sourceLine: draft.sourceLine, sourceExcerptId: draft.sourceExcerptId,
      }));
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────

function createFlashcardHandlers(ipcMain) {

  // ── flashcards:regenerate { articleId } ─────────────────────────────────────
  // Reprocessa o conteúdo manual + trechos "text" editados do artigo, mescla
  // com os cards existentes (preservando agendamento) e persiste.
  ipcMain.handle("flashcards:regenerate", (_evt, { articleId }) => {
    try {
      const article = readArticle(articleId);
      if (!article) return { ok: false, error: "Artigo não encontrado." };

      const drafts = [];
      if (article.source === "manual" && article.content) {
        drafts.push(...parseFlashcardsFromText(article.content));
      }
      for (const ex of article.excerpts ?? []) {
        if ((ex.kind ?? "text") !== "text") continue;
        // Todo trecho de texto salvo gera flashcards. Usa a versão editada se
        // houver; senão, converte o HTML salvo em Markdown (preserva listas e
        // quebras de linha, ao contrário do plainText achatado).
        const md = ex.editedMarkdown ?? htmlToMarkdown(ex.html ?? "") ?? ex.plainText;
        if (!md) continue;
        const exDrafts = parseFlashcardsFromText(md);
        for (const d of exDrafts) d.sourceExcerptId = ex.id;
        drafts.push(...exDrafts);
      }

      const existing = readFlashcards(articleId);
      const merged = mergeFlashcards(existing, drafts, articleId, article.title);
      writeFlashcards(articleId, merged);
      return { ok: true, data: merged };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle("flashcards:list", (_evt, { articleId }) => {
    try { return { ok: true, data: readFlashcards(articleId) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  // ── flashcards:listDue ───────────────────────────────────────────────────────
  // Agrega cards vencidos (due <= agora) de todos os artigos, ordenados por
  // vencimento — usado pela revisão global.
  ipcMain.handle("flashcards:listDue", () => {
    try {
      ensureFlashcardsDir();
      const now = new Date().toISOString();
      const due = [];
      for (const f of fs.readdirSync(flashcardsDir()).filter(f => f.endsWith(".json"))) {
        const cards = readFlashcards(f.replace(".json", ""));
        for (const c of cards) if (c.due <= now) due.push(c);
      }
      due.sort((a, b) => a.due.localeCompare(b.due));
      return { ok: true, data: due };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ── flashcards:grade { articleId, cardId, grade } ───────────────────────────
  ipcMain.handle("flashcards:grade", (_evt, { articleId, cardId, grade }) => {
    try {
      const cards = readFlashcards(articleId);
      const idx = cards.findIndex(c => c.id === cardId);
      if (idx === -1) return { ok: false, error: "Flashcard não encontrado." };
      cards[idx] = gradeCard(cards[idx], grade);
      writeFlashcards(articleId, cards);
      return { ok: true, data: cards[idx] };
    } catch (e) { return { ok: false, error: e.message }; }
  });
}

// parseFlashcardsFromText/flattenDraftsForExport reexportados aqui porque
// articleHandlers.js já os importa deste módulo (ver flashcards:exportCsv);
// gradeCard não é usado fora deste arquivo, mas segue exportado por
// uniformidade e para não quebrar quem já fizer require dele.
module.exports = {
  createFlashcardHandlers, parseFlashcardsFromText, flattenDraftsForExport, invalidateFlashcardsCache,
  gradeCard,
};
