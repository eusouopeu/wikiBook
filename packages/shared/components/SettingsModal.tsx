// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/SettingsModal.tsx
// Modal de configurações — API key da Anthropic, idioma da Wikipedia, tema e
// sincronização entre dispositivos. Único para desktop e mobile: antes vivia
// duplicado (App.tsx do desktop e mobile/screens/SettingsModal.tsx), o que já
// causou o mesmo bug (handleSave ignorando falha) precisar ser corrigido duas
// vezes em rodadas separadas. A única diferença de host é onde a chave fica
// guardada (Keychain do macOS via safeStorage vs. Keystore do Android/iOS via
// SecureStoragePlugin) — invisível aqui, ambos respondem a config:get/set.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useState } from "react";
import { useStore } from "../store/useStore";
import { Icon, type IconName } from "./Icon";
import { useEscToClose } from "../lib/useEscToClose";
import { confirmDialog } from "../lib/confirmDialog";
import { TrashModal } from "./TrashModal";

const WIKI_LANGS: Array<{ code: string; label: string }> = [
  { code: "pt", label: "Português" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
];

const THEME_OPTIONS: Array<{ value: "system" | "light" | "dark"; label: string; icon: IconName }> = [
  { value: "system", label: "Sistema", icon: "themeSystem" },
  { value: "light", label: "Claro", icon: "themeLight" },
  { value: "dark", label: "Escuro", icon: "themeDark" },
];

// embedded: true quando Ajustes é uma aba persistente (shell mobile) em vez
// de popup — sem overlay/moldura de modal, sem Esc pra fechar, sem "Fechar".
export const SettingsModal: React.FC<{ onClose?: () => void; embedded?: boolean }> = ({ onClose, embedded }) => {
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const { wikipediaLang, setWikipediaLang, theme, setTheme, showToast } = useStore();
  useEscToClose(embedded ? () => {} : (onClose ?? (() => {})));

  useEffect(() => {
    window.lexicon.invoke("config:get", { key: "anthropicApiKey" }).then(r => {
      if (r.ok && r.data) setApiKey(r.data as string);
    });
  }, []);

  // Salva ao sair do campo (onBlur), como os demais campos desta tela
  // (URL/token de sincronização) — sem botão "Salvar" genérico no rodapé,
  // que era ambíguo sobre quais dos cinco campos ele realmente persistia.
  async function persistApiKey(value: string) {
    const res = await window.lexicon.invoke("config:set", { key: "anthropicApiKey", value });
    if (!res.ok) { showToast(res.error ?? "Falha ao salvar a chave.", "error"); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  // ── Sincronização Markdown automática (pasta local/Documents) ─────────────
  // Substitui o antigo "Exportar Markdown" manual: toda escrita em artigo já
  // atualiza a pasta sozinha (ver mdSyncHandlers.js no desktop e
  // platform/mdSync.ts no mobile). Aqui só mostra status e permite trocar/
  // desligar/forçar ressincronização.
  const [mdFolder, setMdFolder] = useState<string | null>(null);
  const [mdCount, setMdCount] = useState(0);
  const [mdBusy, setMdBusy] = useState(false);
  const isMobile = typeof window !== "undefined" && !!(window as any).Capacitor;

  const refreshMdStatus = useCallback(async () => {
    const res = await window.lexicon.invoke("mdsync:getStatus");
    if (res.ok) {
      const { folder, count } = res.data as { folder: string | null; count: number };
      setMdFolder(folder);
      setMdCount(count);
    }
  }, []);
  useEffect(() => { refreshMdStatus(); }, [refreshMdStatus]);

  async function handleSelectMdFolder() {
    setMdBusy(true);
    try {
      const res = await window.lexicon.invoke("mdsync:selectFolder");
      if (!res.ok) { showToast(res.error ?? "Falha ao configurar a pasta.", "error"); return; }
      if (res.data === null) return; // cancelado
      const { folder, count } = res.data as { folder: string; count: number };
      setMdFolder(folder);
      setMdCount(count);
      showToast(`Sincronização ativada — ${count} artigo${count === 1 ? "" : "s"} em ${folder}.`);
    } finally {
      setMdBusy(false);
    }
  }
  async function handleResync() {
    setMdBusy(true);
    try {
      const res = await window.lexicon.invoke("mdsync:resync");
      if (!res.ok) { showToast(res.error ?? "Falha ao ressincronizar.", "error"); return; }
      const { count, pulled } = res.data as { count: number; pulled?: number };
      setMdCount(count);
      showToast(
        pulled
          ? `Ressincronizado — ${count} artigo${count === 1 ? "" : "s"}, ${pulled} atualizado${pulled === 1 ? "" : "s"} a partir de edições feitas fora do app.`
          : `Ressincronizado — ${count} artigo${count === 1 ? "" : "s"}.`,
      );
    } finally {
      setMdBusy(false);
    }
  }
  async function handleDisableMdSync() {
    await window.lexicon.invoke("mdsync:disable");
    setMdFolder(null);
    showToast("Sincronização desligada. Os arquivos já gravados continuam onde estão.");
  }
  async function handleOpenMdFolder() {
    const res = await window.lexicon.invoke("mdsync:openFolder");
    if (!res.ok) showToast(res.error ?? "Não foi possível abrir a pasta.", "error");
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
  async function handleSyncNow(confirmed = false) {
    setSyncing(true);
    try {
      const res = await window.lexicon.invoke("sync:run", { serverUrl: syncServerUrl, token: syncToken, confirmed });
      if (!res.ok) {
        showToast(res.error ?? "Falha ao sincronizar.", "error");
        return;
      }
      const data = res.data as {
        needsConfirmation?: boolean; conflicts?: { id: string; title: string }[];
        pushed?: number; pulled?: number;
      };
      if (data.needsConfirmation) {
        const list = (data.conflicts ?? []).map(c => `• ${c.title}`).join("\n");
        const proceed = await confirmDialog(
          `A sincronização vai substituir a versão local de ${data.conflicts?.length} artigo(s) por uma versão mais recente vinda de outro dispositivo:\n\n${list}\n\nA versão substituída fica salva no histórico do artigo. Continuar?`,
          "Confirmar sincronização",
        );
        if (proceed) await handleSyncNow(true);
        return;
      }
      showToast(`Sincronizado — ${data.pushed} enviados, ${data.pulled} atualizados a partir de outros dispositivos.`);
      setSyncLastRunAt(new Date().toISOString());
    } finally {
      setSyncing(false);
    }
  }

  const body = (
    <>
        {!embedded && <h2>Configurações</h2>}
        <label>
          Anthropic API Key
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            onBlur={() => persistApiKey(apiKey)}
            placeholder="sk-ant-api03-…"
          />
        </label>
        <p className="settings-hint">
          Salva de forma criptografada no Keychain/Keystore do dispositivo — nunca enviada para terceiros.
          {saved && <> <Icon name="check" /> Salva.</>}
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
                title={opt.label}
                aria-label={opt.label}
                className={`icon-btn theme-toggle-btn ${theme === opt.value ? "icon-btn-active" : ""}`}
                onClick={() => setTheme(opt.value)}
              >
                <Icon name={opt.icon} />
              </button>
            ))}
          </div>
        </label>
        <h3 className="settings-section-title">Sincronização Markdown</h3>
        <p className="settings-hint">
          {isMobile
            ? "Toda nota é salva automaticamente em .md na pasta Documentos do app — sem exportar manualmente."
            : "Escolha uma pasta e toda nota fica salva automaticamente em .md nela — sem exportar manualmente."}
        </p>
        {mdFolder ? (
          <>
            <p className="settings-hint">
              <Icon name="check" /> Sincronizando com <strong>{mdFolder}</strong> — {mdCount} artigo{mdCount === 1 ? "" : "s"}.
            </p>
            <div className="modal-actions">
              {!isMobile && (
                <button type="button" onClick={handleSelectMdFolder} disabled={mdBusy}>Trocar pasta</button>
              )}
              <button type="button" className="icon-btn" title="Ressincronizar tudo" aria-label="Ressincronizar tudo"
                      onClick={handleResync} disabled={mdBusy}><Icon name="refresh" /></button>
              <button type="button" className="icon-btn"
                      title={isMobile ? "Compartilhar cópia dos artigos" : "Abrir pasta"}
                      aria-label={isMobile ? "Compartilhar cópia dos artigos" : "Abrir pasta"}
                      onClick={handleOpenMdFolder} disabled={mdBusy}>
                <Icon name={isMobile ? "share" : "folderOpen"} />
              </button>
              <button type="button" onClick={handleDisableMdSync} disabled={mdBusy}>Desligar</button>
            </div>
          </>
        ) : (
          <div className="modal-actions">
            <button type="button" className="primary" onClick={handleSelectMdFolder} disabled={mdBusy}>
              {mdBusy ? "Configurando…" : isMobile ? "Ativar sincronização" : "Escolher pasta"}
            </button>
          </div>
        )}

        <h3 className="settings-section-title">Flashcards</h3>
        <p className="settings-hint">Exporta os trechos de texto salvos como flashcards num CSV importável pelo Anki.</p>
        <div className="modal-actions">
          <button type="button" className="icon-btn" title="Exportar flashcards (CSV/Anki)" aria-label="Exportar flashcards (CSV/Anki)"
                  onClick={async () => {
                    const res = await window.lexicon.invoke("article:exportFlashcardsCsv");
                    if (!res.ok) { showToast(res.error ?? "Falha ao exportar flashcards.", "error"); return; }
                    if (res.data === null) return;
                    const { count } = res.data as { count: number };
                    if (count === 0) { showToast("Nenhum trecho de texto salvo para exportar."); return; }
                    showToast(`${count} flashcard${count > 1 ? "s" : ""} exportado${count > 1 ? "s" : ""}.`);
                  }}>
            <Icon name="flashcardsExport" />
          </button>
        </div>

        <h3 className="settings-section-title">Sincronização entre dispositivos</h3>
        <p className="settings-hint">
          Requer um servidor próprio rodando (ver packages/sync-server). Sob demanda — use
          "Sincronizar agora" quando quiser enviar/receber mudanças, não é automático.
        </p>
        <label className="settings-field-spaced">
          Servidor de sincronização
          <input
            type="text"
            value={syncServerUrl}
            onChange={e => persistSyncServerUrl(e.target.value)}
            placeholder="http://192.168.0.10:8787"
          />
        </label>
        <label className="settings-field-spaced">
          Token da biblioteca
          <div className="sync-token-row">
            <input
              type="password"
              value={syncToken}
              onChange={e => persistSyncToken(e.target.value)}
              placeholder="Cole aqui o token gerado no primeiro dispositivo"
            />
            <button type="button" className="icon-btn" title="Gerar novo token" aria-label="Gerar novo token"
                    onClick={handleGenerateToken}><Icon name="token" /></button>
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
          <button className="primary" onClick={() => handleSyncNow()} disabled={syncing || !syncServerUrl || !syncToken}>
            {syncing ? "Sincronizando…" : "Sincronizar agora"}
          </button>
        </div>

        <h3 className="settings-section-title">Lixeira</h3>
        <p className="settings-hint">
          Artigos excluídos ficam guardados por 30 dias antes de serem apagados automaticamente.
        </p>
        <div className="modal-actions">
          <button type="button" className="icon-btn" title="Ver lixeira" aria-label="Ver lixeira"
                  onClick={() => setTrashOpen(true)}>
            <Icon name="trash" />
          </button>
        </div>

        {!embedded && (
          <div className="modal-actions">
            <button onClick={onClose}>Fechar</button>
          </div>
        )}
    </>
  );

  return (
    <>
      {embedded ? (
        <div className="modal settings-embedded">{body}</div>
      ) : (
        <div className="modal-overlay" onClick={onClose}>
          <div className="modal" onClick={e => e.stopPropagation()}>{body}</div>
        </div>
      )}
      {trashOpen && <TrashModal onClose={() => setTrashOpen(false)} />}
    </>
  );
};
