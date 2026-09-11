// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/LogoMark.tsx
// Marca do Wikibook — livro aberto em degradê roxo→azul sobre fundo branco.
// Mesmo desenho de assets/brand/mark.svg (fonte dos ícones do app), embutido
// aqui como JSX para não depender de um loader de assets no esbuild (o
// pipeline atual não configura --loader para .svg/.png).
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
    <defs>
      <linearGradient id="wikibookLogoGradient" x1="18" y1="30" x2="90" y2="82" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#8B5CF6" />
        <stop offset="1" stopColor="#2563EB" />
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="104" height="104" rx="20" fill="#FFFFFF" />
    <path d="M54,40 C40,34 24,36 18,44 L18,78 C24,71 40,69 54,75 Z"
          fill="url(#wikibookLogoGradient)" stroke="#4338CA" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M54,40 C68,34 84,36 90,44 L90,78 C84,71 68,69 54,75 Z"
          fill="url(#wikibookLogoGradient)" stroke="#4338CA" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M54,40 L54,75" fill="none" stroke="#4338CA" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
