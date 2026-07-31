// ─────────────────────────────────────────────────────────────────────────────
// src/renderer/lib/markdown.ts
// Conversões Markdown ⇄ HTML usadas pelos artigos manuais, pelos trechos salvos
// (incluindo o baseline de edição derivado do HTML capturado) e pelas tabelas.
// Funções puras — testáveis isoladamente.
// ─────────────────────────────────────────────────────────────────────────────

// Escapa texto para uso literal dentro de HTML (conteúdo ou atributo)
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ── Markdown inline → HTML ────────────────────────────────────────────────────
// **negrito**, *itálico* (marcador automático de inserção nos trechos editados),
// ==destaque== (amarelo, vira flashcard cloze), ++laranja++, e spans com atributos
// (sintaxe Pandoc): [x]{.def} azul (conceitos), [x]{.enum} verde (estruturas),
// [x]{.num} roxo (dados numéricos), [x]{bg=COR}/[x]{color=COR} cores livres.
export function inlineMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    // _itálico_ = itálico original do trecho (ver excerptDiff.ts); o lookaround
    // evita casar sublinhados dentro de palavras (snake_case)
    .replace(/(?<![\w])_([^_\n]+)_(?![\w])/g, "<em>$1</em>")
    .replace(/==([^=]+)==/g, '<mark class="hl-default">$1</mark>')
    .replace(/\+\+([^+]+)\+\+/g, '<mark class="hl-orange">$1</mark>')
    .replace(/\[([^\]]+)\]\{\.def\}/g, '<mark class="hl-def">$1</mark>')
    .replace(/\[([^\]]+)\]\{\.enum\}/g, '<mark class="hl-enum">$1</mark>')
    .replace(/\[([^\]]+)\]\{\.num\}/g, '<mark class="hl-num">$1</mark>')
    .replace(/\[([^\]]+)\]\{bg=([^}]+)\}/g, '<mark style="background:$2">$1</mark>')
    .replace(/\[([^\]]+)\]\{color=([^}]+)\}/g, '<span style="color:$2">$1</span>');
}

// Aplica negrito automático à parte anterior a "?"/":" num parágrafo (mesma
// regra dos flashcards Pergunta/Resposta): "ameixa: fruto…" → "**ameixa**: fruto…".
// Casa tanto o delimitador seguido de conteúdo na mesma linha quanto a linha que
// termina no delimitador. O "\s+\S" (ou fim de linha) evita "http://", "3:30".
// Não altera a linha se a frente já tiver negrito manual.
function autoBoldQuestionLead(line: string): string {
  const m = line.match(/^(\s*)(.+?)([?:])(\s+\S.*|)$/);
  if (!m) return line;
  const [, indent, front, delim, rest] = m;
  if (front.includes("**")) return line;
  return `${indent}**${front}**${delim}${rest}`;
}

// ── Markdown de bloco → HTML (para artigos manuais e trechos editados) ────────
// Suporta #/##/### títulos, parágrafos e listas — não ordenadas ("- ") e
// ordenadas ("1." / "a)") — com aninhamento por indentação (2 espaços = 1 nível).
// Parágrafos com "?"/":" têm a parte anterior ao delimitador destacada em negrito.
export function markdownToHtml(md: string): string {
  const out: string[] = [];
  const stack: Array<{ tag: "ul" | "ol"; indent: number }> = [];

  const closeToIndent = (indent: number) => {
    while (stack.length && stack[stack.length - 1].indent > indent) {
      out.push(`</${stack.pop()!.tag}>`);
    }
  };
  const closeAll = () => { while (stack.length) out.push(`</${stack.pop()!.tag}>`); };

  for (const rawLine of md.split("\n")) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim()) { closeAll(); continue; }

    const li = line.match(/^([ \t]*)([-•]|\d{1,2}[.)]|[A-Za-zÀ-ÿ][.)])\s+(.*)$/);
    if (li) {
      const indent = Math.floor(li[1].replace(/\t/g, "  ").length / 2);
      const tag: "ul" | "ol" = /^[-•]$/.test(li[2]) ? "ul" : "ol";
      closeToIndent(indent);
      const top = stack[stack.length - 1];
      if (!top || top.indent < indent) {
        stack.push({ tag, indent });
        out.push(`<${tag}>`);
      } else if (top.tag !== tag) {
        out.push(`</${top.tag}>`);
        stack.pop();
        stack.push({ tag, indent });
        out.push(`<${tag}>`);
      }
      out.push(`<li>${inlineMarkdown(li[3])}</li>`);
      continue;
    }

    closeAll();
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 6);   // # → h2 (h1 é o título)
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else {
      out.push(`<p>${inlineMarkdown(autoBoldQuestionLead(line))}</p>`);
    }
  }
  closeAll();
  return out.join("\n");
}

// ── HTML capturado de um trecho → Markdown (baseline de edição) ───────────────
// Preserva a formatação visual original: negrito, itálico (_ , ver excerptDiff),
// listas (com aninhamento e numeração) e títulos. É derivado do `html` imutável
// do trecho, então funciona também para trechos salvos antes desta mudança.
export function excerptHtmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const md = nodeToMarkdown(doc.body, 0);
  return md
    .split("\n")
    .map(l => {
      if (!l.trim()) return "";   // linha só com espaço (whitespace entre tags)
      const indent = l.match(/^[ \t]*/)?.[0] ?? "";
      return indent + l.slice(indent.length).replace(/[ \t]{2,}/g, " ").trimEnd();
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Devolve as LINHAS da lista (sem quebras de borda) — os itens de uma sublista
// precisam ficar contíguos aos do pai, senão a linha em branco encerraria a
// lista na volta para HTML.
function listLines(listEl: Element, depth: number): string[] {
  const ordered = listEl.tagName === "OL";
  const indent = "  ".repeat(depth);
  const lines: string[] = [];
  let n = 0;

  for (const li of Array.from(listEl.children)) {
    if (li.tagName !== "LI") continue;
    n++;
    // Separa o conteúdo inline do item das sublistas aninhadas
    const sublists: Element[] = [];
    let inline = "";
    for (const child of Array.from(li.childNodes)) {
      const asEl = child as Element;
      if (child.nodeType === 1 && (asEl.tagName === "UL" || asEl.tagName === "OL")) {
        sublists.push(asEl);
      } else {
        inline += nodeToMarkdown(child, depth);
      }
    }
    // O item ocupa uma única linha (quebras internas viram espaço)
    const text = inline.replace(/\s*\n+\s*/g, " ").trim();
    lines.push(`${indent}${ordered ? `${n}.` : "-"} ${text}`.trimEnd());
    for (const sub of sublists) lines.push(...listLines(sub, depth + 1));
  }
  return lines;
}

export function listToMarkdown(listEl: Element, depth: number): string {
  return "\n" + listLines(listEl, depth).join("\n") + "\n";
}

export function nodeToMarkdown(node: Node, depth: number): string {
  if (node.nodeType === 3) return (node.textContent ?? "").replace(/\s+/g, " ");
  if (node.nodeType !== 1) return "";

  const el = node as Element;
  const kids = () => Array.from(el.childNodes).map(n => nodeToMarkdown(n, depth)).join("");

  switch (el.tagName) {
    case "BR":   return "\n";
    case "B": case "STRONG": { const t = kids().trim(); return t ? `**${t}**` : ""; }
    case "I": case "EM":     { const t = kids().trim(); return t ? `_${t}_` : ""; }
    case "UL": case "OL":    return listToMarkdown(el, depth);
    case "LI":               return kids();          // normalmente tratado pelo pai
    case "P": case "DIV": case "BLOCKQUOTE": {
      const t = kids().trim();
      return t ? `\n\n${t}\n\n` : "";
    }
    case "H1": case "H2": case "H3": case "H4": case "H5": case "H6": {
      const level = Math.max(1, Number(el.tagName[1]) - 1);   // h2 → "#"
      const t = kids().trim();
      return t ? `\n\n${"#".repeat(level)} ${t}\n\n` : "";
    }
    case "IMG": case "SCRIPT": case "STYLE": return "";
    default: return kids();
  }
}

// ── Tabela Markdown ⇄ matriz de células (para o editor de tabela) ─────────────
// A primeira linha é o cabeçalho; a linha separadora "| --- |" é ignorada.
// Pipes literais no conteúdo vêm escapados como "\|" e são desescapados aqui.
export function parseMarkdownTable(md: string): string[][] {
  const rows: string[][] = [];
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("|")) continue;
    // Linha separadora do cabeçalho (só -, : e espaços entre as pipes)
    if (/^\|(\s*:?-+:?\s*\|)+$/.test(line)) continue;
    const cells = line
      .replace(/^\|/, "").replace(/\|$/, "")
      .split(/(?<!\\)\|/)
      .map(c => c.replace(/\\\|/g, "|").trim());
    rows.push(cells);
  }
  return rows.length ? rows : [[""]];
}

export function serializeMarkdownTable(matrix: string[][]): string {
  const colCount = Math.max(1, ...matrix.map(r => r.length));
  const esc = (c: string) => (c ?? "").replace(/\|/g, "\\|").trim();
  const pad = (r: string[]) => {
    const copy = r.map(esc);
    while (copy.length < colCount) copy.push("");
    return copy;
  };
  const line = (r: string[]) => `| ${pad(r).join(" | ")} |`;
  const header = line(matrix[0] ?? []);
  const sep = `| ${Array(colCount).fill("---").join(" | ")} |`;
  const body = matrix.slice(1).map(line);
  return [header, sep, ...body].join("\n");
}

// Tabela Markdown → HTML, aplicando inline markdown (negrito, marca-textos) nas
// células. Usado para renderizar tabelas editadas célula a célula.
export function markdownTableToHtml(md: string): string {
  const matrix = parseMarkdownTable(md);
  if (matrix.length === 0) return "";
  const [header, ...body] = matrix;
  const thead = `<thead><tr>${header.map(c => `<th>${inlineMarkdown(c)}</th>`).join("")}</tr></thead>`;
  const tbody = body.length
    ? `<tbody>${body.map(r => `<tr>${r.map(c => `<td>${inlineMarkdown(c)}</td>`).join("")}</tr>`).join("")}</tbody>`
    : "";
  return `<table>${thead}${tbody}</table>`;
}
