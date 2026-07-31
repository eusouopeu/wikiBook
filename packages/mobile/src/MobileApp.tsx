// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/MobileApp.tsx
// Componente raiz do shell mobile — equivalente mínimo ao papel de App.tsx no
// desktop (segura o estado de "qual tela/modal está aberto"), sem o layout de
// 3 colunas nem a tab bar inferior (fica para quando flashcards forem
// portados — telas suficientes para justificar navegação por abas).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from "react";
import { useStore } from "@lexicon/shared";
import { ArticleListScreen } from "./screens/ArticleListScreen";
import { ArticleScreen } from "./screens/ArticleScreen";
import { GraphScreen } from "./screens/GraphScreen";
import { NewArticleModal } from "./screens/NewArticleModal";
import { SettingsModal } from "./screens/SettingsModal";

export function MobileApp() {
  const [screen, setScreen] = useState<"list" | "article" | "graph">("list");
  const [showNewModal, setShowNewModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const { articles, activeArticleId, openArticle } = useStore();
  const activeArticle = articles.find(a => a.id === activeArticleId) ?? null;

  // Usado pela lista: já espera o fetch antes de navegar, então activeArticle
  // está pronto assim que a tela troca.
  async function handleOpenArticle(id: string) {
    await openArticle(id);
    setScreen("article");
  }

  // Usado pelo grafo: GraphView já chama openArticle(id) internamente (sem
  // aguardar) antes de disparar este callback — o fetch pode ainda estar em
  // andamento quando a tela troca, daí o estado de carregamento abaixo.
  function handleGraphNodeOpen(_id: string) {
    setScreen("article");
  }

  if (screen === "article") {
    return activeArticle
      ? <ArticleScreen article={activeArticle} onBack={() => setScreen("list")} />
      : <div className="mobile-screen"><p className="mobile-empty">Carregando…</p></div>;
  }

  if (screen === "graph") {
    return <GraphScreen onBack={() => setScreen("list")} onOpenArticle={handleGraphNodeOpen} />;
  }

  return (
    <>
      <ArticleListScreen
        onOpenArticle={handleOpenArticle}
        onNewArticle={() => setShowNewModal(true)}
        onSettings={() => setShowSettings(true)}
        onOpenGraph={() => setScreen("graph")}
      />
      {showNewModal && <NewArticleModal onClose={() => setShowNewModal(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  );
}
