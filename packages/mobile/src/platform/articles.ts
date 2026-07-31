// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/platform/articles.ts
// Porta de packages/desktop/src/main/handlers/articleHandlers.js (CRUD) para
// @capacitor/filesystem — mesma modelagem (um JSON por artigo, em Directory.Data).
// Excerpts/imagens/exportação ficam para uma fase seguinte (exigem os mesmos
// helpers de sanitização de HTML do desktop, ainda não portados).
// ─────────────────────────────────────────────────────────────────────────────

import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import type { Article } from "@lexicon/shared";

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
