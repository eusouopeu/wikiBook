// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/lib/useEscToClose.ts
// Fecha um modal/painel via tecla Esc — sem efeito em touch-only (mobile),
// onde não existe uma tecla física equivalente; nesse caso o fechamento
// continua disponível por toque fora do modal ou pelo botão "Fechar".
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from "react";

export function useEscToClose(onClose: () => void): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
}
