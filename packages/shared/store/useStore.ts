// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/store/useStore.ts
// Store Zustand central — compartilhado entre desktop e mobile
// ─────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import type { Article, ArticleLink, ExcerptOutlineItem, Folder, GraphNode, GraphEdge } from "../shared/types";

// Tipo do bridge exposto pelo preload
declare global {
  interface Window {
    lexicon: {
      invoke: (channel: string, payload?: unknown) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
    };
  }
}

// ── Helper para chamadas IPC ──────────────────────────────────────────────────
async function ipc<T>(channel: string, payload?: unknown): Promise<T> {
  const res = await window.lexicon.invoke(channel, payload);
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
  // Idioma da Wikipedia (persistido em config.json)
  wikipediaLang: string;
  // Filtro por tag na sidebar (null = todas)
  selectedTag: string | null;
  // ── Pastas ────────────────────────────────────────────────────────────────
  folders: Folder[];
  // Filtro por pasta na sidebar (null = todas)
  selectedFolder: string | null;
  // Escopo do grafo: global (tudo) ou local (artigo ativo + vizinhos)
  graphScope: "global" | "local";
  localDepth: 1 | 2;
  // Tarefa em andamento (ex.: geração via Claude disparada pelo menu de contexto)
  pendingTask: string | null;
  // Notificação transitória — action opcional (ex.: "Desfazer" na exclusão de artigo)
  toast: { message: string; type: "info" | "error"; action?: { label: string; onClick: () => void } } | null;
  // Contexto do menu de clique direito no artigo — tableHtml/imageSrc/imageAlt
  // ficam presentes só quando o clique foi sobre uma tabela ou imagem
  contextMenu: {
    visible: boolean;
    x: number;
    y: number;
    selectedText: string;
    parentArticleId: string | null;
    tableHtml?: string;
    imageSrc?: string;
    imageAlt?: string;
  };

  // ── Actions ────────────────────────────────────────────────────────────────
  loadArticles: () => Promise<void>;
  openArticle: (id: string) => Promise<void>;
  saveArticle: (article: Partial<Article> & { title: string }) => Promise<Article>;
  deleteArticle: (id: string) => Promise<void>;
  restoreArticle: (id: string) => Promise<Article>;

  fetchFromWikipedia: (query: string, parentId?: string | null, exactTitle?: string) => Promise<Article>;
  generateWithClaude: (title: string, parentId?: string | null) => Promise<Article>;

  addLink: (parentId: string, anchorText: string, targetId: string, targetTitle: string) => Promise<void>;
  removeLink: (parentId: string, linkId: string) => Promise<void>;

  setView: (v: "article" | "graph") => void;
  setSearchQuery: (q: string) => void;
  setSearchOpen: (open: boolean) => void;
  setWikipediaLang: (lang: string) => Promise<void>;
  setSelectedTag: (tag: string | null) => void;
  loadFolders: () => Promise<void>;
  createFolder: (name: string) => Promise<Folder>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  setArticleFolder: (articleId: string, folderId: string | null) => Promise<void>;
  setSelectedFolder: (id: string | null) => void;
  setGraphScope: (scope: "global" | "local") => void;
  setLocalDepth: (depth: 1 | 2) => void;
  updateTags: (articleId: string, tags: string[]) => Promise<void>;
  updateExcerptMarkdown: (articleId: string, excerptId: string, editedMarkdown: string) => Promise<void>;
  updateExcerptOutline: (articleId: string, outline: ExcerptOutlineItem[]) => Promise<void>;
  showToast: (
    message: string, type?: "info" | "error",
    opts?: { action?: { label: string; onClick: () => void }; durationMs?: number }
  ) => void;
  showContextMenu: (x: number, y: number, parentId: string, opts?: {
    selectedText?: string; tableHtml?: string; imageSrc?: string; imageAlt?: string;
  }) => void;
  hideContextMenu: () => void;
  rebuildGraph: () => void;
}

// ── Algoritmo de profundidade para calcular tamanho dos nós ──────────────────
// Um nó-raiz (sem pai) tem depth=0.
// Um nó filho de um depth=0 tem depth=1, e assim por diante.
// O raio é: BASE * (1.2 ^ (maxDepth - depth)) — nós-pai sempre maiores.
function computeGraphData(articles: Article[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const BASE_RADIUS = 28;

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
    const radius = BASE_RADIUS * Math.pow(1.2, maxDepth - depth);
    return {
      id: art.id,
      title: art.title,
      source: art.source,
      tags: art.tags ?? [],
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
  wikipediaLang: "pt",
  selectedTag: null,
  folders: [],
  selectedFolder: null,
  graphScope: "global",
  localDepth: 1,
  pendingTask: null,
  toast: null,
  contextMenu: {
    visible: false, x: 0, y: 0,
    selectedText: "", parentArticleId: null,
  },

  // ── loadArticles ────────────────────────────────────────────────────────────
  loadArticles: async () => {
    const articles = await ipc<Article[]>("article:list");
    const { nodes, edges } = computeGraphData(articles);
    set({ articles, graphNodes: nodes, graphEdges: edges });
    // Carrega o idioma da Wikipedia salvo em config (uma vez, junto do bootstrap)
    try {
      const lang = await ipc<string | undefined>("config:get", { key: "wikipediaLang" });
      if (lang) set({ wikipediaLang: lang });
    } catch { /* mantém o padrão "pt" */ }
    await get().loadFolders();
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
  // Move o artigo para a lixeira (article:delete não apaga mais em definitivo —
  // ver articleHandlers.js/articles.ts). O caller (ArticleView) é responsável
  // por guardar os links removidos e oferecer "Desfazer" via restoreArticle.
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

  // ── restoreArticle ──────────────────────────────────────────────────────────
  // Desfaz uma exclusão recente (dentro da janela da lixeira). Não restaura
  // sozinho os links removidos de outros artigos — o caller reaplica via addLink.
  restoreArticle: async (id) => {
    const article = await ipc<Article>("article:restore", { id });
    set(s => {
      const articles = [article, ...s.articles.filter(a => a.id !== article.id)];
      const { nodes, edges } = computeGraphData(articles);
      return { articles, graphNodes: nodes, graphEdges: edges };
    });
    return article;
  },

  // ── fetchFromWikipedia ──────────────────────────────────────────────────────
  fetchFromWikipedia: async (query, parentId = null, exactTitle) => {
    set({ pendingTask: `Buscando "${exactTitle ?? query}" na Wikipédia…` });
    try {
      const wiki = await ipc<{ title: string; html: string; plainTextExtract: string }>(
        "wikipedia:fetch", { query, exactTitle, lang: get().wikipediaLang }
      );

      // Dedup: se já existe artigo da Wikipedia com o título resolvido, reutiliza
      const existing = get().articles.find(
        a => a.source === "wikipedia" && a.title.toLowerCase() === wiki.title.toLowerCase()
      );
      if (existing) {
        get().showToast(`"${wiki.title}" já existe — artigo reutilizado.`);
        return existing;
      }

      // Gera resumo via Claude automaticamente
      set({ pendingTask: `Resumindo "${wiki.title}" com Claude…` });
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
    } finally {
      set({ pendingTask: null });
    }
  },

  // ── generateWithClaude ──────────────────────────────────────────────────────
  generateWithClaude: async (title, parentId = null) => {
    set({ pendingTask: `Gerando "${title}" com Claude…` });
    try {
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
    } finally {
      set({ pendingTask: null });
    }
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
  setWikipediaLang: async (lang) => {
    set({ wikipediaLang: lang });
    await ipc("config:set", { key: "wikipediaLang", value: lang });
  },
  setSelectedTag: (tag) => set({ selectedTag: tag }),

  // ── Pastas ────────────────────────────────────────────────────────────────
  // Persistidas como um valor único (array serializado) via config:get/
  // config:set — não há handler IPC dedicado, reaproveita o mecanismo de
  // config já existente. Serializado explicitamente porque o config:set do
  // mobile (Capacitor Preferences) só aceita valores string — passar o array
  // direto vira "[object Object]" lá (o desktop, que grava em JSON puro,
  // toleraria o array cru, mas manter os dois shells na mesma convenção evita
  // esse tipo de divergência silenciosa).
  loadFolders: async () => {
    try {
      const raw = await ipc<string | undefined>("config:get", { key: "folders" });
      set({ folders: raw ? (JSON.parse(raw) as Folder[]) : [] });
    } catch {
      set({ folders: [] });
    }
  },
  createFolder: async (name) => {
    const folder: Folder = { id: crypto.randomUUID(), name: name.trim(), createdAt: new Date().toISOString() };
    const folders = [...get().folders, folder];
    set({ folders });
    await ipc("config:set", { key: "folders", value: JSON.stringify(folders) });
    return folder;
  },
  renameFolder: async (id, name) => {
    const folders = get().folders.map(f => f.id === id ? { ...f, name: name.trim() } : f);
    set({ folders });
    await ipc("config:set", { key: "folders", value: JSON.stringify(folders) });
  },
  deleteFolder: async (id) => {
    const folders = get().folders.filter(f => f.id !== id);
    set({ folders, selectedFolder: get().selectedFolder === id ? null : get().selectedFolder });
    await ipc("config:set", { key: "folders", value: JSON.stringify(folders) });
    // Artigos que estavam na pasta excluída voltam para "Sem pasta"
    const affected = get().articles.filter(a => a.folderId === id);
    for (const article of affected) {
      await get().saveArticle({ ...article, folderId: null });
    }
  },
  setArticleFolder: async (articleId, folderId) => {
    const article = get().articles.find(a => a.id === articleId);
    if (!article) return;
    await get().saveArticle({ ...article, folderId });
  },
  setSelectedFolder: (id) => set({ selectedFolder: id }),
  setGraphScope: (scope) => set({ graphScope: scope }),
  setLocalDepth: (depth) => set({ localDepth: depth }),
  updateTags: async (articleId, tags) => {
    const article = get().articles.find(a => a.id === articleId);
    if (!article) return;
    await get().saveArticle({ ...article, tags });
  },
  updateExcerptMarkdown: async (articleId, excerptId, editedMarkdown) => {
    const article = await ipc<Article>("article:updateExcerpt", { articleId, excerptId, editedMarkdown });
    set(s => ({ articles: s.articles.map(a => a.id === articleId ? article : a) }));
  },
  updateExcerptOutline: async (articleId, outline) => {
    const article = await ipc<Article>("article:updateExcerptOutline", { articleId, outline });
    set(s => ({ articles: s.articles.map(a => a.id === articleId ? article : a) }));
  },
  showToast: (message, type = "info", opts) => {
    set({ toast: { message, type, action: opts?.action } });
    setTimeout(() => {
      // Só limpa se ainda for o mesmo toast
      if (get().toast?.message === message) set({ toast: null });
    }, opts?.durationMs ?? 3500);
  },
  showContextMenu: (x, y, parentId, opts = {}) =>
    set({ contextMenu: {
      visible: true, x, y, parentArticleId: parentId,
      selectedText: opts.selectedText ?? "",
      tableHtml: opts.tableHtml, imageSrc: opts.imageSrc, imageAlt: opts.imageAlt,
    } }),
  hideContextMenu: () =>
    set({ contextMenu: { visible: false, x: 0, y: 0, selectedText: "", parentArticleId: null } }),

  rebuildGraph: () => {
    const { articles } = get();
    const { nodes, edges } = computeGraphData(articles);
    set({ graphNodes: nodes, graphEdges: edges });
  },
}));
