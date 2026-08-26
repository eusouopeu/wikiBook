// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/TrashModal.tsx
// Lista os artigos na lixeira (article:listTrash) com restaurar/excluir em
// definitivo — a única porta de entrada existente para restaurar era o
// "Desfazer" do toast de exclusão, com janela de ~5s; passado isso, o artigo
// ficava até 30 dias em disco sem nenhuma tela para vê-lo (article:purge
// some ele antes disso, sob pedido explícito).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from "react";
import type { TrashedArticle } from "../shared/types";
import { useStore } from "../store/useStore";
import { Icon } from "./Icon";
import { confirmDialog } from "../lib/confirmDialog";
import { useEscToClose } from "../lib/useEscToClose";

const SOURCE_LABEL: Record<TrashedArticle["source"], string> = {
  wikipedia: "Wikipédia",
  claude: "Claude (IA)",
  manual: "Manual",
};

function formatDeletedAt(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "medium", timeStyle: "short" });
}

export const TrashModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { loadArticles, showToast } = useStore();
  const [items, setItems] = useState<TrashedArticle[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  useEscToClose(onClose);

  async function refresh() {
    const res = await window.lexicon.invoke("article:listTrash");
    setItems(res.ok ? (res.data as TrashedArticle[]) : []);
  }
  useEffect(() => { refresh(); }, []);

  async function handleRestore(item: TrashedArticle) {
    setBusyId(item.id);
    try {
      const res = await window.lexicon.invoke("article:restore", { id: item.id });
      if (res.ok) {
        showToast(`Artigo "${item.title}" restaurado.`);
        await loadArticles();
        await refresh();
      } else {
        showToast(res.error ?? "Falha ao restaurar.", "error");
      }
    } finally {
      setBusyId(null);
    }
  }

  async function handlePurge(item: TrashedArticle) {
    const ok = await confirmDialog(
      `Excluir "${item.title}" em definitivo?\n\nEsta ação não pode ser desfeita.`,
      "Excluir em definitivo"
    );
    if (!ok) return;
    setBusyId(item.id);
    try {
      const res = await window.lexicon.invoke("article:purge", { id: item.id });
      if (res.ok) {
        showToast(`Artigo "${item.title}" excluído em definitivo.`);
        await refresh();
      } else {
        showToast(res.error ?? "Falha ao excluir.", "error");
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal trash-modal" onClick={e => e.stopPropagation()}>
        <h2>Lixeira</h2>
        <p className="settings-hint">
          Artigos excluídos ficam aqui por 30 dias antes de serem apagados automaticamente.
        </p>
        {items === null ? (
          <p className="settings-hint">Carregando…</p>
        ) : items.length === 0 ? (
          <p className="trash-empty-hint">A lixeira está vazia.</p>
        ) : (
          <ul className="trash-list">
            {items.map(item => (
              <li key={item.id} className="trash-item">
                <div className="trash-item-main">
                  <span className="trash-item-title">{item.title}</span>
                  <span className="trash-item-meta">
                    <span className={`source-badge source-${item.source}`}>{SOURCE_LABEL[item.source]}</span>
                    <span className="header-sep">·</span>
                    excluído em {formatDeletedAt(item.deletedAt)}
                  </span>
                </div>
                <div className="trash-item-actions">
                  <button
                    type="button" className="icon-btn" title="Restaurar" aria-label={`Restaurar "${item.title}"`}
                    disabled={busyId === item.id} onClick={() => handleRestore(item)}
                  >
                    <Icon name="refresh" />
                  </button>
                  <button
                    type="button" className="icon-btn trash-item-purge-btn" title="Excluir em definitivo"
                    aria-label={`Excluir "${item.title}" em definitivo`}
                    disabled={busyId === item.id} onClick={() => handlePurge(item)}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
};
