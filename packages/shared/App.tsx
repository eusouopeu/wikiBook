// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/App.tsx
// Componente raiz do desktop — NavRail | sidebar de artigos | área principal
// (artigo, grafo, trilha ou revisão). As peças maiores vivem em components/
// (ArticleSidebar, NavRail, NewArticleModal, OnboardingWizard…); aqui fica só
// o layout, os atalhos globais e o estado que atravessa mais de uma peça.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore, computeLocalSubgraph, type AppView } from "./store/useStore";
import type { Flashcard, FlashcardGrade } from "./shared/types";
import { GraphView } from "./components/GraphView";
import { ArticleView } from "./components/ArticleView";
import { ReviewModal } from "./components/ReviewModal";
import { ReviewDashboard } from "./components/ReviewDashboard";
import { PathView } from "./components/PathView";
import { SettingsModal } from "./components/SettingsModal";
import { Icon } from "./components/Icon";
import { TopBar } from "./components/TopBar";
import { NavRail } from "./components/NavRail";
import { ArticleSidebar } from "./components/ArticleSidebar";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { NewArticleModal } from "./components/NewArticleModal";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { StatusOverlay } from "./components/StatusOverlay";
import { GraphControls, GraphLegend } from "./components/GraphLegend";
import { useArticleHistory } from "./lib/useArticleHistory";

export { GraphLegend };

const VIEW_TITLES: Record<AppView, string> = {
  article: "Artigo", graph: "Grafo", path: "Trilha", review: "Revisão",
};

export default function App() {
  const {
    articles, activeArticleId, view,
    graphNodes, graphEdges,
    loadArticles, setView,
    selectedFolder,
    graphScope, setGraphScope, localDepth, setLocalDepth,
    sidebarCollapsed, setSidebarCollapsed,
    onboardingSeen, dismissOnboarding, loadReviewOverview,
  } = useStore();

  const [showNewModal, setShowNewModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const {
    pushHistory, openWithHistory, goBack, goForward, recentArticles, canGoBack, canGoForward,
  } = useArticleHistory();

  // ── Legenda do grafo: tag em destaque (esmaece o resto, não filtra) ──────
  const [graphTagFilter, setGraphTagFilter] = useState<string | null>(null);
  const toggleGraphTagFilter = useCallback((tag: string) => {
    setGraphTagFilter(prev => (prev === tag ? null : tag));
  }, []);

  // ── Painel de grafo local ao lado do artigo aberto ────────────────────────
  const [showLocalGraphPanel, setShowLocalGraphPanel] = useState(false);

  // Slot para onde o ArticleView manda (por portal) os ícones do cabeçalho do
  // artigo — assim eles ficam na barra fixa abaixo da TopBar, e não colados no
  // <h1>. Callback ref: precisa re-renderizar quando o nó existir, senão o
  // primeiro render do ArticleView ainda desenharia os ícones ao lado do título.
  const [articleActionsSlot, setArticleActionsSlot] = useState<HTMLDivElement | null>(null);

  // Busca da sidebar — o ref sobe até aqui por causa do ⌘F e do ícone de
  // pesquisar da TopBar
  const searchInputRef = useRef<HTMLInputElement>(null);

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


  // Fechar a sessão de revisão atualiza o contador da sidebar e o painel da
  // aba Revisão (vencimentos e log do dia mudaram)
  function handleCloseGlobalReview() {
    setGlobalReviewOpen(false);
    refreshDueCount();
    loadReviewOverview().catch(() => { /* painel recarrega ao abrir a aba */ });
  }

  // bootstrapped: só true depois que loadArticles() resolve — inclui a leitura
  // de onboardingSeen do config, então o wizard não pisca na tela para quem já
  // passou por ele (mostrar antes disso resolver usaria o default local false).
  const [bootstrapped, setBootstrapped] = useState(false);
  useEffect(() => { loadArticles().then(() => setBootstrapped(true)); refreshDueCount(); }, [refreshDueCount]);

  const activeArticle = articles.find(a => a.id === activeArticleId) ?? null;

  // Cmd/Ctrl+N (novo artigo), Cmd/Ctrl+F (foca a busca da sidebar — cede o
  // atalho para a busca-na-página do ArticleView quando um artigo está
  // aberto), Cmd/Ctrl+B (sidebar), Cmd/Ctrl+[ / ] (histórico) e "?" (atalhos)
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const isModalOpen = showNewModal || showSettings || showShortcuts;
      if (e.metaKey || e.ctrlKey) {
        const key = e.key.toLowerCase();
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
          return;
        }
        if (key === "b") {
          e.preventDefault();
          setSidebarCollapsed(!sidebarCollapsed);
          return;
        }
        if (e.key === "[") { e.preventDefault(); goBack(); return; }
        if (e.key === "]") { e.preventDefault(); goForward(); return; }
        return;
      }
      if (e.key === "?" && !isModalOpen) {
        const target = e.target as HTMLElement;
        if (["INPUT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable) return;
        e.preventDefault();
        setShowShortcuts(true);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showNewModal, showSettings, showShortcuts, view, activeArticle, sidebarCollapsed, setSidebarCollapsed, goBack, goForward]);

  // Grafo local: artigo ativo + vizinhos até N saltos. Cai para global se não
  // houver artigo ativo (ex.: usuário abriu o grafo sem antes abrir um artigo).
  const displayedGraph = useMemo(() => {
    if (graphScope !== "local" || !activeArticleId) return { nodes: graphNodes, edges: graphEdges };
    return computeLocalSubgraph(graphNodes, graphEdges, activeArticleId, localDepth);
  }, [graphScope, activeArticleId, localDepth, graphNodes, graphEdges]);

  // Tags presentes no grafo exibido no momento (para os chips da legenda)
  const displayedGraphTags = useMemo(() => {
    const tags = new Set<string>();
    for (const n of displayedGraph.nodes) for (const t of n.tags ?? []) tags.add(t);
    return Array.from(tags).sort();
  }, [displayedGraph]);
  useEffect(() => {
    if (graphTagFilter && !displayedGraphTags.includes(graphTagFilter)) setGraphTagFilter(null);
  }, [displayedGraphTags, graphTagFilter]);

  // Painel de grafo local (ao lado do artigo aberto) — mesmo cálculo do modo
  // "Local" da aba Grafo, sempre relativo ao artigo ativo (não ao graphScope).
  const localGraphPanelData = useMemo(() => {
    if (!activeArticleId) return { nodes: [], edges: [] };
    return computeLocalSubgraph(graphNodes, graphEdges, activeArticleId, localDepth);
  }, [activeArticleId, graphNodes, graphEdges, localDepth]);

  return (
    <div className="app-shell">

      {/* ── Navegação principal (Artigo/Grafo/Trilha/Revisão/Configurações) ── */}
      <NavRail
        view={view}
        setView={setView}
        hasActiveArticle={!!activeArticle}
        onSettings={() => setShowSettings(true)}
      />

      {/* ── Sidebar flutuante (⌘B alterna) ─────────────────────────────── */}
      {!sidebarCollapsed && (
        <ArticleSidebar
          searchInputRef={searchInputRef}
          onOpenArticle={openWithHistory}
          recentArticles={recentArticles}
          onNewArticle={() => setShowNewModal(true)}
          dueCount={dueCount}
          onOpenReview={handleOpenGlobalReview}
        />
      )}
      {sidebarCollapsed && (
        <button className="icon-btn sidebar-reveal-fab" title="Mostrar sidebar (⌘B)" aria-label="Mostrar sidebar"
                onClick={() => setSidebarCollapsed(false)}>
          <Icon name="sidebar" />
        </button>
      )}

      {/* ── Área principal ───────────────────────────────────────────────── */}
      <main className="main-area">

        {/* Barra superior padronizada: nome da aba + ícones específicos + pesquisar + tema */}
        <TopBar
          title={VIEW_TITLES[view]}
          onSearch={() => { setSidebarCollapsed(false); setTimeout(() => searchInputRef.current?.focus(), 0); }}
          searchTitle="Pesquisar artigos (⌘F)"
          actionsBelow={view === "article"}
          actions={
            <>
              {view === "article" && activeArticle && (
                <>
                  <div className="article-header-actions" ref={setArticleActionsSlot} />
                  <span className="top-bar-divider" />
                </>
              )}
              {view === "article" && activeArticle && (
                <button
                  className={`icon-btn ${showLocalGraphPanel ? "icon-btn-active" : ""}`}
                  title="Mostrar/ocultar grafo local ao lado do artigo"
                  aria-label="Mostrar/ocultar grafo local ao lado do artigo"
                  aria-pressed={showLocalGraphPanel}
                  onClick={() => setShowLocalGraphPanel(v => !v)}
                >
                  <Icon name="graph" />
                </button>
              )}
              {view === "article" && (
                <>
                  <button className="icon-btn" title="Artigo anterior (⌘[)" aria-label="Artigo anterior"
                          disabled={!canGoBack} onClick={goBack}><Icon name="prev" /></button>
                  <button className="icon-btn" title="Próximo artigo (⌘])" aria-label="Próximo artigo"
                          disabled={!canGoForward} onClick={goForward}><Icon name="next" /></button>
                </>
              )}
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
              <button className="icon-btn" title="Atalhos de teclado (?)" aria-label="Atalhos de teclado"
                      onClick={() => setShowShortcuts(true)}><Icon name="shortcuts" /></button>
            </>
          }
        />

        {/* Conteúdo */}
        <div className="content-area">
          {view === "article" ? (
            activeArticle
              ? (
                <div className={`article-with-graph-panel ${showLocalGraphPanel ? "split" : ""}`}>
                  <ArticleView article={activeArticle} headerActionsSlot={articleActionsSlot} />
                  {showLocalGraphPanel && (
                    <div className="local-graph-panel">
                      {localGraphPanelData.nodes.length > 1 ? (
                        <GraphView
                          nodes={localGraphPanelData.nodes}
                          edges={localGraphPanelData.edges}
                          onNodeOpen={pushHistory}
                        />
                      ) : (
                        <div className="empty-state empty-state-small">
                          <p>Este artigo não tem vizinhos conectados.</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
              : <div className="empty-state">
                  <p>Selecione um artigo ou crie um novo.</p>
                  <button className="primary" onClick={() => setShowNewModal(true)}>
                    + Novo artigo
                  </button>
                </div>
          ) : view === "graph" ? (
            <div className="graph-container">
              {displayedGraph.nodes.length > 0 ? (
                <>
                  <GraphView
                    nodes={displayedGraph.nodes}
                    edges={displayedGraph.edges}
                    onCanvasReady={setGraphCanvasEl}
                    onNodeOpen={pushHistory}
                    highlightTag={graphTagFilter}
                    highlightFolderId={selectedFolder}
                  />
                  <GraphLegend
                    tags={displayedGraphTags}
                    activeTag={graphTagFilter}
                    onToggleTag={toggleGraphTagFilter}
                  />
                </>
              ) : (
                <div className="empty-state">
                  <p>
                    {graphScope === "local"
                      ? "Este artigo não tem vizinhos dentro do alcance selecionado."
                      : "O grafo aparecerá aqui conforme você cria artigos e vínculos."}
                  </p>
                  <button className="primary" onClick={() => setShowNewModal(true)}>+ Novo artigo</button>
                </div>
              )}
            </div>
          ) : view === "path" ? (
            <PathView />
          ) : (
            <ReviewDashboard onStartReview={handleOpenGlobalReview} />
          )}
        </div>
      </main>

      {/* ── Modais ──────────────────────────────────────────────────────── */}
      {showNewModal  && <NewArticleModal  onClose={() => setShowNewModal(false)} />}
      {showSettings  && <SettingsModal    onClose={() => setShowSettings(false)} />}
      {showShortcuts && <ShortcutsModal   onClose={() => setShowShortcuts(false)} />}

      {/* ── Wizard de boas-vindas (primeira execução) ───────────────────── */}
      {bootstrapped && !onboardingSeen && (
        <OnboardingWizard
          onFinish={() => dismissOnboarding()}
          onCreateFirstArticle={() => { dismissOnboarding(); setShowNewModal(true); }}
        />
      )}

      {/* ── Toast / tarefa em andamento ─────────────────────────────────── */}
      <StatusOverlay />

      {/* ── Revisão global de flashcards ─────────────────────────────────── */}
      {globalReviewOpen && (
        <ReviewModal
          cards={globalDueCards}
          onGrade={handleGlobalGrade}
          onClose={handleCloseGlobalReview}
        />
      )}
    </div>
  );
}
