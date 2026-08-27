// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/BottomNav.tsx
// Barra de navegação inferior fixa, com as views que antes viviam como ícones
// soltos no cabeçalho da lista de artigos (Grafo, Trilha, Configurações) mais
// a aba "Artigos" — sempre visível, com a aba atual destacada.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import { Icon } from "@lexicon/shared";
import type { IconName } from "@lexicon/shared";

export type BottomNavTab = "list" | "graph" | "path" | "settings";

interface NavItem { tab: BottomNavTab; label: string; icon: IconName; }

const ITEMS: NavItem[] = [
  { tab: "list", label: "Artigos", icon: "read" },
  { tab: "path", label: "Trilha", icon: "path" },
  { tab: "graph", label: "Grafo", icon: "graph" },
  { tab: "settings", label: "Ajustes", icon: "settings" },
];

interface Props {
  active: BottomNavTab;
  onSelect: (tab: BottomNavTab) => void;
}

export function BottomNav({ active, onSelect }: Props) {
  return (
    <nav className="mobile-bottom-nav" role="tablist" aria-label="Navegação principal">
      {ITEMS.map(item => (
        <button
          key={item.tab}
          type="button"
          role="tab"
          aria-selected={active === item.tab}
          className={`mobile-bottom-nav-item ${active === item.tab ? "active" : ""}`}
          title={item.label}
          aria-label={item.label}
          onClick={() => onSelect(item.tab)}
        >
          <Icon name={item.icon} />
        </button>
      ))}
    </nav>
  );
}
