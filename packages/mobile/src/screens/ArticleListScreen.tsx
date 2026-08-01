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

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useStore, ReviewModal, FolderPicker } from "@lexicon/shared";
import type { Article, Flashcard, FlashcardGrade } from "@lexicon/shared";

const SOURCE_COLOR: Record<Article["source"], string> = {
  wikipedia: "#378ADD",
  claude: "#BA7517",
  manual: "#1D9E75",
};

interface Props {
  onOpenArticle: (id: string) => void;
  onNewArticle: () => void;
  onSettings: () => void;
  onOpenGraph: () => void;
}

export function ArticleListScreen({ onOpenArticle, onNewArticle, onSettings, onOpenGraph }: Props) {
  const {
    articles, activeArticleId, loadArticles,
    searchQuery, setSearchQuery, selectedTag, setSelectedTag, showToast,
    folders, selectedFolder, setSelectedFolder,
    createFolder, renameFolder, deleteFolder, setArticleFolder,
  } = useStore();

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
    if (!window.confirm(`Excluir a pasta "${name}"?\n\nOs artigos dentro dela voltam para "Sem pasta".`)) return;
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
    const res = await window.lexicon.invoke("article:exportMarkdown");
    if (!res.ok) { showToast(res.error ?? "Falha na exportação.", "error"); return; }
    const { count } = res.data as { count: number };
    if (count === 0) { showToast("Nenhum artigo para exportar."); return; }
    showToast(`${count} artigo${count > 1 ? "s" : ""} pronto${count > 1 ? "s" : ""} — escolha o destino.`);
  }

  async function handleExportFlashcardsCsv() {
    const res = await window.lexicon.invoke("article:exportFlashcardsCsv");
    if (!res.ok) { showToast(res.error ?? "Falha ao exportar flashcards.", "error"); return; }
    const { count } = res.data as { count: number };
    if (count === 0) { showToast("Nenhum trecho de texto salvo para exportar."); return; }
    showToast(`${count} flashcard${count > 1 ? "s" : ""} pronto${count > 1 ? "s" : ""} — escolha o destino.`);
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

  // ── Busca semântica opcional (via Claude) — mesmo padrão do App.tsx desktop ──
  const [semanticSearch, setSemanticSearch] = useState(false);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [semanticResultIds, setSemanticResultIds] = useState<string[] | null>(null);

  useEffect(() => {
    if (!semanticSearch || searchQuery.trim().length < 3) {
      setSemanticResultIds(null);
      return;
    }
    setSemanticLoading(true);
    const id = setTimeout(async () => {
      try {
        const res = await window.lexicon.invoke("claude:searchRank", {
          query: searchQuery.trim(),
          candidates: articles.map(a => ({ id: a.id, title: a.title, summary: a.summary })),
        });
        setSemanticResultIds(res.ok ? (res.data as { ids: string[] }).ids : null);
      } catch {
        setSemanticResultIds(null);
      } finally {
        setSemanticLoading(false);
      }
    }, 400);
    return () => clearTimeout(id);
  }, [semanticSearch, searchQuery, articles]);

  const filteredArticles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    if (semanticSearch && semanticResultIds && q.length >= 3) {
      const rank = new Map(semanticResultIds.map((id, i) => [id, i]));
      return articles
        .filter(a =>
          rank.has(a.id) &&
          (!selectedTag || (a.tags ?? []).includes(selectedTag)) &&
          (!selectedFolder || a.folderId === selectedFolder)
        )
        .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
    }

    let result = articles.filter(a =>
      (!q || (searchIndex.get(a.id) ?? "").includes(q)) &&
      (!selectedTag || (a.tags ?? []).includes(selectedTag)) &&
      (!selectedFolder || a.folderId === selectedFolder)
    );
    if (q) {
      result = [
        ...result.filter(a => a.title.toLowerCase().includes(q)),
        ...result.filter(a => !a.title.toLowerCase().includes(q)),
      ];
    }
    return result;
  }, [articles, searchQuery, selectedTag, selectedFolder, searchIndex, semanticSearch, semanticResultIds]);

  return (
    <div className="mobile-screen">
      <header className="mobile-header">
        <h1>Lexicon</h1>
        <div className="mobile-header-actions">
          <button className="mobile-icon-btn" title="Exportar Markdown" onClick={handleExportMarkdown}>⤓</button>
          <button className="mobile-icon-btn" title="Exportar flashcards (CSV)" onClick={handleExportFlashcardsCsv}>🎴</button>
          <button className="mobile-icon-btn" title="Grafo" onClick={onOpenGraph}>🕸</button>
          <button className="mobile-icon-btn" title="Configurações" onClick={onSettings}>⚙</button>
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
        <button
          type="button"
          className={`semantic-search-toggle ${semanticSearch ? "active" : ""}`}
          title={semanticSearch
            ? "Busca semântica ativa (via Claude) — toque para voltar à busca por texto"
            : "Ativar busca semântica (via Claude) — encontra por significado, não só texto exato"}
          onClick={() => setSemanticSearch(s => !s)}
        >
          {semanticLoading ? "…" : "✦"}
        </button>
      </div>

      {folders.length > 0 && (
        <div className="mobile-folders">
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
                    📁 {f.name}
                  </button>
                  <span className="folder-chip-actions">
                    <button type="button" title="Renomear pasta"
                            onClick={() => handleRenameFolderStart(f.id, f.name)}>✎</button>
                    <button type="button" title="Excluir pasta"
                            onClick={() => handleDeleteFolder(f.id, f.name)}>🗑</button>
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {allTags.length > 0 && (
        <div className="mobile-tags">
          {allTags.map(t => (
            <button
              key={t}
              className={`mobile-tag ${selectedTag === t ? "active" : ""}`}
              onClick={() => setSelectedTag(selectedTag === t ? null : t)}
            >
              #{t}
            </button>
          ))}
        </div>
      )}

      {dueCount > 0 && (
        <button className="global-review-btn" onClick={handleOpenGlobalReview}>
          🎓 Revisar flashcards ({dueCount})
        </button>
      )}

      <button className="mobile-new-article-btn" onClick={onNewArticle}>+ Novo artigo</button>

      <ul className="mobile-article-list">
        {filteredArticles.map(a => (
          <li
            key={a.id}
            className={`mobile-article-item ${a.id === activeArticleId ? "active" : ""}`}
            onClick={() => onOpenArticle(a.id)}
          >
            <span className="mobile-dot" style={{ background: SOURCE_COLOR[a.source] }} />
            <span className="mobile-article-title">{a.title}</span>
            {a.links.length > 0 && <span className="mobile-link-count">{a.links.length}</span>}
            <button
              type="button" className="article-item-folder-btn" title="Mover para pasta"
              onClick={e => {
                e.stopPropagation();
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setFolderPickerFor({ articleId: a.id, x: rect.left, y: rect.bottom + 4 });
              }}
            >
              📁
            </button>
          </li>
        ))}
        {filteredArticles.length === 0 && (
          <li className="mobile-empty">
            {searchQuery || selectedTag || selectedFolder ? "Nenhum resultado." : "Nenhum artigo ainda."}
          </li>
        )}
      </ul>

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
