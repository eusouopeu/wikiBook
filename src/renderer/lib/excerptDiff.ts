// ─────────────────────────────────────────────────────────────────────────────
// src/renderer/lib/excerptDiff.ts
// Diff usada pelo editor de trechos salvos: toda edição é sempre comparada com
// o Markdown ORIGINAL do trecho (derivado do HTML capturado), nunca com uma
// edição anterior — cada "Salvar" recalcula do zero quais partes são novas
// (marcadas com *itálico*) e quais foram removidas ("(...)").
//
// O diff é hierárquico: primeiro alinha LINHAS (preservando a estrutura de
// listas e parágrafos), depois faz diff por token dentro de linhas pareadas.
// Sem isso, apagar um item de lista espalharia o "(...)" no meio da formatação
// do item seguinte.
//
// Convenção de itálico, para que os dois usos coexistam sem ambiguidade:
//   _texto_  → itálico ORIGINAL do trecho (preservado ao reabrir o editor)
//   *texto*  → marcador automático de INSERÇÃO (removido ao reabrir)
// Ambos renderizam como <em>; são sintaxes equivalentes em Markdown.
// ─────────────────────────────────────────────────────────────────────────────

// Acima deste número de tokens numa linha, o LCS (O(n·m)) fica caro — nesse
// caso a linha é tratada como removida+adicionada inteira (sem diff fino).
const MAX_DIFF_TOKENS = 2000;

// Marcador de item de lista no início da linha ("- ", "1. ", "a) ")
const BULLET_RE = /^([ \t]*)([-•]|\d{1,2}[.)]|[A-Za-zÀ-ÿ][.)])\s+/;

const isWhitespace = (t: string) => /^\s+$/.test(t);

function tokenize(text: string): string[] {
  // Mantém espaços como tokens próprios, para preservar espaçamento exato
  return text.split(/(\s+)/).filter(t => t.length > 0);
}

// Colapsa espaços repetidos DENTRO de cada linha, preservando a indentação
// inicial (aninhamento de listas) e as quebras de linha. Linhas só com espaço
// viram vazias.
function collapseInlineSpaces(text: string): string {
  return text
    .split("\n")
    .map(line => {
      if (!line.trim()) return "";
      const indent = line.match(/^[ \t]*/)?.[0] ?? "";
      return indent + line.slice(indent.length).replace(/[ \t]{2,}/g, " ").trimEnd();
    })
    .join("\n");
}

// Remove marcadores de formatação de um token para fins de COMPARAÇÃO:
// **negrito**, ==destaque==, ++laranja++, *itálico*, _itálico_ e spans [texto]{...}.
// Assim, envolver texto existente com formatação não conta como edição —
// o token formatado continua "igual" ao original.
function normalizeToken(t: string): string {
  if (isWhitespace(t)) return t;
  return t
    .replace(/\]\{[^}]*\}/g, "")    // fecha-span com atributos: ]{bg=...}, ]{.def}, …
    .replace(/\*\*|==|\+\+/g, "")
    .replace(/[*_]/g, "")
    .replace(/\[/g, "");
}

// Tokens cuja forma normalizada fica vazia (marcadores soltos) só são iguais
// se forem idênticos — evita que "==" solto case com qualquer outro marcador
function tokensEqual(a: string, b: string): boolean {
  const na = normalizeToken(a), nb = normalizeToken(b);
  if (na === "" || nb === "") return a === b;
  return na === nb;
}

// Forma canônica de uma linha para alinhamento (sem formatação nem espaçamento)
function normalizeLine(line: string): string {
  return tokenize(line).map(normalizeToken).join("").replace(/\s+/g, " ").trim();
}

// LCS genérico com comparador customizado
function lcsTable<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): number[][] {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = eq(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

// ── Diff dentro de uma linha (nível de token) ────────────────────────────────

interface TokenOp { type: "same" | "added" | "removed"; tokens: string[]; }

function pushTokenOp(ops: TokenOp[], type: TokenOp["type"], token: string) {
  const last = ops[ops.length - 1];
  if (last && last.type === type) last.tokens.push(token);
  else ops.push({ type, tokens: [token] });
}

// Acrescenta texto garantindo exatamente um espaço separador quando nem o que
// já foi escrito nem o texto novo trazem espaço na junção — necessário porque
// "(...)" e os trechos *itálicos* descartam o espaçamento original das runs
// que substituem.
function appendText(out: string, text: string): string {
  if (text === "") return out;
  const needsSpace = out !== "" && !/\s$/.test(out) && !/^\s/.test(text);
  return out + (needsSpace ? " " : "") + text;
}

// Envolve um texto com o marcador de inserção, sem duplicar itálico existente
function italicize(text: string): string {
  let inner = text.trim();
  if (!inner) return text;
  if (/^\*[^*]+\*$/.test(inner)) inner = inner.slice(1, -1);
  return `*${inner}*`;
}

function diffWithinLine(original: string, edited: string): string {
  // O marcador de lista sai do diff e é reanexado no fim — evita que ele seja
  // tratado como token comum (o que duplicaria o bullet ou o italizaria)
  const origBullet = original.match(BULLET_RE)?.[0] ?? "";
  const editBullet = edited.match(BULLET_RE)?.[0] ?? "";
  const a = tokenize(original.slice(origBullet.length));
  const b = tokenize(edited.slice(editBullet.length));
  if (a.length > MAX_DIFF_TOKENS || b.length > MAX_DIFF_TOKENS) {
    return editBullet + (edited.trim() ? italicize(edited.slice(editBullet.length)) : "");
  }

  const dp = lcsTable(a, b, tokensEqual);
  const ops: TokenOp[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    // "same" emite o token EDITADO (b) — preserva formatação aplicada sobre
    // texto original (==destaque==, **negrito** etc.) sem marcá-la como edição
    if (tokensEqual(a[i], b[j])) { pushTokenOp(ops, "same", b[j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { pushTokenOp(ops, "removed", a[i]); i++; }
    else { pushTokenOp(ops, "added", b[j]); j++; }
  }
  while (i < a.length) { pushTokenOp(ops, "removed", a[i]); i++; }
  while (j < b.length) { pushTokenOp(ops, "added", b[j]); j++; }

  let out = "";
  for (const op of ops) {
    const text = op.tokens.join("");
    if (op.type === "same") {
      out = appendText(out, text);
    } else if (op.type === "added") {
      if (!text.trim()) { out = appendText(out, text); continue; }
      const leading = text.match(/^\s*/)?.[0] ?? "";
      const trailing = text.match(/\s*$/)?.[0] ?? "";
      out = appendText(out, leading + italicize(text));
      out += trailing;
    } else {
      if (op.tokens.every(isWhitespace)) continue;
      out = appendText(out, "(...)");
    }
  }
  return editBullet + out.trim();
}

// ── Diff entre linhas ─────────────────────────────────────────────────────────

type LineOp =
  | { type: "same"; orig: string; edit: string }
  | { type: "removed"; line: string }
  | { type: "added"; line: string };

function diffLineOps(a: string[], b: string[]): LineOp[] {
  const na = a.map(normalizeLine);
  const nb = b.map(normalizeLine);
  const dp = lcsTable(na, nb, (x, y) => x === y);
  const ops: LineOp[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (na[i] === nb[j]) { ops.push({ type: "same", orig: a[i], edit: b[j] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: "removed", line: a[i] }); i++; }
    else { ops.push({ type: "added", line: b[j] }); j++; }
  }
  while (i < a.length) { ops.push({ type: "removed", line: a[i] }); i++; }
  while (j < b.length) { ops.push({ type: "added", line: b[j] }); j++; }
  return ops;
}

// Proporção de tokens em comum entre duas linhas (0..1)
function lineSimilarity(a: string, b: string): number {
  const ta = tokenize(a).filter(t => !isWhitespace(t)).map(normalizeToken);
  const tb = tokenize(b).filter(t => !isWhitespace(t)).map(normalizeToken);
  if (!ta.length && !tb.length) return 1;
  if (!ta.length || !tb.length) return 0;
  const pool = new Map<string, number>();
  for (const t of tb) pool.set(t, (pool.get(t) ?? 0) + 1);
  let common = 0;
  for (const t of ta) {
    const c = pool.get(t) ?? 0;
    if (c > 0) { common++; pool.set(t, c - 1); }
  }
  return (2 * common) / (ta.length + tb.length);
}

// Linhas removidas seguidas de adicionadas que sejam parecidas representam uma
// EDIÇÃO da mesma linha — parear permite diff fino em vez de "some tudo, entra tudo"
const PAIR_THRESHOLD = 0.4;

function pairChangedLines(ops: LineOp[]): LineOp[] {
  const out: LineOp[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].type !== "removed") { out.push(ops[k]); k++; continue; }

    const removed: string[] = [];
    while (k < ops.length && ops[k].type === "removed") {
      removed.push((ops[k] as { line: string }).line); k++;
    }
    const added: string[] = [];
    while (k < ops.length && ops[k].type === "added") {
      added.push((ops[k] as { line: string }).line); k++;
    }

    const pairs = Math.min(removed.length, added.length);
    let p = 0;
    for (; p < pairs; p++) {
      if (lineSimilarity(removed[p], added[p]) < PAIR_THRESHOLD) break;
      out.push({ type: "same", orig: removed[p], edit: added[p] });
    }
    for (let r = p; r < removed.length; r++) out.push({ type: "removed", line: removed[r] });
    for (let d = p; d < added.length; d++) out.push({ type: "added", line: added[d] });
  }
  return out;
}

// Linha inteira apagada: mantém o marcador de lista e sinaliza o corte
function removalPlaceholder(line: string): string {
  const m = line.match(BULLET_RE);
  return m ? `${m[1]}${m[2]} (...)` : "(...)";
}

// Linha inteira nova: itálico no conteúdo, marcador de lista intacto
function addedLine(line: string): string {
  if (!line.trim()) return line;
  const m = line.match(BULLET_RE);
  if (m) {
    const rest = line.slice(m[0].length).trim();
    return rest ? `${m[1]}${m[2]} ${italicize(rest)}` : line;
  }
  return italicize(line);
}

// ── API pública ───────────────────────────────────────────────────────────────

// Markdown original vs. rascunho editado → markdown anotado: trechos iguais
// ficam como estão, adições viram *itálico*, remoções viram "(...)".
export function computeTrackedEdit(original: string, edited: string): string {
  const ops = pairChangedLines(diffLineOps(original.split("\n"), edited.split("\n")));

  const lines: string[] = [];
  let lastWasRemoval = false;
  for (const op of ops) {
    if (op.type === "same") {
      lines.push(op.orig === op.edit ? op.edit : diffWithinLine(op.orig, op.edit));
      lastWasRemoval = false;
    } else if (op.type === "added") {
      lines.push(addedLine(op.line));
      lastWasRemoval = false;
    } else {
      if (!op.line.trim()) continue;           // linha em branco removida: ignora
      if (lastWasRemoval) continue;            // colapsa remoções consecutivas
      lines.push(removalPlaceholder(op.line));
      lastWasRemoval = true;
    }
  }

  return collapseInlineSpaces(lines.join("\n")).replace(/\n{3,}/g, "\n\n").trim();
}

// Reconstrói um rascunho editável a partir do markdown anotado: remove os
// "(...)" (placeholders de remoção) e desembrulha o *itálico* automático de
// inserção — mas preserva **negrito**, _itálico original_, ==destaque==,
// ++laranja++ e [texto]{…}, que são formatação do conteúdo, não anotação.
export function stripTrackedMarkup(markdown: string): string {
  const cleaned = markdown
    .split("\n")
    .filter(line => {
      // Linha que era só o placeholder de remoção some por inteiro
      const withoutBullet = line.replace(BULLET_RE, "").trim();
      return withoutBullet !== "(...)";
    })
    .join("\n");

  let text = cleaned;
  const boldPlaceholders: string[] = [];
  text = text.replace(/\*\*(.+?)\*\*/g, (_, inner) => {
    boldPlaceholders.push(inner);
    return `\u0000${boldPlaceholders.length - 1}\u0000`;
  });
  text = text.replace(/\*(.+?)\*/g, "$1");
  text = text.replace(/\u0000(\d+)\u0000/g, (_, idx) => `**${boldPlaceholders[Number(idx)]}**`);
  text = text.replace(/\(\.\.\.\)/g, "");
  return collapseInlineSpaces(text).replace(/\n{3,}/g, "\n\n").trim();
}
