// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/MobileApp.tsx
// Componente raiz do shell mobile — equivalente mínimo ao papel de App.tsx no
// desktop (segura o estado de "qual tela/modal está aberto"), sem o layout de
// 3 colunas nem a tab bar inferior (fica para quando o grafo/flashcards forem
// portados — telas suficientes para justificar navegação por abas).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from "react";
import { useStore } from "@lexicon/shared";
import { ArticleListScreen } from "./screens/ArticleListScreen";
import { ArticleScreen } from "./screens/ArticleScreen";
import { NewArticleModal } from "./screens/NewArticleModal";
import { SettingsModal } from "./screens/SettingsModal";

export function MobileApp() {
  const [screen, setScreen] = useState<"list" | "article">("list");
  const [showNewModal, setShowNewModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const { articles, activeArticleId, openArticle } = useStore();
  const activeArticle = articles.find(a => a.id === activeArticleId) ?? null;

  async function handleOpenArticle(id: string) {
    await openArticle(id);
    setScreen("article");
  }

  if (screen === "article" && activeArticle) {
    return <ArticleScreen article={activeArticle} onBack={() => setScreen("list")} />;
  }

  return (
    <>
      <ArticleListScreen
        onOpenArticle={handleOpenArticle}
        onNewArticle={() => setShowNewModal(true)}
        onSettings={() => setShowSettings(true)}
      />
      {showNewModal && <NewArticleModal onClose={() => setShowNewModal(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  );
}
