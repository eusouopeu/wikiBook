// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/screens/PathScreen.tsx
// Envolve o PathView de @lexicon/shared (lista de trilhas → assistente de
// criação → percurso serpentino) — mesmo padrão do GraphScreen: componente
// compartilhado sem alteração de lógica, só a barra de navegação de volta
// própria do shell mobile.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import { PathView } from "@lexicon/shared";

interface Props {
  onBack: () => void;
}

export function PathScreen({ onBack }: Props) {
  return (
    <div className="mobile-path-screen">
      <div className="mobile-article-screen-nav">
        <button className="mobile-back-btn" onClick={onBack}>‹ Artigos</button>
      </div>
      <PathView />
    </div>
  );
}
