// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/screens/NewArticleModal.tsx
// Porta quase direta do NewArticleModal do desktop (App.tsx) — mesma lógica
// (busca Wikipedia com debounce de 400ms + useStore.fetchFromWikipedia/
// generateWithClaude, e o mesmo modo de importação em lote), reaproveitando
// as classes .modal/.wiki-search-*/.batch-import-* já definidas em
// @lexicon/shared/styles.css. Sem o fechamento por tecla Esc do desktop (sem
// equivalente físico no touch) — fecha por toque fora ou Cancelar.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from "react";
import { useStore } from "@lexicon/shared";

interface WikiSearchResult { title: string; snippet: string; }

export function NewArticleModal({ onClose }: { onClose: () => void }) {
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
  // Template de geração (só relevante quando source === "claude")
  const [templates, setTemplates] = useState<Array<{ id: string; label: string }>>([]);
  const [templateId, setTemplateId] = useState("padrao");
  const { fetchFromWikipedia, generateWithClaude, wikipediaLang, showToast } = useStore();

  useEffect(() => {
    window.lexicon.invoke("claude:generateTemplates").then(res => {
      if (res.ok) setTemplates((res.data as Array<{ id: string; label: string }>) ?? []);
    });
  }, []);

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
}
