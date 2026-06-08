// ─────────────────────────────────────────────────────────────────────────────
// src/renderer/components/ArticleView.tsx
// ─────────────────────────────────────────────────────────────────────────────

import React, { useRef, useEffect, useState, useCallback } from "react";
import type { Article, ArticleExcerpt } from "../../shared/types";
import { useStore } from "../store/useStore";

interface Props { article: Article; }

// Injeta links internos definidos pelo usuário no HTML do artigo
function injectInternalLinks(html: string, links: Article["links"]): string {
  let result = html;
  for (const link of links) {
    const escaped = link.anchorText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(
      new RegExp(`(<span class="wiki-term">)(${escaped})(</span>)`, "g"),
      `<a class="internal-link" data-article-id="${link.targetId}" href="#" title="${link.targetTitle}">$2</a>`
    );
  }
  return result;
}

// ── Captura o HTML da seleção atual via DOM ───────────────────────────────────
// Serializa o fragmento selecionado para string HTML mantendo tags de formatação.
function getSelectionHtml(): { html: string; plainText: string } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const plainText = selection.toString().trim();
  if (!plainText || plainText.length < 2) return null;

  // Clona o conteúdo selecionado em um div temporário para serializar
  const container = document.createElement("div");
  container.appendChild(range.cloneContents());
  const html = container.innerHTML;
  return { html, plainText };
}

// ── Modal para escolher onde salvar o trecho ──────────────────────────────────
interface SaveExcerptModalProps {
  html: string;
  plainText: string;
  sourceArticleId: string;
  sourceArticleTitle: string;
  articles: Article[];
  onSave: (targetId: string | null, targetTitle: string) => Promise<void>;
  onClose: () => void;
}

const SaveExcerptModal: React.FC<SaveExcerptModalProps> = ({
  html, plainText, sourceArticleId, sourceArticleTitle, articles, onSave, onClose,
}) => {
  const candidates = articles.filter(a => a.id !== sourceArticleId);
  const [mode, setMode]         = useState<"existing" | "new">(candidates.length > 0 ? "existing" : "new");
  const [selectedId, setSelectedId] = useState<string>(candidates[0]?.id ?? "");
  const [newTitle, setNewTitle]   = useState("");
  const [saving, setSaving]       = useState(false);
  const [filter, setFilter]       = useState("");

  const previewText = plainText.length > 200 ? plainText.slice(0, 198) + "…" : plainText;
  const filtered = candidates.filter(a => a.title.toLowerCase().includes(filter.toLowerCase()));

  async function handleConfirm() {
    setSaving(true);
    try {
      if (mode === "existing") {
        const target = candidates.find(a => a.id === selectedId);
        if (!target) return;
        await onSave(target.id, target.title);
      } else {
        if (!newTitle.trim()) return;
        await onSave(null, newTitle.trim());
      }
      onClose();
    } finally { setSaving(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal excerpt-modal" onClick={e => e.stopPropagation()}>
        <h2>Salvar trecho</h2>

        <div className="excerpt-preview">
          <span className="excerpt-preview-label">Trecho selecionado</span>
          {/* Renderiza o HTML do trecho na prévia */}
          <div
            className="excerpt-preview-html wiki-content"
            dangerouslySetInnerHTML={{ __html: html }}
          />
          <span className="excerpt-preview-source">de: {sourceArticleTitle}</span>
        </div>

        <div className="excerpt-dest-tabs">
          <button className={mode === "existing" ? "active" : ""} onClick={() => setMode("existing")} disabled={candidates.length === 0}>
            Artigo existente
          </button>
          <button className={mode === "new" ? "active" : ""} onClick={() => setMode("new")}>
            Novo artigo
          </button>
        </div>

        {mode === "existing" ? (
          <div className="excerpt-dest-list">
            <input type="search" placeholder="Filtrar artigos…" value={filter}
              onChange={e => setFilter(e.target.value)} autoFocus />
            <ul>
              {filtered.map(a => (
                <li key={a.id}
                  className={`excerpt-dest-item ${a.id === selectedId ? "selected" : ""}`}
                  onClick={() => setSelectedId(a.id)}>
                  <span className={`dot dot-${a.source}`} />
                  {a.title}
                  {(a.excerpts?.length ?? 0) > 0 && (
                    <span className="excerpt-count">{a.excerpts.length} trecho{a.excerpts.length > 1 ? "s" : ""}</span>
                  )}
                </li>
              ))}
              {filtered.length === 0 && <li className="excerpt-dest-empty">Nenhum artigo encontrado.</li>}
            </ul>
          </div>
        ) : (
          <div className="excerpt-new-title">
            <label>
              Título do novo artigo
              <input type="text" autoFocus value={newTitle} onChange={e => setNewTitle(e.target.value)}
                placeholder="Ex.: Minhas anotações sobre fotossíntese"
                onKeyDown={e => { if (e.key === "Enter" && newTitle.trim()) handleConfirm(); }} />
            </label>
            <p className="excerpt-new-hint">Um artigo manual será criado com este título.</p>
          </div>
        )}

        <div className="modal-actions">
          <button onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="primary" onClick={handleConfirm}
            disabled={saving || (mode === "existing" && !selectedId) || (mode === "new" && !newTitle.trim())}>
            {saving ? "Salvando…" : "Salvar trecho"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Painel de trechos salvos ──────────────────────────────────────────────────
interface ExcerptsPanelProps {
  articleId: string;
  excerpts: ArticleExcerpt[];
  onOpenSource: (id: string) => void;
  onRemove: (id: string) => void;
}

const ExcerptsPanel: React.FC<ExcerptsPanelProps> = ({ excerpts, onOpenSource, onRemove }) => {
  if (excerpts.length === 0) return null;
  return (
    <div className="excerpts-panel">
      <h2 className="section-heading">Trechos salvos</h2>
      <ul className="excerpts-list">
        {excerpts.map(ex => (
          <li key={ex.id} className="excerpt-item">
            {/* Renderiza o HTML do trecho com formatação preservada */}
            <div
              className="excerpt-html wiki-content"
              dangerouslySetInnerHTML={{ __html: ex.html }}
            />
            <div className="excerpt-meta">
              <button className="excerpt-source-btn" onClick={() => onOpenSource(ex.sourceArticleId)}>
                ↗ {ex.sourceArticleTitle}
              </button>
              <span className="excerpt-date">{new Date(ex.savedAt).toLocaleDateString("pt-BR")}</span>
              <button className="excerpt-remove-btn" onClick={() => onRemove(ex.id)} title="Remover">✕</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────────────────────

export const ArticleView: React.FC<Props> = ({ article }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const summaryRef   = useRef<HTMLDivElement>(null);
  const [showSummary, setShowSummary]         = useState(false);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [saveExcerptModal, setSaveExcerptModal] = useState<{
    visible: boolean; html: string; plainText: string;
  }>({ visible: false, html: "", plainText: "" });

  const { contextMenu, showContextMenu, hideContextMenu,
          fetchFromWikipedia, generateWithClaude, addLink,
          openArticle, articles, saveArticle, loadArticles } = useStore(s => ({
    contextMenu: s.contextMenu, showContextMenu: s.showContextMenu,
    hideContextMenu: s.hideContextMenu, fetchFromWikipedia: s.fetchFromWikipedia,
    generateWithClaude: s.generateWithClaude, addLink: s.addLink,
    openArticle: s.openArticle, articles: s.articles,
    saveArticle: s.saveArticle, loadArticles: s.loadArticles,
  }));

  // ── Clique direito — captura HTML da seleção ────────────────────────────────
  const handleContextMenu = useCallback((e: MouseEvent) => {
    const sel = getSelectionHtml();
    if (!sel) return;
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, sel.plainText, article.id);
  }, [article.id, showContextMenu]);

  // ── Clique em link interno ──────────────────────────────────────────────────
  const handleClick = useCallback((e: MouseEvent) => {
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>("a.internal-link");
    if (link) {
      e.preventDefault();
      const tid = link.getAttribute("data-article-id");
      if (tid) openArticle(tid);
    }
  }, [openArticle]);

  // Registra eventos nos dois containers (artigo completo e resumo)
  useEffect(() => {
    const refs = [containerRef.current, summaryRef.current].filter(Boolean);
    refs.forEach(el => {
      el!.addEventListener("contextmenu", handleContextMenu);
      el!.addEventListener("click", handleClick);
    });
    return () => refs.forEach(el => {
      el!.removeEventListener("contextmenu", handleContextMenu);
      el!.removeEventListener("click", handleClick);
    });
  }, [handleContextMenu, handleClick, showSummary]);

  // ── Trata imagens quebradas: reserva caixa com dimensões originais ──────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.querySelectorAll<HTMLImageElement>("img").forEach(img => {
      const applyFallback = () => {
        if (img.naturalHeight === 0) {
          img.style.display = "block";
          img.style.minHeight = img.getAttribute("height") ? `${img.getAttribute("height")}px` : "80px";
        }
      };
      img.addEventListener("error", applyFallback, { once: true });
      if (img.complete) applyFallback();
    });
  }, [article.id, article.content]);

  // ── Pesquisar no menu de contexto ──────────────────────────────────────────
  const handleSearch = useCallback(async (source: "wikipedia" | "claude") => {
    const { selectedText, parentArticleId } = contextMenu;
    hideContextMenu();
    if (!selectedText || !parentArticleId) return;
    const existing = articles.find(a => a.title.toLowerCase() === selectedText.toLowerCase());
    let target = existing;
    if (!target) {
      target = source === "wikipedia"
        ? await fetchFromWikipedia(selectedText, parentArticleId)
        : await generateWithClaude(selectedText, parentArticleId);
    }
    await addLink(parentArticleId, selectedText, target.id, target.title);
  }, [contextMenu, hideContextMenu, articles, fetchFromWikipedia, generateWithClaude, addLink]);

  // ── Abrir modal "Salvar trecho" ─────────────────────────────────────────────
  const handleOpenSaveExcerpt = useCallback(() => {
    const sel = getSelectionHtml();
    hideContextMenu();
    if (!sel) return;
    setSaveExcerptModal({ visible: true, html: sel.html, plainText: sel.plainText });
  }, [hideContextMenu]);

  // ── Confirmar salvamento ────────────────────────────────────────────────────
  const handleSaveExcerpt = useCallback(async (targetId: string | null, targetTitle: string) => {
    const res = await window.brita.invoke("article:appendExcerpt", {
      targetId, targetTitle,
      html: saveExcerptModal.html,
      sourceArticleId: article.id,
      sourceArticleTitle: article.title,
    });
    if (res.ok) await loadArticles();
  }, [saveExcerptModal.html, article.id, article.title, loadArticles]);

  const handleRemoveExcerpt = useCallback(async (excerptId: string) => {
    const res = await window.brita.invoke("article:removeExcerpt", { targetId: article.id, excerptId });
    if (res.ok) await loadArticles();
  }, [article.id, loadArticles]);

  const handleRegenerateSummary = useCallback(async () => {
    setIsLoadingSummary(true);
    try {
      const res = await window.brita.invoke("claude:summarize", {
        title: article.title,
        text: article.content.replace(/<[^>]+>/g, " ").slice(0, 6000),
      });
      if (res.ok && res.data) await saveArticle({ ...article, summary: (res.data as any).summary });
    } finally { setIsLoadingSummary(false); }
  }, [article, saveArticle]);

  const processedHtml = injectInternalLinks(article.content, article.links);
  const excerpts: ArticleExcerpt[] = article.excerpts ?? [];

  // Transforma bullet points do Claude em HTML com âncoras de seção
  const summaryHtml = article.summary
    ? article.summary.split("\n").filter(Boolean).map((line, i) =>
        `<p class="summary-bullet">${line.startsWith("•") ? line : "• " + line}</p>`
      ).join("")
    : "<p class='no-content'>Nenhum resumo disponível.</p>";

  return (
    <div className="article-view">

      {/* ── Cabeçalho estilo Wikipedia ──────────────────────────────────── */}
      <div className="article-header">
        <h1 className="article-title">{article.title}</h1>

        <div className="article-header-meta">
          <span className={`source-badge source-${article.source}`}>
            {article.source === "wikipedia" ? "Wikipédia" :
             article.source === "claude"    ? "Claude (IA)" : "Manual"}
          </span>
          <span className="header-sep">·</span>
          <span className="article-date">Atualizado em {new Date(article.updatedAt).toLocaleDateString("pt-BR")}</span>
          {excerpts.length > 0 && (
            <>
              <span className="header-sep">·</span>
              <span className="article-date">{excerpts.length} trecho{excerpts.length > 1 ? "s" : ""} salvos</span>
            </>
          )}
        </div>

        {/* Abas de modo (igual à "discussão / editar" da Wikipedia) */}
        <div className="wiki-tabs">
          <button className={!showSummary ? "wiki-tab active" : "wiki-tab"} onClick={() => setShowSummary(false)}>
            Artigo
          </button>
          <button className={showSummary ? "wiki-tab active" : "wiki-tab"} onClick={() => setShowSummary(true)}>
            Resumo
          </button>
        </div>
      </div>

      {/* ── Linha divisória ─────────────────────────────────────────────── */}
      <div className="wiki-divider" />

      {/* ── Corpo ───────────────────────────────────────────────────────── */}
      <div className="article-body">

        {/* Índice de links internos (estilo "Sumário" da Wikipedia) */}
        {article.links.length > 0 && !showSummary && (
          <div className="wiki-toc">
            <div className="wiki-toc-title">Conceitos vinculados</div>
            <ol className="wiki-toc-list">
              {article.links.map((link, i) => (
                <li key={link.id}>
                  <a href="#" className="toc-link"
                     onClick={e => { e.preventDefault(); openArticle(link.targetId); }}>
                    {link.anchorText}
                  </a>
                  <span className="toc-target"> — {link.targetTitle}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Conteúdo principal */}
        {showSummary ? (
          <div ref={summaryRef} className="wiki-content summary-content">
            <div dangerouslySetInnerHTML={{ __html: summaryHtml }} />
            <div className="summary-actions">
              <button className="wiki-btn" onClick={handleRegenerateSummary} disabled={isLoadingSummary}>
                {isLoadingSummary ? "Gerando…" : "↺ Regenerar resumo"}
              </button>
            </div>
          </div>
        ) : article.content ? (
          <div ref={containerRef} className="wiki-content"
               dangerouslySetInnerHTML={{ __html: processedHtml }} />
        ) : (
          <div ref={containerRef} className="wiki-content">
            <div dangerouslySetInnerHTML={{ __html: summaryHtml }} />
          </div>
        )}

        {/* Trechos salvos */}
        <ExcerptsPanel
          articleId={article.id}
          excerpts={excerpts}
          onOpenSource={id => openArticle(id)}
          onRemove={handleRemoveExcerpt}
        />

      </div>

      {/* ── Menu de contexto ─────────────────────────────────────────────── */}
      {contextMenu.visible && contextMenu.parentArticleId === article.id && (
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y} text={contextMenu.selectedText}
          onSearchWiki={() => handleSearch("wikipedia")}
          onSearchClaude={() => handleSearch("claude")}
          onSaveExcerpt={handleOpenSaveExcerpt}
          onClose={hideContextMenu}
        />
      )}

      {/* ── Modal de trecho ──────────────────────────────────────────────── */}
      {saveExcerptModal.visible && (
        <SaveExcerptModal
          html={saveExcerptModal.html}
          plainText={saveExcerptModal.plainText}
          sourceArticleId={article.id}
          sourceArticleTitle={article.title}
          articles={articles}
          onSave={handleSaveExcerpt}
          onClose={() => setSaveExcerptModal({ visible: false, html: "", plainText: "" })}
        />
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ContextMenu
// ─────────────────────────────────────────────────────────────────────────────

interface ContextMenuProps {
  x: number; y: number; text: string;
  onSearchWiki: () => void; onSearchClaude: () => void;
  onSaveExcerpt: () => void; onClose: () => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({
  x, y, text, onSearchWiki, onSearchClaude, onSaveExcerpt, onClose,
}) => {
  const label = text.length > 30 ? text.slice(0, 28) + "…" : text;
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

  return (
    <div className="context-menu" style={{ position: "fixed", top: y, left: x, zIndex: 1000 }}
         onClick={e => e.stopPropagation()}>
      <div className="context-menu-header">"{label}"</div>
      <button className="context-menu-item" onClick={onSearchWiki}>🔍 Pesquisar na Wikipédia</button>
      <button className="context-menu-item" onClick={onSearchClaude}>✦ Gerar artigo com Claude</button>
      <hr className="context-menu-divider" />
      <button className="context-menu-item context-menu-save" onClick={onSaveExcerpt}>📌 Salvar trecho em…</button>
      <hr className="context-menu-divider" />
      <button className="context-menu-item context-menu-cancel" onClick={onClose}>Cancelar</button>
    </div>
  );
};
