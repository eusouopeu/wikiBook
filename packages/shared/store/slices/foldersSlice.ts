// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/store/slices/foldersSlice.ts
// Pastas de artigos (persistidas em config) e filtro da sidebar.
// ─────────────────────────────────────────────────────────────────────────────

import type { Folder } from "../../shared/types";
import { ipc } from "../ipc";
import type { FoldersSlice, SliceCreator } from "../types";

  // Persistidas como um valor único (array serializado) via config:get/
  // config:set — não há handler IPC dedicado, reaproveita o mecanismo de
  // config já existente. Serializado explicitamente porque o config:set do
  // mobile (Capacitor Preferences) só aceita valores string — passar o array
  // direto vira "[object Object]" lá (o desktop, que grava em JSON puro,
  // toleraria o array cru, mas manter os dois shells na mesma convenção evita
  // esse tipo de divergência silenciosa).
export const createFoldersSlice: SliceCreator<FoldersSlice> = (set, get) => ({
  folders: [],
  selectedFolder: null,

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
});
