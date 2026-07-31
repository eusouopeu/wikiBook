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
export * from "./shared/types";
