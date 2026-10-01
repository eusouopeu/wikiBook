// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/store/slices/uiSlice.ts
// Estado de UI: view, busca, preferências persistidas, toasts, menu de contexto e tarefa pendente.
// ─────────────────────────────────────────────────────────────────────────────

import { ipc } from "../ipc";
import type { ThemeMode, UiSlice, SliceCreator } from "../types";

// ── Tema ───────────────────────────────────────────────────────────────────
// "system" não seta o atributo — o CSS já segue prefers-color-scheme por
// padrão; "light"/"dark" força via :root[data-theme=…], sobrepondo o SO
// (ver styles.css). Aplicado em document.documentElement (<html>), único
// alvo válido de seletores :root em CSS.
function applyTheme(theme: ThemeMode): void {
  if (typeof document === "undefined") return;
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

let pendingTaskSeq = 0;

export const createUiSlice: SliceCreator<UiSlice> = (set, get) => ({
  view: "article",
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
  graphScope: "global",
  localDepth: 1,
  pendingTask: null,
  pendingTaskToken: 0,
  toasts: [],
  errorHistory: [],
  searchFocusToken: 0,
  contextMenu: {
    visible: false, x: 0, y: 0,
    selectedText: "", parentArticleId: null,
  },

  loadPreferences: async () => {
    // Idioma da Wikipedia salvo em config (uma vez, junto do bootstrap)
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
  setGraphScope: (scope) => set({ graphScope: scope }),
  setLocalDepth: (depth) => set({ localDepth: depth }),
  showToast: (message, type = "info", opts) => {
    const id = crypto.randomUUID();
    set(s => {
      // Mantém no máximo 3 empilhados — descarta o mais antigo em vez de
      // deixar a pilha crescer sem limite.
      const toasts = [...s.toasts, { id, message, type, action: opts?.action }];
      // Erros também vão para o histórico persistente da sessão — o toast
      // some sozinho em segundos, o histórico fica até o usuário limpar.
      const errorHistory = type === "error"
        ? [...s.errorHistory, { id, message, time: new Date().toISOString() }].slice(-20)
        : s.errorHistory;
      return { toasts: toasts.length > 3 ? toasts.slice(toasts.length - 3) : toasts, errorHistory };
    });
    setTimeout(() => get().dismissToast(id), opts?.durationMs ?? 3500);
  },
  dismissToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
  clearErrorHistory: () => set({ errorHistory: [] }),
  requestSearchFocus: () => set(s => ({ searchFocusToken: s.searchFocusToken + 1 })),
  showContextMenu: (x, y, parentId, opts = {}) =>
    set({ contextMenu: {
      visible: true, x, y, parentArticleId: parentId,
      selectedText: opts.selectedText ?? "",
      tableHtml: opts.tableHtml, selectionTableHtml: opts.selectionTableHtml,
      imageSrc: opts.imageSrc, imageAlt: opts.imageAlt,
    } }),
  hideContextMenu: () =>
    set({ contextMenu: { visible: false, x: 0, y: 0, selectedText: "", parentArticleId: null } }),

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
});
