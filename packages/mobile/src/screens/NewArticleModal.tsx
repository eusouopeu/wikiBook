// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/screens/NewArticleModal.tsx
// Porta quase direta do NewArticleModal do desktop (App.tsx) — mesma lógica
// (busca Wikipedia com debounce de 400ms + useStore.fetchFromWikipedia/
// generateWithClaude), reaproveitando as classes .modal/.wiki-search-* já
// definidas em @lexicon/shared/styles.css. Sem o fechamento por tecla Esc do
// desktop (sem equivalente físico no touch) — fecha por toque fora ou Cancelar.
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
  const { fetchFromWikipedia, generateWithClaude, wikipediaLang } = useStore();

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
}
