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

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useStore, ReviewModal } from "@lexicon/shared";
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
}

export function ArticleListScreen({ onOpenArticle, onNewArticle, onSettings, onOpenGraph }: Props) {
  const {
    articles, activeArticleId, loadArticles,
    searchQuery, setSearchQuery, selectedTag, setSelectedTag, showToast,
  } = useStore();

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

  // Escreve os arquivos e abre o share sheet nativo — não existe "escolher
  // pasta" no mobile, quem decide o destino final é o usuário no share sheet
  // (Arquivos, iCloud Drive, Google Drive, AirDrop…).
  async function handleExportMarkdown() {
    const res = await window.lexicon.invoke("article:exportMarkdown");
    if (!res.ok) { showToast(res.error ?? "Falha na exportação.", "error"); return; }
    const { count } = res.data as { count: number };
    if (count === 0) { showToast("Nenhum artigo para exportar."); return; }
    showToast(`${count} artigo${count > 1 ? "s" : ""} pronto${count > 1 ? "s" : ""} — escolha o destino.`);
  }

  async function handleExportFlashcardsCsv() {
    const res = await window.lexicon.invoke("article:exportFlashcardsCsv");
    if (!res.ok) { showToast(res.error ?? "Falha ao exportar flashcards.", "error"); return; }
    const { count } = res.data as { count: number };
    if (count === 0) { showToast("Nenhum trecho de texto salvo para exportar."); return; }
    showToast(`${count} flashcard${count > 1 ? "s" : ""} pronto${count > 1 ? "s" : ""} — escolha o destino.`);
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
          <button className="mobile-icon-btn" title="Exportar Markdown" onClick={handleExportMarkdown}>⤓</button>
          <button className="mobile-icon-btn" title="Exportar flashcards (CSV)" onClick={handleExportFlashcardsCsv}>🎴</button>
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

      {dueCount > 0 && (
        <button className="global-review-btn" onClick={handleOpenGlobalReview}>
          🎓 Revisar flashcards ({dueCount})
        </button>
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
