// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/ArticleSidebar.tsx
// Sidebar flutuante do desktop (⌘B alterna): busca local rankeada, recentes,
// pastas, filtro por tags, atalho da revisão global e lista virtualizada de
// artigos. Extraída de App.tsx — o shell só decide se ela aparece e repassa
// o que é compartilhado com o resto da tela (ref da busca para ⌘F,
// histórico de navegação, revisão global e modal de novo artigo).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store/useStore";
import type { Article } from "../shared/types";
import { FolderPicker } from "./FolderPicker";
import { LogoMark } from "./LogoMark";
import { Icon } from "./Icon";
import { MiniGraphPreview } from "./MiniGraphPreview";
import { VirtualList, type VirtualListHandle } from "./VirtualList";
import { scoreQueryMatch } from "../lib/searchRelevance";
import { confirmDialog } from "../lib/confirmDialog";
import { highlightMatch, extractSnippet } from "../lib/searchHighlight";
import { pickWeightedRandomArticle } from "../lib/randomArticle";

export const ArticleSidebar: React.FC<{
  searchInputRef: React.RefObject<HTMLInputElement>;
  onOpenArticle: (id: string) => void;
  recentArticles: Article[];
  onNewArticle: () => void;
  dueCount: number;
  onOpenReview: () => void;
}> = ({ searchInputRef, onOpenArticle, recentArticles, onNewArticle, dueCount, onOpenReview }) => {
  const {
    articles, activeArticleId, graphNodes, graphEdges,
    searchQuery, setSearchQuery, selectedTags, toggleSelectedTag,
    folders, selectedFolder, setSelectedFolder,
    createFolder, renameFolder, deleteFolder, setArticleFolder,
    listDensity, setListDensity, sidebarWidth, setSidebarWidth, setSidebarCollapsed,
  } = useStore();

  // ── Sidebar flutuante: redimensionar arrastando a borda direita ──────────
  const sidebarRef = useRef<HTMLElement>(null);
  const [draftSidebarWidth, setDraftSidebarWidth] = useState<number | null>(null);
  const currentSidebarWidth = draftSidebarWidth ?? sidebarWidth;
  useEffect(() => {
    if (draftSidebarWidth === null) return;
    function onMove(e: PointerEvent) {
      const rect = sidebarRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDraftSidebarWidth(Math.min(480, Math.max(200, e.clientX - rect.left)));
    }
    function onUp() {
      setDraftSidebarWidth(w => { if (w !== null) setSidebarWidth(w); return null; });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [draftSidebarWidth, setSidebarWidth]);

  // ── Tags: colapsa em 8 + "mais N", com filtro por digitação ──────────────
  const [tagFilter, setTagFilter] = useState("");
  const [showAllTags, setShowAllTags] = useState(false);

  // ── Biblioteca: só artigos sem nenhuma conexão (nem links, nem backlinks) ──
  const [showOrphansOnly, setShowOrphansOnly] = useState(false);
  const orphanIds = useMemo(() => {
    const connected = new Set<string>();
    for (const e of graphEdges) { connected.add(e.source); connected.add(e.target); }
    return new Set(articles.filter(a => !connected.has(a.id)).map(a => a.id));
  }, [articles, graphEdges]);

  // ── "Artigo aleatório" — pondera por artigos mais antigos/esquecidos ─────
  function handleRandomArticle() {
    const pick = pickWeightedRandomArticle(articles, activeArticleId);
    if (pick) onOpenArticle(pick.id);
  }

  // ── Pastas ──────────────────────────────────────────────────────────────
  const [folderPickerFor, setFolderPickerFor] = useState<{ articleId: string; x: number; y: number } | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  function handleRenameFolderStart(id: string, currentName: string) {
    setRenamingFolderId(id);
    setRenameDraft(currentName);
  }
  async function handleRenameFolderCommit() {
    if (renamingFolderId && renameDraft.trim()) await renameFolder(renamingFolderId, renameDraft.trim());
    setRenamingFolderId(null);
  }
  async function handleDeleteFolder(id: string, name: string) {
    const ok = await confirmDialog(
      `Os artigos dentro dela voltam para "Sem pasta".`,
      `Excluir a pasta "${name}"?`
    );
    if (!ok) return;
    await deleteFolder(id);
  }

  // ── Mini-grafo no hover da lista ────────────────────────────────────────
  const hoverTimerRef = useRef<number | null>(null);
  const [hoverPreview, setHoverPreview] = useState<{ articleId: string; x: number; y: number } | null>(null);

  function scheduleHoverPreview(articleId: string, rect: DOMRect) {
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => {
      const previewWidth = 220;
      const x = rect.right + 8 + previewWidth > window.innerWidth
        ? Math.max(8, rect.left - previewWidth - 8)
        : rect.right + 8;
      setHoverPreview({ articleId, x, y: Math.max(8, rect.top) });
    }, 300);
  }
  function cancelHoverPreview() {
    if (hoverTimerRef.current) { window.clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
    setHoverPreview(null);
  }
  useEffect(() => () => { if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current); }, []);

  // ── Atalhos de teclado ──────────────────────────────────────────────────
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  useEffect(() => { setHighlightedIndex(-1); }, [searchQuery, selectedTags, selectedFolder]);

  // Acima do limiar de virtualização, o item destacado por ArrowUp/ArrowDown
  // pode ficar fora da janela que o react-window mantém no DOM — sem isso, o
  // destaque "some" silenciosamente ao navegar além da tela visível.
  const articleListRef = useRef<VirtualListHandle>(null);
  useEffect(() => {
    if (highlightedIndex >= 0) articleListRef.current?.scrollToItem(highlightedIndex);
  }, [highlightedIndex]);

  // Índice de busca full-text: título + resumo + conteúdo + trechos + tags
  const searchIndex = useMemo(() => {
    const index = new Map<string, string>();
    for (const a of articles) {
      index.set(a.id, [
        a.title,
        a.summary,
        a.content.replace(/<[^>]+>/g, " "),
        ...(a.excerpts ?? []).map(e => e.plainText),
        ...(a.tags ?? []),
      ].join(" ").toLowerCase());
    }
    return index;
  }, [articles]);

  // Todas as tags em uso (para os chips de filtro)
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const a of articles) for (const t of a.tags ?? []) tags.add(t);
    return Array.from(tags).sort();
  }, [articles]);

  // Filtro por tag/pasta + busca local rankeada por relevância (ver
  // lib/searchRelevance.ts) — qualquer token da consulta presente no índice
  // já qualifica o artigo; a ordenação final é o que garante que o melhor
  // match (título exato/prefixo) apareça primeiro.
  const filteredArticles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const qTokens = q.split(/\s+/).filter(Boolean);
    let result = articles.filter(a => {
      if (!selectedTags.every(t => (a.tags ?? []).includes(t))) return false;
      if (selectedFolder && a.folderId !== selectedFolder) return false;
      if (showOrphansOnly && !orphanIds.has(a.id)) return false;
      if (!q) return true;
      const blob = searchIndex.get(a.id) ?? "";
      return qTokens.some(tok => blob.includes(tok));
    });
    if (q) {
      result = result
        .map(a => ({ a, score: scoreQueryMatch(q, a.title.toLowerCase(), searchIndex.get(a.id) ?? "") }))
        .sort((x, y) => y.score - x.score)
        .map(x => x.a);
    }
    return result;
  }, [articles, searchQuery, selectedTags, selectedFolder, searchIndex, showOrphansOnly, orphanIds]);

  return (
    <aside className="sidebar" ref={sidebarRef} style={{ width: currentSidebarWidth }}>
      <div className="sidebar-top">
        <button className="icon-btn" title="Ocultar sidebar (⌘B)" aria-label="Ocultar sidebar"
                onClick={() => setSidebarCollapsed(true)}><Icon name="sidebar" /></button>
        <span className="app-logo"><LogoMark size={20} /> Wikibook</span>
        <div className="sidebar-top-actions">
          <button
            className="icon-btn" title="Artigo aleatório — sorteia com peso para os mais antigos/esquecidos"
            aria-label="Abrir artigo aleatório" disabled={articles.length === 0}
            onClick={handleRandomArticle}
          >
            <Icon name="random" />
          </button>
          <button
            className={`icon-btn ${showOrphansOnly ? "icon-btn-active" : ""}`}
            title="Mostrar só artigos sem nenhuma conexão (órfãos)"
            aria-label="Mostrar só artigos sem nenhuma conexão" aria-pressed={showOrphansOnly}
            onClick={() => setShowOrphansOnly(v => !v)}
          >
            <Icon name="orphan" />
          </button>
          <button
            className="icon-btn"
            title={listDensity === "compact" ? "Lista compacta — clique para expandir" : "Lista expandida — clique para compactar"}
            aria-label={listDensity === "compact" ? "Alternar para lista expandida" : "Alternar para lista compacta"}
            onClick={() => setListDensity(listDensity === "compact" ? "comfortable" : "compact")}
          >
            <Icon name={listDensity === "compact" ? "densityCompact" : "densityComfortable"} />
          </button>
        </div>
      </div>

      <div className="sidebar-search">
        <input
          ref={searchInputRef}
          type="search"
          placeholder="Buscar em títulos e conteúdo… (⌘F)"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlightedIndex(i => Math.min(i + 1, filteredArticles.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlightedIndex(i => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && highlightedIndex >= 0 && filteredArticles[highlightedIndex]) {
              e.preventDefault();
              onOpenArticle(filteredArticles[highlightedIndex].id);
            }
          }}
        />
      </div>

      {/* Recentes (histórico de navegação da sessão) */}
      {recentArticles.length > 0 && (
        <div className="sidebar-recents">
          <span className="sidebar-recents-label"><Icon name="history" /> Recentes</span>
          <div className="sidebar-recents-list">
            {recentArticles.map(a => (
              <button key={a.id} type="button" className="sidebar-recent-item" title={a.title}
                      onClick={() => onOpenArticle(a.id)}>
                {a.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Pastas */}
      {folders.length > 0 && (
        <div className="sidebar-folders">
          {folders.map(f => (
            <div key={f.id} className={`folder-chip ${selectedFolder === f.id ? "active" : ""}`}>
              {renamingFolderId === f.id ? (
                <input
                  className="folder-chip-rename-input" autoFocus value={renameDraft}
                  onChange={e => setRenameDraft(e.target.value)}
                  onBlur={handleRenameFolderCommit}
                  onKeyDown={e => {
                    if (e.key === "Enter") handleRenameFolderCommit();
                    if (e.key === "Escape") setRenamingFolderId(null);
                  }}
                />
              ) : (
                <>
                  <button
                    type="button" className="folder-chip-label"
                    onClick={() => setSelectedFolder(selectedFolder === f.id ? null : f.id)}
                  >
                    <Icon name="folder" /><span>{f.name}</span>
                  </button>
                  <span className="folder-chip-actions">
                    <button type="button" title="Renomear pasta" aria-label="Renomear pasta"
                            onClick={() => handleRenameFolderStart(f.id, f.name)}><Icon name="edit" /></button>
                    <button type="button" title="Excluir pasta" aria-label="Excluir pasta"
                            onClick={() => handleDeleteFolder(f.id, f.name)}><Icon name="trash" /></button>
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Filtro por tag — colapsa em 8 + "mais N" quando há muitas, com busca por digitação */}
      {allTags.length > 0 && (() => {
        const filtered = tagFilter.trim()
          ? allTags.filter(t => t.toLowerCase().includes(tagFilter.trim().toLowerCase()))
          : allTags;
        const showAll = showAllTags || !!tagFilter.trim() || allTags.length <= 8;
        const visible = showAll ? filtered : filtered.slice(0, 8);
        const hiddenCount = showAll ? 0 : Math.max(0, filtered.length - 8);
        return (
          <div className="sidebar-tags-wrap">
            {allTags.length > 8 && (
              <input
                type="text" className="sidebar-tag-filter" placeholder="Filtrar tags…"
                value={tagFilter} onChange={e => setTagFilter(e.target.value)}
              />
            )}
            <div className="sidebar-tags">
              {visible.map(t => (
                <button
                  key={t}
                  className={`sidebar-tag ${selectedTags.includes(t) ? "active" : ""}`}
                  onClick={() => toggleSelectedTag(t)}
                >
                  #{t}
                </button>
              ))}
              {hiddenCount > 0 && (
                <button type="button" className="sidebar-tag sidebar-tag-more" onClick={() => setShowAllTags(true)}>
                  +{hiddenCount} mais
                </button>
              )}
              {showAllTags && allTags.length > 8 && !tagFilter.trim() && (
                <button type="button" className="sidebar-tag sidebar-tag-more" onClick={() => setShowAllTags(false)}>
                  mostrar menos
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {dueCount > 0 && (
        <button className="global-review-btn" onClick={onOpenReview}>
          <Icon name="flashcards" /><span>Revisar flashcards ({dueCount})</span>
        </button>
      )}

      <button className="new-article-btn" onClick={onNewArticle} title="Novo artigo (⌘N)">
        + Novo artigo
      </button>

      {filteredArticles.length === 0 ? (
        <ul className="article-list">
          <li className="empty-list">
            {showOrphansOnly ? "Nenhum artigo órfão — tudo conectado ao grafo."
              : searchQuery || selectedTags.length > 0 || selectedFolder ? "Nenhum resultado." : "Nenhum artigo ainda."}
          </li>
        </ul>
      ) : (
        <VirtualList
          ref={articleListRef}
          className={`article-list article-list-${listDensity}`}
          items={filteredArticles}
          itemHeight={listDensity === "compact" ? 30 : 56}
          itemKey={(a: Article) => a.id}
          renderItem={(a: Article, i: number) => {
            const q = searchQuery.trim();
            const titleMatches = q.length > 0 && a.title.toLowerCase().includes(q.toLowerCase());
            const bodyText = (a.summary || "").replace(/^•\s*/, "") || "Sem resumo.";
            const snippet = q && !titleMatches
              ? extractSnippet(searchIndex.get(a.id)?.slice(0, 4000) ?? "", q)
              : null;
            return (
            <div
              className={`article-item ${a.id === activeArticleId ? "active" : ""} ${i === highlightedIndex ? "highlighted" : ""}`}
              onClick={() => onOpenArticle(a.id)}
              onMouseEnter={e => scheduleHoverPreview(a.id, (e.currentTarget as HTMLElement).getBoundingClientRect())}
              onMouseLeave={cancelHoverPreview}
            >
              <span className={`dot dot-${a.source}`} />
              <div className="article-item-main">
                <span className="article-item-title">{q ? highlightMatch(a.title, q) : a.title}</span>
                {listDensity === "comfortable" && (
                  <span className="article-item-snippet">
                    {snippet
                      ? <>{snippet.before}<mark className="search-highlight">{snippet.match}</mark>{snippet.after}</>
                      : q ? highlightMatch(bodyText.slice(0, 90), q) : bodyText.slice(0, 90)}
                    {folders.find(f => f.id === a.folderId) && (
                      <span className="article-item-folder-label"> · <Icon name="folder" />{folders.find(f => f.id === a.folderId)!.name}</span>
                    )}
                  </span>
                )}
              </div>
              {a.links.length > 0 && (
                <span className="link-count">{a.links.length}</span>
              )}
              <button
                type="button" className="article-item-folder-btn" title="Mover para pasta"
                aria-label={`Mover "${a.title}" para pasta`}
                onClick={e => {
                  e.stopPropagation();
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setFolderPickerFor({ articleId: a.id, x: rect.left, y: rect.bottom + 4 });
                }}
              >
                <Icon name="folder" />
              </button>
            </div>
            );
          }}
        />
      )}

      {hoverPreview && (
        <MiniGraphPreview
          x={hoverPreview.x} y={hoverPreview.y}
          centerId={hoverPreview.articleId}
          nodes={graphNodes} edges={graphEdges}
        />
      )}

      {folderPickerFor && (
        <FolderPicker
          x={folderPickerFor.x} y={folderPickerFor.y}
          folders={folders}
          currentFolderId={articles.find(a => a.id === folderPickerFor.articleId)?.folderId}
          onSelect={async (folderId) => {
            await setArticleFolder(folderPickerFor.articleId, folderId);
            setFolderPickerFor(null);
          }}
          onCreate={createFolder}
          onClose={() => setFolderPickerFor(null)}
        />
      )}

      <div
        className="sidebar-resize-handle"
        onPointerDown={() => setDraftSidebarWidth(sidebarWidth)}
        title="Arraste para redimensionar"
      />
    </aside>
  );
};
