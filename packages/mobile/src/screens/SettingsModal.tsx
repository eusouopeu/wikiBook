// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/screens/SettingsModal.tsx
// Porta quase direta de packages/desktop's SettingsModal (App.tsx) — mesma
// lógica (useStore.wikipediaLang/setWikipediaLang + config:get/set da API
// key), reaproveitando as classes .modal/.modal-overlay já definidas em
// @lexicon/shared/styles.css.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from "react";
import { useStore } from "@lexicon/shared";

const WIKI_LANGS: Array<{ code: string; label: string }> = [
  { code: "pt", label: "Português" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);
  const { wikipediaLang, setWikipediaLang } = useStore();

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
        <div className="modal-actions">
          <button onClick={onClose}>Fechar</button>
          <button className="primary" onClick={handleSave}>
            {saved ? "✓ Salvo" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
