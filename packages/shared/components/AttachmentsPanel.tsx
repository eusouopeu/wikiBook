// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/AttachmentsPanel.tsx
// Seção de anexos do artigo (enviar, ver, exportar, remover) — extraído de
// ArticleView.tsx.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useRef, useState } from "react";
import type { Article } from "../shared/types";
import { confirmDialog } from "../lib/confirmDialog";
import { Icon, type IconName } from "./Icon";

// ── Anexos (imagem/PDF/qualquer arquivo) ────────────────────────────────────
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentIcon(mimeType: string): IconName {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "file";
  return "attachment";
}

// Lê um File do input como base64 puro (sem o prefixo "data:...;base64,")
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Falha ao ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

export const AttachmentsPanel: React.FC<{
  article: Article;
  onChanged: () => Promise<void>;
  showToast: (message: string, type?: "info" | "error") => void;
}> = ({ article, onChanged, showToast }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ name: string; dataUrl: string } | null>(null);
  const attachments = article.attachments ?? [];

  const handleFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const dataBase64 = await fileToBase64(file);
      const res = await window.lexicon.invoke("article:addAttachment", {
        articleId: article.id, name: file.name, mimeType: file.type || "application/octet-stream", dataBase64,
      });
      if (res.ok) await onChanged();
      else showToast(res.error ?? "Falha ao anexar arquivo.", "error");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Falha ao anexar arquivo.", "error");
    } finally {
      setUploading(false);
    }
  }, [article.id, onChanged, showToast]);

  const handlePreview = useCallback(async (attachmentId: string) => {
    setBusyId(attachmentId);
    try {
      const res = await window.lexicon.invoke("article:getAttachmentData", { articleId: article.id, attachmentId });
      if (res.ok) {
        const { dataBase64, mimeType, name } = res.data as { dataBase64: string; mimeType: string; name: string };
        setPreview({ name, dataUrl: `data:${mimeType};base64,${dataBase64}` });
      } else {
        showToast(res.error ?? "Falha ao abrir anexo.", "error");
      }
    } finally {
      setBusyId(null);
    }
  }, [article.id, showToast]);

  const handleExport = useCallback(async (attachmentId: string) => {
    setBusyId(attachmentId);
    try {
      const res = await window.lexicon.invoke("article:exportAttachment", { articleId: article.id, attachmentId });
      if (!res.ok) showToast(res.error ?? "Falha ao exportar anexo.", "error");
    } finally {
      setBusyId(null);
    }
  }, [article.id, showToast]);

  const handleRemove = useCallback(async (attachmentId: string, name: string) => {
    const ok = await confirmDialog(`Remover o anexo "${name}"?`, "Remover anexo");
    if (!ok) return;
    setBusyId(attachmentId);
    try {
      const res = await window.lexicon.invoke("article:removeAttachment", { articleId: article.id, attachmentId });
      if (res.ok) await onChanged();
      else showToast(res.error ?? "Falha ao remover anexo.", "error");
    } finally {
      setBusyId(null);
    }
  }, [article.id, onChanged, showToast]);

  return (
    <div className="attachments-section">
      <div className="attachments-header">
        <span className="attachments-label">Anexos{attachments.length > 0 ? ` (${attachments.length})` : ""}</span>
        <button type="button" className="attachments-add-btn" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
          {uploading ? "Anexando…" : "+ Anexar arquivo"}
        </button>
        <input ref={fileInputRef} type="file" hidden onChange={handleFileSelected} />
      </div>
      {attachments.length > 0 && (
        <ul className="attachments-list">
          {attachments.map(a => (
            <li key={a.id} className="attachment-item">
              <span className="attachment-icon"><Icon name={attachmentIcon(a.mimeType)} /></span>
              <span className="attachment-name" title={a.name}>{a.name}</span>
              <span className="attachment-size">{formatBytes(a.size)}</span>
              <div className="attachment-actions">
                {a.mimeType.startsWith("image/") && (
                  <button type="button" disabled={busyId === a.id} onClick={() => handlePreview(a.id)}>Ver</button>
                )}
                <button type="button" disabled={busyId === a.id} onClick={() => handleExport(a.id)}>Exportar</button>
                <button type="button" disabled={busyId === a.id} onClick={() => handleRemove(a.id, a.name)}>Remover</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {preview && (
        <div className="modal-overlay" onClick={() => setPreview(null)}>
          <div className="modal attachment-preview-modal" onClick={e => e.stopPropagation()}>
            <h2>{preview.name}</h2>
            <img src={preview.dataUrl} alt={preview.name} className="attachment-preview-img" />
            <div className="modal-actions">
              <button onClick={() => setPreview(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
