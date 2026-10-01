// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/NavRail.tsx
// Navegação principal do desktop: coluna flutuante de ícones à esquerda da
// sidebar (substitui as tabs de visualização que antes viviam no centro do
// TopBar) — mesmo papel do BottomNav do mobile.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import { Icon, type IconName } from "./Icon";
import type { AppView } from "../store/useStore";

const ITEMS: Array<{ view: AppView; label: string; icon: IconName }> = [
  { view: "article", label: "Artigo", icon: "read" },
  { view: "graph", label: "Grafo", icon: "graph" },
  { view: "path", label: "Trilha", icon: "path" },
  { view: "review", label: "Revisão", icon: "flashcards" },
];

export const NavRail: React.FC<{
  view: AppView;
  setView: (v: AppView) => void;
  hasActiveArticle: boolean;
  onSettings: () => void;
}> = ({ view, setView, hasActiveArticle, onSettings }) => (
  <nav className="nav-rail" aria-label="Navegação principal">
    {ITEMS.map(item => (
      <button
        key={item.view}
        type="button"
        className={`icon-btn nav-rail-item ${view === item.view ? "icon-btn-active" : ""}`}
        title={item.label} aria-label={item.label} aria-pressed={view === item.view}
        disabled={item.view === "article" && !hasActiveArticle}
        onClick={() => setView(item.view)}
      >
        <Icon name={item.icon} />
      </button>
    ))}
    <span className="nav-rail-spacer" />
    <button type="button" className="icon-btn nav-rail-item" title="Configurações" aria-label="Configurações" onClick={onSettings}>
      <Icon name="settings" />
    </button>
  </nav>
);
