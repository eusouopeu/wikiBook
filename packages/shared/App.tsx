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
import { Icon } from "./components/Icon";
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

          {source === "wikipedia" && (
            <button type="button" className="batch-import-toggle" onClick={() => setBatchMode(true)}>
              Importar vários títulos de uma vez →
            </button>
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
  const { wikipediaLang, setWikipediaLang, theme, setTheme, showToast } = useStore();
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

  // ── Sincronização (servidor self-hosted, ver packages/sync-server) ────────
  const [syncServerUrl, setSyncServerUrl] = useState("");
  const [syncToken, setSyncToken] = useState("");
  const [syncLastRunAt, setSyncLastRunAt] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [testingConn, setTestingConn] = useState(false);

  useEffect(() => {
    window.lexicon.invoke("config:get", { key: "syncServerUrl" }).then(r => { if (r.ok && r.data) setSyncServerUrl(r.data as string); });
    window.lexicon.invoke("config:get", { key: "syncToken" }).then(r => { if (r.ok && r.data) setSyncToken(r.data as string); });
    window.lexicon.invoke("config:get", { key: "syncLastRunAt" }).then(r => { if (r.ok && r.data) setSyncLastRunAt(r.data as string); });
  }, []);

  async function persistSyncServerUrl(value: string) {
    setSyncServerUrl(value);
    await window.lexicon.invoke("config:set", { key: "syncServerUrl", value });
  }
  async function persistSyncToken(value: string) {
    setSyncToken(value);
    await window.lexicon.invoke("config:set", { key: "syncToken", value });
  }
  async function handleGenerateToken() {
    await persistSyncToken(crypto.randomUUID());
    showToast("Novo token gerado — cole-o nos outros dispositivos para sincronizarem entre si.");
  }
  async function handleTestConnection() {
    setTestingConn(true);
    try {
      const res = await window.lexicon.invoke("sync:test", { serverUrl: syncServerUrl });
      if (res.ok) showToast("Servidor de sincronização acessível.");
      else showToast(res.error ?? "Não foi possível conectar ao servidor.", "error");
    } finally {
      setTestingConn(false);
    }
  }
  async function handleSyncNow() {
    setSyncing(true);
    try {
      const res = await window.lexicon.invoke("sync:run", { serverUrl: syncServerUrl, token: syncToken });
      if (res.ok) {
        const { pushed, pulled } = res.data as { pushed: number; pulled: number };
        showToast(`Sincronizado — ${pushed} enviados, ${pulled} atualizados a partir de outros dispositivos.`);
        setSyncLastRunAt(new Date().toISOString());
      } else {
        showToast(res.error ?? "Falha ao sincronizar.", "error");
      }
    } finally {
      setSyncing(false);
    }
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
        <h3 className="settings-section-title">Sincronização entre dispositivos</h3>
        <p className="settings-hint">
          Requer um servidor próprio rodando (ver packages/sync-server). Sob demanda — use
          "Sincronizar agora" quando quiser enviar/receber mudanças, não é automático.
        </p>
        <label>
          Servidor de sincronização
          <input
            type="text"
            value={syncServerUrl}
            onChange={e => persistSyncServerUrl(e.target.value)}
            placeholder="http://192.168.0.10:8787"
          />
        </label>
        <label>
          Token da biblioteca
          <div className="sync-token-row">
            <input
              type="password"
              value={syncToken}
              onChange={e => persistSyncToken(e.target.value)}
              placeholder="Cole aqui o token gerado no primeiro dispositivo"
            />
            <button type="button" onClick={handleGenerateToken}>Gerar novo token</button>
          </div>
        </label>
        {syncLastRunAt && (
          <p className="settings-hint">
            Última sincronização: {new Date(syncLastRunAt).toLocaleString("pt-BR")}
          </p>
        )}
        <div className="modal-actions">
          <button onClick={handleTestConnection} disabled={testingConn || !syncServerUrl}>
            {testingConn ? "Testando…" : "Testar conexão"}
          </button>
          <button className="primary" onClick={handleSyncNow} disabled={syncing || !syncServerUrl || !syncToken}>
            {syncing ? "Sincronizando…" : "Sincronizar agora"}
          </button>
        </div>

        <div className="modal-actions">
          <button onClick={onClose}>Fechar</button>
          <button className="primary" onClick={handleSave}>
            {saved ? <><Icon name="check" /><span>Salvo</span></> : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
};

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
    listDensity, setListDensity, beginPendingTask, endPendingTask,
    onboardingSeen, dismissOnboarding,
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

  // bootstrapped: só true depois que loadArticles() resolve — inclui a leitura
  // de onboardingSeen do config, então o wizard não pisca na tela para quem já
  // passou por ele (mostrar antes disso resolver usaria o default local false).
  const [bootstrapped, setBootstrapped] = useState(false);
  useEffect(() => { loadArticles().then(() => setBootstrapped(true)); refreshDueCount(); }, [refreshDueCount]);

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
          <span className="app-logo"><LogoMark size={20} /> Wikibook</span>
          <div className="sidebar-top-actions">
            <button className="icon-btn" title="Exportar para Markdown (Obsidian)" aria-label="Exportar para Markdown (Obsidian)" onClick={handleExport}><Icon name="save" /></button>
            <button className="icon-btn" title="Exportar flashcards (CSV/Anki)" aria-label="Exportar flashcards (CSV/Anki)" onClick={handleExportFlashcards}><Icon name="flashcardsExport" /></button>
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
            {semanticLoading ? "…" : <Icon name="semantic" />}
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
            <Icon name="flashcards" /><span>Revisar flashcards ({dueCount})</span>
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
          <button
            className={view === "path" ? "tab active" : "tab"}
            onClick={() => setView("path")}
          >
            Trilha
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
          ) : view === "graph" ? (
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
          ) : (
            <PathView />
          )}
        </div>
      </main>

      {/* ── Modais ──────────────────────────────────────────────────────── */}
      {showNewModal  && <NewArticleModal  onClose={() => setShowNewModal(false)} />}
      {showSettings  && <SettingsModal    onClose={() => setShowSettings(false)} />}

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
