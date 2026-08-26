// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/lib/searchRelevance.ts
// Pontuação de relevância local para a busca da lista de artigos — usada por
// App.tsx (desktop) e ArticleListScreen.tsx (mobile).
//
// Antes existia aqui uma busca "semântica" opt-in que mandava {id,título,
// resumo} de TODA a base para claude:searchRank a cada tecla (debounce de
// 400ms): custo que cresce com o tamanho da biblioteca, latência no caminho
// de digitação, e falha silenciosa (sem API key configurada ou sem rede, cai
// pro filtro por substring sem avisar por quê). Como o índice de busca já
// existe localmente (título+resumo+conteúdo+trechos+tags, ver searchIndex em
// App.tsx/ArticleListScreen.tsx), rankear por relevância ali mesmo é
// instantâneo, gratuito e não depende de rede — substitui o toggle "✦" por
// um único modo de busca, sempre ativo.
// ─────────────────────────────────────────────────────────────────────────────

// title: já em minúsculas; blob: já em minúsculas (índice de busca completo
// do artigo). Título casando por inteiro/prefixo pesa mais que qualquer match
// dentro do corpo — é o sinal mais forte de que o artigo é o que a pessoa quer.
export function scoreQueryMatch(query: string, title: string, blob: string): number {
  const q = query.trim();
  if (!q) return 0;
  let score = 0;
  if (title === q) score += 20;
  else if (title.startsWith(q)) score += 10;
  else if (title.includes(q)) score += 6;
  for (const token of q.split(/\s+/).filter(Boolean)) {
    if (title.includes(token)) score += 3;
    if (blob.includes(token)) score += 1;
  }
  return score;
}
