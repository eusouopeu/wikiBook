// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/App.tsx
// Componente raiz do desktop — layout de 3 colunas: sidebar | conteúdo | painel de grafo
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore, computeLocalSubgraph } from "./store/useStore";
import type { Article, Flashcard, FlashcardGrade } from "./shared/types";
import { GraphView } from "./components/GraphView";
import { ArticleView, ReviewModal } from "./components/ArticleView";
import { PathView } from "./components/PathView";
import { FolderPicker } from "./components/FolderPicker";
import { LogoMark } from "./components/LogoMark";
import { SettingsModal } from "./components/SettingsModal";
import { Icon } from "./components/Icon";
import { TopBar } from "./components/TopBar";
import { MiniGraphPreview } from "./components/MiniGraphPreview";
import { VirtualList, type VirtualListHandle } from "./components/VirtualList";
import { scoreQueryMatch } from "./lib/searchRelevance";
import { confirmDialog } from "./lib/confirmDialog";

// ── Controles de zoom do grafo ────────────────────────────────────────────────
// Chama os métodos D3 expostos no SVGElement pelo GraphView
const GraphControls: React.FC<{ canvasRef: React.RefObject<HTMLCanvasElement | null> }> = ({ canvasRef }) => (
  <div className="graph-controls">
    <button className="icon-btn" title="Aproximar" aria-label="Aproximar" onClick={() => (canvasRef.current as any)?.__zoomIn()}><Icon name="zoomIn" /></button>
    <button className="icon-btn" title="Afastar" aria-label="Afastar"   onClick={() => (canvasRef.current as any)?.__zoomOut()}><Icon name="zoomOut" /></button>
    <button className="icon-btn" title="Resetar" aria-label="Resetar"   onClick={() => (canvasRef.current as any)?.__zoomReset()}><Icon name="zoomReset" /></button>
  </div>
);

// ── Atalhos de teclado ────────────────────────────────────────────────────────
const SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: "⌘N", label: "Novo artigo" },
  { keys: "⌘F", label: "Buscar na sidebar" },
  { keys: "⌘B", label: "Mostrar/ocultar sidebar" },
  { keys: "⌘[", label: "Artigo anterior" },
  { keys: "⌘]", label: "Próximo artigo" },
  { keys: "?", label: "Esta lista de atalhos" },
  { keys: "Esc", label: "Fechar modal/painel" },
];

const ShortcutsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useEscToClose(onClose);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Atalhos de teclado</h2>
        <ul className="shortcuts-list">
          {SHORTCUTS.map(s => (
            <li key={s.keys}><kbd>{s.keys}</kbd><span>{s.label}</span></li>
          ))}
        </ul>
        <div className="modal-actions">
          <button onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
};

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
  // Importação em lote (só para Wikipedia): um título por linha, importados em
  // sequência — em paralelo sobrecarregaria a API da Wikipedia e o resumo
  // automático via Claude para cada artigo.
  const [batchMode, setBatchMode] = useState(false);
  const [batchText, setBatchText] = useState("");
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  // Template de geração (só relevante quando source === "claude") — carregado
  // do main process para manter a lista de templates num único lugar.
  const [templates, setTemplates] = useState<Array<{ id: string; label: string }>>([]);
  const [templateId, setTemplateId] = useState("padrao");
  const { fetchFromWikipedia, generateWithClaude, wikipediaLang, showToast } = useStore();
  useEscToClose(onClose);

  useEffect(() => {
    window.lexicon.invoke("claude:generateTemplates").then(res => {
      if (res.ok) setTemplates((res.data as Array<{ id: string; label: string }>) ?? []);
    });
  }, []);

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
      else await generateWithClaude(query.trim(), null, templateId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function importBatch() {
    const titles = Array.from(new Set(
      batchText.split("\n").map(t => t.trim()).filter(Boolean)
    ));
    if (titles.length === 0) return;
    setLoading(true);
    setError("");
    setBatchProgress({ done: 0, total: titles.length });
    const failures: string[] = [];
    for (let i = 0; i < titles.length; i++) {
      try {
        await fetchFromWikipedia(titles[i], null, titles[i]);
      } catch (err) {
        failures.push(titles[i]);
      }
      setBatchProgress({ done: i + 1, total: titles.length });
    }
    setLoading(false);
    const ok = titles.length - failures.length;
    showToast(
      failures.length === 0
        ? `${ok} artigo${ok === 1 ? "" : "s"} importado${ok === 1 ? "" : "s"} da Wikipedia.`
        : `${ok} importado${ok === 1 ? "" : "s"}, ${failures.length} falharam: ${failures.join(", ")}`,
      failures.length === 0 ? "info" : "error",
      { durationMs: 6000 }
    );
    onClose();
  }

  if (batchMode) {
    const titleCount = batchText.split("\n").map(t => t.trim()).filter(Boolean).length;
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={e => e.stopPropagation()}>
          <h2>Importar em lote (Wikipedia)</h2>
          <form onSubmit={e => { e.preventDefault(); importBatch(); }}>
            <label>
              Um título por linha
              <textarea
                autoFocus
                className="batch-import-textarea"
                rows={8}
                value={batchText}
                onChange={e => setBatchText(e.target.value)}
                placeholder={"Fotossíntese\nInteligência artificial\nRevolução Francesa"}
                disabled={loading}
              />
            </label>
            {batchProgress && (
              <p className="wiki-search-hint">
                Importando… {batchProgress.done}/{batchProgress.total}
              </p>
            )}
            <div className="modal-actions">
              <button type="button" onClick={() => setBatchMode(false)} disabled={loading}>Voltar</button>
              <button type="submit" className="primary" disabled={loading || titleCount === 0}>
                {loading ? "Importando…" : `Importar ${titleCount || ""} artigo${titleCount === 1 ? "" : "s"}`}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <form onSubmit={e => { e.preventDefault(); createArticle(); }}>
          <div className="new-article-input-row">
            <input
              autoFocus
              className="new-article-input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Ex.: fotossíntese, inteligência artificial…"
            />
            <button
              type="button"
              className={`icon-btn new-article-source-btn ${source === "wikipedia" ? "icon-btn-active" : ""}`}
              title={`Buscar na Wikipedia (${wikipediaLang})`}
              aria-label={`Buscar na Wikipedia (${wikipediaLang})`}
              aria-pressed={source === "wikipedia"}
              onClick={() => setSource("wikipedia")}
            >
              <Icon name="search" />
            </button>
            <button
              type="button"
              className={`icon-btn new-article-source-btn ${source === "claude" ? "icon-btn-active" : ""}`}
              title="Gerar com Claude"
              aria-label="Gerar com Claude"
              aria-pressed={source === "claude"}
              onClick={() => setSource("claude")}
            >
              <Icon name="semantic" />
            </button>
          </div>

          {source === "claude" && templates.length > 0 && (
            <label>
              Modelo do artigo
              <select value={templateId} onChange={e => setTemplateId(e.target.value)}>
                {templates.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
          )}

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
          <div className="modal-actions modal-actions-with-extra">
            {source === "wikipedia" ? (
              <button type="button" className="icon-btn" title="Importar vários títulos de uma vez"
                      aria-label="Importar vários títulos de uma vez" onClick={() => setBatchMode(true)}>
                <Icon name="batchImport" />
              </button>
            ) : <span />}
            <div className="modal-actions-right">
              <button type="button" onClick={onClose} disabled={loading}>Cancelar</button>
              <button type="submit" className="primary" disabled={loading || !query.trim()}>
                {loading ? "Carregando…" : "Criar artigo"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Configurações ─────────────────────────────────────────────────────────────

// ── Wizard de boas-vindas (primeira execução) ─────────────────────────────────
// 3 passos: apresentação → colar API key (opcional, "Pular" disponível) →
// tour rápido + CTA para criar o primeiro artigo. onFinish fecha o wizard;
// onCreateFirstArticle fecha o wizard E abre o NewArticleModal em seguida.
const OnboardingWizard: React.FC<{
  onFinish: () => void;
  onCreateFirstArticle: () => void;
}> = ({ onFinish, onCreateFirstArticle }) => {
  const [step, setStep] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSaveKeyAndContinue() {
    if (apiKey.trim()) {
      setSaving(true);
      try {
        await window.lexicon.invoke("config:set", { key: "anthropicApiKey", value: apiKey.trim() });
      } finally {
        setSaving(false);
      }
    }
    setStep(2);
  }

  return (
    <div className="modal-overlay">
      <div className="modal onboarding-modal">
        {step === 0 && (
          <>
            <h2>Bem-vindo ao Wikibook</h2>
            <p>
              Sua base de conhecimento pessoal com grafo de conceitos. Crie artigos a partir
              da Wikipedia ou gerados pelo Claude, conecte-os entre si e revise o que aprendeu
              com flashcards de repetição espaçada.
            </p>
            <div className="modal-actions">
              <button className="primary" onClick={() => setStep(1)}>Começar</button>
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <h2>Chave da API Anthropic</h2>
            <p>
              Necessária para os recursos de IA: resumo automático, geração de artigos, busca
              semântica e flashcards. Pode ser configurada depois em Configurações.
            </p>
            <label>
              Anthropic API Key
              <input
                type="password" autoFocus value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk-ant-api03-…"
              />
            </label>
            <div className="modal-actions">
              <button onClick={() => setStep(2)} disabled={saving}>Pular</button>
              <button className="primary" onClick={handleSaveKeyAndContinue} disabled={saving}>
                {saving ? "Salvando…" : "Próximo"}
              </button>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <h2>Tour rápido</h2>
            <ul className="onboarding-tour-list">
              <li>Use <strong>+ Novo artigo</strong> para buscar na Wikipedia ou gerar com o Claude.</li>
              <li>Selecione um trecho de texto e clique com o botão direito para salvá-lo ou criar um flashcard.</li>
              <li>O modo <strong>Grafo</strong> mostra como seus artigos se conectam entre si.</li>
              <li>Revise flashcards vencidos a qualquer momento pelo ícone de capelo no artigo.</li>
            </ul>
            <div className="modal-actions">
              <button onClick={onFinish}>Concluir</button>
              <button className="primary" onClick={onCreateFirstArticle}>Criar meu primeiro artigo</button>
            </div>
          </>
        )}
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
    listDensity, setListDensity,
    sidebarWidth, setSidebarWidth, sidebarCollapsed, setSidebarCollapsed,
    onboardingSeen, dismissOnboarding,
  } = useStore();

  const [showNewModal, setShowNewModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  // ── Navegação: histórico local (⌘[ / ⌘]) + "Recentes" na sidebar ─────────
  // Estado de sessão (não persistido) — como o back/forward de um navegador,
  // mas escopado a artigos abertos nesta janela.
  const [nav, setNav] = useState<{ stack: string[]; index: number }>({ stack: [], index: -1 });
  const pushHistory = useCallback((id: string) => {
    setNav(({ stack, index }) => {
      if (stack[index] === id) return { stack, index };
      const truncated = stack.slice(0, index + 1);
      truncated.push(id);
      return { stack: truncated, index: truncated.length - 1 };
    });
  }, []);
  const handleOpenArticle = useCallback((id: string) => {
    openArticle(id);
    setView("article");
    pushHistory(id);
  }, [openArticle, setView, pushHistory]);
  const goHistoryBack = useCallback(() => {
    setNav(({ stack, index }) => {
      if (index <= 0) return { stack, index };
      const newIndex = index - 1;
      openArticle(stack[newIndex]);
      setView("article");
      return { stack, index: newIndex };
    });
  }, [openArticle, setView]);
  const goHistoryForward = useCallback(() => {
    setNav(({ stack, index }) => {
      if (index >= stack.length - 1) return { stack, index };
      const newIndex = index + 1;
      openArticle(stack[newIndex]);
      setView("article");
      return { stack, index: newIndex };
    });
  }, [openArticle, setView]);
  const recentArticles = useMemo(() => {
    const seen = new Set<string>();
    const list: Article[] = [];
    for (let i = nav.index - 1; i >= 0 && list.length < 6; i--) {
      const id = nav.stack[i];
      if (id === activeArticleId || seen.has(id)) continue;
      seen.add(id);
      const article = articles.find(a => a.id === id);
      if (article) list.push(article);
    }
    return list;
  }, [nav, activeArticleId, articles]);

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

  // ── Painel de grafo local ao lado do artigo aberto ────────────────────────
  const [showLocalGraphPanel, setShowLocalGraphPanel] = useState(false);

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
        if (e.key === "[") { e.preventDefault(); goHistoryBack(); return; }
        if (e.key === "]") { e.preventDefault(); goHistoryForward(); return; }
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
  }, [showNewModal, showSettings, showShortcuts, view, activeArticle, sidebarCollapsed, setSidebarCollapsed, goHistoryBack, goHistoryForward]);

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
  }, [articles, searchQuery, selectedTags, selectedFolder, searchIndex]);

  // Grafo local: artigo ativo + vizinhos até N saltos. Cai para global se não
  // houver artigo ativo (ex.: usuário abriu o grafo sem antes abrir um artigo).
  const displayedGraph = useMemo(() => {
    if (graphScope !== "local" || !activeArticleId) return { nodes: graphNodes, edges: graphEdges };
    return computeLocalSubgraph(graphNodes, graphEdges, activeArticleId, localDepth);
  }, [graphScope, activeArticleId, localDepth, graphNodes, graphEdges]);

  // Painel de grafo local (ao lado do artigo aberto) — mesmo cálculo do modo
  // "Local" da aba Grafo, sempre relativo ao artigo ativo (não ao graphScope).
  const localGraphPanelData = useMemo(() => {
    if (!activeArticleId) return { nodes: [], edges: [] };
    return computeLocalSubgraph(graphNodes, graphEdges, activeArticleId, localDepth);
  }, [activeArticleId, graphNodes, graphEdges, localDepth]);

  return (
    <div className="app-shell">

      {/* ── Sidebar flutuante (⌘B alterna) ─────────────────────────────── */}
      {!sidebarCollapsed && (
        <aside className="sidebar" ref={sidebarRef} style={{ width: currentSidebarWidth }}>
          <div className="sidebar-top">
            <button className="icon-btn" title="Ocultar sidebar (⌘B)" aria-label="Ocultar sidebar"
                    onClick={() => setSidebarCollapsed(true)}><Icon name="sidebar" /></button>
            <span className="app-logo"><LogoMark size={20} /> Wikibook</span>
            <div className="sidebar-top-actions">
              <button
                className="icon-btn"
                title={listDensity === "compact" ? "Lista compacta — clique para expandir" : "Lista expandida — clique para compactar"}
                aria-label={listDensity === "compact" ? "Alternar para lista expandida" : "Alternar para lista compacta"}
                onClick={() => setListDensity(listDensity === "compact" ? "comfortable" : "compact")}
              >
                <Icon name={listDensity === "compact" ? "densityCompact" : "densityComfortable"} />
              </button>
              <button className="icon-btn" title="Configurações" aria-label="Configurações" onClick={() => setShowSettings(true)}><Icon name="settings" /></button>
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
                  handleOpenArticle(filteredArticles[highlightedIndex].id);
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
                          onClick={() => handleOpenArticle(a.id)}>
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
            <button className="global-review-btn" onClick={handleOpenGlobalReview}>
              <Icon name="flashcards" /><span>Revisar flashcards ({dueCount})</span>
            </button>
          )}

          <button className="new-article-btn" onClick={() => setShowNewModal(true)} title="Novo artigo (⌘N)">
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
                  onClick={() => handleOpenArticle(a.id)}
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

          <div
            className="sidebar-resize-handle"
            onPointerDown={() => setDraftSidebarWidth(sidebarWidth)}
            title="Arraste para redimensionar"
          />
        </aside>
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
          title={view === "article" ? "Artigo" : view === "graph" ? "Grafo" : "Trilha"}
          onSearch={() => { setSidebarCollapsed(false); setTimeout(() => searchInputRef.current?.focus(), 0); }}
          searchTitle="Pesquisar artigos (⌘F)"
          center={
            <div className="view-tabs">
              <button className={view === "article" ? "tab active" : "tab"} onClick={() => setView("article")} disabled={!activeArticle}>
                Artigo
              </button>
              <button className={view === "graph" ? "tab active" : "tab"} onClick={() => setView("graph")}>
                Grafo
              </button>
              <button className={view === "path" ? "tab active" : "tab"} onClick={() => setView("path")}>
                Trilha
              </button>
            </div>
          }
          actions={
            <>
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
                          disabled={nav.index <= 0} onClick={goHistoryBack}><Icon name="prev" /></button>
                  <button className="icon-btn" title="Próximo artigo (⌘])" aria-label="Próximo artigo"
                          disabled={nav.index >= nav.stack.length - 1} onClick={goHistoryForward}><Icon name="next" /></button>
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
                  <ArticleView article={activeArticle} />
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
                  <button className="primary" onClick={() => setShowNewModal(true)}>+ Novo artigo</button>
                </div>
              )}
            </div>
          ) : (
            <PathView />
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
          onClose={() => { setGlobalReviewOpen(false); refreshDueCount(); }}
        />
      )}
    </div>
  );
}
