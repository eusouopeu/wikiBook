// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/platform/flashcards.ts
// Porta de packages/desktop/src/main/handlers/flashcardHandlers.js — parser,
// SM-2 e merge são regex/aritmética pura, copiados sem alteração; só a
// persistência (fs do Node → @capacitor/filesystem) e a leitura do artigo
// (readArticle do Node → getArticle daqui) mudam.
// ─────────────────────────────────────────────────────────────────────────────

import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import type { Flashcard, FlashcardGrade } from "@lexicon/shared";
import { getArticle, htmlToMarkdown } from "./articles";

const FLASHCARDS_DIR = "flashcards";

async function ensureFlashcardsDir() {
  try {
    await Filesystem.mkdir({ path: FLASHCARDS_DIR, directory: Directory.Data, recursive: true });
  } catch {
    // já existe
  }
}

function flashcardsPath(articleId: string) {
  return `${FLASHCARDS_DIR}/${articleId}.json`;
}

async function readFlashcards(articleId: string): Promise<Flashcard[]> {
  await ensureFlashcardsDir();
  try {
    const res = await Filesystem.readFile({
      path: flashcardsPath(articleId), directory: Directory.Data, encoding: Encoding.UTF8,
    });
    return JSON.parse(res.data as string);
  } catch {
    return [];
  }
}

async function writeFlashcards(articleId: string, cards: Flashcard[]) {
  await ensureFlashcardsDir();
  await Filesystem.writeFile({
    path: flashcardsPath(articleId),
    data: JSON.stringify(cards, null, 2),
    directory: Directory.Data,
    encoding: Encoding.UTF8,
  });
}

export async function deleteFlashcards(articleId: string): Promise<void> {
  try {
    await Filesystem.deleteFile({ path: flashcardsPath(articleId), directory: Directory.Data });
  } catch {
    // já não existia
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser: texto Markdown → flashcards "rascunho" (sem estado de agendamento)
// ─────────────────────────────────────────────────────────────────────────────

interface CardDraft {
  kind: "cloze" | "enum-cloze" | "reversed" | "basic" | "qa";
  clozeText?: string; front?: string; back?: string;
  sourceLine: string; sourceExcerptId?: string;
}

const LIST_MARKER = String.raw`(?:[-*•]|\d{1,2}[.)]|[ivxlcdm]{1,4}[.)]|[IVXLCDM]{1,4}[.)]|[A-Za-zÀ-ÿ][.)])`;
const ENUM_LINE_RE = new RegExp(`^(${LIST_MARKER})\\s+(.*)$`);
const ENUM_INLINE_RE = /(?:^|\s)(\d{1,2}[.)]|[ivxlcdm]{1,4}[.)]|[A-Za-zÀ-ÿ][.)])\s+/g;

function buildEnumCloze(items: Array<{ marker: string; content: string }>, sourceText: string, stem?: string | null): CardDraft {
  const body = items.map(it => `${it.marker} {{c1::${it.content}}}`).join("\n");
  const clozeText = stem ? `${stem}\n${body}` : body;
  return { kind: "enum-cloze", clozeText, sourceLine: sourceText };
}

function collectListRun(lines: string[], start: number) {
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
    const m = l.match(ENUM_LINE_RE)!;
    return { marker: m[1], content: m[2].trim() };
  });
  return { items, runLines, end: j };
}

function maskSpanAttrs(text: string): string {
  return text.replace(/\{[^}]*\}/g, m => " ".repeat(m.length));
}

function parseLineForCard(line: string): CardDraft | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const masked = maskSpanAttrs(trimmed);

  if (/==(.+?)==/.test(masked) || /\+\+(.+?)\+\+/.test(masked)) {
    const clozeText = trimmed
      .replace(/==(.+?)==/g, (_, inner) => `{{c1::${inner}}}`)
      .replace(/\+\+(.+?)\+\+/g, (_, inner) => `{{c2::${inner}}}`);
    return { kind: "cloze", clozeText, sourceLine: trimmed };
  }

  if (masked.includes("==")) {
    const i = masked.indexOf("==");
    const front = trimmed.slice(0, i).trim();
    const back = trimmed.slice(i + 2).trim();
    if (front && back) return { kind: "reversed", front, back, sourceLine: trimmed };
    return null;
  }

  if (masked.includes("=")) {
    const i = masked.indexOf("=");
    const front = trimmed.slice(0, i).trim();
    const back = trimmed.slice(i + 1).trim();
    if (front && back) return { kind: "basic", front, back, sourceLine: trimmed };
  }

  return null;
}

function parseQA(lines: string[], i: number): { draft: CardDraft; next: number } | null {
  const line = lines[i].trim();
  if (!line) return null;

  let front: string, firstBackLine: string | null = null;
  const inline = line.match(/^(.+?)([?:])\s+(\S.*)$/);
  if (inline) {
    front = inline[1].trim() + (inline[2] === "?" ? "?" : "");
    firstBackLine = inline[3].trim();
  } else {
    const trailing = line.match(/^(.+?)([?:])$/);
    if (!trailing) return null;
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

function parseFlashcardsFromText(text: string): CardDraft[] {
  const drafts: CardDraft[] = [];
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed) { i++; continue; }

    const run = collectListRun(lines, i);
    if (run) {
      drafts.push(buildEnumCloze(run.items, run.runLines.join("\n"), null));
      i = run.end;
      continue;
    }

    if (!ENUM_LINE_RE.test(trimmed) && i + 1 < lines.length && lines[i + 1].trim()) {
      const run2 = collectListRun(lines, i + 1);
      if (run2) {
        drafts.push(buildEnumCloze(run2.items, `${trimmed}\n${run2.runLines.join("\n")}`, trimmed));
        i = run2.end;
        continue;
      }
    }

    const inlineMatches = [...trimmed.matchAll(ENUM_INLINE_RE)];
    if (inlineMatches.length >= 2) {
      const items: Array<{ marker: string; content: string }> = [];
      for (let k = 0; k < inlineMatches.length; k++) {
        const start = inlineMatches[k].index! + inlineMatches[k][0].length;
        const end = k + 1 < inlineMatches.length ? inlineMatches[k + 1].index! : trimmed.length;
        const content = trimmed.slice(start, end).trim();
        if (content) items.push({ marker: inlineMatches[k][1], content });
      }
      if (items.length >= 2) { drafts.push(buildEnumCloze(items, trimmed)); i++; continue; }
    }

    const card = parseLineForCard(trimmed);
    if (card) { drafts.push(card); i++; continue; }

    const qa = parseQA(lines, i);
    if (qa) { drafts.push(qa.draft); i = qa.next; continue; }

    i++;
  }

  return drafts;
}

// ─────────────────────────────────────────────────────────────────────────────
// SM-2 simplificado
// ─────────────────────────────────────────────────────────────────────────────

function makeDefaultSchedule(now: string) {
  return { due: now, interval: 0, ease: 2.5, reps: 0, lapses: 0 };
}

function gradeCard(card: Flashcard, grade: FlashcardGrade): Flashcard {
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

function mergeFlashcards(existingCards: Flashcard[], drafts: CardDraft[], articleId: string, articleTitle: string): Flashcard[] {
  const now = new Date().toISOString();
  const existingByKey = new Map<string, Flashcard>();
  for (const c of existingCards) {
    existingByKey.set(`${c.kind}::${c.sourceLine}::${c.frontBackIndex ?? 0}`, c);
  }

  const result: Flashcard[] = [];

  const carryOverOrNew = (key: string, base: Partial<Flashcard>): Flashcard => {
    const existing = existingByKey.get(key);
    return {
      id: existing?.id ?? crypto.randomUUID(),
      createdAt: existing?.createdAt ?? now,
      ...(existing
        ? { due: existing.due, interval: existing.interval, ease: existing.ease, reps: existing.reps, lapses: existing.lapses }
        : makeDefaultSchedule(now)),
      ...base,
    } as Flashcard;
  };

  for (const draft of drafts) {
    if (draft.kind === "reversed") {
      const pairs = [
        { front: draft.front!, back: draft.back!, idx: 0 },
        { front: draft.back!, back: draft.front!, idx: 1 },
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

export async function regenerate(articleId: string): Promise<Flashcard[]> {
  const article = await getArticle(articleId);

  const drafts: CardDraft[] = [];
  if (article.source === "manual" && article.content) {
    drafts.push(...parseFlashcardsFromText(article.content));
  }
  for (const ex of article.excerpts ?? []) {
    if ((ex.kind ?? "text") !== "text") continue;
    const md = ex.editedMarkdown ?? htmlToMarkdown(ex.html ?? "") ?? ex.plainText;
    if (!md) continue;
    const exDrafts = parseFlashcardsFromText(md);
    for (const d of exDrafts) d.sourceExcerptId = ex.id;
    drafts.push(...exDrafts);
  }

  const existing = await readFlashcards(articleId);
  const merged = mergeFlashcards(existing, drafts, articleId, article.title);
  await writeFlashcards(articleId, merged);
  return merged;
}

export async function list(articleId: string): Promise<Flashcard[]> {
  return readFlashcards(articleId);
}

// Agrega cards vencidos (due <= agora) de todos os artigos, ordenados por
// vencimento — usado pela revisão global.
export async function listDue(): Promise<Flashcard[]> {
  await ensureFlashcardsDir();
  const now = new Date().toISOString();
  const due: Flashcard[] = [];
  let entries;
  try {
    entries = await Filesystem.readdir({ path: FLASHCARDS_DIR, directory: Directory.Data });
  } catch {
    return [];
  }
  for (const f of entries.files.filter(f => f.name.endsWith(".json"))) {
    try {
      const res = await Filesystem.readFile({
        path: `${FLASHCARDS_DIR}/${f.name}`, directory: Directory.Data, encoding: Encoding.UTF8,
      });
      const cards: Flashcard[] = JSON.parse(res.data as string);
      for (const c of cards) if (c.due <= now) due.push(c);
    } catch {
      // arquivo corrompido — ignora
    }
  }
  due.sort((a, b) => a.due.localeCompare(b.due));
  return due;
}

export async function grade(articleId: string, cardId: string, cardGrade: FlashcardGrade): Promise<Flashcard> {
  const cards = await readFlashcards(articleId);
  const idx = cards.findIndex(c => c.id === cardId);
  if (idx === -1) throw new Error("Flashcard não encontrado.");
  cards[idx] = gradeCard(cards[idx], cardGrade);
  await writeFlashcards(articleId, cards);
  return cards[idx];
}
