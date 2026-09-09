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
import type { Article, ArticleAttachment, ArticleExcerpt, ArticleHistoryEntry, ExcerptOutlineItem } from "@lexicon/shared";

const ARTICLES_DIR = "articles";
const TRASH_DIR = `${ARTICLES_DIR}/.trash`;
const HISTORY_DIR = `${ARTICLES_DIR}/.history`;
const HISTORY_MAX_ENTRIES = 20;
const ATTACHMENTS_DIR = "attachments";
// Mesmo limite do desktop (ver articleHandlers.js/MAX_ATTACHMENT_BYTES)
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

async function ensureDir() {
  try {
    await Filesystem.mkdir({ path: ARTICLES_DIR, directory: Directory.Data, recursive: true });
  } catch {
    // já existe
  }
}

async function ensureTrashDir() {
  try {
    await Filesystem.mkdir({ path: TRASH_DIR, directory: Directory.Data, recursive: true });
  } catch {
    // já existe
  }
}

function articlePath(id: string) {
  return `${ARTICLES_DIR}/${id}.json`;
}

function trashPath(id: string) {
  return `${TRASH_DIR}/${id}.json`;
}

function historyPath(id: string) {
  return `${HISTORY_DIR}/${id}.json`;
}

async function ensureHistoryDir() {
  try {
    await Filesystem.mkdir({ path: HISTORY_DIR, directory: Directory.Data, recursive: true });
  } catch {
    // já existe
  }
}

async function readHistory(id: string): Promise<ArticleHistoryEntry[]> {
  try {
    const res = await Filesystem.readFile({
      path: historyPath(id), directory: Directory.Data, encoding: Encoding.UTF8,
    });
    return JSON.parse(res.data as string) as ArticleHistoryEntry[];
  } catch {
    return [];
  }
}

async function writeHistory(id: string, entries: ArticleHistoryEntry[]) {
  await ensureHistoryDir();
  await Filesystem.writeFile({
    path: historyPath(id), data: JSON.stringify(entries, null, 2),
    directory: Directory.Data, encoding: Encoding.UTF8,
  });
}

// Snapshot da versão ANTERIOR à escrita — só quando title/summary/content de
// fato mudaram, para não acumular entradas idênticas a cada "Salvar" sem
// edição real.
// ── Anexos (imagem/PDF) de um artigo ────────────────────────────────────────
// Mesma modelagem do desktop: só metadados no JSON do artigo, conteúdo
// binário em arquivo próprio (attachments/<articleId>/<attachmentId>-<nome>).
function safeAttachmentName(name: string): string {
  return name.replace(/[/\\:*?"<>|#^[\]]/g, "-").trim().slice(0, 120) || "arquivo";
}
function attachmentDirPath(articleId: string) {
  return `${ATTACHMENTS_DIR}/${articleId}`;
}
function attachmentFilePath(articleId: string, attachmentId: string, name: string) {
  return `${attachmentDirPath(articleId)}/${attachmentId}-${safeAttachmentName(name)}`;
}
async function ensureAttachmentDir(articleId: string) {
  try {
    await Filesystem.mkdir({ path: attachmentDirPath(articleId), directory: Directory.Data, recursive: true });
  } catch {
    // já existe
  }
}

export async function snapshotBeforeSave(oldArticle: Article) {
  const entries = await readHistory(oldArticle.id);
  entries.unshift({
    title: oldArticle.title, content: oldArticle.content,
    summary: oldArticle.summary, updatedAt: oldArticle.updatedAt,
  });
  await writeHistory(oldArticle.id, entries.slice(0, HISTORY_MAX_ENTRIES));
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

// Exportado para platform/sync.ts — grava um Article vindo do servidor tal
// como está (sem carimbar updatedAt/gerar id, diferente de saveArticle) E
// invalida o cache em memória, ao contrário de escrever o arquivo por fora.
export async function writeArticleRaw(article: Article): Promise<void> {
  await writeArticle(article);
}

async function writeArticle(article: Article) {
  await ensureDir();
  await Filesystem.writeFile({
    path: articlePath(article.id),
    data: JSON.stringify(article, null, 2),
    directory: Directory.Data,
    encoding: Encoding.UTF8,
  });
  invalidateArticlesCache();
  // Import tardio: mdSync.ts importa listArticles deste módulo (ciclo).
  // writeArticle é o único ponto de escrita (save, links, trechos, anexos,
  // reversão de versão) — logo o único ponto que precisa do hook.
  try {
    const { syncArticleFile } = await import("./mdSync");
    await syncArticleFile(article);
  } catch { /* sync desligado ou indisponível */ }
}

// Cache em memória da listagem completa — evita reler e reparsear TODOS os
// JSONs a cada article:list. Invalidado (não atualizado incrementalmente) em
// toda escrita — writeArticle() já cobre a maioria; delete/restore, que usam
// Filesystem.rename direto sem passar por writeArticle, invalidam explicitamente.
let articlesCache: Article[] | null = null;
function invalidateArticlesCache() { articlesCache = null; }

const TRASH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;   // 30 dias
let trashPurged = false;

// Limpeza oportunista de itens da lixeira com mais de 30 dias — roda no
// máximo uma vez por sessão do app (chamada de dentro de listAllArticles)
async function purgeOldTrashOnce() {
  if (trashPurged) return;
  trashPurged = true;
  try {
    await ensureTrashDir();
    const { files } = await Filesystem.readdir({ path: TRASH_DIR, directory: Directory.Data });
    const now = Date.now();
    for (const f of files) {
      if (!f.name.endsWith(".json")) continue;
      if (now - f.mtime > TRASH_MAX_AGE_MS) {
        await Filesystem.deleteFile({ path: `${TRASH_DIR}/${f.name}`, directory: Directory.Data });
        try {
          await Filesystem.deleteFile({ path: `${HISTORY_DIR}/${f.name}`, directory: Directory.Data });
        } catch { /* pode não ter histórico */ }
        try {
          await Filesystem.rmdir({
            path: attachmentDirPath(f.name.replace(/\.json$/, "")), directory: Directory.Data, recursive: true,
          });
        } catch { /* pode não ter anexos */ }
      }
    }
  } catch {
    // limpeza é best-effort — nunca deve quebrar o bootstrap
  }
}

async function listAllArticles(): Promise<Article[]> {
  await ensureDir();
  await purgeOldTrashOnce();
  if (articlesCache) return articlesCache;
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
  articlesCache = articles.filter((a): a is Article => a !== null);
  return articlesCache;
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
  } else {
    const previous = await readArticle(article.id);
    if (previous && (
      previous.title !== article.title ||
      previous.summary !== article.summary ||
      previous.content !== article.content
    )) {
      await snapshotBeforeSave(previous);
    }
  }
  article.tags = article.tags ?? [];
  article.updatedAt = now;
  await writeArticle(article);
  return article;
}

export async function getArticleHistory(id: string): Promise<ArticleHistoryEntry[]> {
  return readHistory(id);
}

export async function revertArticleVersion(id: string, updatedAt: string): Promise<Article> {
  const article = await readArticle(id);
  if (!article) throw new Error(`Artigo "${id}" não encontrado.`);
  const entries = await readHistory(id);
  const snapshot = entries.find(e => e.updatedAt === updatedAt);
  if (!snapshot) throw new Error("Versão não encontrada no histórico.");

  await snapshotBeforeSave(article);
  article.title = snapshot.title;
  article.summary = snapshot.summary;
  article.content = snapshot.content;
  article.updatedAt = new Date().toISOString();
  await writeArticle(article);
  return article;
}

export async function addAttachment(
  articleId: string, name: string, mimeType: string, dataBase64: string
): Promise<Article> {
  const article = await readArticle(articleId);
  if (!article) throw new Error(`Artigo "${articleId}" não encontrado.`);

  // Tamanho aproximado do binário original a partir do base64 (3/4 do
  // comprimento da string, descontando padding) — mesmo limite do desktop.
  const approxBytes = Math.floor((dataBase64.length * 3) / 4);
  if (approxBytes > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Anexo maior que ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB.`);
  }

  const id = crypto.randomUUID();
  await ensureAttachmentDir(articleId);
  await Filesystem.writeFile({
    path: attachmentFilePath(articleId, id, name), data: dataBase64, directory: Directory.Data,
  });

  const attachment: ArticleAttachment = {
    id, name, mimeType, size: approxBytes, createdAt: new Date().toISOString(),
  };
  article.attachments = [...(article.attachments ?? []), attachment];
  article.updatedAt = attachment.createdAt;
  await writeArticle(article);
  return article;
}

export async function removeAttachment(articleId: string, attachmentId: string): Promise<Article> {
  const article = await readArticle(articleId);
  if (!article) throw new Error(`Artigo "${articleId}" não encontrado.`);
  const attachment = (article.attachments ?? []).find(a => a.id === attachmentId);
  if (attachment) {
    try {
      await Filesystem.deleteFile({
        path: attachmentFilePath(articleId, attachment.id, attachment.name), directory: Directory.Data,
      });
    } catch {
      // arquivo já pode não existir — segue removendo os metadados
    }
  }
  article.attachments = (article.attachments ?? []).filter(a => a.id !== attachmentId);
  article.updatedAt = new Date().toISOString();
  await writeArticle(article);
  return article;
}

// Lê o anexo de volta como base64, para preview inline ou share sheet — não
// há "salvar em pasta" no mobile, o destino final é decidido no share nativo.
export async function readAttachmentData(articleId: string, attachmentId: string): Promise<{ dataBase64: string; mimeType: string; name: string }> {
  const article = await readArticle(articleId);
  const attachment = article && (article.attachments ?? []).find(a => a.id === attachmentId);
  if (!attachment) throw new Error("Anexo não encontrado.");
  const res = await Filesystem.readFile({
    path: attachmentFilePath(articleId, attachment.id, attachment.name), directory: Directory.Data,
  });
  return { dataBase64: res.data as string, mimeType: attachment.mimeType, name: attachment.name };
}

// Move (não apaga) o artigo para articles/.trash/ — permite desfazer via
// restoreArticle. Links de outros artigos que apontavam para ele são
// removidos normalmente (o store guarda essa informação antes de chamar isto,
// e reaplica via addLink no "Desfazer").
export async function deleteArticle(id: string): Promise<void> {
  try {
    await ensureTrashDir();
    await Filesystem.rename({ from: articlePath(id), to: trashPath(id), directory: Directory.Data });
    invalidateArticlesCache();
  } catch {
    // já não existia
  }
  try {
    const { removeArticleFile } = await import("./mdSync");
    await removeArticleFile(id);
  } catch { /* sync desligado ou indisponível */ }
  // Remove referências ao artigo excluído nos artigos-pai
  for (const art of await listAllArticles()) {
    const before = art.links.length;
    art.links = art.links.filter(l => l.targetId !== id);
    if (art.links.length !== before) await writeArticle(art);
  }
}

// Desfaz uma exclusão recente — devolve o JSON de articles/.trash/ para a
// posição original. Links removidos de outros artigos são reaplicados pelo
// caller (store.deleteArticle guarda o que precisa antes de deletar).
export async function restoreArticle(id: string): Promise<Article> {
  await ensureDir();
  try {
    await Filesystem.rename({ from: trashPath(id), to: articlePath(id), directory: Directory.Data });
    invalidateArticlesCache();
  } catch {
    throw new Error("Artigo não encontrado na lixeira (pode já ter sido limpo).");
  }
  const restored = await getArticle(id);
  try {
    const { syncArticleFile } = await import("./mdSync");
    await syncArticleFile(restored);
  } catch { /* sync desligado ou indisponível */ }
  return restored;
}

// Metadados leves dos artigos na lixeira — mesma ideia do desktop
// (article:listTrash em articleHandlers.js): a única porta de entrada pra
// restaurar era o "Desfazer" do toast (~5s); depois disso o artigo ficava
// até 30 dias em disco sem nenhuma tela para vê-lo.
export async function listTrash(): Promise<Array<{ id: string; title: string; source: Article["source"]; deletedAt: string }>> {
  await ensureTrashDir();
  let files;
  try {
    ({ files } = await Filesystem.readdir({ path: TRASH_DIR, directory: Directory.Data }));
  } catch {
    return [];
  }
  const items = await Promise.all(
    files.filter(f => f.name.endsWith(".json")).map(async f => {
      try {
        const res = await Filesystem.readFile({
          path: `${TRASH_DIR}/${f.name}`, directory: Directory.Data, encoding: Encoding.UTF8,
        });
        const raw = JSON.parse(res.data as string);
        return { id: raw.id as string, title: raw.title as string, source: raw.source as Article["source"], deletedAt: new Date(f.mtime).toISOString() };
      } catch {
        return null;
      }
    })
  );
  return items
    .filter((i): i is NonNullable<typeof i> => i !== null)
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

// Remove em definitivo um artigo da lixeira (arquivo + histórico + anexos).
// Flashcards ficam a cargo do caller (bridge.ts), igual a delete/restore.
export async function purgeArticle(id: string): Promise<void> {
  try { await Filesystem.deleteFile({ path: trashPath(id), directory: Directory.Data }); } catch { /* já não existia */ }
  try { await Filesystem.deleteFile({ path: historyPath(id), directory: Directory.Data }); } catch { /* sem histórico */ }
  try {
    await Filesystem.rmdir({ path: attachmentDirPath(id), directory: Directory.Data, recursive: true });
  } catch { /* sem anexos */ }
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
