// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/lib/randomArticle.ts
// "Artigo aleatório" — sorteio ponderado que favorece artigos mais antigos/
// menos revisitados (sem rastrear contagem de aberturas, que não existe no
// schema hoje): usa updatedAt como proxy — quanto mais tempo sem tocar,
// maior o peso. Usado por App.tsx (desktop) e ArticleListScreen.tsx (mobile).
// ─────────────────────────────────────────────────────────────────────────────

import type { Article } from "../shared/types";

export function pickWeightedRandomArticle(articles: Article[], excludeId?: string | null): Article | null {
  const pool = articles.filter(a => a.id !== excludeId);
  if (pool.length === 0) return null;
  const now = Date.now();
  // Peso linear pela idade desde a última atualização, com piso de 1 dia —
  // dobrar de idade dobra a chance, sem deixar artigos recém-tocados com
  // peso zero (ainda podem ser sorteados, só com menos frequência).
  const weights = pool.map(a => {
    const ageMs = Math.max(now - new Date(a.updatedAt).getTime(), 0);
    const ageDays = ageMs / 86_400_000;
    return 1 + ageDays;
  });
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}
