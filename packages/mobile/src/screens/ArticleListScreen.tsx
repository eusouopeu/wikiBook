// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/screens/ArticleListScreen.tsx
// Primeira tela do shell mobile — reaproveita useStore de @lexicon/shared
// (mesmas actions/estado do desktop), mas com layout próprio (sem sidebar
// fixa). A derivação de busca/filtro por tag hoje vive dentro de App.tsx no
// desktop (não em useStore.ts) — como o mobile não reusa App.tsx inteiro
// (layout de 3 colunas não faz sentido em tela pequena), essa lógica é
// replicada aqui.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo } from "react";
import { useStore } from "@lexicon/shared";
import type { Article } from "@lexicon/shared";

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
    searchQuery, setSearchQuery, selectedTag, setSelectedTag,
  } = useStore();

  useEffect(() => { loadArticles(); }, [loadArticles]);

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

  const filteredArticles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let result = articles.filter(a =>
      (!q || (searchIndex.get(a.id) ?? "").includes(q)) &&
      (!selectedTag || (a.tags ?? []).includes(selectedTag))
    );
    if (q) {
      result = [
        ...result.filter(a => a.title.toLowerCase().includes(q)),
        ...result.filter(a => !a.title.toLowerCase().includes(q)),
      ];
    }
    return result;
  }, [articles, searchQuery, selectedTag, searchIndex]);

  return (
    <div className="mobile-screen">
      <header className="mobile-header">
        <h1>Lexicon</h1>
        <div className="mobile-header-actions">
          <button className="mobile-icon-btn" title="Grafo" onClick={onOpenGraph}>🕸</button>
          <button className="mobile-icon-btn" title="Configurações" onClick={onSettings}>⚙</button>
        </div>
      </header>

      <input
        className="mobile-search"
        type="search"
        placeholder="Buscar em títulos e conteúdo…"
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
      />

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
          </li>
        ))}
        {filteredArticles.length === 0 && (
          <li className="mobile-empty">
            {searchQuery || selectedTag ? "Nenhum resultado." : "Nenhum artigo ainda."}
          </li>
        )}
      </ul>
    </div>
  );
}
