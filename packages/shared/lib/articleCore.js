// @ts-check
// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/lib/articleCore.js
// Lógica pura de artigos compartilhada entre desktop (articleHandlers.js,
// fs síncrono) e mobile (platform/articles.ts, @capacitor/filesystem) — cada
// plataforma fica só com o I/O de arquivo; o que é decisão/transformação
// (cache da listagem, normalização, ordenação, histórico, sanitização de
// trechos, HTML → Markdown, .md no formato Obsidian) mora aqui, testável sem
// tocar em disco/rede. CommonJS porque o main do Electron faz require direto.
// ─────────────────────────────────────────────────────────────────────────────

// Snapshots de versão guardados por artigo — cap alto o bastante para cobrir
// uma sessão de edição longa, sem deixar o arquivo de histórico crescer sem
// limite (cada snapshot guarda content/summary inteiros).
const HISTORY_MAX_ENTRIES = 20;
// Tamanho máximo por anexo — protege contra travar o processo/ponte
// serializando/gravando um arquivo enorme recebido como base64.
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const TRASH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;   // 30 dias

/**
 * @typedef {{ id: string; kind?: string; category?: string; html?: string; plainText: string;
 *   editedMarkdown?: string; sourceArticleId?: string; sourceArticleTitle: string; savedAt?: string;
 *   updatedAt?: string }} ExcerptLike
 * @typedef {{ type: string; id: string }} OutlineItemLike
 * @typedef {{ id: string; anchorText: string; targetId: string; targetTitle: string }} LinkLike
 * @typedef {{ title: string; content?: string; summary?: string; updatedAt?: string }} HistoryEntryLike
 */

// ── Cache em memória da listagem completa ───────────────────────────────────
// Evita reler e reparsear TODOS os JSONs a cada listagem. Invalidado (não
// atualizado incrementalmente) em toda escrita — writeArticle() já cobre a
// maioria; delete/restore, que fazem rename direto, invalidam explicitamente.
/**
 * @template T
 * @returns {{ get(): T[] | null; set(list: T[]): T[]; invalidate(): void }}
 */
function createListingCache() {
  /** @type {T[] | null} */
  let cached = null;
  return {
    get() { return cached; },
    set(list) { cached = list; return list; },
    invalidate() { cached = null; },
  };
}

// Preenche os arrays que JSONs antigos podem não ter (muta e devolve o mesmo objeto)
/**
 * @template {{ excerpts?: any[]; links?: any[]; tags?: any[] }} T
 * @param {T} art
 * @returns {T}
 */
function normalizeArticle(art) {
  art.excerpts = art.excerpts ?? [];
  art.links    = art.links    ?? [];
  art.tags     = art.tags     ?? [];
  return art;
}

// Mais recente primeiro (ordena no lugar, igual ao .sort() original)
/**
 * @template {{ updatedAt?: string }} T
 * @param {T[]} articles
 * @returns {T[]}
 */
function sortByUpdatedDesc(articles) {
  return articles.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

/**
 * @param {number} mtimeMs
 * @param {number} now
 */
function isTrashExpired(mtimeMs, now) {
  return now - mtimeMs > TRASH_MAX_AGE_MS;
}

// Id legível a partir do título + sufixo aleatório (gerado pela plataforma —
// crypto do Node no desktop, Web Crypto no mobile)
/**
 * @param {string} title
 * @param {string} suffix
 */
function slugify(title, suffix) {
  const base = title.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return `${base}-${suffix}`;
}

// ── Histórico de versões ───────────────────────────────────────────────────
// Snapshot só quando title/summary/content de fato mudaram, para não acumular
// uma entrada idêntica a cada clique em "Salvar" sem edição real.
/**
 * @param {HistoryEntryLike} previous
 * @param {HistoryEntryLike} next
 */
function hasContentChanged(previous, next) {
  return previous.title !== next.title ||
    previous.summary !== next.summary ||
    previous.content !== next.content;
}

// Versão anterior no topo, cortando no limite — devolve o array a gravar
/**
 * @template {HistoryEntryLike} E
 * @param {E[]} entries
 * @param {HistoryEntryLike} oldArticle
 * @returns {E[]}
 */
function pushHistorySnapshot(entries, oldArticle) {
  entries.unshift(/** @type {E} */ ({
    title: oldArticle.title,
    content: oldArticle.content,
    summary: oldArticle.summary,
    updatedAt: oldArticle.updatedAt,
  }));
  return entries.slice(0, HISTORY_MAX_ENTRIES);
}

// ── Sanitiza HTML de um trecho mantendo formatação, removendo hrefs ───────────
// Recebe HTML bruto da seleção (pode conter <a href>, <b>, <i>, <sup>, etc.)
// Devolve HTML limpo: <a> → <span class="wiki-term">, hrefs removidos
/** @param {string} html */
function sanitizeExcerptHtml(html) {
  return html
    // Remove atributos href de qualquer elemento
    .replace(/\s+href="[^"]*"/g, "")
    // Converte <a ...>texto</a> em <span class="wiki-term">texto</span>
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi,
      '<span class="wiki-term">$1</span>')
    // Remove atributos style e class ruidosos mas mantém a tag
    .replace(/\s+style="[^"]*"/g, "")
    .replace(/\s+class="(?:mw-[^"]*|reference[^"]*)"/g, "")
    // Remove referências numéricas <sup>
    .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, "")
    .trim();
}

// ── Extrai texto puro de um fragmento HTML (para prévia e deduplicação) ───────
/** @param {string} html */
function htmlToPlainText(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** @param {string} text */
function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// ── Conversão pragmática HTML → Markdown (exportação/flashcards) ─────────────
/** @param {string} html */
function htmlToMarkdown(html) {
  let md = html;
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n");
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n");
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n");
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");
  md = md.replace(/<(?:b|strong)[^>]*>([\s\S]*?)<\/(?:b|strong)>/gi, "**$1**");
  md = md.replace(/<(?:i|em)[^>]*>([\s\S]*?)<\/(?:i|em)>/gi, "*$1*");
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n");
  md = md.replace(/<br\s*\/?>/gi, "\n");
  md = md.replace(/<img[^>]*>/gi, "");
  md = md.replace(/<[^>]+>/g, "");           // remove tags restantes
  md = decodeEntities(md);
  md = md.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return md.trim();
}

// ── Tabela HTML → tabela Markdown (preserva linhas e colunas) ─────────────────
// Usada tanto para o plainText do excerpt (busca/prévia) quanto na exportação —
// já sai pronta como sintaxe de tabela Markdown, sem reconversão.
/** @param {string} html */
function htmlTableToMarkdown(html) {
  /** @type {string[][]} */
  const rows = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    /** @type {string[]} */
    const cells = [];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      const text = decodeEntities(cellMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
      cells.push(text.replace(/\|/g, "\\|"));   // escapa pipes literais no conteúdo
    }
    if (cells.length) rows.push(cells);
  }
  if (rows.length === 0) return "(tabela vazia)";

  const colCount = Math.max(...rows.map(r => r.length));
  /** @param {string[]} r */
  const pad = (r) => { const copy = [...r]; while (copy.length < colCount) copy.push(""); return copy; };
  /** @param {string[]} r */
  const toLine = (r) => `| ${pad(r).join(" | ")} |`;

  const header = toLine(rows[0]);
  const separator = `| ${Array(colCount).fill("---").join(" | ")} |`;
  const body = rows.slice(1).map(toLine);
  return [header, separator, ...body].join("\n");
}

// ── Trechos (excerpts) ──────────────────────────────────────────────────────
// html bruto (seleção ou outerHTML de <table>) → html limpo + plainText
// derivado conforme o kind ("table" vira tabela Markdown)
/**
 * @param {string} html
 * @param {string} kind
 * @returns {{ cleanHtml: string; plainText: string }}
 */
function prepareExcerpt(html, kind) {
  const cleanHtml = sanitizeExcerptHtml(html);
  const plainText = kind === "table" ? htmlTableToMarkdown(cleanHtml) : htmlToPlainText(cleanHtml);
  return { cleanHtml, plainText };
}

// Imagem baixada → <img> com data URI embutida (a nota fica independente do
// artigo de origem) + plainText usado na deduplicação/prévia
/**
 * @param {string} mime
 * @param {string} base64
 * @param {string} alt
 * @returns {{ html: string; plainText: string }}
 */
function buildImageExcerptHtml(mime, base64, alt) {
  const dataUri = `data:${mime};base64,${base64}`;
  const safeAlt = alt.replace(/"/g, "&quot;");
  return { html: `<img src="${dataUri}" alt="${safeAlt}">`, plainText: alt || "Imagem salva" };
}

// Artigo-destino criado na hora quando o trecho não tem alvo existente
/**
 * @param {string | undefined} targetTitle
 * @param {string} now ISO
 * @param {string} slugSuffix
 */
function createNotesArticle(targetTitle, now, slugSuffix) {
  return {
    id: slugify(targetTitle || "notas-pessoais", slugSuffix),
    title: targetTitle || "Notas pessoais",
    source: /** @type {"manual"} */ ("manual"),
    content: "", summary: "",
    /** @type {any[]} */ links: [], /** @type {any[]} */ excerpts: [], /** @type {string[]} */ tags: [],
    createdAt: now, updatedAt: now,
  };
}

// Deduplicação por texto puro + origem (imagens só comparam com imagens)
/**
 * @param {ExcerptLike[]} excerpts
 * @param {"text" | "image"} mode
 * @param {string} plainText
 * @param {string | undefined} sourceArticleId
 */
function isDuplicateExcerpt(excerpts, mode, plainText, sourceArticleId) {
  if (mode === "image") {
    return excerpts.some(
      e => e.kind === "image" && e.sourceArticleId === sourceArticleId && e.plainText === plainText
    );
  }
  return excerpts.some(e => e.plainText === plainText && e.sourceArticleId === sourceArticleId);
}

// Remove o trecho e mantém o outline consistente (muta o artigo)
/**
 * @param {{ excerpts?: ExcerptLike[]; excerptOutline?: OutlineItemLike[] }} article
 * @param {string} excerptId
 */
function removeExcerptFromArticle(article, excerptId) {
  article.excerpts = (article.excerpts ?? []).filter(e => e.id !== excerptId);
  if (article.excerptOutline) {
    article.excerptOutline = article.excerptOutline.filter(
      item => !(item.type === "excerpt" && item.id === excerptId)
    );
  }
}

// Tira links que apontam para um artigo excluído — true se algo mudou
/**
 * @param {{ links: LinkLike[] }} article
 * @param {string} targetId
 */
function removeLinksTo(article, targetId) {
  const before = article.links.length;
  article.links = article.links.filter(l => l.targetId !== targetId);
  return article.links.length !== before;
}

/**
 * @param {LinkLike[]} links
 * @param {string} targetId
 * @param {string} anchorText
 */
function hasLink(links, targetId, anchorText) {
  return links.some(l => l.targetId === targetId && l.anchorText === anchorText);
}

// ── Lixeira ─────────────────────────────────────────────────────────────────
/**
 * @param {any} raw JSON do artigo na lixeira
 * @param {string} deletedAt ISO (mtime do arquivo — o rename para .trash/ o atualiza)
 */
function trashItemFromRaw(raw, deletedAt) {
  return { id: raw.id, title: raw.title, source: raw.source, deletedAt };
}

/**
 * @template {{ deletedAt: string }} T
 * @param {T[]} items
 */
function sortTrashItems(items) {
  return items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

// ── Exportação / sincronização Markdown ────────────────────────────────────
// Nome de arquivo seguro a partir do título (mantém espaços — padrão Obsidian)
/**
 * @param {string} title
 * @param {string} [fallback]
 */
function safeFilename(title, fallback = "sem-titulo") {
  return title.replace(/[/\\:*?"<>|#^[\]]/g, "-").trim().slice(0, 120) || fallback;
}

/** @type {Record<string, string>} */
const MIME_EXT = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
  "image/webp": "webp", "image/svg+xml": "svg",
};
/** @param {string} mime */
function extFromMime(mime) { return MIME_EXT[mime] ?? "png"; }

// CSV (delimitador ";", padrão de importação do Anki em pt-BR): aspas duplas
// ao redor de campos com ";", aspas ou quebra de linha
/** @param {unknown} field */
function csvEscape(field) {
  const s = String(field ?? "");
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Monta o .md de um artigo no formato Obsidian (frontmatter + wikilinks)
// imageAssetPaths: Map<excerptId, caminho relativo em assets/> já gravado em disco
/**
 * @param {{ title: string; source: string; tags?: string[]; createdAt?: string; updatedAt?: string;
 *   summary?: string; content?: string; links?: LinkLike[]; excerpts?: ExcerptLike[] }} article
 * @param {Map<string, string>} [imageAssetPaths]
 */
function articleToMarkdown(article, imageAssetPaths = new Map()) {
  const lines = [];
  lines.push("---");
  lines.push(`title: "${article.title.replace(/"/g, '\\"')}"`);
  lines.push(`source: ${article.source}`);
  if (article.tags?.length) lines.push(`tags: [${article.tags.join(", ")}]`);
  lines.push(`created: ${article.createdAt ?? ""}`);
  lines.push(`updated: ${article.updatedAt ?? ""}`);
  lines.push("---", "");

  if (article.summary) {
    lines.push("## Resumo", "");
    for (const l of article.summary.split("\n").filter(Boolean)) {
      lines.push(l.startsWith("•") ? l.replace(/^•\s*/, "- ") : `- ${l}`);
    }
    lines.push("");
  }

  if (article.content) {
    lines.push("## Conteúdo", "");
    // Artigos manuais já são Markdown; os demais são HTML e precisam de conversão
    lines.push(article.source === "manual" ? article.content : htmlToMarkdown(article.content));
    lines.push("");
  }

  if (article.links?.length) {
    lines.push("## Conceitos vinculados", "");
    for (const link of article.links) {
      lines.push(`- [[${safeFilename(link.targetTitle)}]] — "${link.anchorText}"`);
    }
    lines.push("");
  }

  if (article.excerpts?.length) {
    lines.push("## Trechos salvos", "");
    /** @type {Record<string, string>} */
    const CATEGORY_TAG = { concept: "conceito", list: "lista", numeric: "dados" };
    for (const ex of article.excerpts) {
      const kind = ex.kind ?? "text";
      const catTag = ex.category ? CATEGORY_TAG[ex.category] : undefined;   // undefined para "default"/ausente
      if (kind === "image") {
        const assetPath = imageAssetPaths.get(ex.id);
        lines.push(assetPath ? `![${ex.plainText || "imagem"}](${assetPath})` : "_(imagem não exportada)_");
        lines.push(`— de [[${safeFilename(ex.sourceArticleTitle)}]]`, "");
      } else if (kind === "table") {
        // Edição célula a célula sobrescreve a captura original
        lines.push(ex.editedMarkdown ?? ex.plainText);
        lines.push(`\n— de [[${safeFilename(ex.sourceArticleTitle)}]]${catTag ? ` #${catTag}` : ""}`, "");
      } else {
        // Trecho editado: exporta o markdown editado (com == e negrito); os
        // marcadores "(...)"/itálico de edição são markdown válido
        const body = ex.editedMarkdown ?? ex.plainText;
        for (const line of body.split("\n")) lines.push(`> ${line}`);
        lines.push(`> — de [[${safeFilename(ex.sourceArticleTitle)}]]${catTag ? ` #${catTag}` : ""}`, "");
      }
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

module.exports = {
  HISTORY_MAX_ENTRIES, MAX_ATTACHMENT_BYTES, TRASH_MAX_AGE_MS,
  createListingCache, normalizeArticle, sortByUpdatedDesc, isTrashExpired, slugify,
  hasContentChanged, pushHistorySnapshot,
  sanitizeExcerptHtml, htmlToPlainText, decodeEntities, htmlToMarkdown, htmlTableToMarkdown,
  prepareExcerpt, buildImageExcerptHtml, createNotesArticle, isDuplicateExcerpt,
  removeExcerptFromArticle, removeLinksTo, hasLink,
  trashItemFromRaw, sortTrashItems,
  safeFilename, extFromMime, csvEscape, articleToMarkdown,
};
