// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/store/graphData.ts
// Cálculo dos nós/arestas do grafo a partir dos artigos — funções puras usadas
// pela fatia de artigos do store e pela GraphView (subgrafo local).
// ─────────────────────────────────────────────────────────────────────────────

import type { Article, GraphNode, GraphEdge } from "../shared/types";

// ── Algoritmo de profundidade para calcular tamanho dos nós ──────────────────
// Um nó-raiz (sem pai) tem depth=0.
// Um nó filho de um depth=0 tem depth=1, e assim por diante.
// O raio é: BASE * (1.2 ^ (maxDepth - depth)) — nós-pai sempre maiores.
export function computeGraphData(articles: Article[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const BASE_RADIUS = 28;
  // Teto no fator de crescimento — sem isso, grafos com 6-7 níveis de
  // profundidade deixam os nós-raiz desproporcionalmente enormes.
  const MAX_GROWTH_FACTOR = 3;

  // Monta mapas de adjacência: targetId → [parentId] e parentId → [targetId]
  const parentMap = new Map<string, string[]>();
  const childMap = new Map<string, string[]>();
  const allEdges: GraphEdge[] = [];

  for (const art of articles) {
    for (const link of art.links) {
      if (!parentMap.has(link.targetId)) parentMap.set(link.targetId, []);
      parentMap.get(link.targetId)!.push(art.id);
      if (!childMap.has(art.id)) childMap.set(art.id, []);
      childMap.get(art.id)!.push(link.targetId);
      allEdges.push({
        id: link.id,
        source: art.id,
        target: link.targetId,
        anchorText: link.anchorText,
      });
    }
  }

  // BFS para calcular depth de cada nó — como todas as raízes entram na fila
  // com depth 0, a primeira visita a um nó já é pelo caminho mais curto
  const depths = new Map<string, number>();
  // Nós sem nenhum pai são raízes (depth 0)
  const roots = articles.filter(a => !parentMap.has(a.id) || parentMap.get(a.id)!.length === 0);
  const queue: Array<{ id: string; depth: number }> = roots.map(r => ({ id: r.id, depth: 0 }));

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depths.has(id)) continue;
    depths.set(id, depth);
    for (const childId of childMap.get(id) ?? []) {
      if (!depths.has(childId)) queue.push({ id: childId, depth: depth + 1 });
    }
  }

  // Artigos não visitados (ilhas sem links) recebem depth 0
  for (const art of articles) {
    if (!depths.has(art.id)) depths.set(art.id, 0);
  }

  const maxDepth = Math.max(0, ...Array.from(depths.values()));

  const nodes: GraphNode[] = articles.map(art => {
    const depth = depths.get(art.id) ?? 0;
    // Efeito cascata: quanto menor o depth (mais "pai"), maior o nó
    const growthFactor = Math.min(Math.pow(1.2, maxDepth - depth), MAX_GROWTH_FACTOR);
    const radius = BASE_RADIUS * growthFactor;
    return {
      id: art.id,
      title: art.title,
      source: art.source,
      tags: art.tags ?? [],
      folderId: art.folderId ?? null,
      depth,
      radius,
    };
  });

  return { nodes, edges: allEdges };
}

// ── Subgrafo local: artigo central + vizinhos até N saltos (não-direcional) ──
// Usado pelo modo "Local" da visualização em grafo — reaproveita os nós/raios
// já calculados globalmente, apenas filtra quais entram na cena.
export function computeLocalSubgraph(
  nodes: GraphNode[], edges: GraphEdge[], centerId: string, maxDepth: number
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    adjacency.get(a)!.add(b);
  };
  for (const e of edges) { link(e.source, e.target); link(e.target, e.source); }

  const included = new Set<string>([centerId]);
  let frontier = [centerId];
  for (let depth = 0; depth < maxDepth; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (!included.has(neighbor)) { included.add(neighbor); next.push(neighbor); }
      }
    }
    frontier = next;
  }

  return {
    nodes: nodes.filter(n => included.has(n.id)),
    edges: edges.filter(e => included.has(e.source) && included.has(e.target)),
  };
}
