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
import { useStore, ReviewModal, FolderPicker, VirtualList, LogoMark, Icon, scoreQueryMatch, confirmDialog } from "@lexicon/shared";
import type { Article, Flashcard, FlashcardGrade } from "@lexicon/shared";

// Pseudo-id local (não existe no backend) usado só para representar o card
// "Sem pasta" na grade de pastas — artigos com folderId nulo/indefinido.
const NO_FOLDER_ID = "__no_folder__";

interface Props {
  onOpenArticle: (id: string) => void;
  onNewArticle: () => void;
}

export function ArticleListScreen({ onOpenArticle, onNewArticle }: Props) {
  const {
    articles, activeArticleId, loadArticles,
    searchQuery, setSearchQuery, selectedTags, toggleSelectedTag, showToast,
    folders, selectedFolder, setSelectedFolder,
    createFolder, renameFolder, deleteFolder, setArticleFolder,
    listDensity, setListDensity, beginPendingTask, endPendingTask,
  } = useStore();

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

  // Escreve os arquivos e abre o share sheet nativo — não existe "escolher
  // pasta" no mobile, quem decide o destino final é o usuário no share sheet
  // (Arquivos, iCloud Drive, Google Drive, AirDrop…).
  async function handleExportMarkdown() {
    const token = beginPendingTask("Exportando artigos…");
    try {
      const res = await window.lexicon.invoke("article:exportMarkdown");
      if (!res.ok) { showToast(res.error ?? "Falha na exportação.", "error"); return; }
      const { count } = res.data as { count: number };
      if (count === 0) { showToast("Nenhum artigo para exportar."); return; }
      showToast(`${count} artigo${count > 1 ? "s" : ""} pronto${count > 1 ? "s" : ""} — escolha o destino.`);
    } finally {
      endPendingTask(token);
    }
  }

  async function handleExportFlashcardsCsv() {
    const token = beginPendingTask("Exportando flashcards…");
    try {
      const res = await window.lexicon.invoke("article:exportFlashcardsCsv");
      if (!res.ok) { showToast(res.error ?? "Falha ao exportar flashcards.", "error"); return; }
      const { count } = res.data as { count: number };
      if (count === 0) { showToast("Nenhum trecho de texto salvo para exportar."); return; }
      showToast(`${count} flashcard${count > 1 ? "s" : ""} pronto${count > 1 ? "s" : ""} — escolha o destino.`);
    } finally {
      endPendingTask(token);
    }
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
  }, [articles, searchQuery, selectedTags, selectedFolder, searchIndex, libraryView]);

  return (
    <div className="mobile-screen">
      <header className="mobile-header">
        <h1 className="mobile-header-logo"><LogoMark size={22} /> Wikibook</h1>
        <div className="mobile-header-actions">
          <button
            className="mobile-icon-btn"
            title={libraryView === "folders" ? "Ver arquivos soltos (sem pastas)" : "Ver por pastas"}
            aria-label={libraryView === "folders" ? "Ver arquivos soltos (sem pastas)" : "Ver por pastas"}
            onClick={() => setLibraryView(v => v === "folders" ? "flat" : "folders")}
          >
            <Icon name={libraryView === "folders" ? "file" : "folder"} />
          </button>
          <button className="mobile-icon-btn" title="Exportar Markdown" aria-label="Exportar Markdown" onClick={handleExportMarkdown}><Icon name="save" /></button>
          <button className="mobile-icon-btn" title="Exportar flashcards (CSV)" aria-label="Exportar flashcards (CSV)" onClick={handleExportFlashcardsCsv}><Icon name="flashcardsExport" /></button>
          <button
            className="mobile-icon-btn"
            title={listDensity === "compact" ? "Lista compacta — toque para expandir" : "Lista expandida — toque para compactar"}
            aria-label={listDensity === "compact" ? "Alternar para lista expandida" : "Alternar para lista compacta"}
            onClick={() => setListDensity(listDensity === "compact" ? "comfortable" : "compact")}
          >
            <Icon name={listDensity === "compact" ? "densityCompact" : "densityComfortable"} />
          </button>
        </div>
      </header>

      <div className="mobile-search-row">
        <input
          className="mobile-search"
          type="search"
          placeholder="Buscar em títulos e conteúdo…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
      </div>

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

      <button className="mobile-new-article-btn" onClick={onNewArticle}>+ Novo artigo</button>

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
            {searchQuery || selectedTags.length > 0 || selectedFolder ? "Nenhum resultado." : "Nenhum artigo ainda."}
          </li>
        </ul>
      ) : (
        <VirtualList
          className={`mobile-article-list mobile-article-list-${listDensity}`}
          items={filteredArticles}
          itemHeight={listDensity === "compact" ? 46 : 64}
          itemKey={(a: Article) => a.id}
          renderItem={(a: Article) => (
            <div
              className={`mobile-article-item ${a.id === activeArticleId ? "active" : ""}`}
              onClick={() => onOpenArticle(a.id)}
            >
              <div className="mobile-article-main">
                <span className="mobile-article-title">{a.title}</span>
                {listDensity === "comfortable" && (
                  <span className="mobile-article-snippet">
                    {(a.summary || "").replace(/^•\s*/, "").slice(0, 70) || "Sem resumo."}
                  </span>
                )}
              </div>
              {a.links.length > 0 && <span className="mobile-link-count">{a.links.length}</span>}
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
          )}
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
