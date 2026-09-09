// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/platform/sync.ts
// Porta de packages/desktop/src/main/handlers/syncHandlers.js — cliente do
// servidor self-hosted em packages/sync-server. Mesma lógica de merge
// (push local, adota de volta o que veio mais novo de outros dispositivos);
// usa CapacitorHttp em vez de fetch() pelo mesmo motivo do platform/claude.ts
// (contorna CORS nos builds nativos — no preview via browser cai para
// fetch() normal, então funciona ali só se o servidor de sync mandar CORS
// permissivo, o que packages/sync-server não faz por padrão).
// ─────────────────────────────────────────────────────────────────────────────

import { CapacitorHttp } from "@capacitor/core";
import type { Article, Folder } from "@lexicon/shared";
import { getConfigValue, setConfigValue } from "./config";
import { listArticles as listAllArticles, writeArticleRaw, snapshotBeforeSave } from "./articles";
import { computeSyncConflicts } from "@lexicon/shared/lib/syncPolicy.js";

function normalizeServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export async function testConnection(serverUrl: string): Promise<{ reachable: boolean }> {
  const res = await CapacitorHttp.get({ url: `${normalizeServerUrl(serverUrl)}/health` });
  if (res.status !== 200) throw new Error(`Servidor respondeu ${res.status}.`);
  const body = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
  return { reachable: Boolean(body?.ok) };
}

export type SyncRunResult =
  | { needsConfirmation: true; conflicts: { id: string; title: string }[] }
  | { needsConfirmation?: false; pushed: number; pulled: number; totalArticles: number };

// confirmed=false (padrão): se o merge for sobrescrever algum artigo local
// com uma versão diferente vinda de outro dispositivo, PARA sem gravar nada
// e devolve a lista de conflitos para a UI perguntar — ver
// packages/desktop/.../syncHandlers.js (mesma lógica, espelhada aqui).
export async function runSync(serverUrl: string, token: string, confirmed = false): Promise<SyncRunResult> {
  if (!serverUrl || !token) throw new Error("Configure o servidor e o token antes de sincronizar.");

  const localArticles = await listAllArticles();
  const foldersRaw = await getConfigValue("folders");
  const localFolders: Folder[] = foldersRaw ? JSON.parse(foldersRaw) : [];

  const res = await CapacitorHttp.post({
    url: `${normalizeServerUrl(serverUrl)}/sync/push`,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: { articles: localArticles, folders: localFolders },
  });
  const body = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
  if (res.status < 200 || res.status >= 300 || !body?.ok) {
    throw new Error(body?.error ?? `Servidor de sincronização respondeu ${res.status}.`);
  }
  const mergedArticles: Article[] = body.articles ?? [];

  if (!confirmed) {
    const conflicts = computeSyncConflicts(localArticles, mergedArticles);
    if (conflicts.length > 0) return { needsConfirmation: true, conflicts };
  }

  const localById = new Map(localArticles.map(a => [a.id, a]));
  let pulled = 0;
  for (const article of mergedArticles) {
    const local = localById.get(article.id);
    if (!local || article.updatedAt > local.updatedAt) {
      if (local) await snapshotBeforeSave(local);
      await writeArticleRaw(article);
      pulled++;
    }
  }
  await setConfigValue("folders", JSON.stringify(body.folders ?? []));
  await setConfigValue("syncLastRunAt", new Date().toISOString());

  return { pushed: localArticles.length, pulled, totalArticles: mergedArticles.length };
}
