// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/lib/findInPage.ts
// Destaque de ocorrências do "buscar na página" — extraído de ArticleView.tsx.
// Mexe direto no DOM do container recebido (sem React).
// ─────────────────────────────────────────────────────────────────────────────



// ── Buscar na página ──────────────────────────────────────────────────────────
// Destaca ocorrências de `query` no container ativo (artigo ou resumo) com
// <mark>, navegável. Mutação de DOM direta (fora do controle do React), no
// mesmo espírito do efeito de fallback de imagem quebrada mais abaixo —
// seguro porque só roda entre re-renders do dangerouslySetInnerHTML, nunca
// durante um deles.
export function clearFindMarks(container: HTMLElement) {
  container.querySelectorAll("mark.find-match").forEach(mark => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
    parent.normalize();
  });
}

export function highlightFindMatches(container: HTMLElement, query: string): HTMLElement[] {
  clearFindMarks(container);
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.toLowerCase().includes(q)) return NodeFilter.FILTER_SKIP;
      const tag = node.parentElement?.tagName;
      if (tag === "MARK" || tag === "SCRIPT" || tag === "STYLE") return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const textNodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) textNodes.push(n as Text);

  const matches: HTMLElement[] = [];
  for (const node of textNodes) {
    const text = node.nodeValue ?? "";
    const lower = text.toLowerCase();
    const frag = document.createDocumentFragment();
    let cursor = 0;
    let idx = lower.indexOf(q, cursor);
    while (idx !== -1) {
      if (idx > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, idx)));
      const mark = document.createElement("mark");
      mark.className = "find-match";
      mark.textContent = text.slice(idx, idx + q.length);
      frag.appendChild(mark);
      matches.push(mark);
      cursor = idx + q.length;
      idx = lower.indexOf(q, cursor);
    }
    if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
    node.parentNode?.replaceChild(frag, node);
  }
  return matches;
}
