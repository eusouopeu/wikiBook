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
import { Dialog } from "@capacitor/dialog";
import { useStore, ReviewModal, FolderPicker, VirtualList, LogoMark, Icon } from "@lexicon/shared";
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
  onOpenPath: () => void;
}

export function ArticleListScreen({ onOpenArticle, onNewArticle, onSettings, onOpenGraph, onOpenPath }: Props) {
  const {
    articles, activeArticleId, loadArticles,
    searchQuery, setSearchQuery, selectedTags, toggleSelectedTag, showToast,
    folders, selectedFolder, setSelectedFolder,
    createFolder, renameFolder, deleteFolder, setArticleFolder,
    listDensity, setListDensity, beginPendingTask, endPendingTask,
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
  // Dialog.confirm em vez de window.confirm(): dentro da WebView do Capacitor,
  // o confirm() nativo do browser renderiza com estilo inconsistente com o
  // resto do app — ruim justo numa confirmação destrutiva.
  async function handleDeleteFolder(id: string, name: string) {
    const { value } = await Dialog.confirm({
      title: "Excluir pasta",
      message: `Excluir a pasta "${name}"?\n\nOs artigos dentro dela voltam para "Sem pasta".`,
      okButtonTitle: "Excluir",
      cancelButtonTitle: "Cancelar",
    });
    if (!value) return;
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

  // ── Busca semântica opcional (via Claude) — mesmo padrão do App.tsx desktop ──
  const [semanticSearch, setSemanticSearch] = useState(false);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [semanticResultIds, setSemanticResultIds] = useState<string[] | null>(null);
  // A chamada via CapacitorHttp não expõe cancelamento real (sem AbortSignal),
  // então usamos um token de requisição: cada busca dispara com um número
  // sequencial, e só a resposta cujo número ainda é o mais recente é aplicada
  // — descarta respostas obsoletas de buscas anteriores mais lentas.
  const searchRequestId = useRef(0);

  useEffect(() => {
    if (!semanticSearch || searchQuery.trim().length < 3) {
      setSemanticResultIds(null);
      return;
    }
    setSemanticLoading(true);
    const id = setTimeout(async () => {
      const requestId = ++searchRequestId.current;
      try {
        const res = await window.lexicon.invoke("claude:searchRank", {
          query: searchQuery.trim(),
          candidates: articles.map(a => ({ id: a.id, title: a.title, summary: a.summary })),
        });
        if (requestId !== searchRequestId.current) return;
        setSemanticResultIds(res.ok ? (res.data as { ids: string[] }).ids : null);
      } catch {
        if (requestId !== searchRequestId.current) return;
        setSemanticResultIds(null);
      } finally {
        if (requestId === searchRequestId.current) setSemanticLoading(false);
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
          selectedTags.every(t => (a.tags ?? []).includes(t)) &&
          (!selectedFolder || a.folderId === selectedFolder)
        )
        .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
    }

    let result = articles.filter(a =>
      (!q || (searchIndex.get(a.id) ?? "").includes(q)) &&
      selectedTags.every(t => (a.tags ?? []).includes(t)) &&
      (!selectedFolder || a.folderId === selectedFolder)
    );
    if (q) {
      result = [
        ...result.filter(a => a.title.toLowerCase().includes(q)),
        ...result.filter(a => !a.title.toLowerCase().includes(q)),
      ];
    }
    return result;
  }, [articles, searchQuery, selectedTags, selectedFolder, searchIndex, semanticSearch, semanticResultIds]);

  return (
    <div className="mobile-screen">
      <header className="mobile-header">
        <h1 className="mobile-header-logo"><LogoMark size={22} /> Wikibook</h1>
        <div className="mobile-header-actions">
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
          <button className="mobile-icon-btn" title="Grafo" aria-label="Abrir grafo" onClick={onOpenGraph}><Icon name="graph" /></button>
          <button className="mobile-icon-btn" title="Trilha" aria-label="Abrir trilhas de aprendizado" onClick={onOpenPath}><Icon name="path" /></button>
          <button className="mobile-icon-btn" title="Configurações" aria-label="Configurações" onClick={onSettings}><Icon name="settings" /></button>
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
          {semanticLoading ? "…" : <Icon name="semantic" />}
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

      {dueCount > 0 && (
        <button className="global-review-btn" onClick={handleOpenGlobalReview}>
          <Icon name="flashcards" /><span>Revisar flashcards ({dueCount})</span>
        </button>
      )}

      <button className="mobile-new-article-btn" onClick={onNewArticle}>+ Novo artigo</button>

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
              <span className="mobile-dot" style={{ background: SOURCE_COLOR[a.source] }} />
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
