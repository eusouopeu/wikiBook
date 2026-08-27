// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/MobileApp.tsx
// Componente raiz do shell mobile — equivalente mínimo ao papel de App.tsx no
// desktop (segura o estado de "qual tela/modal está aberto"). A navegação
// entre as views principais (Artigos/Grafo/Trilha/Ajustes) fica centralizada
// na barra inferior fixa (BottomNav) — as telas individuais não sabem mais
// como abrir umas às outras.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from "react";
import { useStore, SettingsModal } from "@lexicon/shared";
import { ArticleListScreen } from "./screens/ArticleListScreen";
import { ArticleScreen } from "./screens/ArticleScreen";
import { GraphScreen } from "./screens/GraphScreen";
import { PathScreen } from "./screens/PathScreen";
import { NewArticleModal } from "./screens/NewArticleModal";
import { OnboardingWizard } from "./screens/OnboardingWizard";
import { StatusOverlay } from "./StatusOverlay";
import { BottomNav, type BottomNavTab } from "./BottomNav";

export function MobileApp() {
  const [screen, setScreen] = useState<"list" | "article" | "graph" | "path" | "settings">("list");
  const [showNewModal, setShowNewModal] = useState(false);

  const {
    articles, activeArticleId, loadingArticle, openArticle,
    loadArticles, onboardingSeen, dismissOnboarding,
  } = useStore();
  const activeArticle = articles.find(a => a.id === activeArticleId) ?? null;

  // bootstrapped: só true depois que loadArticles() resolve (inclui a leitura
  // de onboardingSeen do config) — evita o wizard piscar para quem já passou
  // por ele. ArticleListScreen também chama loadArticles() no próprio mount;
  // chamar de novo aqui é redundante mas barato (só uma listagem local) e
  // garante que este componente saiba quando o bootstrap terminou.
  const [bootstrapped, setBootstrapped] = useState(false);
  useEffect(() => { loadArticles().then(() => setBootstrapped(true)); }, [loadArticles]);

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

  // Sem isso, excluir o artigo que está sendo visualizado (activeArticleId
  // vira null) deixava a tela travada em "Carregando…" para sempre — nada
  // muda activeArticleId de volta depois de uma exclusão, e o placeholder de
  // loading não tem botão de voltar. loadingArticle distingue esse caso do
  // carregamento legítimo em andamento (aberto pelo grafo, ver comentário acima).
  useEffect(() => {
    if (screen === "article" && !activeArticleId && !loadingArticle) setScreen("list");
  }, [screen, activeArticleId, loadingArticle]);

  let content: React.ReactNode;
  if (screen === "article") {
    content = activeArticle
      ? <ArticleScreen article={activeArticle} onBack={() => setScreen("list")} />
      : <div className="mobile-screen"><p className="mobile-empty">Carregando…</p></div>;
  } else if (screen === "graph") {
    content = <GraphScreen onOpenArticle={handleGraphNodeOpen} />;
  } else if (screen === "path") {
    content = <PathScreen />;
  } else if (screen === "settings") {
    content = <SettingsModal embedded />;
  } else {
    content = (
      <ArticleListScreen
        onOpenArticle={handleOpenArticle}
        onNewArticle={() => setShowNewModal(true)}
      />
    );
  }

  // A aba ativa é uma das cinco views da barra inferior — o artigo aberto é
  // tratado como parte da aba "Artigos" (não existe aba própria para ele).
  const activeTab: BottomNavTab = screen === "article" ? "list" : screen;

  function handleSelectTab(tab: BottomNavTab) {
    setScreen(tab);
  }

  return (
    <>
      <div className="mobile-app-content">{content}</div>
      <BottomNav active={activeTab} onSelect={handleSelectTab} />
      {showNewModal && <NewArticleModal onClose={() => setShowNewModal(false)} />}
      {bootstrapped && !onboardingSeen && (
        <OnboardingWizard
          onFinish={() => dismissOnboarding()}
          onCreateFirstArticle={() => { dismissOnboarding(); setShowNewModal(true); }}
        />
      )}
      <StatusOverlay />
    </>
  );
}
