// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/ArticleHistoryPanel.tsx
// Modal de histórico de versões do artigo (diff + reverter) — extraído de
// ArticleView.tsx.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useState } from "react";
import type { Article, ArticleHistoryEntry } from "../shared/types";
import { confirmDialog } from "../lib/confirmDialog";
import { computeTrackedEdit } from "../lib/excerptDiff";
import { sanitize } from "../lib/articleHtml";
import { markdownToHtml } from "../lib/markdown";

// ── Histórico de versões ────────────────────────────────────────────────────
// Extrai um texto comparável de uma versão (snapshot ou atual) para o diff:
// artigos manuais já são Markdown; wikipedia/claude viram texto puro (tags
// HTML fora, para o diff por token não se perder em atributos/markup).
function comparableVersionText(source: Article["source"], content: string, summary: string): string {
  const raw = content && content.trim() ? content : summary;
  if (source === "manual") return raw;
  return raw.replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function formatHistoryDate(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export const ArticleHistoryPanel: React.FC<{
  article: Article;
  onClose: () => void;
  onReverted: () => Promise<void>;
  showToast: (message: string, type?: "info" | "error") => void;
}> = ({ article, onClose, onReverted, showToast }) => {
  const [entries, setEntries] = useState<ArticleHistoryEntry[] | null>(null);
  const [expandedAt, setExpandedAt] = useState<string | null>(null);
  const [reverting, setReverting] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.lexicon.invoke("article:getHistory", { id: article.id }).then(res => {
      if (!cancelled && res.ok) setEntries((res.data as ArticleHistoryEntry[]) ?? []);
    });
    return () => { cancelled = true; };
  }, [article.id]);

  const handleRevert = useCallback(async (entry: ArticleHistoryEntry) => {
    const ok = await confirmDialog(
      `Reverter "${article.title}" para a versão de ${formatHistoryDate(entry.updatedAt)}? A versão atual também fica salva no histórico.`,
      "Reverter versão"
    );
    if (!ok) return;
    setReverting(entry.updatedAt);
    try {
      const res = await window.lexicon.invoke("article:revertVersion", { id: article.id, updatedAt: entry.updatedAt });
      if (res.ok) {
        showToast("Artigo revertido para a versão selecionada.");
        await onReverted();
        onClose();
      } else {
        showToast(res.error ?? "Falha ao reverter versão.", "error");
      }
    } finally {
      setReverting(null);
    }
  }, [article.id, article.title, onReverted, onClose, showToast]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal history-modal" onClick={e => e.stopPropagation()}>
        <h2>Histórico de versões</h2>
        {entries === null && <p className="no-content">Carregando…</p>}
        {entries !== null && entries.length === 0 && (
          <p className="no-content">Nenhuma versão anterior salva ainda — o histórico começa a ser guardado na próxima edição deste artigo.</p>
        )}
        {entries !== null && entries.length > 0 && (
          <ul className="history-list">
            {entries.map(entry => {
              const expanded = expandedAt === entry.updatedAt;
              return (
                <li key={entry.updatedAt} className="history-item">
                  <div className="history-item-row">
                    <span className="history-item-date">{formatHistoryDate(entry.updatedAt)}</span>
                    <span className="history-item-title">{entry.title}</span>
                    <div className="history-item-actions">
                      <button type="button" onClick={() => setExpandedAt(expanded ? null : entry.updatedAt)}>
                        {expanded ? "Ocultar diff" : "Ver diff"}
                      </button>
                      <button type="button" disabled={reverting === entry.updatedAt}
                              onClick={() => handleRevert(entry)}>
                        {reverting === entry.updatedAt ? "Revertendo…" : "Reverter"}
                      </button>
                    </div>
                  </div>
                  {expanded && (() => {
                    const oldText = comparableVersionText(article.source, entry.content, entry.summary);
                    const newText = comparableVersionText(article.source, article.content, article.summary);
                    const diffMd = computeTrackedEdit(oldText, newText);
                    return (
                      <div className="history-diff" dangerouslySetInnerHTML={{ __html: sanitize(markdownToHtml(diffMd || "_Sem diferenças de texto._")) }} />
                    );
                  })()}
                </li>
              );
            })}
          </ul>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
};
