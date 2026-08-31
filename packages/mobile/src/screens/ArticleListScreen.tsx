// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/screens/ArticleListScreen.tsx
// Primeira tela do shell mobile — reaproveita useStore de @lexicon/shared
// (mesmas actions/estado do desktop), mas com layout próprio (sem sidebar
// fixa). A derivação de busca/filtro por tag hoje vive dentro de App.tsx no
// desktop (não em useStore.ts) — como o mobile não reusa App.tsx inteiro
// (layout de 3 colunas não faz sentido em tela pequena), essa lógica é
// replicada aqui. A revisão global de flashcards (badge + modal agregando
// todos os artigos) é o mesmo padrão do App.tsx do desktop, também replicado
// pelo mesmo motivo.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useStore, ReviewModal, FolderPicker, VirtualList, TopBar, Icon, scoreQueryMatch, confirmDialog,
  highlightMatch, extractSnippet, pickWeightedRandomArticle,
} from "@lexicon/shared";
import type { Article, Flashcard, FlashcardGrade } from "@lexicon/shared";

// Pseudo-id local (não existe no backend) usado só para representar o card
// "Sem pasta" na grade de pastas — artigos com folderId nulo/indefinido.
const NO_FOLDER_ID = "__no_folder__";

// Alvo de toque mínimo de 48px (ver App.tsx desktop = 44/64 — no mobile
// compacto virava 46, arredondado pra cima) + o botão "mover para pasta" some
// da linha e só aparece arrastando (libera espaço pro título/resumo, ver
// recomendação de UX: alvos pequenos demais no modo compacto).
const SWIPE_REVEAL = 60;

const SwipeableRow: React.FC<{
  children: React.ReactNode;
  onReveal: (rect: DOMRect) => void;
}> = ({ children, onReveal }) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const [dx, setDx] = useState(0);
  const drag = useRef({ active: false, startX: 0, moved: false });

  function onPointerDown(e: React.PointerEvent) {
    drag.current = { active: true, startX: e.clientX, moved: false };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current.active) return;
    const delta = e.clientX - drag.current.startX;
    if (Math.abs(delta) > 4) drag.current.moved = true;
    setDx(Math.min(0, Math.max(-SWIPE_REVEAL, delta)));
  }
  function onPointerUp() {
    if (!drag.current.active) return;
    drag.current.active = false;
    setDx(d => (d < -SWIPE_REVEAL / 2 ? -SWIPE_REVEAL : 0));
  }
  // Um arraste real não deve também abrir o artigo (onClick da linha) —
  // suprime o clique sintético só quando houve movimento de fato.
  function onClickCapture(e: React.MouseEvent) {
    if (drag.current.moved) { e.preventDefault(); e.stopPropagation(); drag.current.moved = false; }
  }

  return (
    <div className="swipe-row">
      <button
        type="button" className="swipe-row-action" title="Mover para pasta" aria-label="Mover para pasta"
        onClick={() => {
          const rect = rowRef.current?.getBoundingClientRect();
          if (rect) onReveal(rect);
          setDx(0);
        }}
      >
        <Icon name="folder" />
      </button>
      <div
        ref={rowRef}
        className="swipe-row-content"
        style={{ transform: `translateX(${dx}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
    </div>
  );
};

interface Props {
  onOpenArticle: (id: string) => void;
}

export function ArticleListScreen({ onOpenArticle }: Props) {
  const {
    articles, activeArticleId, loadArticles,
    searchQuery, setSearchQuery, selectedTags, toggleSelectedTag,
    folders, selectedFolder, setSelectedFolder,
    createFolder, renameFolder, deleteFolder, setArticleFolder,
    listDensity, setListDensity,
    graphEdges, searchFocusToken,
  } = useStore();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Busca colapsável — mesmo ícone/posição do TopBar das outras abas (ver
  // recomendação de padronização); abre ao tocar o ícone de pesquisar aqui
  // ou ao chegar de outra aba via requestSearchFocus() (ver MobileApp.tsx).
  const [searchOpen, setSearchOpen] = useState(!!searchQuery.trim());
  useEffect(() => {
    if (searchFocusToken === 0) return;
    setSearchOpen(true);
    setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [searchFocusToken]);

  // Só artigos sem nenhuma conexão (nem links, nem backlinks)
  const [showOrphansOnly, setShowOrphansOnly] = useState(false);
  const orphanIds = useMemo(() => {
    const connected = new Set<string>();
    for (const e of graphEdges) { connected.add(e.source); connected.add(e.target); }
    return new Set(articles.filter(a => !connected.has(a.id)).map(a => a.id));
  }, [articles, graphEdges]);

  function handleRandomArticle() {
    const pick = pickWeightedRandomArticle(articles, activeArticleId);
    if (pick) onOpenArticle(pick.id);
  }

  // Alterna entre ver artigos agrupados por pasta (chips de pasta visíveis,
  // renomear/excluir pasta) e ver tudo solto, sem organização por pasta.
  const [libraryView, setLibraryView] = useState<"folders" | "flat">("folders");
  const [dueCount, setDueCount] = useState(0);
  const [globalReviewOpen, setGlobalReviewOpen] = useState(false);
  const [globalDueCards, setGlobalDueCards] = useState<Flashcard[]>([]);

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
    if (selectedFolder === id) setSelectedFolder(null);
    await deleteFolder(id);
  }

  const refreshDueCount = useCallback(async () => {
    const res = await window.lexicon.invoke("flashcards:listDue");
    if (res.ok) setDueCount((res.data as Flashcard[]).length);
  }, []);

  async function handleOpenGlobalReview() {
    const res = await window.lexicon.invoke("flashcards:listDue");
    if (res.ok) { setGlobalDueCards(res.data as Flashcard[]); setGlobalReviewOpen(true); }
  }

  async function handleGlobalGrade(articleId: string, cardId: string, grade: FlashcardGrade) {
    await window.lexicon.invoke("flashcards:grade", { articleId, cardId, grade });
  }

  useEffect(() => { loadArticles(); refreshDueCount(); }, [loadArticles, refreshDueCount]);

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

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const a of articles) for (const t of a.tags ?? []) tags.add(t);
    return Array.from(tags).sort();
  }, [articles]);

  // Contagem de artigos por pasta (+ "Sem pasta") para os cards da grade.
  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    let noFolder = 0;
    for (const a of articles) {
      if (a.folderId) counts.set(a.folderId, (counts.get(a.folderId) ?? 0) + 1);
      else noFolder++;
    }
    return { counts, noFolder };
  }, [articles]);

  // Grade de pastas (cards, não chips) é a home do modo "folders" — só cede
  // lugar à lista de artigos quando o usuário entra numa pasta específica ou
  // busca/filtra por tag (que cruzam todas as pastas, como no modo "flat").
  const inFolderDetail = libraryView === "folders" && !!selectedFolder;
  const showFolderGrid = libraryView === "folders" && !selectedFolder && folders.length > 0
    && !searchQuery.trim() && selectedTags.length === 0;

  const openFolder = folders.find(f => f.id === selectedFolder);

  // Filtro por tag/pasta + busca local rankeada por relevância — ver
  // lib/searchRelevance.ts (mesma lógica do App.tsx desktop; antes daqui
  // saía uma chamada de rede por tecla para claude:searchRank).
  const filteredArticles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const qTokens = q.split(/\s+/).filter(Boolean);
    let result = articles.filter(a => {
      if (!selectedTags.every(t => (a.tags ?? []).includes(t))) return false;
      if (libraryView === "folders" && selectedFolder === NO_FOLDER_ID && a.folderId) return false;
      if (libraryView === "folders" && selectedFolder && selectedFolder !== NO_FOLDER_ID && a.folderId !== selectedFolder) return false;
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
  }, [articles, searchQuery, selectedTags, selectedFolder, searchIndex, libraryView, showOrphansOnly, orphanIds]);

  return (
    <div className="mobile-screen">
      <TopBar
        title="Artigos"
        onSearch={() => { setSearchOpen(v => !v); setTimeout(() => searchInputRef.current?.focus(), 0); }}
        actions={
          <>
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
              title={libraryView === "folders" ? "Ver arquivos soltos (sem pastas)" : "Ver por pastas"}
              aria-label={libraryView === "folders" ? "Ver arquivos soltos (sem pastas)" : "Ver por pastas"}
              onClick={() => setLibraryView(v => v === "folders" ? "flat" : "folders")}
            >
              <Icon name={libraryView === "folders" ? "file" : "folder"} />
            </button>
            <button
              className="icon-btn"
              title={listDensity === "compact" ? "Lista compacta — toque para expandir" : "Lista expandida — toque para compactar"}
              aria-label={listDensity === "compact" ? "Alternar para lista expandida" : "Alternar para lista compacta"}
              onClick={() => setListDensity(listDensity === "compact" ? "comfortable" : "compact")}
            >
              <Icon name={listDensity === "compact" ? "densityCompact" : "densityComfortable"} />
            </button>
          </>
        }
      />

      {searchOpen && (
        <div className="mobile-search-row">
          <input
            ref={searchInputRef}
            className="mobile-search"
            type="search"
            placeholder="Buscar em títulos e conteúdo…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <button
            type="button" className="icon-btn" title="Fechar busca" aria-label="Fechar busca"
            onClick={() => { setSearchQuery(""); setSearchOpen(false); }}
          >
            <Icon name="close" />
          </button>
        </div>
      )}

      {inFolderDetail && (
        <div className="mobile-folder-detail-header">
          <button className="mobile-back-btn" onClick={() => setSelectedFolder(null)}>‹ Pastas</button>
          {openFolder && renamingFolderId === openFolder.id ? (
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
            <span className="mobile-folder-detail-title">
              <Icon name="folder" /><span>{openFolder ? openFolder.name : "Sem pasta"}</span>
            </span>
          )}
          {openFolder && renamingFolderId !== openFolder.id && (
            <span className="mobile-folder-detail-actions">
              <button type="button" title="Renomear pasta" aria-label="Renomear pasta"
                      onClick={() => handleRenameFolderStart(openFolder.id, openFolder.name)}><Icon name="edit" /></button>
              <button type="button" title="Excluir pasta" aria-label="Excluir pasta"
                      onClick={() => handleDeleteFolder(openFolder.id, openFolder.name)}><Icon name="trash" /></button>
            </span>
          )}
        </div>
      )}

      {dueCount > 0 && (
        <button className="global-review-btn" onClick={handleOpenGlobalReview}>
          <Icon name="flashcards" /><span>Revisar flashcards ({dueCount})</span>
        </button>
      )}

      {showFolderGrid ? (
        <div className="mobile-folder-grid">
          {folders.map(f => {
            const count = folderCounts.counts.get(f.id) ?? 0;
            return (
              <button key={f.id} type="button" className="mobile-folder-card" onClick={() => setSelectedFolder(f.id)}>
                <Icon name="folder" />
                <span className="mobile-folder-card-name">{f.name}</span>
                <span className="mobile-folder-card-count">{count} artigo{count === 1 ? "" : "s"}</span>
              </button>
            );
          })}
          {folderCounts.noFolder > 0 && (
            <button type="button" className="mobile-folder-card mobile-folder-card-none" onClick={() => setSelectedFolder(NO_FOLDER_ID)}>
              <Icon name="file" />
              <span className="mobile-folder-card-name">Sem pasta</span>
              <span className="mobile-folder-card-count">{folderCounts.noFolder} artigo{folderCounts.noFolder === 1 ? "" : "s"}</span>
            </button>
          )}
        </div>
      ) : (
      <>

      {allTags.length > 0 && (
        <div className="mobile-tags">
          {allTags.map(t => (
            <button
              key={t}
              className={`mobile-tag ${selectedTags.includes(t) ? "active" : ""}`}
              onClick={() => toggleSelectedTag(t)}
            >
              #{t}
            </button>
          ))}
        </div>
      )}

      {filteredArticles.length === 0 ? (
        <ul className="mobile-article-list">
          <li className="mobile-empty">
            {showOrphansOnly ? "Nenhum artigo órfão — tudo conectado ao grafo."
              : searchQuery || selectedTags.length > 0 || selectedFolder ? "Nenhum resultado." : "Nenhum artigo ainda."}
          </li>
        </ul>
      ) : (
        <VirtualList
          className={`mobile-article-list mobile-article-list-${listDensity}`}
          items={filteredArticles}
          itemHeight={listDensity === "compact" ? 48 : 68}
          itemKey={(a: Article) => a.id}
          renderItem={(a: Article) => {
            const q = searchQuery.trim();
            const titleMatches = q.length > 0 && a.title.toLowerCase().includes(q.toLowerCase());
            const bodyText = (a.summary || "").replace(/^•\s*/, "") || "Sem resumo.";
            const snippet = q && !titleMatches
              ? extractSnippet(searchIndex.get(a.id)?.slice(0, 4000) ?? "", q)
              : null;
            return (
            <SwipeableRow
              onReveal={rect => setFolderPickerFor({ articleId: a.id, x: rect.left, y: rect.bottom + 4 })}
            >
              <div
                className={`mobile-article-item ${a.id === activeArticleId ? "active" : ""}`}
                onClick={() => onOpenArticle(a.id)}
              >
                <div className="mobile-article-main">
                  <span className="mobile-article-title">{q ? highlightMatch(a.title, q) : a.title}</span>
                  {listDensity === "comfortable" && (
                    <span className="mobile-article-snippet">
                      {snippet
                        ? <>{snippet.before}<mark className="search-highlight">{snippet.match}</mark>{snippet.after}</>
                        : q ? highlightMatch(bodyText.slice(0, 70), q) : bodyText.slice(0, 70)}
                    </span>
                  )}
                </div>
                {a.links.length > 0 && <span className="mobile-link-count">{a.links.length}</span>}
              </div>
            </SwipeableRow>
            );
          }}
        />
      )}

      </>
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

      {globalReviewOpen && (
        <ReviewModal
          cards={globalDueCards}
          onGrade={handleGlobalGrade}
          onClose={() => { setGlobalReviewOpen(false); refreshDueCount(); }}
        />
      )}
    </div>
  );
}
