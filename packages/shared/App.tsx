// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/App.tsx
// Componente raiz do desktop — layout de 3 colunas: sidebar | conteúdo | painel de grafo
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore, computeLocalSubgraph } from "./store/useStore";
import type { Article, Flashcard, FlashcardGrade } from "./shared/types";
import { GraphView } from "./components/GraphView";
import { ArticleView, ReviewModal } from "./components/ArticleView";
import { FolderPicker } from "./components/FolderPicker";
import { MiniGraphPreview } from "./components/MiniGraphPreview";
import { VirtualList, type VirtualListHandle } from "./components/VirtualList";

// ── Controles de zoom do grafo ────────────────────────────────────────────────
// Chama os métodos D3 expostos no SVGElement pelo GraphView
const GraphControls: React.FC<{ canvasRef: React.RefObject<HTMLCanvasElement | null> }> = ({ canvasRef }) => (
  <div className="graph-controls">
    <button title="Aproximar" aria-label="Aproximar" onClick={() => (canvasRef.current as any)?.__zoomIn()}>＋</button>
    <button title="Afastar" aria-label="Afastar"   onClick={() => (canvasRef.current as any)?.__zoomOut()}>－</button>
    <button title="Resetar" aria-label="Resetar"   onClick={() => (canvasRef.current as any)?.__zoomReset()}>⌖</button>
  </div>
);

// ── Hook: fecha via tecla Esc ─────────────────────────────────────────────────
function useEscToClose(onClose: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
}

// ── Modal de novo artigo ──────────────────────────────────────────────────────
interface WikiSearchResult { title: string; snippet: string; }

const NewArticleModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<"wikipedia" | "claude">("wikipedia");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<WikiSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const { fetchFromWikipedia, generateWithClaude, wikipediaLang } = useStore();
  useEscToClose(onClose);

  // Prévia dos resultados da Wikipedia (busca com debounce de 400ms)
  useEffect(() => {
    if (source !== "wikipedia" || query.trim().length < 3) {
      setResults([]);
      return;
    }
    setSearching(true);
    const id = setTimeout(async () => {
      try {
        const res = await window.lexicon.invoke("wikipedia:search", {
          query: query.trim(), lang: wikipediaLang,
        });
        if (res.ok) setResults(res.data as WikiSearchResult[]);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(id);
  }, [query, source, wikipediaLang]);

  async function createArticle(exactTitle?: string) {
    if (!query.trim() && !exactTitle) return;
    setLoading(true);
    setError("");
    try {
      if (source === "wikipedia") await fetchFromWikipedia(query.trim(), null, exactTitle);
      else await generateWithClaude(query.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Novo artigo</h2>
        <form onSubmit={e => { e.preventDefault(); createArticle(); }}>
          <label>
            Título / Pesquisa
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Ex.: fotossíntese, inteligência artificial…"
            />
          </label>
          <div className="source-choice">
            <label>
              <input
                type="radio" name="source" value="wikipedia"
                checked={source === "wikipedia"}
                onChange={() => setSource("wikipedia")}
              />
              Buscar na Wikipedia ({wikipediaLang})
            </label>
            <label>
              <input
                type="radio" name="source" value="claude"
                checked={source === "claude"}
                onChange={() => setSource("claude")}
              />
              Gerar com Claude
            </label>
          </div>

          {/* Prévia dos resultados da Wikipedia — clique cria pelo título exato */}
          {source === "wikipedia" && query.trim().length >= 3 && (
            <div className="wiki-search-results">
              {searching && results.length === 0 && (
                <p className="wiki-search-hint">Buscando…</p>
              )}
              {!searching && results.length === 0 && (
                <p className="wiki-search-hint">Nenhum resultado ainda.</p>
              )}
              {results.map(r => (
                <button type="button" key={r.title} className="wiki-search-item"
                        disabled={loading} onClick={() => createArticle(r.title)}>
                  <span className="wiki-search-title">{r.title}</span>
                  <span className="wiki-search-snippet">{r.snippet}…</span>
                </button>
              ))}
            </div>
          )}

          {error && <p className="modal-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={loading}>Cancelar</button>
            <button type="submit" className="primary" disabled={loading || !query.trim()}>
              {loading ? "Carregando…" : "Criar artigo"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Configurações ─────────────────────────────────────────────────────────────
const WIKI_LANGS: Array<{ code: string; label: string }> = [
  { code: "pt", label: "Português" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
];

const THEME_OPTIONS: Array<{ value: "system" | "light" | "dark"; label: string }> = [
  { value: "system", label: "Sistema" },
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
];

const SettingsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);
  const { wikipediaLang, setWikipediaLang, theme, setTheme } = useStore();
  useEscToClose(onClose);

  useEffect(() => {
    window.lexicon.invoke("config:get", { key: "anthropicApiKey" }).then(r => {
      if (r.ok && r.data) setApiKey(r.data as string);
    });
  }, []);

  async function handleSave() {
    await window.lexicon.invoke("config:set", { key: "anthropicApiKey", value: apiKey });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Configurações</h2>
        <label>
          Anthropic API Key
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="sk-ant-api03-…"
          />
        </label>
        <p className="settings-hint">
          Salva criptografada (Keychain) em userData/config.json — nunca enviada para terceiros.
        </p>
        <label>
          Idioma da Wikipedia
          <select value={wikipediaLang} onChange={e => setWikipediaLang(e.target.value)}>
            {WIKI_LANGS.map(l => (
              <option key={l.code} value={l.code}>{l.label} ({l.code})</option>
            ))}
          </select>
        </label>
        <label>
          Tema
          <div className="theme-toggle" role="radiogroup" aria-label="Tema da interface">
            {THEME_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={theme === opt.value}
                className={`theme-toggle-btn ${theme === opt.value ? "active" : ""}`}
                onClick={() => setTheme(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </label>
        <div className="modal-actions">
          <button onClick={onClose}>Fechar</button>
          <button className="primary" onClick={handleSave}>
            {saved ? "✓ Salvo" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Toast + indicador de tarefa em andamento ──────────────────────────────────
const StatusOverlay: React.FC = () => {
  const toasts = useStore(s => s.toasts);
  const pendingTask = useStore(s => s.pendingTask);
  const dismissToast = useStore(s => s.dismissToast);
  if (toasts.length === 0 && !pendingTask) return null;
  return (
    <div className="status-overlay">
      {pendingTask && (
        <div className="pending-banner">
          <span className="spinner" />
          {pendingTask}
        </div>
      )}
      {toasts.map(toast => (
        <div key={toast.id} className={`toast toast-${toast.type}`} onClick={() => dismissToast(toast.id)}>
          {toast.message}
          {toast.action && (
            <button
              type="button"
              className="toast-action-btn"
              onClick={e => { e.stopPropagation(); toast.action!.onClick(); }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
};

// ── Legenda de cores do grafo ─────────────────────────────────────────────────
const GraphLegend: React.FC = () => (
  <div className="graph-legend">
    <span><i className="legend-dot" style={{ background: "#378ADD" }} /> Wikipédia</span>
    <span><i className="legend-dot" style={{ background: "#BA7517" }} /> Claude</span>
    <span><i className="legend-dot" style={{ background: "#1D9E75" }} /> Manual</span>
    <span><i className="legend-dot legend-ring" /> Anel = tag</span>
  </div>
);

// ── App principal ─────────────────────────────────────────────────────────────
export default function App() {
  const {
    articles, activeArticleId, view,
    graphNodes, graphEdges,
    loadArticles, openArticle, setView,
    searchQuery, setSearchQuery,
    selectedTags, toggleSelectedTag, showToast,
    graphScope, setGraphScope, localDepth, setLocalDepth,
    folders, selectedFolder, setSelectedFolder,
    createFolder, renameFolder, deleteFolder, setArticleFolder,
    listDensity, setListDensity, beginPendingTask, endPendingTask,
  } = useStore();

  const [showNewModal, setShowNewModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

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
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  useEffect(() => { setHighlightedIndex(-1); }, [searchQuery, selectedTags, selectedFolder]);

  // Acima do limiar de virtualização, o item destacado por ArrowUp/ArrowDown
  // pode ficar fora da janela que o react-window mantém no DOM — sem isso, o
  // destaque "some" silenciosamente ao navegar além da tela visível.
  const articleListRef = useRef<VirtualListHandle>(null);
  useEffect(() => {
    if (highlightedIndex >= 0) articleListRef.current?.scrollToItem(highlightedIndex);
  }, [highlightedIndex]);

  // Elemento SVG do grafo, recebido do GraphView após a montagem
  // (usado pelos botões de zoom em GraphControls)
  const [graphCanvasEl, setGraphCanvasEl] = useState<HTMLCanvasElement | null>(null);

  // Revisão global de flashcards (todos os artigos, agregados por vencimento)
  const [dueCount, setDueCount] = useState(0);
  const [globalReviewOpen, setGlobalReviewOpen] = useState(false);
  const [globalDueCards, setGlobalDueCards] = useState<Flashcard[]>([]);

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

  useEffect(() => { loadArticles(); refreshDueCount(); }, [refreshDueCount]);

  const activeArticle = articles.find(a => a.id === activeArticleId) ?? null;

  // Cmd/Ctrl+N (novo artigo) e Cmd/Ctrl+F (foca a busca da sidebar — cede o
  // atalho para a busca-na-página do ArticleView quando um artigo está aberto)
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      const isModalOpen = showNewModal || showSettings;
      if (key === "n" && !isModalOpen) {
        e.preventDefault();
        setShowNewModal(true);
        return;
      }
      if (key === "f") {
        if (view === "article" && activeArticle) return;
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showNewModal, showSettings, view, activeArticle]);

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

  // ── Busca semântica opcional (via Claude) ──────────────────────────────────
  // Opt-in explícito (toggle "✦"); debounce de 400ms; cai silenciosamente para
  // a busca por substring normal enquanto a chamada está em voo, se falhar, ou
  // se a API key não estiver configurada.
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
    // Com busca ativa, artigos com match no título vêm primeiro
    if (q) {
      result = [
        ...result.filter(a => a.title.toLowerCase().includes(q)),
        ...result.filter(a => !a.title.toLowerCase().includes(q)),
      ];
    }
    return result;
  }, [articles, searchQuery, selectedTags, selectedFolder, searchIndex, semanticSearch, semanticResultIds]);

  // Exportação Markdown/Obsidian
  async function handleExport() {
    const token = beginPendingTask("Exportando artigos…");
    try {
      const res = await window.lexicon.invoke("article:exportMarkdown");
      if (!res.ok) { showToast(res.error ?? "Falha na exportação.", "error"); return; }
      if (res.data) {
        const { count, dir } = res.data as { count: number; dir: string };
        showToast(`${count} artigo${count > 1 ? "s" : ""} exportado${count > 1 ? "s" : ""} para ${dir}`);
      }
      // data === null → usuário cancelou o diálogo; nada a fazer
    } finally {
      endPendingTask(token);
    }
  }

  // Exportação de flashcards (trechos de texto salvos) para CSV/Anki
  async function handleExportFlashcards() {
    const token = beginPendingTask("Exportando flashcards…");
    try {
      const res = await window.lexicon.invoke("article:exportFlashcardsCsv");
      if (!res.ok) { showToast(res.error ?? "Falha ao exportar flashcards.", "error"); return; }
      if (res.data === null) return;   // usuário cancelou o diálogo de salvar
      const { count } = res.data as { count: number };
      if (count === 0) { showToast("Nenhum trecho de texto salvo para exportar."); return; }
      showToast(`${count} flashcard${count > 1 ? "s" : ""} exportado${count > 1 ? "s" : ""}.`);
    } finally {
      endPendingTask(token);
    }
  }

  // Grafo local: artigo ativo + vizinhos até N saltos. Cai para global se não
  // houver artigo ativo (ex.: usuário abriu o grafo sem antes abrir um artigo).
  const displayedGraph = useMemo(() => {
    if (graphScope !== "local" || !activeArticleId) return { nodes: graphNodes, edges: graphEdges };
    return computeLocalSubgraph(graphNodes, graphEdges, activeArticleId, localDepth);
  }, [graphScope, activeArticleId, localDepth, graphNodes, graphEdges]);

  return (
    <div className="app-shell">

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-top">
          <span className="app-logo">Lexicon</span>
          <div className="sidebar-top-actions">
            <button className="icon-btn" title="Exportar para Markdown (Obsidian)" aria-label="Exportar para Markdown (Obsidian)" onClick={handleExport}>⤓</button>
            <button className="icon-btn" title="Exportar flashcards (CSV/Anki)" aria-label="Exportar flashcards (CSV/Anki)" onClick={handleExportFlashcards}>🎴</button>
            <button
              className="icon-btn"
              title={listDensity === "compact" ? "Lista compacta — clique para expandir" : "Lista expandida — clique para compactar"}
              aria-label={listDensity === "compact" ? "Alternar para lista expandida" : "Alternar para lista compacta"}
              onClick={() => setListDensity(listDensity === "compact" ? "comfortable" : "compact")}
            >
              {listDensity === "compact" ? "☰" : "▤"}
            </button>
            <button className="icon-btn" title="Configurações" aria-label="Configurações" onClick={() => setShowSettings(true)}>⚙</button>
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
                openArticle(filteredArticles[highlightedIndex].id);
                setView("article");
              }
            }}
          />
          <button
            type="button"
            className={`semantic-search-toggle ${semanticSearch ? "active" : ""}`}
            title={semanticSearch
              ? "Busca semântica ativa (via Claude) — clique para voltar à busca por texto"
              : "Ativar busca semântica (via Claude) — encontra por significado, não só texto exato"}
            onClick={() => setSemanticSearch(s => !s)}
          >
            {semanticLoading ? "…" : "✦"}
          </button>
        </div>

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
                      📁 {f.name}
                    </button>
                    <span className="folder-chip-actions">
                      <button type="button" title="Renomear pasta" aria-label="Renomear pasta"
                              onClick={() => handleRenameFolderStart(f.id, f.name)}>✎</button>
                      <button type="button" title="Excluir pasta" aria-label="Excluir pasta"
                              onClick={() => handleDeleteFolder(f.id, f.name)}>🗑</button>
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Filtro por tag */}
        {allTags.length > 0 && (
          <div className="sidebar-tags">
            {allTags.map(t => (
              <button
                key={t}
                className={`sidebar-tag ${selectedTags.includes(t) ? "active" : ""}`}
                onClick={() => toggleSelectedTag(t)}
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

        <button className="new-article-btn" onClick={() => setShowNewModal(true)}>
          + Novo artigo
        </button>

        {filteredArticles.length === 0 ? (
          <ul className="article-list">
            <li className="empty-list">
              {searchQuery || selectedTags.length > 0 || selectedFolder ? "Nenhum resultado." : "Nenhum artigo ainda."}
            </li>
          </ul>
        ) : (
          <VirtualList
            ref={articleListRef}
            className={`article-list article-list-${listDensity}`}
            items={filteredArticles}
            itemHeight={listDensity === "compact" ? 30 : 56}
            itemKey={(a: Article) => a.id}
            renderItem={(a: Article, i: number) => (
              <div
                className={`article-item ${a.id === activeArticleId ? "active" : ""} ${i === highlightedIndex ? "highlighted" : ""}`}
                onClick={() => { openArticle(a.id); setView("article"); }}
                onMouseEnter={e => scheduleHoverPreview(a.id, (e.currentTarget as HTMLElement).getBoundingClientRect())}
                onMouseLeave={cancelHoverPreview}
              >
                <span className={`dot dot-${a.source}`} />
                <div className="article-item-main">
                  <span className="article-item-title">{a.title}</span>
                  {listDensity === "comfortable" && (
                    <span className="article-item-snippet">
                      {(a.summary || "").replace(/^•\s*/, "").slice(0, 90) || "Sem resumo."}
                      {folders.find(f => f.id === a.folderId) && (
                        <span className="article-item-folder-label"> · 📁 {folders.find(f => f.id === a.folderId)!.name}</span>
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
                  📁
                </button>
              </div>
            )}
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
      </aside>

      {/* ── Área principal ───────────────────────────────────────────────── */}
      <main className="main-area">

        {/* Tabs de modo de visualização */}
        <div className="view-tabs">
          <button
            className={view === "article" ? "tab active" : "tab"}
            onClick={() => setView("article")}
            disabled={!activeArticle}
          >
            Artigo
          </button>
          <button
            className={view === "graph" ? "tab active" : "tab"}
            onClick={() => setView("graph")}
          >
            Grafo
          </button>
          {view === "graph" && (
            <>
              <div className="graph-scope-toggle">
                <button className={graphScope === "global" ? "active" : ""}
                        onClick={() => setGraphScope("global")}>Global</button>
                <button className={graphScope === "local" ? "active" : ""}
                        disabled={!activeArticle}
                        title={!activeArticle ? "Abra um artigo para ver o grafo local" : ""}
                        onClick={() => setGraphScope("local")}>Local</button>
              </div>
              {graphScope === "local" && (
                <select className="graph-depth-select" value={localDepth}
                        onChange={e => setLocalDepth(Number(e.target.value) as 1 | 2)}>
                  <option value={1}>1 salto</option>
                  <option value={2}>2 saltos</option>
                </select>
              )}
              <GraphControls canvasRef={{ current: graphCanvasEl }} />
            </>
          )}
        </div>

        {/* Conteúdo */}
        <div className="content-area">
          {view === "article" ? (
            activeArticle
              ? <ArticleView article={activeArticle} />
              : <div className="empty-state">
                  <p>Selecione um artigo ou crie um novo.</p>
                  <button className="primary" onClick={() => setShowNewModal(true)}>
                    + Novo artigo
                  </button>
                </div>
          ) : (
            <div className="graph-container">
              {displayedGraph.nodes.length > 0 ? (
                <>
                  <GraphView
                    nodes={displayedGraph.nodes}
                    edges={displayedGraph.edges}
                    onCanvasReady={setGraphCanvasEl}
                  />
                  <GraphLegend />
                </>
              ) : (
                <div className="empty-state">
                  <p>
                    {graphScope === "local"
                      ? "Este artigo não tem vizinhos dentro do alcance selecionado."
                      : "O grafo aparecerá aqui conforme você cria artigos e vínculos."}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* ── Modais ──────────────────────────────────────────────────────── */}
      {showNewModal  && <NewArticleModal  onClose={() => setShowNewModal(false)} />}
      {showSettings  && <SettingsModal    onClose={() => setShowSettings(false)} />}

      {/* ── Toast / tarefa em andamento ─────────────────────────────────── */}
      <StatusOverlay />

      {/* ── Revisão global de flashcards ─────────────────────────────────── */}
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
