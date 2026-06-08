// ─────────────────────────────────────────────────────────────────────────────
// src/renderer/store/useStore.ts
// Store Zustand central do renderer
// ─────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import type { Article, ArticleLink, GraphNode, GraphEdge } from "../../shared/types";

// Tipo do bridge exposto pelo preload
declare global {
  interface Window {
    brita: {
      invoke: (channel: string, payload?: unknown) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
    };
  }
}

// ── Helper para chamadas IPC ──────────────────────────────────────────────────
async function ipc<T>(channel: string, payload?: unknown): Promise<T> {
  const res = await window.brita.invoke(channel, payload);
  if (!res.ok) throw new Error(res.error ?? "IPC error");
  return res.data as T;
}

// ─────────────────────────────────────────────────────────────────────────────

interface AppState {
  // ── Artigos ────────────────────────────────────────────────────────────────
  articles: Article[];
  activeArticleId: string | null;
  loadingArticle: boolean;

  // ── Modo de visualização ──────────────────────────────────────────────────
  view: "article" | "graph";

  // ── Grafo ─────────────────────────────────────────────────────────────────
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];

  // ── UI states ──────────────────────────────────────────────────────────────
  searchQuery: string;
  isSearchOpen: boolean;
  // Contexto do menu de clique direito no artigo
  contextMenu: {
    visible: boolean;
    x: number;
    y: number;
    selectedText: string;
    parentArticleId: string | null;
  };

  // ── Actions ────────────────────────────────────────────────────────────────
  loadArticles: () => Promise<void>;
  openArticle: (id: string) => Promise<void>;
  saveArticle: (article: Partial<Article> & { title: string }) => Promise<Article>;
  deleteArticle: (id: string) => Promise<void>;

  fetchFromWikipedia: (query: string, parentId?: string | null) => Promise<Article>;
  generateWithClaude: (title: string, parentId?: string | null) => Promise<Article>;

  addLink: (parentId: string, anchorText: string, targetId: string, targetTitle: string) => Promise<void>;
  removeLink: (parentId: string, linkId: string) => Promise<void>;

  setView: (v: "article" | "graph") => void;
  setSearchQuery: (q: string) => void;
  setSearchOpen: (open: boolean) => void;
  showContextMenu: (x: number, y: number, text: string, parentId: string) => void;
  hideContextMenu: () => void;
  rebuildGraph: () => void;
}

// ── Algoritmo de profundidade para calcular tamanho dos nós ──────────────────
// Um nó-raiz (sem pai) tem depth=0.
// Um nó filho de um depth=0 tem depth=1, e assim por diante.
// O raio é: BASE * (1.2 ^ (maxDepth - depth)) — nós-pai sempre maiores.
function computeGraphData(articles: Article[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const BASE_RADIUS = 28;

  // Monta mapa de parentesco: targetId → [parentId]
  const parentMap = new Map<string, string[]>();
  const allEdges: GraphEdge[] = [];

  for (const art of articles) {
    for (const link of art.links) {
      if (!parentMap.has(link.targetId)) parentMap.set(link.targetId, []);
      parentMap.get(link.targetId)!.push(art.id);
      allEdges.push({
        id: link.id,
        source: art.id,
        target: link.targetId,
        anchorText: link.anchorText,
      });
    }
  }

  // BFS para calcular depth de cada nó
  const depths = new Map<string, number>();
  // Nós sem nenhum pai são raízes (depth 0)
  const roots = articles.filter(a => !parentMap.has(a.id) || parentMap.get(a.id)!.length === 0);
  const queue: Array<{ id: string; depth: number }> = roots.map(r => ({ id: r.id, depth: 0 }));
  const visited = new Set<string>();

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    // Usa o menor depth encontrado (artigo pode ser filho de múltiplos pais)
    if (!depths.has(id) || depths.get(id)! > depth) depths.set(id, depth);

    // Propaga para filhos
    for (const art of articles) {
      for (const link of art.links) {
        if (link.targetId === id && !visited.has(art.id)) {
          // art.id é pai de id → art.id já processado; processa filhos de id
        }
        if (art.id === id && !visited.has(link.targetId)) {
          queue.push({ id: link.targetId, depth: depth + 1 });
        }
      }
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
    const radius = BASE_RADIUS * Math.pow(1.2, maxDepth - depth);
    return {
      id: art.id,
      title: art.title,
      source: art.source,
      depth,
      radius,
    };
  });

  return { nodes, edges: allEdges };
}

// ─────────────────────────────────────────────────────────────────────────────

export const useStore = create<AppState>((set, get) => ({
  articles: [],
  activeArticleId: null,
  loadingArticle: false,
  view: "article",
  graphNodes: [],
  graphEdges: [],
  searchQuery: "",
  isSearchOpen: false,
  contextMenu: {
    visible: false, x: 0, y: 0,
    selectedText: "", parentArticleId: null,
  },

  // ── loadArticles ────────────────────────────────────────────────────────────
  loadArticles: async () => {
    const articles = await ipc<Article[]>("article:list");
    const { nodes, edges } = computeGraphData(articles);
    set({ articles, graphNodes: nodes, graphEdges: edges });
  },

  // ── openArticle ─────────────────────────────────────────────────────────────
  openArticle: async (id) => {
    set({ loadingArticle: true });
    try {
      const article = await ipc<Article>("article:get", { id });
      // Atualiza o artigo na lista local sem recarregar tudo
      set(s => ({
        articles: s.articles.map(a => a.id === id ? article : a),
        activeArticleId: id,
        view: "article",
        loadingArticle: false,
      }));
    } catch {
      set({ loadingArticle: false });
    }
  },

  // ── saveArticle ─────────────────────────────────────────────────────────────
  saveArticle: async (partial) => {
    const article = await ipc<Article>("article:save", { article: partial });
    set(s => {
      const exists = s.articles.find(a => a.id === article.id);
      const articles = exists
        ? s.articles.map(a => a.id === article.id ? article : a)
        : [article, ...s.articles];
      const { nodes, edges } = computeGraphData(articles);
      return { articles, activeArticleId: article.id, graphNodes: nodes, graphEdges: edges };
    });
    return article;
  },

  // ── deleteArticle ───────────────────────────────────────────────────────────
  deleteArticle: async (id) => {
    await ipc("article:delete", { id });
    set(s => {
      const articles = s.articles.filter(a => a.id !== id);
      const { nodes, edges } = computeGraphData(articles);
      return {
        articles,
        activeArticleId: s.activeArticleId === id ? null : s.activeArticleId,
        graphNodes: nodes, graphEdges: edges,
      };
    });
  },

  // ── fetchFromWikipedia ──────────────────────────────────────────────────────
  fetchFromWikipedia: async (query, parentId = null) => {
    const wiki = await ipc<{ title: string; html: string; plainTextExtract: string }>(
      "wikipedia:fetch", { query }
    );

    // Gera resumo via Claude automaticamente
    let summary = "";
    try {
      const r = await ipc<{ summary: string }>("claude:summarize", {
        title: wiki.title,
        text: wiki.plainTextExtract,
      });
      summary = r.summary;
    } catch {
      summary = "• Resumo não disponível.";
    }

    const article = await get().saveArticle({
      title: wiki.title,
      source: "wikipedia",
      content: wiki.html,
      summary,
      links: [],
    });

    // Se veio de uma busca contextual (parentId fornecido), o caller é responsável
    // por chamar addLink com o texto selecionado
    return article;
  },

  // ── generateWithClaude ──────────────────────────────────────────────────────
  generateWithClaude: async (title, parentId = null) => {
    // Coleta contexto dos artigos relacionados ao pai (se houver)
    let context = "";
    if (parentId) {
      const parent = get().articles.find(a => a.id === parentId);
      if (parent) context = parent.summary;
    }

    const r = await ipc<{ summary: string }>("claude:generate", { title, context });

    const article = await get().saveArticle({
      title,
      source: "claude",
      content: "",   // artigos gerados pelo Claude não têm HTML, só bullet points
      summary: r.summary,
      links: [],
    });

    return article;
  },

  // ── addLink ─────────────────────────────────────────────────────────────────
  addLink: async (parentId, anchorText, targetId, targetTitle) => {
    const parent = await ipc<Article>("article:addLink", {
      parentId, anchorText, targetId, targetTitle,
    });
    set(s => {
      const articles = s.articles.map(a => a.id === parentId ? parent : a);
      const { nodes, edges } = computeGraphData(articles);
      return { articles, graphNodes: nodes, graphEdges: edges };
    });
  },

  // ── removeLink ──────────────────────────────────────────────────────────────
  removeLink: async (parentId, linkId) => {
    const parent = await ipc<Article>("article:removeLink", { parentId, linkId });
    set(s => {
      const articles = s.articles.map(a => a.id === parentId ? parent : a);
      const { nodes, edges } = computeGraphData(articles);
      return { articles, graphNodes: nodes, graphEdges: edges };
    });
  },

  // ── UI actions ──────────────────────────────────────────────────────────────
  setView: (v) => set({ view: v }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSearchOpen: (open) => set({ isSearchOpen: open }),
  showContextMenu: (x, y, text, parentId) =>
    set({ contextMenu: { visible: true, x, y, selectedText: text, parentArticleId: parentId } }),
  hideContextMenu: () =>
    set({ contextMenu: { visible: false, x: 0, y: 0, selectedText: "", parentArticleId: null } }),

  rebuildGraph: () => {
    const { articles } = get();
    const { nodes, edges } = computeGraphData(articles);
    set({ graphNodes: nodes, graphEdges: edges });
  },
}));
