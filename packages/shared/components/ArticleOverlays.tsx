// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/ArticleOverlays.tsx
// Camadas flutuantes do leitor de artigo (dica de seleção, prévia de link
// interno, menu de contexto) — extraído de ArticleView.tsx.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ExcerptCategory } from "../shared/types";
import { Icon } from "./Icon";

// Posição fixa (x/y crus do evento de origem) encaixada dentro da viewport,
// com margem de 8px — compartilhado pelas três camadas flutuantes abaixo.
function useViewportClamp(x: number, y: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: y, left: x });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) { setPos({ top: y, left: x }); return; }
    const margin = 8;
    const rect = el.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - margin;
    const maxTop = window.innerHeight - rect.height - margin;
    setPos({
      left: Math.max(margin, Math.min(x, maxLeft)),
      top: Math.max(margin, Math.min(y, maxTop)),
    });
  }, [x, y]);

  return { ref, pos };
}

// ─────────────────────────────────────────────────────────────────────────────
// SelectionHintBubble — dica de descoberta mostrada na primeira seleção de
// texto de um artigo, ensinando o fluxo central do produto (menu de contexto
// para criar link / salvar trecho) sem exigir um wizard de onboarding.
// ─────────────────────────────────────────────────────────────────────────────

// Toque longo dispara o mesmo "contextmenu" no mobile (ver ArticleScreen.tsx
// no shell mobile) — sem instrução própria, a dica herdava texto de mouse
// ("clique com o botão direito"), que não existe em iOS/Android.
const isTouchPlatform =
  typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0);

export const SelectionHintBubble: React.FC<{ x: number; y: number; onDismiss: () => void }> = ({
  x, y, onDismiss,
}) => {
  const { ref, pos } = useViewportClamp(x, y);

  return (
    <div ref={ref} className="selection-hint-bubble"
         style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 998 }}
         onClick={e => e.stopPropagation()}>
      <Icon name="hint" /> {isTouchPlatform
        ? "Toque e segure para criar um link ou salvar este trecho."
        : "Clique com o botão direito para criar um link ou salvar este trecho."}
      <button type="button" className="selection-hint-dismiss" title="Entendi" aria-label="Fechar dica" onClick={onDismiss}><Icon name="close" /></button>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// LinkHoverPreview — prévia (título + início do resumo) ao passar o mouse
// sobre um link interno, sem precisar navegar até o artigo-alvo.
// ─────────────────────────────────────────────────────────────────────────────

export const LinkHoverPreview: React.FC<{ x: number; y: number; title: string; snippet: string }> = ({
  x, y, title, snippet,
}) => {
  const { ref, pos } = useViewportClamp(x, y);

  return (
    <div ref={ref} className="link-hover-preview"
         style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 999 }}>
      <strong className="link-hover-preview-title">{title}</strong>
      <p className="link-hover-preview-snippet">{snippet}</p>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ContextMenu
// ─────────────────────────────────────────────────────────────────────────────

interface ContextMenuProps {
  x: number; y: number; text: string;
  hasTable: boolean; hasSelectionTable: boolean; hasImage: boolean;
  onSearchWiki: () => void; onSearchClaude: () => void;
  onSaveExcerpt: (category: ExcerptCategory) => void;
  onSaveTable: () => void; onSaveSelectionTable: () => void; onSaveImage: () => void;
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  x, y, text, hasTable, hasSelectionTable, hasImage,
  onSearchWiki, onSearchClaude, onSaveExcerpt, onSaveTable, onSaveSelectionTable, onSaveImage, onClose,
}) => {
  const hasText = text.length > 0;

  useEffect(() => {
    let handler: (() => void) | undefined;
    const id = setTimeout(() => {
      handler = () => onClose();
      document.addEventListener("click", handler, { once: true });
    }, 0);
    return () => {
      clearTimeout(id);
      if (handler) document.removeEventListener("click", handler);
    };
  }, [onClose]);

  // Encaixa o menu dentro da viewport — sem isso, um toque/clique perto da
  // borda (comum em telas estreitas de celular) renderiza o menu cortado ou
  // fora da tela por completo, já que x/y vêm crus do evento de origem.
  const { ref: menuRef, pos } = useViewportClamp(x, y);

  return (
    <div ref={menuRef} className="context-menu" style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 1000 }}
         onClick={e => e.stopPropagation()}>
      {hasText && (
        <>
          <button className="context-menu-item" title="Pesquisar na Wikipédia" aria-label="Pesquisar na Wikipédia" onClick={onSearchWiki}><Icon name="search" /></button>
          <button className="context-menu-item" title="Gerar artigo com Claude" aria-label="Gerar artigo com Claude" onClick={onSearchClaude}><Icon name="semantic" /></button>
          <span className="context-menu-divider" />
          <button className="context-menu-item context-menu-save" title="Salvar trecho" aria-label="Salvar trecho"
                  onClick={() => onSaveExcerpt("default")}><Icon name="pin" /></button>
          <button className="context-menu-item context-menu-save" title="Salvar como conceito" aria-label="Salvar como conceito"
                  onClick={() => onSaveExcerpt("concept")}>
            <span className="ctx-cat-swatch ctx-cat-concept" />
          </button>
          <button className="context-menu-item context-menu-save" title="Salvar como lista" aria-label="Salvar como lista"
                  onClick={() => onSaveExcerpt("list")}>
            <span className="ctx-cat-swatch ctx-cat-list" />
          </button>
          <button className="context-menu-item context-menu-save" title="Salvar como dados numéricos" aria-label="Salvar como dados numéricos"
                  onClick={() => onSaveExcerpt("numeric")}>
            <span className="ctx-cat-swatch ctx-cat-numeric" />
          </button>
        </>
      )}
      {hasSelectionTable && (
        <button className="context-menu-item context-menu-save" title="Salvar só as células selecionadas"
                aria-label="Salvar só as células selecionadas" onClick={onSaveSelectionTable}>
          <Icon name="table" />
          <span className="ctx-badge">seleção</span>
        </button>
      )}
      {hasTable && (
        <button className="context-menu-item context-menu-save" title="Salvar tabela inteira em…" aria-label="Salvar tabela inteira em…" onClick={onSaveTable}><Icon name="table" /></button>
      )}
      {hasImage && (
        <button className="context-menu-item context-menu-save" title="Salvar imagem em…" aria-label="Salvar imagem em…" onClick={onSaveImage}><Icon name="image" /></button>
      )}
      <span className="context-menu-divider" />
      <button className="context-menu-item context-menu-cancel" title="Cancelar" aria-label="Cancelar" onClick={onClose}><Icon name="close" /></button>
    </div>
  );
};
