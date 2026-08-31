// ─────────────────────────────────────────────────────────────────────────────
// src/main/handlers/mdSyncHandlers.js
// Sincronização automática: mantém uma pasta escolhida pelo usuário sempre
// espelhando a biblioteca em .md (formato Obsidian), sem exportação manual.
// syncArticleFile/removeArticleFile são chamados de dentro de
// articleHandlers.js (writeArticle, article:delete, article:restore) — todo
// artigo criado/editado/apagado já reflete na pasta assim que a operação
// termina.
//
// Manifesto id→nome-de-arquivo guardado em config (mdSyncManifest) em vez de
// um arquivo dentro da própria pasta de sync: evita colocar um arquivo
// "estranho" no meio das notas do usuário, e sobrevive à troca de pasta.
// Necessário para apagar o .md antigo quando o TÍTULO muda (o nome do
// arquivo é derivado do título).
// ─────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");
const { dialog, shell } = require("electron");
const { getConfig, setConfig } = require("./configHandlers");

const FOLDER_KEY = "mdSyncFolder";
const MANIFEST_KEY = "mdSyncManifest";
const ASSETS_DIRNAME = "assets";

function readManifest() {
  try {
    const raw = getConfig(MANIFEST_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function writeManifest(manifest) {
  setConfig(MANIFEST_KEY, JSON.stringify(manifest));
}

function getSyncFolder() {
  const dir = getConfig(FOLDER_KEY);
  return dir && fs.existsSync(dir) ? dir : null;
}

// ── Escreve/atualiza o .md de UM artigo na pasta de sync ──────────────────────
function syncArticleFile(article) {
  if (!article) return;
  const dir = getSyncFolder();
  if (!dir) return;
  // require tardio: articleHandlers.js já requer este módulo (ciclo).
  const { articleToMarkdown, safeFilename, extFromMime, dataUriToBuffer } = require("./articleHandlers");

  const manifest = readManifest();
  const previousFilename = manifest[article.id];

  const imageAssetPaths = new Map();
  for (const ex of article.excerpts ?? []) {
    if ((ex.kind ?? "text") !== "image") continue;
    const match = ex.html?.match(/src="(data:[^"]+)"/);
    if (!match) continue;
    const decoded = dataUriToBuffer(match[1]);
    if (!decoded) continue;
    const assetsDir = path.join(dir, ASSETS_DIRNAME);
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
    const filename = `${safeFilename(article.title)}-${ex.id.slice(0, 8)}.${extFromMime(decoded.mime)}`;
    fs.writeFileSync(path.join(assetsDir, filename), decoded.buffer);
    imageAssetPaths.set(ex.id, `${ASSETS_DIRNAME}/${filename}`);
  }

  const filename = `${safeFilename(article.title)}.md`;
  if (previousFilename && previousFilename !== filename) {
    const oldPath = path.join(dir, previousFilename);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  fs.writeFileSync(path.join(dir, filename), articleToMarkdown(article, imageAssetPaths), "utf8");
  manifest[article.id] = filename;
  writeManifest(manifest);
}

// ── Remove o .md de um artigo apagado ─────────────────────────────────────────
function removeArticleFile(id) {
  const dir = getSyncFolder();
  if (!dir) return;
  const manifest = readManifest();
  const filename = manifest[id];
  if (filename) {
    const p = path.join(dir, filename);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    delete manifest[id];
    writeManifest(manifest);
  }
}

// ── Ressincroniza tudo (troca de pasta, ou correção manual) ───────────────────
function resyncAll() {
  const dir = getSyncFolder();
  if (!dir) return { count: 0 };
  const { listAllArticles } = require("./articleHandlers");
  const articles = listAllArticles();
  const manifest = readManifest();
  const currentIds = new Set(articles.map(a => a.id));
  // Remove arquivos de artigos que não existem mais (apagados enquanto a
  // sincronização estava desligada, ou pasta trocada por uma antiga).
  for (const [id, filename] of Object.entries(manifest)) {
    if (currentIds.has(id)) continue;
    const p = path.join(dir, filename);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    delete manifest[id];
  }
  writeManifest(manifest);
  for (const article of articles) syncArticleFile(article);
  return { count: articles.length };
}

function createMdSyncHandlers(ipcMain) {
  // ── mdsync:getStatus → { folder, count } ────────────────────────────────────
  ipcMain.handle("mdsync:getStatus", () => {
    const folder = getSyncFolder();
    const manifest = readManifest();
    return { ok: true, data: { folder, count: folder ? Object.keys(manifest).length : 0 } };
  });

  // ── mdsync:selectFolder → escolhe pasta, liga sync e ressincroniza tudo ─────
  ipcMain.handle("mdsync:selectFolder", async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: "Escolha a pasta de sincronização (Markdown)",
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) return { ok: true, data: null };
      const dir = result.filePaths[0];
      setConfig(FOLDER_KEY, dir);
      const { count } = resyncAll();
      return { ok: true, data: { folder: dir, count } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ── mdsync:disable → desliga sync (arquivos já gravados permanecem) ────────
  ipcMain.handle("mdsync:disable", () => {
    setConfig(FOLDER_KEY, "");
    setConfig(MANIFEST_KEY, "");
    return { ok: true };
  });

  // ── mdsync:resync → força ressincronização completa ─────────────────────────
  ipcMain.handle("mdsync:resync", () => {
    try {
      return { ok: true, data: resyncAll() };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ── mdsync:openFolder → abre a pasta no Finder/Explorer ─────────────────────
  ipcMain.handle("mdsync:openFolder", () => {
    const dir = getSyncFolder();
    if (!dir) return { ok: false, error: "Nenhuma pasta configurada." };
    shell.openPath(dir);
    return { ok: true };
  });
}

module.exports = { createMdSyncHandlers, syncArticleFile, removeArticleFile, resyncAll };
