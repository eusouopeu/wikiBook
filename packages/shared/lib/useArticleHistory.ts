// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/lib/useArticleHistory.ts
// Navegação do desktop: histórico local (⌘[ / ⌘]) + "Recentes" na sidebar.
// Estado de sessão (não persistido) — como o back/forward de um navegador,
// mas escopado a artigos abertos nesta janela.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useMemo, useState } from "react";
import { useStore } from "../store/useStore";
import type { Article } from "../shared/types";

export function useArticleHistory() {
  const articles = useStore(s => s.articles);
  const activeArticleId = useStore(s => s.activeArticleId);
  const openArticle = useStore(s => s.openArticle);
  const setView = useStore(s => s.setView);

  const [nav, setNav] = useState<{ stack: string[]; index: number }>({ stack: [], index: -1 });
  const pushHistory = useCallback((id: string) => {
    setNav(({ stack, index }) => {
      if (stack[index] === id) return { stack, index };
      const truncated = stack.slice(0, index + 1);
      truncated.push(id);
      return { stack: truncated, index: truncated.length - 1 };
    });
  }, []);
  const openWithHistory = useCallback((id: string) => {
    openArticle(id);
    setView("article");
    pushHistory(id);
  }, [openArticle, setView, pushHistory]);
  const goBack = useCallback(() => {
    setNav(({ stack, index }) => {
      if (index <= 0) return { stack, index };
      const newIndex = index - 1;
      openArticle(stack[newIndex]);
      setView("article");
      return { stack, index: newIndex };
    });
  }, [openArticle, setView]);
  const goForward = useCallback(() => {
    setNav(({ stack, index }) => {
      if (index >= stack.length - 1) return { stack, index };
      const newIndex = index + 1;
      openArticle(stack[newIndex]);
      setView("article");
      return { stack, index: newIndex };
    });
  }, [openArticle, setView]);
  const recentArticles = useMemo(() => {
    const seen = new Set<string>();
    const list: Article[] = [];
    for (let i = nav.index - 1; i >= 0 && list.length < 6; i--) {
      const id = nav.stack[i];
      if (id === activeArticleId || seen.has(id)) continue;
      seen.add(id);
      const article = articles.find(a => a.id === id);
      if (article) list.push(article);
    }
    return list;
  }, [nav, activeArticleId, articles]);

  return {
    pushHistory, openWithHistory, goBack, goForward, recentArticles,
    canGoBack: nav.index > 0,
    canGoForward: nav.index < nav.stack.length - 1,
  };
}
