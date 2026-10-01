// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/store/slices/articlesSlice.ts
// Artigos, links entre eles e o grafo derivado.
// ─────────────────────────────────────────────────────────────────────────────

import type { Article } from "../../shared/types";
import { ipc } from "../ipc";
import { computeGraphData } from "../graphData";
import type { ArticlesSlice, SliceCreator } from "../types";

export const createArticlesSlice: SliceCreator<ArticlesSlice> = (set, get) => ({
  articles: [],
  activeArticleId: null,
  loadingArticle: false,
  graphNodes: [],
  graphEdges: [],

  // ── loadArticles ────────────────────────────────────────────────────────────
  loadArticles: async () => {
    const articles = await ipc<Article[]>("article:list");
    const { nodes, edges } = computeGraphData(articles);
    set({ articles, graphNodes: nodes, graphEdges: edges });
    await get().loadPreferences();
    await get().loadFolders();
    try { await get().loadPaths(); } catch { /* trilhas ficam vazias se falhar */ }
    try { await get().loadPathDraft(); } catch { /* sem rascunho pendente */ }
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
    const token = get().beginPendingTask(`Buscando "${exactTitle ?? query}" na Wikipédia…`);
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

      // Sem resumo automático — fica em branco até o usuário pedir explicitamente
      // pelo botão "Regenerar resumo" na aba Resumo (evita pagar uma chamada à
      // API a cada importação, e o "resumo falhou" que aparecia sem API key).
      get().updatePendingTask(token, `Salvando "${wiki.title}"…`);
      const article = await get().saveArticle({
        title: wiki.title,
        source: "wikipedia",
        content: wiki.html,
        summary: "",
        links: [],
      });

      // Se veio de uma busca contextual (parentId fornecido), o caller é responsável
      // por chamar addLink com o texto selecionado
      return article;
    } finally {
      get().endPendingTask(token);
    }
  },

  // ── generateWithClaude ──────────────────────────────────────────────────────
  generateWithClaude: async (title, parentId = null, templateId = "padrao") => {
    const token = get().beginPendingTask(`Gerando "${title}" com Claude…`);
    try {
      // Coleta contexto dos artigos relacionados ao pai (se houver)
      let context = "";
      if (parentId) {
        const parent = get().articles.find(a => a.id === parentId);
        if (parent) context = parent.summary;
      }

      const r = await ipc<{ summary: string }>("claude:generate", { title, context, templateId });

      get().updatePendingTask(token, `Salvando "${title}"…`);
      const article = await get().saveArticle({
        title,
        source: "claude",
        content: "",   // artigos gerados pelo Claude não têm HTML, só bullet points
        summary: r.summary,
        links: [],
      });

      return article;
    } finally {
      get().endPendingTask(token);
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

  rebuildGraph: () => {
    const { articles } = get();
    const { nodes, edges } = computeGraphData(articles);
    set({ graphNodes: nodes, graphEdges: edges });
  },
});
