// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/screens/ArticleScreen.tsx
// Envolve o ArticleView de @lexicon/shared — reaproveitado sem nenhuma
// alteração de lógica: o menu de contexto (busca por texto selecionado,
// salvar trecho/tabela/imagem) já dispara no evento DOM nativo "contextmenu",
// que WebKit/Chromium mobile emitem sozinhos depois de um toque longo — não
// precisei escrever nenhum código de toque longo à parte.
//
// Ressalva sinalizada: não dá pra verificar aqui se o toque longo real num
// device/simulador compete com o callout nativo de seleção (Copiar/Buscar no
// iOS, Copiar/Compartilhar no Android) sem Xcode/emulador Android — só a
// mecânica (o menu abre, as opções funcionam) foi verificada via preview de
// browser, disparando o evento contextmenu manualmente. Por segurança já
// suprimimos o callout nativo do iOS via CSS (-webkit-touch-callout: none em
// .wiki-content, em mobile.css) — efeito real só é confirmável no device.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from "react";
import { ArticleView, TopBar, useStore } from "@lexicon/shared";
import type { Article } from "@lexicon/shared";

interface Props {
  article: Article;
  onBack: () => void;
}

export function ArticleScreen({ article, onBack }: Props) {
  // Callback ref em vez de useRef: precisa disparar um re-render quando o
  // nó existir, para que o primeiro render de ArticleView já receba o slot
  // (senão os 4 ícones "primários" apareceriam inline por um instante antes
  // de migrar para a barra de navegação).
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);
  const requestSearchFocus = useStore(s => s.requestSearchFocus);

  return (
    <div className="mobile-article-screen">
      <TopBar
        title={article.title}
        onBack={onBack}
        onSearch={() => { onBack(); requestSearchFocus(); }}
        searchTitle="Buscar artigos"
        actionsBelow
        actions={<div className="mobile-article-screen-actions" ref={setActionsSlot} />}
      />
      <div className="mobile-article-screen-body">
        <ArticleView article={article} headerActionsSlot={actionsSlot} />
      </div>
    </div>
  );
}
