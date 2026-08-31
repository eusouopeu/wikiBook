// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/platform/mdSync.ts
// Porta de mdSyncHandlers.js (desktop) — mantém uma cópia .md (formato
// Obsidian) de cada artigo sempre atualizada, sem exportação manual.
//
// Sem escolha de pasta arbitrária no mobile (não há SAF/bookmark plugin
// instalado): os arquivos vão para Directory.Documents/Wikibook — no iOS,
// visível no app Arquivos em "Neste iPhone/iPad → Wikibook" (Info.plist já
// habilita UIFileSharingEnabled + LSSupportsOpeningDocumentsInPlace); no
// Android, pasta própria do app em armazenamento externo, acessível por
// qualquer gerenciador de arquivos sem permissão extra. syncArticleFile é
// chamado de dentro de articles.ts (writeArticle) e index.ts (delete/restore)
// — mesmo ponto único de escrita do desktop.
// ─────────────────────────────────────────────────────────────────────────────

import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Preferences } from "@capacitor/preferences";
import { Share } from "@capacitor/share";
import type { Article } from "@lexicon/shared";
import { articleToMarkdown, safeFilename, extFromMime, dataUriToBase64 } from "./export";

const SYNC_DIR = "Wikibook";
const ASSETS_DIRNAME = "assets";
const MANIFEST_KEY = "mdSyncManifest";
const ENABLED_KEY = "mdSyncEnabled";

async function isEnabled(): Promise<boolean> {
  const { value } = await Preferences.get({ key: ENABLED_KEY });
  return value !== "false"; // habilitado por padrão
}

async function readManifest(): Promise<Record<string, string>> {
  try {
    const { value } = await Preferences.get({ key: MANIFEST_KEY });
    return value ? JSON.parse(value) : {};
  } catch { return {}; }
}
async function writeManifest(manifest: Record<string, string>): Promise<void> {
  await Preferences.set({ key: MANIFEST_KEY, value: JSON.stringify(manifest) });
}

async function ensureSyncDir() {
  try {
    await Filesystem.mkdir({ path: SYNC_DIR, directory: Directory.Documents, recursive: true });
  } catch { /* já existe */ }
}

export async function syncArticleFile(article: Article): Promise<void> {
  if (!(await isEnabled())) return;
  await ensureSyncDir();

  const manifest = await readManifest();
  const previousFilename = manifest[article.id];

  const imageAssetPaths = new Map<string, string>();
  for (const ex of article.excerpts ?? []) {
    if ((ex.kind ?? "text") !== "image") continue;
    const match = ex.html?.match(/src="(data:[^"]+)"/);
    if (!match) continue;
    const decoded = dataUriToBase64(match[1]);
    if (!decoded) continue;
    const assetsPath = `${SYNC_DIR}/${ASSETS_DIRNAME}`;
    try { await Filesystem.mkdir({ path: assetsPath, directory: Directory.Documents, recursive: true }); } catch { /* já existe */ }
    const filename = `${safeFilename(article.title)}-${ex.id.slice(0, 8)}.${extFromMime(decoded.mime)}`;
    await Filesystem.writeFile({
      path: `${assetsPath}/${filename}`, data: decoded.base64, directory: Directory.Documents,
    });
    imageAssetPaths.set(ex.id, `${ASSETS_DIRNAME}/${filename}`);
  }

  const filename = `${safeFilename(article.title)}.md`;
  if (previousFilename && previousFilename !== filename) {
    try { await Filesystem.deleteFile({ path: `${SYNC_DIR}/${previousFilename}`, directory: Directory.Documents }); } catch { /* já não existia */ }
  }
  await Filesystem.writeFile({
    path: `${SYNC_DIR}/${filename}`,
    data: articleToMarkdown(article, imageAssetPaths),
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
  });
  manifest[article.id] = filename;
  await writeManifest(manifest);
}

export async function removeArticleFile(id: string): Promise<void> {
  if (!(await isEnabled())) return;
  const manifest = await readManifest();
  const filename = manifest[id];
  if (!filename) return;
  try { await Filesystem.deleteFile({ path: `${SYNC_DIR}/${filename}`, directory: Directory.Documents }); } catch { /* já não existia */ }
  delete manifest[id];
  await writeManifest(manifest);
}

export async function getStatus(): Promise<{ folder: string | null; count: number }> {
  const enabled = await isEnabled();
  if (!enabled) return { folder: null, count: 0 };
  const manifest = await readManifest();
  return { folder: `Documentos/${SYNC_DIR}`, count: Object.keys(manifest).length };
}

export async function setEnabled(enabled: boolean): Promise<void> {
  await Preferences.set({ key: ENABLED_KEY, value: String(enabled) });
}

// ── Ressincroniza tudo (religar depois de desligado, ou correção manual) ─────
export async function resyncAll(): Promise<{ count: number }> {
  const { listArticles } = await import("./articles");
  const articles = await listArticles();
  const manifest = await readManifest();
  const currentIds = new Set(articles.map(a => a.id));
  for (const [id, filename] of Object.entries(manifest)) {
    if (currentIds.has(id)) continue;
    try { await Filesystem.deleteFile({ path: `${SYNC_DIR}/${filename}`, directory: Directory.Documents }); } catch { /* já não existia */ }
    delete manifest[id];
  }
  await writeManifest(manifest);
  for (const article of articles) await syncArticleFile(article);
  return { count: articles.length };
}

// ── Compartilha uma cópia de tudo pelo share sheet nativo (opcional) ─────────
// Complementa (não substitui) o auto-sync: útil pra tirar os arquivos do
// sandbox do app de uma vez, sem depender do usuário achar a pasta Documents.
export async function shareAll(): Promise<{ count: number }> {
  const manifest = await readManifest();
  const uris: string[] = [];
  for (const filename of Object.values(manifest)) {
    try {
      const { uri } = await Filesystem.getUri({ path: `${SYNC_DIR}/${filename}`, directory: Directory.Documents });
      uris.push(uri);
    } catch { /* arquivo pode ter sido removido externamente */ }
  }
  if (uris.length === 0) return { count: 0 };
  await Share.share({ title: "Compartilhar artigos (Markdown)", dialogTitle: "Compartilhar artigos", files: uris });
  return { count: uris.length };
}
