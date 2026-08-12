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

import React from "react";
import { ArticleView } from "@lexicon/shared";
import type { Article } from "@lexicon/shared";

interface Props {
  article: Article;
  onBack: () => void;
}

export function ArticleScreen({ article, onBack }: Props) {
  return (
    <div className="mobile-article-screen">
      <div className="mobile-article-screen-nav">
        <button className="mobile-back-btn" onClick={onBack}>‹ Artigos</button>
        <span className="mobile-article-screen-title">{article.title}</span>
      </div>
      <div className="mobile-article-screen-body">
        <ArticleView article={article} />
      </div>
    </div>
  );
}
