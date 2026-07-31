// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/platform/articles.ts
// Porta de packages/desktop/src/main/handlers/articleHandlers.js para
// @capacitor/filesystem — mesma modelagem (um JSON por artigo, em Directory.Data).
// CRUD de artigos + excerpts/imagens. Exportação (Markdown/CSV) fica para a
// fase de Filesystem+Share; flashcards ficam para platform/flashcards.ts
// (fase própria, algoritmo SM-2 + parser ainda não portado).
// ─────────────────────────────────────────────────────────────────────────────

import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { CapacitorHttp } from "@capacitor/core";
import type { Article, ArticleExcerpt, ExcerptOutlineItem } from "@lexicon/shared";

const ARTICLES_DIR = "articles";

async function ensureDir() {
  try {
    await Filesystem.mkdir({ path: ARTICLES_DIR, directory: Directory.Data, recursive: true });
  } catch {
    // já existe
  }
}

function articlePath(id: string) {
  return `${ARTICLES_DIR}/${id}.json`;
}

async function readArticle(id: string): Promise<Article | null> {
  try {
    const res = await Filesystem.readFile({
      path: articlePath(id), directory: Directory.Data, encoding: Encoding.UTF8,
    });
    const article = JSON.parse(res.data as string) as Article;
    article.excerpts = article.excerpts ?? [];
    article.links = article.links ?? [];
    article.tags = article.tags ?? [];
    return article;
  } catch {
    return null;
  }
}

async function writeArticle(article: Article) {
  await ensureDir();
  await Filesystem.writeFile({
    path: articlePath(article.id),
    data: JSON.stringify(article, null, 2),
    directory: Directory.Data,
    encoding: Encoding.UTF8,
  });
}

async function listAllArticles(): Promise<Article[]> {
  await ensureDir();
  let entries;
  try {
    entries = await Filesystem.readdir({ path: ARTICLES_DIR, directory: Directory.Data });
  } catch {
    return [];
  }
  const ids = entries.files
    .map(f => f.name)
    .filter(name => name.endsWith(".json"))
    .map(name => name.replace(/\.json$/, ""));
  const articles = await Promise.all(ids.map(readArticle));
  return articles.filter((a): a is Article => a !== null);
}

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    .slice(0, 60);
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 4);
  return `${base}-${rand}`;
}

// ─────────────────────────────────────────────────────────────────────────────

export async function listArticles(): Promise<Article[]> {
  return (await listAllArticles()).sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export async function getArticle(id: string): Promise<Article> {
  const article = await readArticle(id);
  if (!article) throw new Error(`Artigo "${id}" não encontrado.`);
  return article;
}

export async function saveArticle(partial: Partial<Article> & { title: string }): Promise<Article> {
  const now = new Date().toISOString();
  const article = { ...partial } as Article;
  if (!article.id) {
    article.id = slugify(article.title);
    article.createdAt = now;
    article.links = article.links ?? [];
    article.excerpts = article.excerpts ?? [];
  }
  article.tags = article.tags ?? [];
  article.updatedAt = now;
  await writeArticle(article);
  return article;
}

export async function deleteArticle(id: string): Promise<void> {
  try {
    await Filesystem.deleteFile({ path: articlePath(id), directory: Directory.Data });
  } catch {
    // já não existia
  }
  // Remove referências ao artigo excluído nos artigos-pai
  for (const art of await listAllArticles()) {
    const before = art.links.length;
    art.links = art.links.filter(l => l.targetId !== id);
    if (art.links.length !== before) await writeArticle(art);
  }
  // TODO(flashcards): quando platform/flashcards.ts existir, remover também
  // flashcards/<id>.json aqui — mesma limpeza que articleHandlers.js faz hoje.
}

export async function addLink(
  parentId: string, anchorText: string, targetId: string, targetTitle: string
): Promise<Article> {
  const parent = await readArticle(parentId);
  if (!parent) throw new Error("Artigo-pai não encontrado.");
  const already = parent.links.some(l => l.targetId === targetId && l.anchorText === anchorText);
  if (already) return parent;
  parent.links.push({
    id: crypto.randomUUID(), anchorText, targetId, targetTitle,
    createdAt: new Date().toISOString(),
  });
  parent.updatedAt = new Date().toISOString();
  await writeArticle(parent);
  return parent;
}

export async function removeLink(parentId: string, linkId: string): Promise<Article> {
  const parent = await readArticle(parentId);
  if (!parent) throw new Error("Artigo-pai não encontrado.");
  parent.links = parent.links.filter(l => l.id !== linkId);
  parent.updatedAt = new Date().toISOString();
  await writeArticle(parent);
  return parent;
}

// ─────────────────────────────────────────────────────────────────────────────
// Excerpts — sanitização de HTML/tabela é regex puro, copiado sem alteração
// de articleHandlers.js (só os helpers de fs/http mudam).
// ─────────────────────────────────────────────────────────────────────────────

function sanitizeExcerptHtml(html: string): string {
  return html
    .replace(/\s+href="[^"]*"/g, "")
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '<span class="wiki-term">$1</span>')
    .replace(/\s+style="[^"]*"/g, "")
    .replace(/\s+class="(?:mw-[^"]*|reference[^"]*)"/g, "")
    .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, "")
    .trim();
}

function htmlToPlainText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function htmlTableToMarkdown(html: string): string {
  const rows: string[][] = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const cells: string[] = [];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      const text = decodeEntities(cellMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
      cells.push(text.replace(/\|/g, "\\|"));
    }
    if (cells.length) rows.push(cells);
  }
  if (rows.length === 0) return "(tabela vazia)";

  const colCount = Math.max(...rows.map(r => r.length));
  const pad = (r: string[]) => { const copy = [...r]; while (copy.length < colCount) copy.push(""); return copy; };
  const toLine = (r: string[]) => `| ${pad(r).join(" | ")} |`;

  const header = toLine(rows[0]);
  const separator = `| ${Array(colCount).fill("---").join(" | ")} |`;
  const body = rows.slice(1).map(toLine);
  return [header, separator, ...body].join("\n");
}

// Conversão pragmática HTML → Markdown, usada pelo gerador de flashcards
// (platform/flashcards.ts) para reprocessar excerpts salvos como HTML.
export function htmlToMarkdown(html: string): string {
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
  md = md.replace(/<[^>]+>/g, "");
  md = decodeEntities(md);
  md = md.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return md.trim();
}

interface AppendExcerptArgs {
  targetId?: string | null; targetTitle?: string;
  html: string; kind?: "text" | "table"; category?: ArticleExcerpt["category"];
  sourceArticleId: string; sourceArticleTitle: string;
}

export async function appendExcerpt(args: AppendExcerptArgs): Promise<Article> {
  const { targetId, targetTitle, html, kind = "text", category = "default", sourceArticleId, sourceArticleTitle } = args;
  const now = new Date().toISOString();
  const cleanHtml = sanitizeExcerptHtml(html);
  const plainText = kind === "table" ? htmlTableToMarkdown(cleanHtml) : htmlToPlainText(cleanHtml);

  let target = targetId ? await readArticle(targetId) : null;
  if (!target) {
    target = {
      id: slugify(targetTitle || "notas-pessoais"),
      title: targetTitle || "Notas pessoais",
      source: "manual",
      content: "", summary: "", links: [], excerpts: [], tags: [],
      createdAt: now, updatedAt: now,
    };
  }
  target.excerpts = target.excerpts ?? [];

  const alreadyExists = target.excerpts.some(e => e.plainText === plainText && e.sourceArticleId === sourceArticleId);
  if (alreadyExists) return target;

  target.excerpts.push({
    id: crypto.randomUUID(), kind, category, html: cleanHtml, plainText,
    sourceArticleId, sourceArticleTitle, savedAt: now,
  });
  target.updatedAt = now;
  await writeArticle(target);
  return target;
}

interface AppendImageArgs {
  targetId?: string | null; targetTitle?: string;
  src: string; alt?: string;
  sourceArticleId: string; sourceArticleTitle: string;
}

function getHeader(headers: Record<string, string> | undefined, name: string): string {
  if (!headers) return "";
  const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : "";
}

// Baixa a imagem do src original e embute como data URI, igual ao desktop —
// a nota fica independente do artigo de origem. CapacitorHttp com
// responseType "blob" devolve base64 SEM o prefixo "data:mime;base64,";
// remontamos usando o content-type da resposta.
export async function appendImage(args: AppendImageArgs): Promise<Article> {
  const { targetId, targetTitle, src, alt = "", sourceArticleId, sourceArticleTitle } = args;
  if (!/^https?:\/\//i.test(src)) throw new Error("URL de imagem inválida.");

  const res = await CapacitorHttp.get({ url: src, responseType: "blob" });
  if (res.status !== 200) throw new Error(`Download da imagem retornou status ${res.status}.`);
  const contentType = getHeader(res.headers, "content-type");
  const mime = contentType.split(";")[0].trim();
  if (!mime.startsWith("image/")) {
    throw new Error(`URL não aponta para uma imagem (recebido: ${mime || "desconhecido"}).`);
  }

  const now = new Date().toISOString();
  const dataUri = `data:${mime};base64,${res.data}`;
  const safeAlt = alt.replace(/"/g, "&quot;");
  const html = `<img src="${dataUri}" alt="${safeAlt}">`;
  const plainText = alt || "Imagem salva";

  let target = targetId ? await readArticle(targetId) : null;
  if (!target) {
    target = {
      id: slugify(targetTitle || "notas-pessoais"),
      title: targetTitle || "Notas pessoais",
      source: "manual",
      content: "", summary: "", links: [], excerpts: [], tags: [],
      createdAt: now, updatedAt: now,
    };
  }
  target.excerpts = target.excerpts ?? [];

  const alreadyExists = target.excerpts.some(
    e => e.kind === "image" && e.sourceArticleId === sourceArticleId && e.plainText === plainText
  );
  if (alreadyExists) return target;

  target.excerpts.push({
    id: crypto.randomUUID(), kind: "image", html, plainText,
    sourceArticleId, sourceArticleTitle, savedAt: now,
  });
  target.updatedAt = now;
  await writeArticle(target);
  return target;
}

export async function removeExcerpt(targetId: string, excerptId: string): Promise<Article> {
  const target = await readArticle(targetId);
  if (!target) throw new Error("Artigo não encontrado.");
  target.excerpts = (target.excerpts ?? []).filter(e => e.id !== excerptId);
  if (target.excerptOutline) {
    target.excerptOutline = target.excerptOutline.filter(item => !(item.type === "excerpt" && item.id === excerptId));
  }
  target.updatedAt = new Date().toISOString();
  await writeArticle(target);
  return target;
}

export async function updateExcerpt(articleId: string, excerptId: string, editedMarkdown: string): Promise<Article> {
  const article = await readArticle(articleId);
  if (!article) throw new Error("Artigo não encontrado.");
  const excerpt = (article.excerpts ?? []).find(e => e.id === excerptId);
  if (!excerpt) throw new Error("Trecho não encontrado.");
  excerpt.editedMarkdown = editedMarkdown;
  excerpt.updatedAt = new Date().toISOString();
  article.updatedAt = excerpt.updatedAt;
  await writeArticle(article);
  return article;
}

export async function updateExcerptOutline(articleId: string, outline: ExcerptOutlineItem[]): Promise<Article> {
  const article = await readArticle(articleId);
  if (!article) throw new Error("Artigo não encontrado.");
  article.excerptOutline = outline;
  article.updatedAt = new Date().toISOString();
  await writeArticle(article);
  return article;
}
