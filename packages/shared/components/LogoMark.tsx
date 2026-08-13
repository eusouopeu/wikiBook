// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/LogoMark.tsx
// Marca do Wikibook — livro aberto (base de conhecimento) com um grafo de
// conceitos nascendo da lombada (a rede de artigos vinculados que o app
// constrói). Mesmo desenho de assets/brand/mark.svg (fonte dos ícones do
// app), embutido aqui como JSX para não depender de um loader de assets no
// esbuild (o pipeline atual não configura --loader para .svg/.png).
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";

export const LogoMark: React.FC<{ size?: number; className?: string }> = ({ size = 20, className }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 108 108"
    role="img"
    aria-label="Wikibook"
  >
    <path d="M54,44 C42,37 24,39 18,48 L18,80 C24,73 42,71 54,77 Z"
          fill="#3366CC" stroke="#1f4e9e" strokeWidth="1.5" strokeLinejoin="round"/>
    <path d="M54,44 C66,37 84,39 90,48 L90,80 C84,73 66,71 54,77 Z"
          fill="#3366CC" stroke="#1f4e9e" strokeWidth="1.5" strokeLinejoin="round"/>
    <path d="M54,44 L54,77" fill="none" stroke="#1f4e9e" strokeWidth="1.5" strokeLinecap="round"/>

    <path d="M54,44 L54,30 M54,30 L34,30 M54,30 L74,30"
          fill="none" stroke="#1D9E75" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="54" cy="22" r="7" fill="#1D9E75"/>
    <circle cx="34" cy="30" r="5" fill="#1D9E75"/>
    <circle cx="74" cy="30" r="5" fill="#1D9E75"/>
  </svg>
);
