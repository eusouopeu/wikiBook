// @ts-check
// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/lib/syncPolicy.js
// Funções puras de decisão para as duas sincronizações do app — extraídas
// para serem testáveis sem tocar em fs/rede:
//   - resolveMdSyncDirection: sincronização de Markdown (Obsidian) decide se
//     empurra o artigo para o .md ou lê o .md de volta pro artigo, comparando
//     mtime do arquivo com updatedAt do artigo (LWW por lado).
//   - computeSyncConflicts: sincronização HTTP entre desktop/mobile — antes de
//     sobrescrever um artigo local com a versão mesclada do servidor, lista
//     quais artigos locais serão substituídos (para confirmação na UI).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} articleUpdatedAt ISO de Article.updatedAt
 * @param {string | null} fileMtimeIso ISO do mtime do .md em disco, ou null se o arquivo não existe
 * @returns {"push" | "pull" | "none"}
 *   "push": grava o artigo por cima do .md (artigo é a versão mais nova, ou o arquivo não existe)
 *   "pull": lê o .md de volta para o artigo (arquivo foi editado fora do app depois do último save)
 *   "none": nada mudou dos dois lados
 */
function resolveMdSyncDirection(articleUpdatedAt, fileMtimeIso) {
  if (!fileMtimeIso) return "push";
  const articleTime = Date.parse(articleUpdatedAt);
  const fileTime = Date.parse(fileMtimeIso);
  if (fileTime > articleTime) return "pull";
  if (articleTime > fileTime) return "push";
  return "none";
}

/**
 * @typedef {{ id: string; title: string; updatedAt: string }} ConflictCandidate
 * @param {ConflictCandidate[]} localArticles
 * @param {ConflictCandidate[]} mergedArticles versão devolvida pelo servidor após o merge LWW
 * @returns {{ id: string; title: string }[]} artigos locais que serão sobrescritos por uma versão diferente vinda do servidor
 */
function computeSyncConflicts(localArticles, mergedArticles) {
  const localById = new Map(localArticles.map(a => [a.id, a]));
  const conflicts = [];
  for (const merged of mergedArticles) {
    const local = localById.get(merged.id);
    if (!local) continue;
    if (merged.updatedAt > local.updatedAt) conflicts.push({ id: local.id, title: local.title });
  }
  return conflicts;
}

module.exports = { resolveMdSyncDirection, computeSyncConflicts };
