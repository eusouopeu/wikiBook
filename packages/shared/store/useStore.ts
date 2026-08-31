// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/store/useStore.ts
// Store Zustand central — compartilhado entre desktop e mobile
// ─────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import type {
  Article, ArticleLink, ExcerptOutlineItem, Folder, GraphNode, GraphEdge,
  LearningPath, InterviewAnswer, PathGenerationModel, PathUnit,
} from "../shared/types";

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

// Nome curto do bloco para a etiqueta "[N]/[nome]" — o título da unidade
// gerado pelo Claude não tem limite de tamanho, mas a etiqueta é um chip de
// UI, não um cabeçalho.
function shortenBlockName(title: string, maxLen = 28): string {
  if (title.length <= maxLen) return title;
  const cut = title.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 10 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

// ── Tema ───────────────────────────────────────────────────────────────────
// "system" não seta o atributo — o CSS já segue prefers-color-scheme por
// padrão; "light"/"dark" força via :root[data-theme=…], sobrepondo o SO
// (ver styles.css). Aplicado em document.documentElement (<html>), único
// alvo válido de seletores :root em CSS.
export type ThemeMode = "light" | "dark" | "system";

function applyTheme(theme: ThemeMode): void {
  if (typeof document === "undefined") return;
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

// ─────────────────────────────────────────────────────────────────────────────

interface AppState {
  // ── Artigos ────────────────────────────────────────────────────────────────
  articles: Article[];
  activeArticleId: string | null;
  loadingArticle: boolean;

  // ── Modo de visualização ──────────────────────────────────────────────────
  view: "article" | "graph" | "path";

  // ── Trilhas de aprendizado ───────────────────────────────────────────────
  paths: LearningPath[];
  activePathId: string | null;

  // ── Grafo ─────────────────────────────────────────────────────────────────
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];

  // ── UI states ──────────────────────────────────────────────────────────────
  searchQuery: string;
  isSearchOpen: boolean;
  // Idioma da Wikipedia (persistido em config.json)
  wikipediaLang: string;
  // Tema — persistido em config.json; "system" = segue o SO
  theme: ThemeMode;
  // Densidade da lista de artigos na sidebar — persistida em config.json
  listDensity: "compact" | "comfortable";
  // Sidebar flutuante do desktop — largura (arrastável) e visibilidade,
  // persistidas em config.json. Sem efeito no shell mobile (sem sidebar).
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  // Se o usuário já viu a dica de "selecione texto → botão direito" — depois
  // da primeira vez (ou do primeiro uso real do menu de contexto), nunca
  // mais é mostrada. Persistida em config.json.
  selectionHintSeen: boolean;
  // Se o usuário já passou pelo wizard de boas-vindas (primeira execução) —
  // persistida em config.json, igual a selectionHintSeen.
  onboardingSeen: boolean;
  // Filtro por tags na sidebar (vazio = todas) — múltiplas tags selecionadas
  // filtram por interseção, permitindo cruzar artigos por mais de um tema
  // simultaneamente, ortogonal às pastas (hierárquicas, uma só por artigo).
  selectedTags: string[];
  // ── Pastas ────────────────────────────────────────────────────────────────
  folders: Folder[];
  // Filtro por pasta na sidebar (null = todas)
  selectedFolder: string | null;
  // Escopo do grafo: global (tudo) ou local (artigo ativo + vizinhos)
  graphScope: "global" | "local";
  localDepth: 1 | 2;
  // Tarefa em andamento (ex.: geração via Claude disparada pelo menu de contexto)
  pendingTask: string | null;
  // Token da operação dona da mensagem atual de pendingTask — permite que
  // operações concorrentes (ex.: exportar enquanto uma busca na Wikipédia
  // ainda está em voo) não apaguem o status uma da outra: cada uma só
  // atualiza/limpa pendingTask se o token ainda for o dela. Uso interno do
  // store (ver beginPendingTask/updatePendingTask/endPendingTask).
  pendingTaskToken: number;
  // Fila de notificações transitórias — action opcional (ex.: "Desfazer" na
  // exclusão de artigo). Fila em vez de slot único: no mobile, ações em
  // sequência (salvar, gerar flashcard, exportar) disparam toasts
  // consecutivos, e um slot único faz o segundo sobrescrever o primeiro
  // antes de o usuário lê-lo.
  toasts: Array<{ id: string; message: string; type: "info" | "error"; action?: { label: string; onClick: () => void } }>;
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
  generateWithClaude: (title: string, parentId?: string | null, templateId?: string) => Promise<Article>;

  addLink: (parentId: string, anchorText: string, targetId: string, targetTitle: string) => Promise<void>;
  removeLink: (parentId: string, linkId: string) => Promise<void>;

  setView: (v: "article" | "graph" | "path") => void;

  // ── Trilhas de aprendizado ───────────────────────────────────────────────
  loadPaths: () => Promise<void>;
  openPath: (id: string) => void;
  savePathRecord: (partial: Partial<LearningPath> & { goal: string }) => Promise<LearningPath>;
  deletePathRecord: (id: string) => Promise<void>;
  consolidateProfile: (goal: string, answers: InterviewAnswer[]) => Promise<string>;
  generatePathUnits: (goal: string, profileSummary: string, model: PathGenerationModel) => Promise<PathUnit[]>;
  importPathArticles: (units: PathUnit[], goal: string) => Promise<PathUnit[]>;
  completeStep: (pathId: string, stepId: string) => Promise<void>;
  uncompleteStep: (pathId: string, stepId: string) => Promise<void>;
  setSearchQuery: (q: string) => void;
  setSearchOpen: (open: boolean) => void;
  setWikipediaLang: (lang: string) => Promise<void>;
  setTheme: (theme: ThemeMode) => Promise<void>;
  setListDensity: (density: "compact" | "comfortable") => Promise<void>;
  setSidebarWidth: (width: number) => Promise<void>;
  setSidebarCollapsed: (collapsed: boolean) => Promise<void>;
  dismissSelectionHint: () => Promise<void>;
  dismissOnboarding: () => Promise<void>;
  toggleSelectedTag: (tag: string) => void;
  clearSelectedTags: () => void;
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
  dismissToast: (id: string) => void;
  showContextMenu: (x: number, y: number, parentId: string, opts?: {
    selectedText?: string; tableHtml?: string; imageSrc?: string; imageAlt?: string;
  }) => void;
  hideContextMenu: () => void;
  rebuildGraph: () => void;
  // Expostos para operações longas fora das actions do store (ex.: exportação
  // em App.tsx/ArticleListScreen.tsx) reaproveitarem o mesmo StatusOverlay já
  // usado por fetchFromWikipedia/generateWithClaude, sem risco de uma limpar
  // o status da outra se rodarem em paralelo — begin retorna um token que
  // update/end só aplicam se ainda for a operação "dona" do pendingTask atual.
  beginPendingTask: (task: string) => number;
  updatePendingTask: (token: number, task: string) => void;
  endPendingTask: (token: number) => void;
}

let pendingTaskSeq = 0;

// ── Algoritmo de profundidade para calcular tamanho dos nós ──────────────────
// Um nó-raiz (sem pai) tem depth=0.
// Um nó filho de um depth=0 tem depth=1, e assim por diante.
// O raio é: BASE * (1.2 ^ (maxDepth - depth)) — nós-pai sempre maiores.
function computeGraphData(articles: Article[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
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
  paths: [],
  activePathId: null,
  graphNodes: [],
  graphEdges: [],
  searchQuery: "",
  isSearchOpen: false,
  wikipediaLang: "pt",
  theme: "system",
  listDensity: "comfortable",
  sidebarWidth: 260,
  sidebarCollapsed: false,
  selectionHintSeen: false,
  onboardingSeen: false,
  selectedTags: [],
  folders: [],
  selectedFolder: null,
  graphScope: "global",
  localDepth: 1,
  pendingTask: null,
  pendingTaskToken: 0,
  toasts: [],
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
    try {
      const theme = await ipc<string | undefined>("config:get", { key: "theme" });
      if (theme === "light" || theme === "dark" || theme === "system") {
        set({ theme });
        applyTheme(theme);
      }
    } catch { /* mantém o padrão "system" */ }
    try {
      const density = await ipc<string | undefined>("config:get", { key: "listDensity" });
      if (density === "compact" || density === "comfortable") set({ listDensity: density });
    } catch { /* mantém o padrão "comfortable" */ }
    try {
      const width = await ipc<string | undefined>("config:get", { key: "sidebarWidth" });
      const parsed = width ? Number(width) : NaN;
      if (!Number.isNaN(parsed) && parsed >= 200 && parsed <= 480) set({ sidebarWidth: parsed });
    } catch { /* mantém o padrão 260 */ }
    try {
      const collapsed = await ipc<string | undefined>("config:get", { key: "sidebarCollapsed" });
      if (collapsed === "true") set({ sidebarCollapsed: true });
    } catch { /* mantém o padrão false */ }
    try {
      const seen = await ipc<string | undefined>("config:get", { key: "selectionHintSeen" });
      if (seen === "true") set({ selectionHintSeen: true });
    } catch { /* mantém o padrão false */ }
    try {
      const onboardingSeen = await ipc<string | undefined>("config:get", { key: "onboardingSeen" });
      if (onboardingSeen === "true") set({ onboardingSeen: true });
    } catch { /* mantém o padrão false */ }
    await get().loadFolders();
    try { await get().loadPaths(); } catch { /* trilhas ficam vazias se falhar */ }
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

  // ── Trilhas de aprendizado ────────────────────────────────────────────────
  loadPaths: async () => {
    const paths = await ipc<LearningPath[]>("path:list");
    set({ paths });
  },
  openPath: (id) => set({ activePathId: id, view: "path" }),
  savePathRecord: async (partial) => {
    const saved = await ipc<LearningPath>("path:save", { path: partial });
    set(s => {
      const exists = s.paths.find(p => p.id === saved.id);
      const paths = exists ? s.paths.map(p => p.id === saved.id ? saved : p) : [saved, ...s.paths];
      return { paths, activePathId: saved.id };
    });
    return saved;
  },
  deletePathRecord: async (id) => {
    await ipc("path:delete", { id });
    set(s => ({
      paths: s.paths.filter(p => p.id !== id),
      activePathId: s.activePathId === id ? null : s.activePathId,
    }));
  },
  consolidateProfile: async (goal, answers) => {
    const r = await ipc<{ profileSummary: string }>("path:consolidateProfile", { goal, answers });
    return r.profileSummary;
  },
  generatePathUnits: async (goal, profileSummary, model) => {
    const r = await ipc<{ units: PathUnit[] }>("path:generate", { goal, profileSummary, model });
    return r.units;
  },
  // Cria uma pasta para a trilha e importa cada recurso "wikipedia" resolvido
  // (ver resolveWikipediaResource nos handlers — só recursos com URL real de
  // artigo, "/wiki/…", não a página de busca de fallback) como artigo local
  // dentro dela. Título "[nº da aula]/[nome do artigo]" (aula = ordem global
  // do passo no percurso), etiqueta "[nº do bloco]/[nome curto da unidade]".
  // Guarda o articleId de volta no recurso para o clique abrir no app em vez
  // do navegador externo (ver StepPanel). Falha em um recurso não derruba os
  // demais — o app continua funcional com o link externo como fallback.
  importPathArticles: async (units, goal) => {
    const token = get().beginPendingTask(`Importando artigos de "${goal}"…`);
    try {
      const folder = await get().createFolder(goal);
      const lang = get().wikipediaLang;

      const importedUnits: PathUnit[] = [];
      for (let unitIdx = 0; unitIdx < units.length; unitIdx++) {
        const unit = units[unitIdx];
        const tag = `${unitIdx + 1}/${shortenBlockName(unit.title)}`;
        const steps: typeof unit.steps = [];
        for (const step of unit.steps) {
          const resources: typeof step.resources = [];
          for (const resource of step.resources) {
            if (resource.kind !== "wikipedia" || !resource.url?.includes("/wiki/")) {
              resources.push(resource);
              continue;
            }
            try {
              get().updatePendingTask(token, `Importando "${resource.title}"…`);
              const wiki = await ipc<{ title: string; html: string }>(
                "wikipedia:fetch", { exactTitle: resource.title, lang }
              );
              const article = await get().saveArticle({
                title: `${step.order + 1}/${wiki.title}`,
                source: "wikipedia",
                content: wiki.html,
                summary: "",
                links: [],
                tags: [tag],
                folderId: folder.id,
              });
              resources.push({ ...resource, articleId: article.id });
            } catch {
              // Sem internet/artigo removido nesse meio-tempo — o recurso
              // continua existindo, só sem o link interno.
              resources.push(resource);
            }
          }
          steps.push({ ...step, resources });
        }
        importedUnits.push({ ...unit, steps });
      }
      return importedUnits;
    } finally {
      get().endPendingTask(token);
    }
  },
  completeStep: async (pathId, stepId) => {
    const learningPath = get().paths.find(p => p.id === pathId);
    if (!learningPath) return;
    const now = new Date().toISOString();
    const doneIds = new Set<string>();
    for (const unit of learningPath.units) {
      for (const step of unit.steps) {
        if (step.status === "done" || step.id === stepId) doneIds.add(step.id);
      }
    }
    const units = learningPath.units.map(unit => ({
      ...unit,
      steps: unit.steps.map(step => {
        if (step.id === stepId) return { ...step, status: "done" as const, completedAt: now };
        if (step.status === "done") return step;
        const unlocked = step.prerequisiteIds.every(id => doneIds.has(id));
        return unlocked ? { ...step, status: "available" as const } : step;
      }),
    }));
    await get().savePathRecord({ ...learningPath, units });
  },
  // Reverte um passo concluído por engano — como o desbloqueio é estritamente
  // sequencial (prerequisiteIds de um passo é sempre só o anterior no
  // percurso achatado, ver materializeUnits em pathMaterialize.js), desfazer
  // um passo também tranca de volta tudo que vem depois dele: a conclusão
  // desses dependia da cadeia passar por este passo, e deixá-los "done" sem
  // ele deixaria a serpentina num estado que a UI não sabe representar
  // (passo concluído com pré-requisito bloqueado).
  uncompleteStep: async (pathId, stepId) => {
    const learningPath = get().paths.find(p => p.id === pathId);
    if (!learningPath) return;
    const flatSteps = learningPath.units.flatMap(u => u.steps);
    const idx = flatSteps.findIndex(s => s.id === stepId);
    if (idx === -1) return;
    const invalidatedIds = new Set(flatSteps.slice(idx + 1).map(s => s.id));
    const units = learningPath.units.map(unit => ({
      ...unit,
      steps: unit.steps.map(step => {
        if (step.id === stepId) {
          const { completedAt, ...rest } = step;
          return { ...rest, status: "available" as const };
        }
        if (invalidatedIds.has(step.id)) {
          const { completedAt, ...rest } = step;
          return { ...rest, status: "locked" as const };
        }
        return step;
      }),
    }));
    await get().savePathRecord({ ...learningPath, units });
  },

  // ── UI actions ──────────────────────────────────────────────────────────────
  setView: (v) => set({ view: v }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSearchOpen: (open) => set({ isSearchOpen: open }),
  setWikipediaLang: async (lang) => {
    set({ wikipediaLang: lang });
    await ipc("config:set", { key: "wikipediaLang", value: lang });
  },
  setTheme: async (theme) => {
    set({ theme });
    applyTheme(theme);
    await ipc("config:set", { key: "theme", value: theme });
  },
  setListDensity: async (density) => {
    set({ listDensity: density });
    await ipc("config:set", { key: "listDensity", value: density });
  },
  setSidebarWidth: async (width) => {
    const clamped = Math.min(480, Math.max(200, Math.round(width)));
    set({ sidebarWidth: clamped });
    await ipc("config:set", { key: "sidebarWidth", value: String(clamped) });
  },
  setSidebarCollapsed: async (collapsed) => {
    set({ sidebarCollapsed: collapsed });
    await ipc("config:set", { key: "sidebarCollapsed", value: String(collapsed) });
  },
  dismissSelectionHint: async () => {
    set({ selectionHintSeen: true });
    await ipc("config:set", { key: "selectionHintSeen", value: "true" });
  },
  dismissOnboarding: async () => {
    set({ onboardingSeen: true });
    await ipc("config:set", { key: "onboardingSeen", value: "true" });
  },
  toggleSelectedTag: (tag) => set(s => ({
    selectedTags: s.selectedTags.includes(tag)
      ? s.selectedTags.filter(t => t !== tag)
      : [...s.selectedTags, tag],
  })),
  clearSelectedTags: () => set({ selectedTags: [] }),

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
    const id = crypto.randomUUID();
    set(s => {
      // Mantém no máximo 3 empilhados — descarta o mais antigo em vez de
      // deixar a pilha crescer sem limite.
      const toasts = [...s.toasts, { id, message, type, action: opts?.action }];
      return { toasts: toasts.length > 3 ? toasts.slice(toasts.length - 3) : toasts };
    });
    setTimeout(() => get().dismissToast(id), opts?.durationMs ?? 3500);
  },
  dismissToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
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

  beginPendingTask: (task) => {
    const token = ++pendingTaskSeq;
    set({ pendingTask: task, pendingTaskToken: token });
    return token;
  },
  updatePendingTask: (token, task) => {
    if (get().pendingTaskToken === token) set({ pendingTask: task });
  },
  endPendingTask: (token) => {
    if (get().pendingTaskToken === token) set({ pendingTask: null });
  },
}));
