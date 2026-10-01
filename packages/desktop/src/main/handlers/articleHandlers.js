// ─────────────────────────────────────────────────────────────────────────────
// src/main/handlers/articleHandlers.js
// ─────────────────────────────────────────────────────────────────────────────

const { app, dialog } = require("electron");
const fs      = require("fs");
const path    = require("path");
const crypto  = require("crypto");
const https   = require("https");
const { URL } = require("url");
// Lógica pura (cache, normalização, histórico, trechos, HTML → Markdown, .md
// Obsidian) é compartilhada com o mobile — aqui fica só o I/O de arquivo.
const core = require("../../../../shared/lib/articleCore");
const {
  MAX_ATTACHMENT_BYTES, htmlToMarkdown, articleToMarkdown, safeFilename, extFromMime, csvEscape,
} = core;

const DATA_DIR = path.join(app.getPath("userData"), "articles");
const TRASH_DIR = path.join(DATA_DIR, ".trash");
const HISTORY_DIR = path.join(DATA_DIR, ".history");
const ATTACHMENTS_DIR = path.join(app.getPath("userData"), "attachments");
const FLASHCARDS_DIR = path.join(app.getPath("userData"), "flashcards");
const FLASHCARDS_TRASH_DIR = path.join(FLASHCARDS_DIR, ".trash");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function ensureTrashDir() {
  if (!fs.existsSync(TRASH_DIR)) fs.mkdirSync(TRASH_DIR, { recursive: true });
}
function articlePath(id) { return path.join(DATA_DIR, `${id}.json`); }
function trashPath(id)   { return path.join(TRASH_DIR, `${id}.json`); }
function historyPath(id) { return path.join(HISTORY_DIR, `${id}.json`); }

// ── Histórico de versões ───────────────────────────────────────────────────
// Guardado FORA do JSON do artigo (arquivo próprio em .history/) — o objeto
// de artigo já é enviado por inteiro em article:list a cada carregamento da
// biblioteca; embutir snapshots ali infla esse payload para toda a lista, não
// só para quem abre o histórico. Lido/escrito só sob demanda.
function readHistory(id) {
  try {
    const p = historyPath(id);
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch { return []; }
}
function writeHistory(id, entries) {
  if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
  const p = historyPath(id);
  fs.writeFileSync(p + ".tmp", JSON.stringify(entries, null, 2), "utf8");
  fs.renameSync(p + ".tmp", p);
}
// Snapshot da versão ANTERIOR à escrita — chamado de dentro de article:save
// só quando title/summary/content de fato mudaram, para não acumular uma
// entrada idêntica a cada clique em "Salvar" sem edição real.
function snapshotBeforeSave(oldArticle) {
  writeHistory(oldArticle.id, core.pushHistorySnapshot(readHistory(oldArticle.id), oldArticle));
}

// Limpeza oportunista de itens da lixeira com mais de 30 dias — roda no
// máximo uma vez por processo (chamada de dentro de listAllArticles)
let trashPurged = false;
function purgeOldTrashOnce() {
  if (trashPurged) return;
  trashPurged = true;
  try {
    ensureTrashDir();
    const now = Date.now();
    for (const f of fs.readdirSync(TRASH_DIR)) {
      if (!f.endsWith(".json")) continue;
      const p = path.join(TRASH_DIR, f);
      if (core.isTrashExpired(fs.statSync(p).mtimeMs, now)) {
        fs.unlinkSync(p);
        const hp = path.join(HISTORY_DIR, f);
        if (fs.existsSync(hp)) fs.unlinkSync(hp);
        const attDir = attachmentDir(f.replace(".json", ""));
        if (fs.existsSync(attDir)) fs.rmSync(attDir, { recursive: true, force: true });
      }
    }
  } catch { /* limpeza é best-effort — nunca deve quebrar o bootstrap */ }
}

function readArticle(id) {
  const p = articlePath(id);
  if (!fs.existsSync(p)) return null;
  try {
    return core.normalizeArticle(JSON.parse(fs.readFileSync(p, "utf8")));
  } catch { return null; }
}

function writeArticle(article) {
  ensureDataDir();
  const p   = articlePath(article.id);
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(article, null, 2), "utf8");
  fs.renameSync(tmp, p);
  invalidateArticlesCache();
  // Require tardio: mdSyncHandlers.js importa articleToMarkdown/safeFilename/
  // etc. deste módulo, então um require no topo do arquivo criaria dependência
  // circular. writeArticle é o único choque de escrita (save, links, trechos,
  // anexos, reversão de versão) — logo o único ponto que precisa do hook.
  try { require("./mdSyncHandlers").syncArticleFile(article); } catch { /* pasta de sync não configurada ou indisponível */ }
}

// Cache em memória da listagem completa — evita reler e reparsear TODOS os
// JSONs do disco a cada article:list (bloqueava o main process do Electron
// de forma síncrona). Invalidado (não atualizado incrementalmente) em toda
// escrita — writeArticle() já cobre a maioria; delete/restore, que fazem
// rename direto sem passar por writeArticle, invalidam explicitamente.
const articlesCache = core.createListingCache();
function invalidateArticlesCache() { articlesCache.invalidate(); }

// Lê todos os artigos do disco — usado por list/export/flashcards
function listAllArticles() {
  ensureDataDir();
  purgeOldTrashOnce();
  const cached = articlesCache.get();
  if (cached) return cached;
  return articlesCache.set(fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => readArticle(f.replace(".json", "")))
    .filter(Boolean));
}

// Sufixo aleatório do id (Node crypto) — o resto do slug é puro (articleCore)
function randomSlugSuffix() { return crypto.randomBytes(2).toString("hex"); }
function slugify(title) { return core.slugify(title, randomSlugSuffix()); }

// sanitizeExcerptHtml/htmlToPlainText/htmlToMarkdown/htmlTableToMarkdown,
// safeFilename/extFromMime/csvEscape e articleToMarkdown vivem em
// shared/lib/articleCore.js (mesma lógica do mobile).

// ── Download binário com redirecionamento e limite de tamanho ────────────────
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;   // 8MB — evita JSONs desproporcionais
const IMAGE_TIMEOUT_MS = 20_000;

function fetchBinary(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    if (redirectsLeft <= 0) return reject(new Error("Muitos redirecionamentos ao baixar a imagem."));
    let parsed;
    try { parsed = new URL(url); } catch { return reject(new Error("URL de imagem inválida.")); }

    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "GET",
      timeout: IMAGE_TIMEOUT_MS,
      headers: { "User-Agent": "Lexicon/1.0 (app pessoal)" },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return fetchBinary(next, redirectsLeft - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Download da imagem retornou status ${res.statusCode}.`));
      }
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > IMAGE_MAX_BYTES) {
          req.destroy(new Error(`Imagem excede o limite de ${IMAGE_MAX_BYTES / (1024 * 1024)}MB.`));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve({ buffer: Buffer.concat(chunks), contentType: res.headers["content-type"] || "" }));
    });
    req.on("timeout", () => req.destroy(new Error(`Tempo esgotado após ${IMAGE_TIMEOUT_MS / 1000}s ao baixar a imagem.`)));
    req.on("error", reject);
    req.end();
  });
}

// ── Extrai {mime, buffer} de uma data URI (para reexportar imagens salvas) ───
function dataUriToBuffer(dataUri) {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}

// ── Anexos (imagem/PDF) de um artigo ────────────────────────────────────────
// Guardados fora do JSON do artigo, um arquivo por anexo em
// attachments/<articleId>/<attachmentId>-<nome-seguro> — só metadados
// (id/name/mimeType/size/createdAt) ficam no objeto Article, pela mesma razão
// do histórico: não inflar article:list para toda a biblioteca com conteúdo
// binário de quem tem poucos anexos.
function attachmentDir(articleId) { return path.join(ATTACHMENTS_DIR, articleId); }
function ensureAttachmentDir(articleId) {
  const dir = attachmentDir(articleId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function storedAttachmentPath(articleId, attachmentId, name) {
  return path.join(attachmentDir(articleId), `${attachmentId}-${safeFilename(name)}`);
}

// ─────────────────────────────────────────────────────────────────────────────

function createArticleHandlers(ipcMain) {

  ipcMain.handle("article:list", () => {
    try {
      const articles = core.sortByUpdatedDesc(listAllArticles());
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
      } else {
        const previous = readArticle(article.id);
        if (previous && core.hasContentChanged(previous, article)) {
          snapshotBeforeSave(previous);
        }
      }
      article.tags      = article.tags ?? [];
      article.updatedAt = now;
      writeArticle(article);
      return { ok: true, data: article };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ── article:getHistory ──────────────────────────────────────────────────────
  ipcMain.handle("article:getHistory", (_evt, { id }) => {
    try {
      return { ok: true, data: readHistory(id) };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ── article:revertVersion ───────────────────────────────────────────────────
  // Restaura título/resumo/conteúdo de um snapshot do histórico. O estado atual
  // (antes de reverter) também vira um snapshot — reverter uma reversão
  // funciona do mesmo jeito, sem tratamento especial.
  ipcMain.handle("article:revertVersion", (_evt, { id, updatedAt }) => {
    try {
      const article = readArticle(id);
      if (!article) return { ok: false, error: "Artigo não encontrado." };
      const entries = readHistory(id);
      const snapshot = entries.find(e => e.updatedAt === updatedAt);
      if (!snapshot) return { ok: false, error: "Versão não encontrada no histórico." };

      snapshotBeforeSave(article);
      article.title   = snapshot.title;
      article.summary = snapshot.summary;
      article.content = snapshot.content;
      article.updatedAt = new Date().toISOString();
      writeArticle(article);
      return { ok: true, data: article };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Move (não apaga) o artigo para .trash/ — permite desfazer via article:restore.
  // Links de outros artigos que apontavam para ele são removidos normalmente
  // (o renderer já guarda essa informação antes de chamar este handler, e
  // reaplica via addLink no "Desfazer").
  ipcMain.handle("article:delete", (_evt, { id }) => {
    try {
      const p = articlePath(id);
      if (fs.existsSync(p)) {
        ensureTrashDir();
        fs.renameSync(p, trashPath(id));
        invalidateArticlesCache();
      }
      ensureDataDir();
      fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".json")).forEach(f => {
        const art = readArticle(f.replace(".json", ""));
        if (!art) return;
        if (core.removeLinksTo(art, id)) writeArticle(art);
      });
      // Move (não apaga) os flashcards órfãos deste artigo, para restaurar junto
      const flashcardsPath = path.join(FLASHCARDS_DIR, `${id}.json`);
      if (fs.existsSync(flashcardsPath)) {
        if (!fs.existsSync(FLASHCARDS_TRASH_DIR)) fs.mkdirSync(FLASHCARDS_TRASH_DIR, { recursive: true });
        fs.renameSync(flashcardsPath, path.join(FLASHCARDS_TRASH_DIR, `${id}.json`));
      }
      // Require tardio (não no topo do arquivo) para evitar dependência
      // circular — flashcardHandlers.js já requer articleHandlers.js.
      require("./flashcardHandlers").invalidateFlashcardsCache(id);
      try { require("./mdSyncHandlers").removeArticleFile(id); } catch { /* pasta de sync não configurada */ }
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ── article:restore ─────────────────────────────────────────────────────────
  // Desfaz uma exclusão recente: devolve o JSON (e os flashcards, se houver) de
  // .trash/ para a posição original. Links removidos de outros artigos NÃO são
  // restaurados aqui — o renderer reaplica via addLink com o que guardou antes
  // de deletar (ver Fase 4.1 do plano / store.deleteArticle).
  ipcMain.handle("article:restore", (_evt, { id }) => {
    try {
      const trashP = trashPath(id);
      if (!fs.existsSync(trashP)) {
        return { ok: false, error: "Artigo não encontrado na lixeira (pode já ter sido limpo)." };
      }
      ensureDataDir();
      fs.renameSync(trashP, articlePath(id));
      invalidateArticlesCache();
      const flashcardsTrashPath = path.join(FLASHCARDS_TRASH_DIR, `${id}.json`);
      if (fs.existsSync(flashcardsTrashPath)) {
        if (!fs.existsSync(FLASHCARDS_DIR)) fs.mkdirSync(FLASHCARDS_DIR, { recursive: true });
        fs.renameSync(flashcardsTrashPath, path.join(FLASHCARDS_DIR, `${id}.json`));
      }
      require("./flashcardHandlers").invalidateFlashcardsCache(id);
      const restored = readArticle(id);
      try { require("./mdSyncHandlers").syncArticleFile(restored); } catch { /* pasta de sync não configurada */ }
      return { ok: true, data: restored };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ── article:listTrash → artigos na lixeira (metadados leves) ────────────────
  // A única porta de entrada para restaurar era o "Desfazer" do toast, com
  // janela de ~5s — passado isso, o artigo ficava até 30 dias em disco sem
  // nenhuma tela para vê-lo. deletedAt vem do mtime do arquivo (o rename para
  // .trash/ atualiza mtime, sem precisar gravar o campo no próprio JSON).
  ipcMain.handle("article:listTrash", () => {
    try {
      ensureTrashDir();
      const items = fs.readdirSync(TRASH_DIR)
        .filter(f => f.endsWith(".json"))
        .map(f => {
          try {
            const raw = JSON.parse(fs.readFileSync(path.join(TRASH_DIR, f), "utf8"));
            const deletedAt = fs.statSync(path.join(TRASH_DIR, f)).mtime.toISOString();
            return core.trashItemFromRaw(raw, deletedAt);
          } catch { return null; }
        })
        .filter(Boolean);
      return { ok: true, data: core.sortTrashItems(items) };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ── article:purge { id } → remove em definitivo (lixeira, histórico, flashcards, anexos) ─
  ipcMain.handle("article:purge", (_evt, { id }) => {
    try {
      const trashP = trashPath(id);
      if (fs.existsSync(trashP)) fs.unlinkSync(trashP);
      const hp = historyPath(id);
      if (fs.existsSync(hp)) fs.unlinkSync(hp);
      const flashcardsTrashPath = path.join(FLASHCARDS_TRASH_DIR, `${id}.json`);
      if (fs.existsSync(flashcardsTrashPath)) fs.unlinkSync(flashcardsTrashPath);
      const attDir = attachmentDir(id);
      if (fs.existsSync(attDir)) fs.rmSync(attDir, { recursive: true, force: true });
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle("article:addLink", (_evt, { parentId, anchorText, targetId, targetTitle }) => {
    try {
      const parent = readArticle(parentId);
      if (!parent) return { ok: false, error: "Artigo-pai não encontrado." };
      if (core.hasLink(parent.links, targetId, anchorText)) return { ok: true, data: parent };
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
  // html: fragmento HTML bruto (seleção de texto ou outerHTML de uma <table>)
  // kind: "text" | "table" — determina como o plainText é derivado
  // category: cor de fundo semântica (default | concept | list | numeric)
  // O handler sanitiza e armazena html + plainText derivado
  ipcMain.handle("article:appendExcerpt", (_evt, {
    targetId, targetTitle, html, kind = "text", category = "default",
    sourceArticleId, sourceArticleTitle
  }) => {
    try {
      const now        = new Date().toISOString();
      const { cleanHtml, plainText } = core.prepareExcerpt(html, kind);

      const target = (targetId ? readArticle(targetId) : null) ?? core.createNotesArticle(targetTitle, now, randomSlugSuffix());
      target.excerpts = target.excerpts ?? [];

      // Deduplicação por texto puro
      if (core.isDuplicateExcerpt(target.excerpts, "text", plainText, sourceArticleId)) return { ok: true, data: target };

      target.excerpts.push({
        id: crypto.randomUUID(),
        kind,
        category,
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

  // ── article:appendImage ──────────────────────────────────────────────────────
  // Baixa a imagem do src original e embute como data URI — a nota fica
  // independente do artigo de origem (sobrevive mesmo que ele seja excluído).
  ipcMain.handle("article:appendImage", async (_evt, {
    targetId, targetTitle, src, alt = "", sourceArticleId, sourceArticleTitle
  }) => {
    try {
      if (!/^https?:\/\//i.test(src)) {
        return { ok: false, error: "URL de imagem inválida." };
      }
      const { buffer, contentType } = await fetchBinary(src);
      const mime = contentType.split(";")[0].trim();
      if (!mime.startsWith("image/")) {
        return { ok: false, error: `URL não aponta para uma imagem (recebido: ${mime || "desconhecido"}).` };
      }

      const now = new Date().toISOString();
      const { html, plainText } = core.buildImageExcerptHtml(mime, buffer.toString("base64"), alt);

      const target = (targetId ? readArticle(targetId) : null) ?? core.createNotesArticle(targetTitle, now, randomSlugSuffix());
      target.excerpts = target.excerpts ?? [];

      if (core.isDuplicateExcerpt(target.excerpts, "image", plainText, sourceArticleId)) return { ok: true, data: target };

      target.excerpts.push({
        id: crypto.randomUUID(), kind: "image", html, plainText,
        sourceArticleId, sourceArticleTitle, savedAt: now,
      });
      target.updatedAt = now;
      writeArticle(target);
      return { ok: true, data: target };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // article:exportMarkdown foi substituído pela sincronização automática em
  // mdSyncHandlers.js (ver createMdSyncHandlers) — toda escrita em
  // writeArticle() já mantém a pasta escolhida pelo usuário atualizada, sem
  // exportação manual.

  // ── article:exportFlashcardsCsv ─────────────────────────────────────────────
  // Exporta trechos de texto salvos como flashcards (Frente/Verso) num CSV
  // importável pelo Anki. Tabelas e imagens não viram flashcard de texto.
  // Roda o mesmo parser de flashcards (parseFlashcardsFromText) usado pela
  // revisão SM-2 dentro do app, para que o card exportado seja o mesmo que o
  // usuário revisa aqui — inclusive os grupos de cloze, já na sintaxe
  // {{c1::…}} que o Anki reconhece nativamente.
  ipcMain.handle("article:exportFlashcardsCsv", async () => {
    try {
      const { parseFlashcardsFromText, flattenDraftsForExport } = require("./flashcardHandlers");
      const articles = listAllArticles();
      const rows = [];
      for (const art of articles) {
        for (const ex of art.excerpts ?? []) {
          if ((ex.kind ?? "text") !== "text") continue;
          const md = ex.editedMarkdown ?? htmlToMarkdown(ex.html ?? "") ?? ex.plainText;
          if (!md) continue;
          const tag = `lexicon::${art.title}`.replace(/\s+/g, "_");
          for (const { front, back } of flattenDraftsForExport(parseFlashcardsFromText(md))) {
            if (front) rows.push([front, back, tag]);
          }
        }
      }
      if (rows.length === 0) return { ok: true, data: { count: 0 } };

      const result = await dialog.showSaveDialog({
        title: "Exportar flashcards para Anki",
        defaultPath: "lexicon-flashcards.csv",
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (result.canceled || !result.filePath) return { ok: true, data: null };

      const csv = rows.map(r => r.map(csvEscape).join(";")).join("\n") + "\n";
      fs.writeFileSync(result.filePath, csv, "utf8");
      return { ok: true, data: { count: rows.length, filePath: result.filePath } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle("article:removeExcerpt", (_evt, { targetId, excerptId }) => {
    try {
      const target = readArticle(targetId);
      if (!target) return { ok: false, error: "Artigo não encontrado." };
      // Mantém o outline consistente: remove a entrada correspondente, se houver
      core.removeExcerptFromArticle(target, excerptId);
      target.updatedAt = new Date().toISOString();
      writeArticle(target);
      return { ok: true, data: target };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ── article:updateExcerpt ────────────────────────────────────────────────────
  // Atualiza o markdown editado de um trecho "text" (editor de trechos).
  // editedMarkdown já vem pronto do renderer (com *inserções* em itálico e "(...)"
  // nas remoções) — este handler apenas persiste.
  ipcMain.handle("article:updateExcerpt", (_evt, { articleId, excerptId, editedMarkdown }) => {
    try {
      const article = readArticle(articleId);
      if (!article) return { ok: false, error: "Artigo não encontrado." };
      const excerpt = (article.excerpts ?? []).find(e => e.id === excerptId);
      if (!excerpt) return { ok: false, error: "Trecho não encontrado." };
      excerpt.editedMarkdown = editedMarkdown;
      excerpt.updatedAt = new Date().toISOString();
      article.updatedAt = excerpt.updatedAt;
      writeArticle(article);
      return { ok: true, data: article };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ── article:updateExcerptOutline ─────────────────────────────────────────────
  // Substitui a ordem/agrupamento de exibição dos trechos (após arraste ou
  // criação/remoção de heading).
  ipcMain.handle("article:updateExcerptOutline", (_evt, { articleId, outline }) => {
    try {
      const article = readArticle(articleId);
      if (!article) return { ok: false, error: "Artigo não encontrado." };
      article.excerptOutline = outline;
      article.updatedAt = new Date().toISOString();
      writeArticle(article);
      return { ok: true, data: article };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ── article:addAttachment { articleId, name, mimeType, dataBase64 } ────────
  ipcMain.handle("article:addAttachment", (_evt, { articleId, name, mimeType, dataBase64 }) => {
    try {
      const article = readArticle(articleId);
      if (!article) return { ok: false, error: "Artigo não encontrado." };

      const buffer = Buffer.from(dataBase64, "base64");
      if (buffer.length > MAX_ATTACHMENT_BYTES) {
        return { ok: false, error: `Anexo maior que ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB.` };
      }

      const id = crypto.randomUUID();
      ensureAttachmentDir(articleId);
      fs.writeFileSync(storedAttachmentPath(articleId, id, name), buffer);

      const attachment = {
        id, name, mimeType, size: buffer.length, createdAt: new Date().toISOString(),
      };
      article.attachments = [...(article.attachments ?? []), attachment];
      article.updatedAt = attachment.createdAt;
      writeArticle(article);
      return { ok: true, data: article };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ── article:removeAttachment { articleId, attachmentId } ───────────────────
  ipcMain.handle("article:removeAttachment", (_evt, { articleId, attachmentId }) => {
    try {
      const article = readArticle(articleId);
      if (!article) return { ok: false, error: "Artigo não encontrado." };
      const attachment = (article.attachments ?? []).find(a => a.id === attachmentId);
      if (attachment) {
        const p = storedAttachmentPath(articleId, attachment.id, attachment.name);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
      article.attachments = (article.attachments ?? []).filter(a => a.id !== attachmentId);
      article.updatedAt = new Date().toISOString();
      writeArticle(article);
      return { ok: true, data: article };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ── article:getAttachmentData { articleId, attachmentId } ──────────────────
  // Base64 sob demanda — usado pela prévia inline de imagens no ArticleView.
  // Não é chamado em lote (article:list nunca inclui isso), só quando o
  // usuário abre um anexo específico.
  ipcMain.handle("article:getAttachmentData", (_evt, { articleId, attachmentId }) => {
    try {
      const article = readArticle(articleId);
      const attachment = article && (article.attachments ?? []).find(a => a.id === attachmentId);
      if (!attachment) return { ok: false, error: "Anexo não encontrado." };
      const p = storedAttachmentPath(articleId, attachment.id, attachment.name);
      if (!fs.existsSync(p)) return { ok: false, error: "Arquivo do anexo não encontrado em disco." };
      const dataBase64 = fs.readFileSync(p).toString("base64");
      return { ok: true, data: { dataBase64, mimeType: attachment.mimeType, name: attachment.name } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ── article:exportAttachment { articleId, attachmentId } ───────────────────
  // Copia o anexo para um caminho escolhido pelo usuário (dialog nativo) —
  // mesma UX de article:exportMarkdown/exportFlashcardsCsv.
  ipcMain.handle("article:exportAttachment", async (_evt, { articleId, attachmentId }) => {
    try {
      const article = readArticle(articleId);
      const attachment = article && (article.attachments ?? []).find(a => a.id === attachmentId);
      if (!attachment) return { ok: false, error: "Anexo não encontrado." };
      const src = storedAttachmentPath(articleId, attachment.id, attachment.name);
      if (!fs.existsSync(src)) return { ok: false, error: "Arquivo do anexo não encontrado em disco." };

      const result = await dialog.showSaveDialog({
        title: "Salvar anexo", defaultPath: attachment.name,
      });
      if (result.canceled || !result.filePath) return { ok: true, data: null };
      fs.copyFileSync(src, result.filePath);
      return { ok: true, data: { filePath: result.filePath } };
    } catch (e) { return { ok: false, error: e.message }; }
  });
}

module.exports = {
  createArticleHandlers, readArticle, writeArticle, listAllArticles, htmlToMarkdown,
  articleToMarkdown, safeFilename, extFromMime, dataUriToBuffer, snapshotBeforeSave,
};
