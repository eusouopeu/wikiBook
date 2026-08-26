// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/index.ts
// Barrel do pacote @lexicon/shared — consumido por packages/desktop e
// packages/mobile. Cada plataforma monta seu próprio shell de layout em torno
// destas peças; só o host (Electron IPC vs. Capacitor plugins) muda.
// ─────────────────────────────────────────────────────────────────────────────

export { default as App } from "./App";
export { useStore, computeLocalSubgraph } from "./store/useStore";
export { ArticleView, ReviewModal } from "./components/ArticleView";
export { GraphView } from "./components/GraphView";
export { PathView } from "./components/PathView";
export { FolderPicker } from "./components/FolderPicker";
export { SettingsModal } from "./components/SettingsModal";
export { TrashModal } from "./components/TrashModal";
export { LogoMark } from "./components/LogoMark";
export { Icon } from "./components/Icon";
export type { IconName } from "./components/Icon";
export { VirtualList } from "./components/VirtualList";
export type { VirtualListHandle } from "./components/VirtualList";
export * from "./shared/types";
export { confirmDialog } from "./lib/confirmDialog";
export { scoreQueryMatch } from "./lib/searchRelevance";
