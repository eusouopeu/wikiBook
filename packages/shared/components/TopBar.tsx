// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/TopBar.tsx
// Barra superior padronizada entre todas as abas/telas (desktop e mobile):
// nome da aba (+ botão voltar, quando houver) à esquerda; à direita, ícones
// específicos da aba (actions), pesquisar (global) e alternar tema — sempre
// nesta ordem, para que a posição dos dois últimos nunca mude entre telas.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from "react";
import { useStore, type ThemeMode } from "../store/useStore";
import { Icon, type IconName } from "./Icon";
import { useEscToClose } from "../lib/useEscToClose";

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

function formatErrorTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// Mini central de erros — os toasts de erro somem sozinhos em segundos; isso
// guarda os últimos da sessão (ver errorHistory em useStore.ts) num painel
// que fica disponível em qualquer aba, já que o TopBar é compartilhado.
const ErrorCenterButton: React.FC = () => {
  const errorHistory = useStore(s => s.errorHistory);
  const clearErrorHistory = useStore(s => s.clearErrorHistory);
  const [open, setOpen] = useState(false);
  useEscToClose(() => setOpen(false));
  if (errorHistory.length === 0) return null;
  return (
    <div className="error-center">
      <button
        type="button"
        className="icon-btn error-center-btn"
        title="Erros recentes desta sessão"
        aria-label={`Erros recentes desta sessão (${errorHistory.length})`}
        onClick={() => setOpen(v => !v)}
      >
        <Icon name="errors" />
        <span className="error-center-badge">{errorHistory.length}</span>
      </button>
      {open && (
        <>
          <div className="error-center-scrim" onClick={() => setOpen(false)} />
          <div className="error-center-panel">
            <div className="error-center-panel-header">
              <span>Erros recentes</span>
              <button type="button" className="text-btn" onClick={() => { clearErrorHistory(); setOpen(false); }}>
                Limpar
              </button>
            </div>
            <ul className="error-center-list">
              {[...errorHistory].reverse().map(e => (
                <li key={e.id} className="error-center-item">
                  <span className="error-center-item-time">{formatErrorTime(e.time)}</span>
                  <span className="error-center-item-message">{e.message}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
};

interface TopBarProps {
  title: string;
  onBack?: () => void;
  /** Conteúdo entre o título e os ícones fixos — ex.: tabs de visualização no desktop. */
  center?: React.ReactNode;
  /** Ícones específicos da aba atual, renderizados antes de pesquisar/tema. */
  actions?: React.ReactNode;
  /**
   * Move os ícones da aba para uma segunda barra fixa logo abaixo da barra
   * superior (aba Artigos e views de artigo), deixando a linha de cima só com
   * o título + pesquisar/erros/tema — assim o título ganha a largura toda.
   */
  actionsBelow?: boolean;
  onSearch?: () => void;
  searchTitle?: string;
  className?: string;
}

export const TopBar: React.FC<TopBarProps> = ({
  title, onBack, center, actions, actionsBelow = false,
  onSearch, searchTitle = "Pesquisar (⌘F)", className,
}) => {
  const bar = (
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
        {!actionsBelow && (
          <>
            {actions}
            <span className="top-bar-divider" />
          </>
        )}
        {onSearch && (
          <button type="button" className="icon-btn" title={searchTitle} aria-label={searchTitle} onClick={onSearch}>
            <Icon name="search" />
          </button>
        )}
        <ErrorCenterButton />
        <ThemeToggleButton />
      </div>
    </div>
  );

  if (!actionsBelow) return bar;
  return (
    <div className="top-bar-stack">
      {bar}
      <div className="top-bar-actions-row" role="toolbar" aria-label={`Ações de ${title}`}>
        {actions}
      </div>
    </div>
  );
};
