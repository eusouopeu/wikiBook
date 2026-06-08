// ─────────────────────────────────────────────────────────────────────────────
// src/renderer/App.tsx
// Componente raiz — layout de 3 colunas: sidebar | conteúdo | painel de grafo
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from "react";
import { useStore } from "./store/useStore";
import { GraphView } from "./components/GraphView";
import { ArticleView } from "./components/ArticleView";

// ── Controles de zoom do grafo ────────────────────────────────────────────────
// Chama os métodos D3 expostos no SVGElement pelo GraphView
const GraphControls: React.FC<{ svgRef: React.RefObject<SVGSVGElement | null> }> = ({ svgRef }) => (
  <div className="graph-controls">
    <button title="Aproximar" onClick={() => (svgRef.current as any)?.__zoomIn()}>＋</button>
    <button title="Afastar"   onClick={() => (svgRef.current as any)?.__zoomOut()}>－</button>
    <button title="Resetar"   onClick={() => (svgRef.current as any)?.__zoomReset()}>⌖</button>
  </div>
);

// ── Modal de novo artigo ──────────────────────────────────────────────────────
const NewArticleModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<"wikipedia" | "claude">("wikipedia");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { fetchFromWikipedia, generateWithClaude } = useStore();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    try {
      if (source === "wikipedia") await fetchFromWikipedia(query.trim());
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
        <form onSubmit={handleSubmit}>
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
              Buscar na Wikipedia
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
const SettingsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    window.brita.invoke("config:get", { key: "anthropicApiKey" }).then(r => {
      if (r.ok && r.data) setApiKey(r.data as string);
    });
  }, []);

  async function handleSave() {
    await window.brita.invoke("config:set", { key: "anthropicApiKey", value: apiKey });
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
          Salva localmente em userData/config.json — nunca enviada para terceiros.
        </p>
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

// ── App principal ─────────────────────────────────────────────────────────────
export default function App() {
  const {
    articles, activeArticleId, view,
    graphNodes, graphEdges,
    loadArticles, openArticle, setView,
    searchQuery, setSearchQuery,
  } = useStore();

  const [showNewModal, setShowNewModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const graphSvgRef = React.useRef<SVGSVGElement>(null);

  // Passa a ref do SVG para o GraphView via callback após a montagem
  const [graphSvgEl, setGraphSvgEl] = useState<SVGSVGElement | null>(null);

  useEffect(() => { loadArticles(); }, []);

  const activeArticle = articles.find(a => a.id === activeArticleId) ?? null;

  const filteredArticles = searchQuery
    ? articles.filter(a =>
        a.title.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : articles;

  return (
    <div className="app-shell">

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-top">
          <span className="app-logo">Brita</span>
          <button className="icon-btn" title="Configurações" onClick={() => setShowSettings(true)}>⚙</button>
        </div>

        <div className="sidebar-search">
          <input
            type="search"
            placeholder="Filtrar artigos…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>

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
              {searchQuery ? "Nenhum resultado." : "Nenhum artigo ainda."}
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
            <GraphControls svgRef={{ current: graphSvgEl }} />
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
              {graphNodes.length > 0 ? (
                <GraphView
                  nodes={graphNodes}
                  edges={graphEdges}
                />
              ) : (
                <div className="empty-state">
                  <p>O grafo aparecerá aqui conforme você cria artigos e vínculos.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* ── Modais ──────────────────────────────────────────────────────── */}
      {showNewModal  && <NewArticleModal  onClose={() => setShowNewModal(false)} />}
      {showSettings  && <SettingsModal    onClose={() => setShowSettings(false)} />}
    </div>
  );
}
