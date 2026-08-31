// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/TopBar.tsx
// Barra superior padronizada entre todas as abas/telas (desktop e mobile):
// nome da aba (+ botão voltar, quando houver) à esquerda; à direita, ícones
// específicos da aba (actions), pesquisar (global) e alternar tema — sempre
// nesta ordem, para que a posição dos dois últimos nunca mude entre telas.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import { useStore, type ThemeMode } from "../store/useStore";
import { Icon, type IconName } from "./Icon";

const THEME_CYCLE: ThemeMode[] = ["system", "light", "dark"];
const THEME_ICON: Record<ThemeMode, IconName> = {
  system: "themeSystem", light: "themeLight", dark: "themeDark",
};
const THEME_LABEL: Record<ThemeMode, string> = {
  system: "Tema: Sistema", light: "Tema: Claro", dark: "Tema: Escuro",
};

export const ThemeToggleButton: React.FC<{ className?: string }> = ({ className }) => {
  const { theme, setTheme } = useStore();
  function cycle() {
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length];
    setTheme(next);
  }
  return (
    <button
      type="button"
      className={className ?? "icon-btn"}
      title={`${THEME_LABEL[theme]} — clique para alternar`}
      aria-label={`${THEME_LABEL[theme]} — clique para alternar`}
      onClick={cycle}
    >
      <Icon name={THEME_ICON[theme]} />
    </button>
  );
};

interface TopBarProps {
  title: string;
  onBack?: () => void;
  /** Conteúdo entre o título e os ícones fixos — ex.: tabs de visualização no desktop. */
  center?: React.ReactNode;
  /** Ícones específicos da aba atual, renderizados antes de pesquisar/tema. */
  actions?: React.ReactNode;
  onSearch?: () => void;
  searchTitle?: string;
  className?: string;
}

export const TopBar: React.FC<TopBarProps> = ({
  title, onBack, center, actions, onSearch, searchTitle = "Pesquisar (⌘F)", className,
}) => (
  <div className={`top-bar ${className ?? ""}`}>
    <div className="top-bar-left">
      {onBack && (
        <button type="button" className="icon-btn top-bar-back" title="Voltar" aria-label="Voltar" onClick={onBack}>
          <Icon name="back" />
        </button>
      )}
      <span className="top-bar-title">{title}</span>
      {center}
    </div>
    <div className="top-bar-right">
      {actions}
      <span className="top-bar-divider" />
      {onSearch && (
        <button type="button" className="icon-btn" title={searchTitle} aria-label={searchTitle} onClick={onSearch}>
          <Icon name="search" />
        </button>
      )}
      <ThemeToggleButton />
    </div>
  </div>
);
