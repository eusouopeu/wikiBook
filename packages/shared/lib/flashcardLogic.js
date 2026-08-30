// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/lib/flashcardLogic.js
// Parser de flashcards (texto Markdown → rascunhos) e agendamento SM-2
// simplificado — extraído de packages/desktop/src/main/handlers/
// flashcardHandlers.js para ser puro (sem fs/Electron), o que permite
// testá-lo com node --test sem nenhum mock (ver packages/desktop/test/
// flashcards.test.js).
//
// Padrões reconhecidos pelo parser:
//   ==destaque==  → cloze c1 (amarelo; uma linha = um card, todos os destaques
//                   da linha revelados juntos)
//   ++destaque++  → cloze c2 (laranja; combina com os c1 amarelos na mesma linha)
//   listas (ordenadas ou não — "1." "a." "a)" "i." "-" "*" …) na mesma linha ou
//                   em linhas seguidas → um único card cloze c1 que esconde todos
//                   os itens simultaneamente, mantendo os marcadores visíveis
//   "Pergunta? resposta"  /  "Termo: definição"  (delimitador "?"/":" seguido de
//                   conteúdo na mesma linha ou na linha seguinte) → card cuja
//                   frente é a parte anterior ao delimitador e o verso é o
//                   restante, até a primeira linha vazia
//   texto = texto → card básico (frente = antes do "=", verso = depois)
//   texto == texto (sem par de "==") → card invertido (gera as duas direções)
//
// gradeCard: mesma família de algoritmo usada pelo plugin Spaced Repetition
// do Obsidian e pelo Anki.
//
// CommonJS plano, mesmo padrão de claudePrompts.js/pathMaterialize.js:
// require() direto no main do Electron, import com interop do esbuild no
// mobile (quando/se essa duplicação for removida do lado mobile também).
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

// Achata rascunhos em pares frente/verso "prontos para estudo" — mesma
// divisão de cards que mergeFlashcards usa para gerar os flashcards revisados
// no app (um card por grupo de cloze presente, duas direções para
// "reversed"), mas sem estado de agendamento. Usado pela exportação CSV para
// Anki, para que o card exportado seja o mesmo que o usuário revisa aqui.
function flattenDraftsForExport(drafts) {
  const cards = [];
  for (const draft of drafts) {
    if (draft.kind === "reversed") {
      cards.push({ front: draft.front, back: draft.back });
      cards.push({ front: draft.back, back: draft.front });
    } else if (draft.kind === "cloze" || draft.kind === "enum-cloze") {
      // Um card por grupo de cloze (c1 amarelo, c2 laranja, …): o grupo do
      // card vira {{c1::…}} (sintaxe de cloze deletion do Anki); os demais
      // grupos ficam visíveis como texto puro, igual ao preview do app.
      const groups = [...new Set(
        [...(draft.clozeText ?? "").matchAll(/\{\{c(\d+)::/g)].map(m => Number(m[1]))
      )].sort((a, b) => a - b);
      for (const g of (groups.length ? groups : [1])) {
        const front = (draft.clozeText ?? "")
          .replace(new RegExp(`\\{\\{c${g}::(.+?)\\}\\}`, "g"), (_m, inner) => `{{c1::${inner}}}`)
          .replace(/\{\{c\d+::(.+?)\}\}/g, (_m, inner) => inner);
        cards.push({ front, back: "" });
      }
    } else {
      cards.push({ front: draft.front, back: draft.back });
    }
  }
  return cards;
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

module.exports = {
  parseFlashcardsFromText,
  flattenDraftsForExport,
  makeDefaultSchedule,
  gradeCard,
};
