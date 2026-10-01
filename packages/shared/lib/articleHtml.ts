// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/lib/articleHtml.ts
// Transformações de HTML do leitor de artigo (sanitização, links internos,
// resumo em bullets) e captura da seleção atual — extraído de ArticleView.tsx.
// Sem estado; as duas funções de seleção leem window.getSelection().
// ─────────────────────────────────────────────────────────────────────────────

import DOMPurify from "dompurify";
import type { Article } from "../shared/types";
import { escapeHtml } from "./markdown";
import { buildSelectionTableHtml } from "./tableSelection.js";

// Sanitização final antes de qualquer dangerouslySetInnerHTML
export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    // data-article-id: âncora dos links internos; style: necessário para as
    // cores personalizáveis de destaque/texto ([texto]{bg=...}/{color=...})
    ADD_ATTR: ["data-article-id", "style"],
  });
}

// Transforma bullet points do Claude em HTML com âncoras de seção
export function summaryToHtml(summary: string): string {
  return summary
    ? summary.split("\n").filter(Boolean).map(line => {
        const text = escapeHtml(line.startsWith("•") ? line : "• " + line);
        return `<p class="summary-bullet">${text}</p>`;
      }).join("")
    : "<p class='no-content'>Nenhum resumo disponível.</p>";
}

// ── Injeta links internos em HTML de artigo manual ────────────────────────────
// Sem spans .wiki-term para ancorar, substitui a primeira ocorrência do
// anchorText em segmentos de texto (nunca dentro de tags)
export function linkifyPlainText(html: string, links: Article["links"]): string {
  if (links.length === 0) return html;
  const parts = html.split(/(<[^>]+>)/);
  for (const link of links) {
    const anchor = escapeHtml(link.anchorText);
    const re = new RegExp(anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith("<") || !re.test(parts[i])) continue;
      parts[i] = parts[i].replace(re,
        `<a class="internal-link" data-article-id="${escapeHtml(link.targetId)}" href="#" title="${escapeHtml(link.targetTitle)}">${anchor}</a>`);
      break;
    }
  }
  return parts.join("");
}

// Injeta links internos definidos pelo usuário no HTML do artigo
export function injectInternalLinks(html: string, links: Article["links"]): string {
  let result = html;
  for (const link of links) {
    // O HTML armazenado tem entidades (& → &amp;), então o anchorText precisa
    // ser escapado da mesma forma antes de virar padrão de regex
    const escaped = escapeHtml(link.anchorText).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(
      new RegExp(`(<span class="wiki-term">)(${escaped})(</span>)`, "g"),
      `<a class="internal-link" data-article-id="${escapeHtml(link.targetId)}" href="#" title="${escapeHtml(link.targetTitle)}">$2</a>`
    );
  }
  return result;
}

// ── Captura o HTML da seleção atual via DOM ───────────────────────────────────
// Serializa o fragmento selecionado para string HTML mantendo tags de formatação.
export function getSelectionHtml(): { html: string; plainText: string } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const plainText = selection.toString().trim();
  if (!plainText || plainText.length < 2) return null;

  // Clona o conteúdo selecionado em um div temporário para serializar
  const container = document.createElement("div");
  container.appendChild(range.cloneContents());
  const html = container.innerHTML;
  return { html, plainText };
}

// ── Seleção que cruza mais de uma célula de tabela ───────────────────────────
// cloneContents() de uma seleção assim devolve pedaços soltos de <td>/<tr>, que
// salvos como trecho de texto viram um amontoado sem tabela. Aqui as células
// tocadas pelo Range são remontadas numa sub-tabela bem formada (a montagem do
// HTML fica em lib/tableSelection.js, testada à parte).
type SelectedCell = { tag: "td" | "th"; html: string; colSpan: number; rowSpan: number };

export function getSelectionTableHtml(): string | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const anchor = range.commonAncestorContainer;
  const anchorEl = (anchor.nodeType === 1 ? anchor : anchor.parentElement) as HTMLElement | null;
  const table = anchorEl?.closest?.("table") as HTMLTableElement | null;
  if (!table) return null;   // seleção não está inteira dentro de uma tabela

  const rows: SelectedCell[][] = [];
  for (const tr of Array.from(table.rows)) {
    const cells = Array.from(tr.cells).filter(cell => range.intersectsNode(cell));
    if (cells.length === 0) continue;
    rows.push(cells.map(cell => ({
      tag: cell.tagName.toLowerCase() === "th" ? "th" : "td",
      html: cell.innerHTML,
      colSpan: cell.colSpan,
      rowSpan: cell.rowSpan,
    })));
  }
  return buildSelectionTableHtml(rows);
}
