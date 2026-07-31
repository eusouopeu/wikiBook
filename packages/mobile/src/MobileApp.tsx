// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/MobileApp.tsx
// Componente raiz do shell mobile — equivalente mínimo ao papel de App.tsx no
// desktop (segura o estado de "qual modal está aberto"), sem o layout de 3
// colunas nem a tab bar inferior (fica para quando o grafo/flashcards forem
// portados — telas suficientes para justificar navegação por abas).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from "react";
import { ArticleListScreen } from "./screens/ArticleListScreen";
import { NewArticleModal } from "./screens/NewArticleModal";
import { SettingsModal } from "./screens/SettingsModal";

export function MobileApp() {
  const [showNewModal, setShowNewModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  return (
    <>
      <ArticleListScreen
        onNewArticle={() => setShowNewModal(true)}
        onSettings={() => setShowSettings(true)}
      />
      {showNewModal && <NewArticleModal onClose={() => setShowNewModal(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  );
}
