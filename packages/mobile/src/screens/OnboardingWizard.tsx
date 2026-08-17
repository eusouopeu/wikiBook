// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/screens/OnboardingWizard.tsx
// Porta direta do OnboardingWizard do desktop (App.tsx) — mesmos 3 passos
// (apresentação → API key opcional → tour + CTA), reaproveitando as classes
// .modal/.onboarding-* já definidas em @lexicon/shared/styles.css.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from "react";

export function OnboardingWizard({ onFinish, onCreateFirstArticle }: {
  onFinish: () => void;
  onCreateFirstArticle: () => void;
}) {
  const [step, setStep] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSaveKeyAndContinue() {
    if (apiKey.trim()) {
      setSaving(true);
      try {
        await window.lexicon.invoke("config:set", { key: "anthropicApiKey", value: apiKey.trim() });
      } finally {
        setSaving(false);
      }
    }
    setStep(2);
  }

  return (
    <div className="modal-overlay">
      <div className="modal onboarding-modal">
        {step === 0 && (
          <>
            <h2>Bem-vindo ao Wikibook</h2>
            <p>
              Sua base de conhecimento pessoal com grafo de conceitos. Crie artigos a partir
              da Wikipedia ou gerados pelo Claude, conecte-os entre si e revise o que aprendeu
              com flashcards de repetição espaçada.
            </p>
            <div className="modal-actions">
              <button className="primary" onClick={() => setStep(1)}>Começar</button>
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <h2>Chave da API Anthropic</h2>
            <p>
              Necessária para os recursos de IA: resumo automático, geração de artigos, busca
              semântica e flashcards. Pode ser configurada depois em Configurações.
            </p>
            <label>
              Anthropic API Key
              <input
                type="password" autoFocus value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk-ant-api03-…"
              />
            </label>
            <div className="modal-actions">
              <button onClick={() => setStep(2)} disabled={saving}>Pular</button>
              <button className="primary" onClick={handleSaveKeyAndContinue} disabled={saving}>
                {saving ? "Salvando…" : "Próximo"}
              </button>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <h2>Tour rápido</h2>
            <ul className="onboarding-tour-list">
              <li>Use <strong>+ Novo artigo</strong> para buscar na Wikipedia ou gerar com o Claude.</li>
              <li>Selecione um trecho de texto e toque em "Salvar" para guardá-lo ou criar um flashcard.</li>
              <li>O modo <strong>Grafo</strong> mostra como seus artigos se conectam entre si.</li>
              <li>Revise flashcards vencidos a qualquer momento pelo ícone 🎓 no artigo.</li>
            </ul>
            <div className="modal-actions">
              <button onClick={onFinish}>Concluir</button>
              <button className="primary" onClick={onCreateFirstArticle}>Criar meu primeiro artigo</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
