// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/screens/SettingsModal.tsx
// Porta quase direta de packages/desktop's SettingsModal (App.tsx) — mesma
// lógica (useStore.wikipediaLang/setWikipediaLang + config:get/set da API
// key + sincronização entre dispositivos), reaproveitando as classes
// .modal/.modal-overlay/.sync-* já definidas em @lexicon/shared/styles.css.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from "react";
import { useStore, Icon } from "@lexicon/shared";

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

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);
  const { wikipediaLang, setWikipediaLang, theme, setTheme, showToast } = useStore();

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
          Salva no Keychain/Keystore do dispositivo — nunca enviada para terceiros.
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
          Requer um servidor próprio rodando (ver packages/sync-server). Sob demanda — toque em
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
}
