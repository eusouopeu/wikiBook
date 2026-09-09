// @ts-check
// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/lib/graphPath.js
// BFS não-direcionado sobre as arestas do grafo — usado para calcular o menor
// caminho entre dois nós (GraphView). .js (não .ts) para rodar direto em
// `node --test` sem passo de transpilação, igual claudePrompts/flashcardLogic/
// pathMaterialize — tipado via JSDoc + checkJs (ver tsconfig.json).
// ─────────────────────────────────────────────────────────────────────────────

/** @typedef {{ source: string; target: string }} EdgeLike */

/** @param {EdgeLike[]} edges @returns {Map<string, string[]>} */
function buildAdjacency(edges) {
  const adjacency = new Map();
  const link = (/** @type {string} */ a, /** @type {string} */ b) => {
    if (!adjacency.has(a)) adjacency.set(a, []);
    adjacency.get(a).push(b);
  };
  for (const e of edges) { link(e.source, e.target); link(e.target, e.source); }
  return adjacency;
}

// Retorna a lista de ids do caminho mais curto (inclusive origem e destino),
// ou null se não houver caminho (nós desconexos). sourceId === targetId
// retorna [sourceId].
/**
 * @param {EdgeLike[]} edges
 * @param {string} sourceId
 * @param {string} targetId
 * @returns {string[] | null}
 */
function findShortestPath(edges, sourceId, targetId) {
  if (sourceId === targetId) return [sourceId];
  const adjacency = buildAdjacency(edges);
  /** @type {Map<string, string>} */
  const cameFrom = new Map();
  const visited = new Set([sourceId]);
  const queue = [sourceId];

  while (queue.length > 0) {
    const current = /** @type {string} */ (queue.shift());
    for (const neighbor of adjacency.get(current) ?? []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      cameFrom.set(neighbor, current);
      if (neighbor === targetId) {
        const path = [targetId];
        let node = targetId;
        while (node !== sourceId) {
          node = /** @type {string} */ (cameFrom.get(node));
          path.push(node);
        }
        return path.reverse();
      }
      queue.push(neighbor);
    }
  }
  return null;
}

module.exports = { findShortestPath };
