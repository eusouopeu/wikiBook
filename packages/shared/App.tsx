// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/App.tsx
// Componente raiz do desktop — layout de 3 colunas: sidebar | conteúdo | painel de grafo
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useStore, computeLocalSubgraph } from "./store/useStore";
import type { Flashcard, FlashcardGrade } from "./shared/types";
import { GraphView } from "./components/GraphView";
import { ArticleView, ReviewModal } from "./components/ArticleView";

// ── Controles de zoom do grafo ────────────────────────────────────────────────
// Chama os métodos D3 expostos no SVGElement pelo GraphView
const GraphControls: React.FC<{ svgRef: React.RefObject<SVGSVGElement | null> }> = ({ svgRef }) => (
  <div className="graph-controls">
    <button title="Aproximar" onClick={() => (svgRef.current as any)?.__zoomIn()}>＋</button>
    <button title="Afastar"   onClick={() => (svgRef.current as any)?.__zoomOut()}>－</button>
    <button title="Resetar"   onClick={() => (svgRef.current as any)?.__zoomReset()}>⌖</button>
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

const SettingsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);
  const { wikipediaLang, setWikipediaLang } = useStore();
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
  const toast = useStore(s => s.toast);
  const pendingTask = useStore(s => s.pendingTask);
  if (!toast && !pendingTask) return null;
  return (
    <div className="status-overlay">
      {pendingTask && (
        <div className="pending-banner">
          <span className="spinner" />
          {pendingTask}
        </div>
      )}
      {toast && (
        <div className={`toast toast-${toast.type}`}>{toast.message}</div>
      )}
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
    selectedTag, setSelectedTag, showToast,
    graphScope, setGraphScope, localDepth, setLocalDepth,
  } = useStore();

  const [showNewModal, setShowNewModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Elemento SVG do grafo, recebido do GraphView após a montagem
  // (usado pelos botões de zoom em GraphControls)
  const [graphSvgEl, setGraphSvgEl] = useState<SVGSVGElement | null>(null);

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

  const filteredArticles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let result = articles.filter(a =>
      (!q || (searchIndex.get(a.id) ?? "").includes(q)) &&
      (!selectedTag || (a.tags ?? []).includes(selectedTag))
    );
    // Com busca ativa, artigos com match no título vêm primeiro
    if (q) {
      result = [
        ...result.filter(a => a.title.toLowerCase().includes(q)),
        ...result.filter(a => !a.title.toLowerCase().includes(q)),
      ];
    }
    return result;
  }, [articles, searchQuery, selectedTag, searchIndex]);

  // Exportação Markdown/Obsidian
  async function handleExport() {
    const res = await window.lexicon.invoke("article:exportMarkdown");
    if (!res.ok) { showToast(res.error ?? "Falha na exportação.", "error"); return; }
    if (res.data) {
      const { count, dir } = res.data as { count: number; dir: string };
      showToast(`${count} artigo${count > 1 ? "s" : ""} exportado${count > 1 ? "s" : ""} para ${dir}`);
    }
    // data === null → usuário cancelou o diálogo; nada a fazer
  }

  // Exportação de flashcards (trechos de texto salvos) para CSV/Anki
  async function handleExportFlashcards() {
    const res = await window.lexicon.invoke("article:exportFlashcardsCsv");
    if (!res.ok) { showToast(res.error ?? "Falha ao exportar flashcards.", "error"); return; }
    if (res.data === null) return;   // usuário cancelou o diálogo de salvar
    const { count } = res.data as { count: number };
    if (count === 0) { showToast("Nenhum trecho de texto salvo para exportar."); return; }
    showToast(`${count} flashcard${count > 1 ? "s" : ""} exportado${count > 1 ? "s" : ""}.`);
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
            <button className="icon-btn" title="Exportar para Markdown (Obsidian)" onClick={handleExport}>⤓</button>
            <button className="icon-btn" title="Exportar flashcards (CSV/Anki)" onClick={handleExportFlashcards}>🎴</button>
            <button className="icon-btn" title="Configurações" onClick={() => setShowSettings(true)}>⚙</button>
          </div>
        </div>

        <div className="sidebar-search">
          <input
            type="search"
            placeholder="Buscar em títulos e conteúdo…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Filtro por tag */}
        {allTags.length > 0 && (
          <div className="sidebar-tags">
            {allTags.map(t => (
              <button
                key={t}
                className={`sidebar-tag ${selectedTag === t ? "active" : ""}`}
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

        <button className="new-article-btn" onClick={() => setShowNewModal(true)}>
          + Novo artigo
        </button>

        <ul className="article-list">
          {filteredArticles.map(a => (
            <li
              key={a.id}
              className={`article-item ${a.id === activeArticleId ? "active" : ""}`}
              onClick={() => { openArticle(a.id); setView("article"); }}
            >
              <span className={`dot dot-${a.source}`} />
              <span className="article-item-title">{a.title}</span>
              {a.links.length > 0 && (
                <span className="link-count">{a.links.length}</span>
              )}
            </li>
          ))}
          {filteredArticles.length === 0 && (
            <li className="empty-list">
              {searchQuery || selectedTag ? "Nenhum resultado." : "Nenhum artigo ainda."}
            </li>
          )}
        </ul>
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
              <GraphControls svgRef={{ current: graphSvgEl }} />
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
                    onSvgReady={setGraphSvgEl}
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
