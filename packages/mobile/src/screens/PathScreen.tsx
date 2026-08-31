// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/screens/PathScreen.tsx
// Envolve o PathView de @lexicon/shared (lista de trilhas → assistente de
// criação → percurso serpentino) — mesmo padrão do GraphScreen: componente
// compartilhado sem alteração de lógica, só a TopBar padronizada do shell
// mobile por cima.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import { PathView, TopBar } from "@lexicon/shared";

interface Props {
  onOpenArticle?: (id: string) => void;
}

export function PathScreen({ onOpenArticle }: Props) {
  return (
    <div className="mobile-path-screen">
      <TopBar title="Trilha" />
      <PathView onOpenArticle={onOpenArticle} />
    </div>
  );
}
