// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/store/types.ts
// Formato do store, dividido por fatia (slice). Cada fatia vive em
// store/slices/*.ts; useStore.ts só junta tudo. As fatias enxergam o estado
// inteiro (AppState) via get(), então uma pode chamar ações da outra.
// ─────────────────────────────────────────────────────────────────────────────

import type { StateCreator } from "zustand";
import type {
  Article, ExcerptOutlineItem, Folder, GraphNode, GraphEdge,
  LearningPath, InterviewAnswer, PathGenerationModel, PathUnit, ReviewOverview,
} from "../shared/types";

// "system" = segue o SO (ver applyTheme em slices/uiSlice.ts)
export type ThemeMode = "light" | "dark" | "system";

export type AppView = "article" | "graph" | "path" | "review";

export type PathDraft = {
  goal: string; interviewAnswers: InterviewAnswer[]; profileSummary: string;
  model: PathGenerationModel; units: PathUnit[]; createdAt: string;
};

// ── Artigos + grafo ──────────────────────────────────────────────────────────
export interface ArticlesSlice {
  articles: Article[];
  activeArticleId: string | null;
  loadingArticle: boolean;
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];

  loadArticles: () => Promise<void>;
  openArticle: (id: string) => Promise<void>;
  saveArticle: (article: Partial<Article> & { title: string }) => Promise<Article>;
  deleteArticle: (id: string) => Promise<void>;
  restoreArticle: (id: string) => Promise<Article>;
  fetchFromWikipedia: (query: string, parentId?: string | null, exactTitle?: string) => Promise<Article>;
  generateWithClaude: (title: string, parentId?: string | null, templateId?: string) => Promise<Article>;
  addLink: (parentId: string, anchorText: string, targetId: string, targetTitle: string) => Promise<void>;
  removeLink: (parentId: string, linkId: string) => Promise<void>;
  updateTags: (articleId: string, tags: string[]) => Promise<void>;
  updateExcerptMarkdown: (articleId: string, excerptId: string, editedMarkdown: string) => Promise<void>;
  updateExcerptOutline: (articleId: string, outline: ExcerptOutlineItem[]) => Promise<void>;
  rebuildGraph: () => void;
}

// ── Trilhas de aprendizado ───────────────────────────────────────────────────
export interface PathsSlice {
  paths: LearningPath[];
  activePathId: string | null;
  // Rascunho da última geração de trilha que ainda não terminou de importar
  // (ver savePathDraft/clearPathDraft) — guarda as unidades já pagas ao
  // Claude antes de importPathArticles rodar, para não perder a geração se o
  // app fechar, a rede cair ou um recurso falhar no meio da importação.
  pathDraft: PathDraft | null;

  loadPaths: () => Promise<void>;
  openPath: (id: string) => void;
  savePathRecord: (partial: Partial<LearningPath> & { goal: string }) => Promise<LearningPath>;
  deletePathRecord: (id: string) => Promise<void>;
  consolidateProfile: (goal: string, answers: InterviewAnswer[]) => Promise<string>;
  generatePathUnits: (goal: string, profileSummary: string, model: PathGenerationModel) => Promise<PathUnit[]>;
  importPathArticles: (units: PathUnit[], goal: string) => Promise<PathUnit[]>;
  loadPathDraft: () => Promise<void>;
  savePathDraft: (draft: Omit<PathDraft, "createdAt">) => Promise<void>;
  clearPathDraft: () => Promise<void>;
  completeStep: (pathId: string, stepId: string) => Promise<void>;
  uncompleteStep: (pathId: string, stepId: string) => Promise<void>;
}

// ── Pastas ───────────────────────────────────────────────────────────────────
export interface FoldersSlice {
  folders: Folder[];
  // Filtro por pasta na sidebar (null = todas)
  selectedFolder: string | null;

  loadFolders: () => Promise<void>;
  createFolder: (name: string) => Promise<Folder>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  setArticleFolder: (articleId: string, folderId: string | null) => Promise<void>;
  setSelectedFolder: (id: string | null) => void;
}

// ── Painel de revisão (flashcards) ───────────────────────────────────────────
export interface ReviewSlice {
  // Datas de vencimento de todos os cards + contagem de revisões por dia —
  // matéria-prima de computeReviewStats (lib/reviewStats.ts). null = ainda
  // não carregado.
  reviewOverview: ReviewOverview | null;
  loadReviewOverview: () => Promise<void>;
}

// ── UI, preferências e notificações ──────────────────────────────────────────
export type Toast = {
  id: string; message: string; type: "info" | "error";
  action?: { label: string; onClick: () => void };
};

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  selectedText: string;
  parentArticleId: string | null;
  tableHtml?: string;
  /** Sub-tabela remontada quando a seleção cruza mais de uma célula. */
  selectionTableHtml?: string;
  imageSrc?: string;
  imageAlt?: string;
}

export interface UiSlice {
  view: AppView;
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
  toasts: Toast[];
  // Histórico de erros da sessão (não persistido) — os toasts de erro somem
  // sozinhos em alguns segundos; isso guarda os últimos N para quem não leu a
  // tempo. Alimentado automaticamente por showToast(type: "error").
  errorHistory: Array<{ id: string; message: string; time: string }>;
  // Incrementado por requestSearchFocus() — sinal para o shell mobile trocar
  // para a aba Artigos e focar a busca a partir do ícone de pesquisar de
  // qualquer outra aba (desktop já resolve isso localmente em App.tsx, sem
  // precisar de estado global, pois a busca vive na mesma tela que as views).
  searchFocusToken: number;
  // Contexto do menu de clique direito no artigo — tableHtml/imageSrc/imageAlt
  // ficam presentes só quando o clique foi sobre uma tabela ou imagem
  contextMenu: ContextMenuState;

  // Lê as preferências persistidas em config (chamado por loadArticles no boot)
  loadPreferences: () => Promise<void>;
  setView: (v: AppView) => void;
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
  setGraphScope: (scope: "global" | "local") => void;
  setLocalDepth: (depth: 1 | 2) => void;
  showToast: (
    message: string, type?: "info" | "error",
    opts?: { action?: { label: string; onClick: () => void }; durationMs?: number }
  ) => void;
  dismissToast: (id: string) => void;
  clearErrorHistory: () => void;
  requestSearchFocus: () => void;
  showContextMenu: (x: number, y: number, parentId: string, opts?: {
    selectedText?: string; tableHtml?: string; selectionTableHtml?: string;
    imageSrc?: string; imageAlt?: string;
  }) => void;
  hideContextMenu: () => void;
  // Expostos para operações longas fora das actions do store (ex.: exportação
  // em App.tsx/ArticleListScreen.tsx) reaproveitarem o mesmo StatusOverlay já
  // usado por fetchFromWikipedia/generateWithClaude, sem risco de uma limpar
  // o status da outra se rodarem em paralelo — begin retorna um token que
  // update/end só aplicam se ainda for a operação "dona" do pendingTask atual.
  beginPendingTask: (task: string) => number;
  updatePendingTask: (token: number, task: string) => void;
  endPendingTask: (token: number) => void;
}

export type AppState = ArticlesSlice & PathsSlice & FoldersSlice & ReviewSlice & UiSlice;

export type SliceCreator<T> = StateCreator<AppState, [], [], T>;
