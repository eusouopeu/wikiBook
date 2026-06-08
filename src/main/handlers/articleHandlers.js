// ─────────────────────────────────────────────────────────────────────────────
// src/main/handlers/articleHandlers.js
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require("electron");
const fs      = require("fs");
const path    = require("path");
const crypto  = require("crypto");

const DATA_DIR = path.join(app.getPath("userData"), "articles");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function articlePath(id) { return path.join(DATA_DIR, `${id}.json`); }

function readArticle(id) {
  const p = articlePath(id);
  if (!fs.existsSync(p)) return null;
  try {
    const art = JSON.parse(fs.readFileSync(p, "utf8"));
    art.excerpts = art.excerpts ?? [];
    art.links    = art.links    ?? [];
    return art;
  } catch { return null; }
}

function writeArticle(article) {
  ensureDataDir();
  const p   = articlePath(article.id);
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(article, null, 2), "utf8");
  fs.renameSync(tmp, p);
}

function slugify(title) {
  const base = title.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return `${base}-${crypto.randomBytes(2).toString("hex")}`;
}

// ── Sanitiza HTML de um trecho mantendo formatação, removendo hrefs ───────────
// Recebe HTML bruto da seleção (pode conter <a href>, <b>, <i>, <sup>, etc.)
// Devolve HTML limpo: <a> → <span class="wiki-term">, hrefs removidos
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
function htmlToPlainText(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// ─────────────────────────────────────────────────────────────────────────────

function createArticleHandlers(ipcMain) {

  ipcMain.handle("article:list", () => {
    ensureDataDir();
    try {
      const articles = fs.readdirSync(DATA_DIR)
        .filter(f => f.endsWith(".json"))
        .map(f => readArticle(f.replace(".json", "")))
        .filter(Boolean)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return { ok: true, data: articles };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle("article:get", (_evt, { id }) => {
    const article = readArticle(id);
    if (!article) return { ok: false, error: `Artigo "${id}" não encontrado.` };
    return { ok: true, data: article };
  });

  ipcMain.handle("article:save", (_evt, { article }) => {
    try {
      const now = new Date().toISOString();
      if (!article.id) {
        article.id       = slugify(article.title);
        article.createdAt = now;
        article.links    = article.links    ?? [];
        article.excerpts = article.excerpts ?? [];
      }
      article.updatedAt = now;
      writeArticle(article);
      return { ok: true, data: article };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle("article:delete", (_evt, { id }) => {
    try {
      const p = articlePath(id);
      if (fs.existsSync(p)) fs.unlinkSync(p);
      ensureDataDir();
      fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".json")).forEach(f => {
        const art = readArticle(f.replace(".json", ""));
        if (!art) return;
        const before = art.links.length;
        art.links = art.links.filter(l => l.targetId !== id);
        if (art.links.length !== before) writeArticle(art);
      });
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle("article:addLink", (_evt, { parentId, anchorText, targetId, targetTitle }) => {
    try {
      const parent = readArticle(parentId);
      if (!parent) return { ok: false, error: "Artigo-pai não encontrado." };
      const already = parent.links.some(
        l => l.targetId === targetId && l.anchorText === anchorText
      );
      if (already) return { ok: true, data: parent };
      parent.links.push({ id: crypto.randomUUID(), anchorText, targetId, targetTitle,
                          createdAt: new Date().toISOString() });
      parent.updatedAt = new Date().toISOString();
      writeArticle(parent);
      return { ok: true, data: parent };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle("article:removeLink", (_evt, { parentId, linkId }) => {
    try {
      const parent = readArticle(parentId);
      if (!parent) return { ok: false, error: "Artigo-pai não encontrado." };
      parent.links = parent.links.filter(l => l.id !== linkId);
      parent.updatedAt = new Date().toISOString();
      writeArticle(parent);
      return { ok: true, data: parent };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ── article:appendExcerpt ────────────────────────────────────────────────────
  // html: fragmento HTML bruto da seleção (vem do renderer via Selection API)
  // O handler sanitiza e armazena html + plainText derivado
  ipcMain.handle("article:appendExcerpt", (_evt, {
    targetId, targetTitle, html, sourceArticleId, sourceArticleTitle
  }) => {
    try {
      const now        = new Date().toISOString();
      const cleanHtml  = sanitizeExcerptHtml(html);
      const plainText  = htmlToPlainText(cleanHtml);

      let target = targetId ? readArticle(targetId) : null;
      if (!target) {
        target = {
          id: slugify(targetTitle || "notas-pessoais"),
          title: targetTitle || "Notas pessoais",
          source: "manual",
          content: "", summary: "", links: [], excerpts: [],
          createdAt: now, updatedAt: now,
        };
      }
      target.excerpts = target.excerpts ?? [];

      // Deduplicação por texto puro
      const alreadyExists = target.excerpts.some(
        e => e.plainText === plainText && e.sourceArticleId === sourceArticleId
      );
      if (alreadyExists) return { ok: true, data: target };

      target.excerpts.push({
        id: crypto.randomUUID(),
        html: cleanHtml,
        plainText,
        sourceArticleId,
        sourceArticleTitle,
        savedAt: now,
      });
      target.updatedAt = now;
      writeArticle(target);
      return { ok: true, data: target };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle("article:removeExcerpt", (_evt, { targetId, excerptId }) => {
    try {
      const target = readArticle(targetId);
      if (!target) return { ok: false, error: "Artigo não encontrado." };
      target.excerpts = (target.excerpts ?? []).filter(e => e.id !== excerptId);
      target.updatedAt = new Date().toISOString();
      writeArticle(target);
      return { ok: true, data: target };
    } catch (e) { return { ok: false, error: e.message }; }
  });
}

module.exports = { createArticleHandlers };
