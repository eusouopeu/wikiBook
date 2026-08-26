// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/lib/wikiAccordions.ts
// Reagrupa o HTML sanitizado de um artigo da Wikipedia em seções recolhíveis:
//   <h1>/<h2>  → accordion (<details>), fechado por padrão, uma cor por seção
//   <h3>       → toggle aninhado (<details>), estilo Notion
//   <h4-h6>    → apenas coloridos (tom mais claro da mesma família)
//
// A API da Wikipedia (Parsoid) já entrega o conteúdo pré-agrupado em <section
// data-mw-section-id="N"> aninhadas — cada seção começa com seu próprio
// heading e contém, como filhas diretas, o conteúdo da seção e as <section>
// das subseções. Isso torna a transformação uma travessia recursiva dessa
// árvore, não um agrupamento de irmãos soltos.
//
// Cada accordion recebe uma cor do palette Tailwind abaixo, ciclando na ordem
// em que as seções de topo aparecem — via CSS custom properties no próprio
// <details> (--wa-100/600/700/800/900), herdadas pelos toggles/subtítulos
// dentro dele, para não precisar de uma classe CSS por combinação de cor×tag.
// ─────────────────────────────────────────────────────────────────────────────

interface PaletteColor { c100: string; c600: string; c700: string; c800: string; c900: string; }

// Valores literais da paleta padrão do Tailwind (v3) — o projeto não usa
// Tailwind no bundler, então os hex ficam hardcoded aqui.
const PALETTE: PaletteColor[] = [
  { c100: "#dbeafe", c600: "#2563eb", c700: "#1d4ed8", c800: "#1e40af", c900: "#1e3a8a" }, // blue
  { c100: "#d1fae5", c600: "#059669", c700: "#047857", c800: "#065f46", c900: "#064e3b" }, // emerald
  { c100: "#fef3c7", c600: "#d97706", c700: "#b45309", c800: "#92400e", c900: "#78350f" }, // amber
  { c100: "#ede9fe", c600: "#7c3aed", c700: "#6d28d9", c800: "#5b21b6", c900: "#4c1d95" }, // violet
  { c100: "#ffe4e6", c600: "#e11d48", c700: "#be123c", c800: "#9f1239", c900: "#881337" }, // rose
  { c100: "#cffafe", c600: "#0891b2", c700: "#0e7490", c800: "#155e75", c900: "#164e63" }, // cyan
  { c100: "#ffedd5", c600: "#ea580c", c700: "#c2410c", c800: "#9a3412", c900: "#7c2d12" }, // orange
  { c100: "#ccfbf1", c600: "#0d9488", c700: "#0f766e", c800: "#115e59", c900: "#134e4a" }, // teal
  { c100: "#fae8ff", c600: "#c026d3", c700: "#a21caf", c800: "#86198f", c900: "#701a75" }, // fuchsia
  { c100: "#ecfccb", c600: "#65a30d", c700: "#4d7c0f", c800: "#3f6212", c900: "#365314" }, // lime
  { c100: "#e0f2fe", c600: "#0284c7", c700: "#0369a1", c800: "#075985", c900: "#0c4a6e" }, // sky
  { c100: "#e0e7ff", c600: "#4f46e5", c700: "#4338ca", c800: "#3730a3", c900: "#312e81" }, // indigo
];

function colorStyle(c: PaletteColor): string {
  return `--wa-100:${c.c100};--wa-600:${c.c600};--wa-700:${c.c700};--wa-800:${c.c800};--wa-900:${c.c900}`;
}

const HEADING_SELECTOR = ":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6";

// Reagrupa o HTML já sanitizado. Sem nenhuma <section> de topo (estrutura
// inesperada — versão antiga da API, artigo muito curto), devolve intocado.
export function buildWikiAccordions(html: string): string {
  if (typeof DOMParser === "undefined") return html;

  const doc = new DOMParser().parseFromString(`<div id="__root">${html}</div>`, "text/html");
  const root = doc.getElementById("__root");
  if (!root || !root.querySelector(":scope > section")) return html;

  let colorIdx = -1;

  // Processa uma <section> (heading + conteúdo + subseções aninhadas),
  // anexando o resultado em `appendTo`.
  function renderSection(sectionEl: HTMLElement, appendTo: HTMLElement): void {
    const heading = sectionEl.querySelector<HTMLElement>(HEADING_SELECTOR);
    let target = appendTo;

    if (heading) {
      const level = Number(heading.tagName[1]);
      if (level <= 2) {
        colorIdx = (colorIdx + 1) % PALETTE.length;
        const details = doc.createElement("details");
        details.className = "wiki-accordion";
        details.setAttribute("style", colorStyle(PALETTE[colorIdx]));
        const summary = doc.createElement("summary");
        summary.className = "wiki-accordion-title";
        summary.appendChild(heading);
        const body = doc.createElement("div");
        body.className = "wiki-accordion-body";
        details.append(summary, body);
        appendTo.appendChild(details);
        target = body;
      } else if (level === 3) {
        const details = doc.createElement("details");
        details.className = "wiki-toggle";
        const summary = doc.createElement("summary");
        summary.className = "wiki-toggle-title";
        summary.appendChild(heading);
        const body = doc.createElement("div");
        body.className = "wiki-toggle-body";
        details.append(summary, body);
        appendTo.appendChild(details);
        target = body;
      } else {
        heading.classList.add(`wiki-subheading-h${level}`);
        appendTo.appendChild(heading);
        target = appendTo;
      }
    }

    for (const child of Array.from(sectionEl.childNodes)) {
      if (child === heading) continue;
      if ((child as HTMLElement).tagName?.toLowerCase() === "section") {
        renderSection(child as HTMLElement, target);
      } else {
        target.appendChild(child);
      }
    }
  }

  const out = doc.createElement("div");
  for (const node of Array.from(root.childNodes)) {
    if ((node as HTMLElement).tagName?.toLowerCase() === "section") {
      renderSection(node as HTMLElement, out);
    } else {
      out.appendChild(node);
    }
  }

  return out.innerHTML;
}

// Abre a cadeia de <details> ancestrais de um elemento — usado ao pular para
// uma seção (sumário) ou revelar um resultado de busca-na-página que caiu
// dentro de um accordion/toggle fechado.
export function openAncestorDetails(el: Element | null): void {
  let node = el?.closest("details") ?? null;
  while (node) {
    (node as HTMLDetailsElement).open = true;
    node = node.parentElement?.closest("details") ?? null;
  }
}
