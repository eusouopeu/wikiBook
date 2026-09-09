// ─────────────────────────────────────────────────────────────────────────────
// src/main/handlers/syncHandlers.js
// Cliente do servidor self-hosted em packages/sync-server — sincronização sob
// demanda (botão "Sincronizar agora"), não automática em segundo plano.
//
// Fluxo de sync:run { serverUrl, token, confirmed? }:
//   1. Lê todos os artigos locais + pastas (config "folders")
//   2. POST /sync/push no servidor com esse estado
//   3. O servidor devolve o estado MESCLADO (LWW por updatedAt de artigo,
//      união de pastas por id)
//   4. computeSyncConflicts lista os artigos locais que o merge vai
//      SOBRESCREVER (versão do servidor mais nova que a local). Sem
//      confirmed=true e com conflitos, a chamada PARA aqui sem gravar nada e
//      devolve { needsConfirmation: true, conflicts } para a UI perguntar —
//      LWW silencioso apagava a versão perdida sem aviso nenhum.
//   5. Confirmado (ou sem conflito nenhum): antes de sobrescrever cada
//      artigo em conflito, snapshotBeforeSave grava a versão local atual em
//      .history/ (mesma rede de segurança do article:save) — a perda vira
//      reversível em vez de definitiva.
//   6. As pastas locais são substituídas pelo conjunto mesclado
// ─────────────────────────────────────────────────────────────────────────────

const { getConfig, setConfig } = require("./configHandlers");
const { listAllArticles, writeArticle, snapshotBeforeSave } = require("./articleHandlers");
const { computeSyncConflicts } = require("../../../../shared/lib/syncPolicy");

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

  // ── sync:run { serverUrl, token, confirmed? } → push+merge+adoção local ────
  ipcMain.handle("sync:run", async (_evt, { serverUrl, token, confirmed = false }) => {
    try {
      if (!serverUrl || !token) return { ok: false, error: "Configure o servidor e o token antes de sincronizar." };

      const localArticles = listAllArticles();
      const foldersRaw = getConfig("folders");
      const localFolders = foldersRaw ? JSON.parse(foldersRaw) : [];

      const merged = await callSyncServer(serverUrl, token, "/sync/push", {
        method: "POST",
        body: JSON.stringify({ articles: localArticles, folders: localFolders }),
      });
      const mergedArticles = merged.articles ?? [];

      if (!confirmed) {
        const conflicts = computeSyncConflicts(localArticles, mergedArticles);
        if (conflicts.length > 0) {
          return { ok: true, data: { needsConfirmation: true, conflicts } };
        }
      }

      const localById = new Map(localArticles.map(a => [a.id, a]));
      let pulled = 0;
      for (const article of mergedArticles) {
        const local = localById.get(article.id);
        if (!local || article.updatedAt > local.updatedAt) {
          // Confirmado (ou sem conflito): a versão local que vai ser
          // substituída ainda entra no histórico antes da escrita.
          if (local) snapshotBeforeSave(local);
          writeArticle(article);
          pulled++;
        }
      }
      setConfig("folders", JSON.stringify(merged.folders ?? []));
      setConfig("syncLastRunAt", new Date().toISOString());

      return {
        ok: true,
        data: { pushed: localArticles.length, pulled, totalArticles: mergedArticles.length },
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

module.exports = { createSyncHandlers };
