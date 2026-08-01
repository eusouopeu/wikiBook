// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/FolderPicker.tsx
// Popover para atribuir/trocar a pasta de um artigo (1 pasta por artigo, lista
// plana). Reaproveitado por App.tsx (desktop) e ArticleListScreen.tsx (mobile) —
// mesmo padrão de reuso de componente que ReviewModal em ArticleView.tsx.
// Posicionamento e fechamento por clique-fora seguem o mesmo esquema do
// ContextMenu em ArticleView.tsx (clamp dentro da viewport via getBoundingClientRect).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Folder } from "../shared/types";

interface FolderPickerProps {
  x: number;
  y: number;
  folders: Folder[];
  currentFolderId?: string | null;
  onSelect: (folderId: string | null) => void;
  onCreate: (name: string) => Promise<Folder>;
  onClose: () => void;
}

export const FolderPicker: React.FC<FolderPickerProps> = ({
  x, y, folders, currentFolderId, onSelect, onCreate, onClose,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: y, left: x });
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) { setPos({ top: y, left: x }); return; }
    const margin = 8;
    const rect = el.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - margin;
    const maxTop = window.innerHeight - rect.height - margin;
    setPos({
      left: Math.max(margin, Math.min(x, maxLeft)),
      top: Math.max(margin, Math.min(y, maxTop)),
    });
  }, [x, y, folders.length, creating]);

  useEffect(() => {
    let handler: (() => void) | undefined;
    const id = setTimeout(() => {
      handler = () => onClose();
      document.addEventListener("click", handler, { once: true });
    }, 0);
    return () => {
      clearTimeout(id);
      if (handler) document.removeEventListener("click", handler);
    };
  }, [onClose]);

  async function handleCreate() {
    const name = draft.trim();
    if (!name) return;
    const folder = await onCreate(name);
    setDraft("");
    setCreating(false);
    onSelect(folder.id);
  }

  return (
    <div
      ref={ref} className="folder-picker"
      style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 1000 }}
      onClick={e => e.stopPropagation()}
    >
      <div className="folder-picker-title">Pasta</div>
      <ul className="folder-picker-list">
        <li>
          <button type="button" className={!currentFolderId ? "active" : ""} onClick={() => onSelect(null)}>
            Sem pasta
          </button>
        </li>
        {folders.map(f => (
          <li key={f.id}>
            <button type="button" className={currentFolderId === f.id ? "active" : ""} onClick={() => onSelect(f.id)}>
              📁 {f.name}
            </button>
          </li>
        ))}
      </ul>
      {creating ? (
        <div className="folder-picker-create">
          <input
            autoFocus value={draft} onChange={e => setDraft(e.target.value)}
            placeholder="Nome da pasta…"
            onKeyDown={e => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") { setCreating(false); setDraft(""); }
            }}
          />
          <button type="button" className="primary" onClick={handleCreate}>Criar</button>
        </div>
      ) : (
        <button type="button" className="folder-picker-new-btn" onClick={() => setCreating(true)}>
          + Nova pasta
        </button>
      )}
    </div>
  );
};
