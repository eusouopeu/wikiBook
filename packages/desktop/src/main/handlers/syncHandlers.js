// ─────────────────────────────────────────────────────────────────────────────
// src/main/handlers/syncHandlers.js
// Cliente do servidor self-hosted em packages/sync-server — sincronização sob
// demanda (botão "Sincronizar agora"), não automática em segundo plano.
//
// Fluxo de sync:sync (única chamada faz push + adota o merge de volta):
//   1. Lê todos os artigos locais + pastas (config "folders")
//   2. POST /sync/push no servidor com esse estado
//   3. O servidor devolve o estado MESCLADO (LWW por updatedAt de artigo,
//      união de pastas por id)
//   4. Artigos do merge mais novos que os locais (ou que não existem
//      localmente) são gravados em disco — isso "puxa" as mudanças feitas em
//      outros dispositivos
//   5. As pastas locais são substituídas pelo conjunto mesclado
// ─────────────────────────────────────────────────────────────────────────────

const { getConfig, setConfig } = require("./configHandlers");
const { listAllArticles, writeArticle } = require("./articleHandlers");

const REQUEST_TIMEOUT_MS = 30_000;

function normalizeServerUrl(url) {
  return (url ?? "").trim().replace(/\/+$/, "");
}

async function callSyncServer(serverUrl, token, path, options = {}) {
  const res = await fetch(`${normalizeServerUrl(serverUrl)}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...options.headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  let body;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok || !body?.ok) {
    throw new Error(body?.error ?? `Servidor de sincronização respondeu ${res.status}.`);
  }
  return body;
}

function createSyncHandlers(ipcMain) {

  // ── sync:test { serverUrl } → verifica se o servidor responde ──────────────
  ipcMain.handle("sync:test", async (_evt, { serverUrl }) => {
    try {
      const res = await fetch(`${normalizeServerUrl(serverUrl)}/health`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return { ok: false, error: `Servidor respondeu ${res.status}.` };
      const body = await res.json();
      return { ok: true, data: { reachable: Boolean(body?.ok) } };
    } catch (e) {
      return { ok: false, error: `Não foi possível conectar: ${e.message}` };
    }
  });

  // ── sync:run { serverUrl, token } → executa push+merge+adoção local ────────
  ipcMain.handle("sync:run", async (_evt, { serverUrl, token }) => {
    try {
      if (!serverUrl || !token) return { ok: false, error: "Configure o servidor e o token antes de sincronizar." };

      const localArticles = listAllArticles();
      const foldersRaw = getConfig("folders");
      const localFolders = foldersRaw ? JSON.parse(foldersRaw) : [];

      const merged = await callSyncServer(serverUrl, token, "/sync/push", {
        method: "POST",
        body: JSON.stringify({ articles: localArticles, folders: localFolders }),
      });

      const localById = new Map(localArticles.map(a => [a.id, a]));
      let pulled = 0;
      for (const article of merged.articles ?? []) {
        const local = localById.get(article.id);
        if (!local || article.updatedAt > local.updatedAt) {
          writeArticle(article);
          pulled++;
        }
      }
      setConfig("folders", JSON.stringify(merged.folders ?? []));
      setConfig("syncLastRunAt", new Date().toISOString());

      return {
        ok: true,
        data: { pushed: localArticles.length, pulled, totalArticles: (merged.articles ?? []).length },
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

module.exports = { createSyncHandlers };
