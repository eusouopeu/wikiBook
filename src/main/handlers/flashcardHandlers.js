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

const FLASHCARDS_DIR = path.join(app.getPath("userData"), "flashcards");

function ensureFlashcardsDir() {
  if (!fs.existsSync(FLASHCARDS_DIR)) fs.mkdirSync(FLASHCARDS_DIR, { recursive: true });
}
function flashcardsPath(articleId) { return path.join(FLASHCARDS_DIR, `${articleId}.json`); }

function readFlashcards(articleId) {
  ensureFlashcardsDir();
  const p = flashcardsPath(articleId);
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return []; }
}
function writeFlashcards(articleId, cards) {
  ensureFlashcardsDir();
  fs.writeFileSync(flashcardsPath(articleId), JSON.stringify(cards, null, 2), "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser: texto Markdown → flashcards "rascunho" (sem estado de agendamento)
// ─────────────────────────────────────────────────────────────────────────────

// Marcadores de lista, ordenada ou não: bullets ("-" "*" "•"), números ("1."
// "2)"), romanos ("i." "iv)" — minúsculo ou maiúsculo) e letras ("a)" "b.").
const LIST_MARKER = String.raw`(?:[-*•]|\d{1,2}[.)]|[ivxlcdm]{1,4}[.)]|[IVXLCDM]{1,4}[.)]|[A-Za-zÀ-ÿ][.)])`;
const ENUM_LINE_RE = new RegExp(`^(${LIST_MARKER})\\s+(.*)$`);
// Inline: só marcadores ORDENADOS (bullets soltos gerariam falsos positivos em
// prosa com hifens/asteriscos), 2+ na mesma linha.
const ENUM_INLINE_RE = /(?:^|\s)(\d{1,2}[.)]|[ivxlcdm]{1,4}[.)]|[A-Za-zÀ-ÿ][.)])\s+/g;

// Monta um card cloze de lista: cada item vira {{c1::…}} com o marcador visível.
// `stem` (parágrafo-guia logo acima da lista, se houver) é exibido intacto na
// frente do card, acima dos itens escondidos.
function buildEnumCloze(items, sourceText, stem) {
  const body = items.map(it => `${it.marker} {{c1::${it.content}}}`).join("\n");
  const clozeText = stem ? `${stem}\n${body}` : body;
  return { kind: "enum-cloze", clozeText, sourceLine: sourceText };
}

// Coleta uma sequência de 2+ linhas de lista a partir de `start`. Retorna
// { items, runLines, end } ou null se não houver uma lista de 2+ itens ali.
function collectListRun(lines, start) {
  const first = start < lines.length ? lines[start].trim() : "";
  if (!first || !ENUM_LINE_RE.test(first)) return null;
  const runLines = [first];
  let j = start + 1;
  while (j < lines.length && lines[j].trim() && ENUM_LINE_RE.test(lines[j].trim())) {
    runLines.push(lines[j].trim());
    j++;
  }
  if (runLines.length < 2) return null;
  const items = runLines.map(l => {
    const m = l.match(ENUM_LINE_RE);
    return { marker: m[1], content: m[2].trim() };
  });
  return { items, runLines, end: j };
}

// Substitui o conteúdo de atributos de span ({bg=...}, {color=...}, {.def}…)
// por placeholders do mesmo tamanho — o "=" interno deles não pode ser
// confundido com o separador de flashcard básico/invertido
function maskSpanAttrs(text) {
  return text.replace(/\{[^}]*\}/g, m => " ".repeat(m.length));
}

// Interpreta uma única linha como card cloze, invertido ou básico.
// Retorna null se a linha não casar nenhum padrão. Detecção de separadores
// roda sobre a versão mascarada; o conteúdo dos cards vem da linha original.
function parseLineForCard(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const masked = maskSpanAttrs(trimmed);

  // Cloze: pares "==amarelo==" (→ c1) e/ou "++laranja++" (→ c2) na linha.
  // Uma linha pode misturar os dois; todos os clozes de mesma cor caem no
  // mesmo grupo (c1/c2) e são revelados juntos.
  if (/==(.+?)==/.test(masked) || /\+\+(.+?)\+\+/.test(masked)) {
    const clozeText = trimmed
      .replace(/==(.+?)==/g, (_, inner) => `{{c1::${inner}}}`)
      .replace(/\+\+(.+?)\+\+/g, (_, inner) => `{{c2::${inner}}}`);
    return { kind: "cloze", clozeText, sourceLine: trimmed };
  }

  // "==" solto (sem par) → invertido
  if (masked.includes("==")) {
    const i = masked.indexOf("==");
    const front = trimmed.slice(0, i).trim();
    const back = trimmed.slice(i + 2).trim();
    if (front && back) return { kind: "reversed", front, back, sourceLine: trimmed };
    return null;
  }

  // "=" único → básico
  if (masked.includes("=")) {
    const i = masked.indexOf("=");
    const front = trimmed.slice(0, i).trim();
    const back = trimmed.slice(i + 1).trim();
    if (front && back) return { kind: "basic", front, back, sourceLine: trimmed };
  }

  return null;
}

// Tenta interpretar um bloco Pergunta/Resposta começando na linha `i`.
// Casa dois formatos:
//   1) delimitador ("?" ou ":") seguido de conteúdo na MESMA linha
//        "Qual a capital da França? Paris"   "Osmose: passagem de água…"
//   2) linha que TERMINA com o delimitador, com o verso na(s) linha(s) seguinte(s)
//        "Qual a capital da França?"
//        "Paris"
// A frente é a parte anterior ao delimitador (o "?" é mantido por ser natural na
// pergunta; o ":" é descartado). O verso vai até a primeira linha vazia.
// O "\s+" exigido após o delimitador evita casar "http://…", "3:30", etc.
// Retorna { draft, next } (índice da próxima linha a processar) ou null.
function parseQA(lines, i) {
  const line = lines[i].trim();
  if (!line) return null;

  let front, firstBackLine = null;
  const inline = line.match(/^(.+?)([?:])\s+(\S.*)$/);
  if (inline) {
    front = inline[1].trim() + (inline[2] === "?" ? "?" : "");
    firstBackLine = inline[3].trim();
  } else {
    const trailing = line.match(/^(.+?)([?:])$/);
    if (!trailing) return null;
    // Formato 2 exige verso na linha imediatamente seguinte
    if (i + 1 >= lines.length || !lines[i + 1].trim()) return null;
    front = trailing[1].trim() + (trailing[2] === "?" ? "?" : "");
  }
  if (!front) return null;

  const backLines = firstBackLine ? [firstBackLine] : [];
  let j = i + 1;
  while (j < lines.length && lines[j].trim()) { backLines.push(lines[j].trim()); j++; }

  const back = backLines.join(" ").trim();
  if (!back) return null;

  const sourceLine = lines.slice(i, j).map(l => l.trim()).join("\n");
  return { draft: { kind: "qa", front, back, sourceLine }, next: j };
}

// Varre o texto linha a linha. Sequências de 2+ linhas consecutivas de
// enumeração viram um único card cloze simultâneo; uma linha isolada com 2+
// marcadores inline ("a) x b) y") faz o mesmo. Linhas restantes são avaliadas
// individualmente (cloze "==", invertido "==" solto, básico "=" solto).
function parseFlashcardsFromText(text) {
  const drafts = [];
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed) { i++; continue; }

    // Lista (ordenada/não ordenada) começando nesta linha, sem parágrafo-guia
    const run = collectListRun(lines, i);
    if (run) {
      drafts.push(buildEnumCloze(run.items, run.runLines.join("\n"), null));
      i = run.end;
      continue;
    }

    // Parágrafo-guia (linha comum) imediatamente seguido de uma lista → card
    // cloze com o parágrafo visível na frente e os itens escondidos.
    if (!ENUM_LINE_RE.test(trimmed) && i + 1 < lines.length && lines[i + 1].trim()) {
      const run2 = collectListRun(lines, i + 1);
      if (run2) {
        drafts.push(buildEnumCloze(run2.items, `${trimmed}\n${run2.runLines.join("\n")}`, trimmed));
        i = run2.end;
        continue;
      }
    }

    // Enumeração inline (2+ itens na mesma linha)
    const inlineMatches = [...trimmed.matchAll(ENUM_INLINE_RE)];
    if (inlineMatches.length >= 2) {
      const items = [];
      for (let k = 0; k < inlineMatches.length; k++) {
        const start = inlineMatches[k].index + inlineMatches[k][0].length;
        const end = k + 1 < inlineMatches.length ? inlineMatches[k + 1].index : trimmed.length;
        const content = trimmed.slice(start, end).trim();
        if (content) items.push({ marker: inlineMatches[k][1], content });
      }
      if (items.length >= 2) { drafts.push(buildEnumCloze(items, trimmed)); i++; continue; }
    }

    // Cloze/invertido/básico (uma linha) têm prioridade sobre a heurística Q/R,
    // pois dependem de marcação explícita ("==" "++" "=").
    const card = parseLineForCard(trimmed);
    if (card) { drafts.push(card); i++; continue; }

    // Pergunta/Resposta ("?"/":"), possivelmente multilinha
    const qa = parseQA(lines, i);
    if (qa) { drafts.push(qa.draft); i = qa.next; continue; }

    i++;
  }

  return drafts;
}

// ─────────────────────────────────────────────────────────────────────────────
// SM-2 simplificado
// ─────────────────────────────────────────────────────────────────────────────

function makeDefaultSchedule(now) {
  return { due: now, interval: 0, ease: 2.5, reps: 0, lapses: 0 };
}

function gradeCard(card, grade) {
  let { interval, ease, reps, lapses } = card;

  if (grade === "again") {
    reps = 0; lapses += 1; interval = 1; ease = Math.max(1.3, ease - 0.2);
  } else if (grade === "hard") {
    interval = interval <= 0 ? 1 : Math.max(1, Math.round(interval * 1.2));
    ease = Math.max(1.3, ease - 0.15);
    reps += 1;
  } else if (grade === "good") {
    interval = reps === 0 ? 1 : reps === 1 ? 6 : Math.round(interval * ease);
    reps += 1;
  } else if (grade === "easy") {
    interval = reps === 0 ? 2 : reps === 1 ? 8 : Math.round(interval * ease * 1.3);
    ease = ease + 0.15;
    reps += 1;
  }

  const due = new Date(Date.now() + interval * 86_400_000).toISOString();
  return { ...card, interval, ease, reps, lapses, due };
}

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
      for (const f of fs.readdirSync(FLASHCARDS_DIR).filter(f => f.endsWith(".json"))) {
        try {
          const cards = JSON.parse(fs.readFileSync(path.join(FLASHCARDS_DIR, f), "utf8"));
          for (const c of cards) if (c.due <= now) due.push(c);
        } catch { /* arquivo corrompido — ignora */ }
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

module.exports = { createFlashcardHandlers, parseFlashcardsFromText };
