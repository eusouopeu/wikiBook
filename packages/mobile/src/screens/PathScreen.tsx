// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/screens/PathScreen.tsx
// Envolve o PathView de @lexicon/shared (lista de trilhas → assistente de
// criação → percurso serpentino) — mesmo padrão do GraphScreen: componente
// compartilhado sem alteração de lógica, só a barra de navegação de volta
// própria do shell mobile.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import { PathView } from "@lexicon/shared";

export function PathScreen() {
  return (
    <div className="mobile-path-screen">
      <PathView />
    </div>
  );
}
