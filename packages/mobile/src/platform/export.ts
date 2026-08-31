// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/platform/export.ts
// Porta de article:exportFlashcardsCsv em articleHandlers.js (o CSV do Anki
// continua exportação manual, sob demanda). A exportação de artigos em
// Markdown deixou de ser manual — ver platform/mdSync.ts, que reaproveita
// articleToMarkdown/safeFilename exportados abaixo.
//
// Ressalva do CSV: @capacitor/share só suporta a opção `files` (múltiplos
// arquivos) nativamente — o fallback web usa a Web Share API do navegador,
// que não aceita `files`. Dá pra verificar a GERAÇÃO do arquivo (conteúdo CSV
// correto) no preview de browser, mas não o passo de share em si — só
// confirmável num device/simulador de verdade.
// ─────────────────────────────────────────────────────────────────────────────

import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import type { Article } from "@lexicon/shared";
import { listArticles, htmlToMarkdown } from "./articles";
import { parseFlashcardsFromText, flattenDraftsForExport } from "./flashcards";

const EXPORT_DIR = "lexicon-export";

const MIME_EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
  "image/webp": "webp", "image/svg+xml": "svg",
};
export function extFromMime(mime: string): string {
  return MIME_EXT[mime] ?? "png";
}

export function dataUriToBase64(dataUri: string): { mime: string; base64: string } | null {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mime: match[1], base64: match[2] };
}

// Nome de arquivo seguro a partir do título (mantém espaços — padrão Obsidian)
export function safeFilename(title: string): string {
  return title.replace(/[/\\:*?"<>|#^[\]]/g, "-").trim().slice(0, 120) || "sem-titulo";
}

// CSV (delimitador ";", padrão de importação do Anki em pt-BR)
function csvEscape(field: unknown): string {
  const s = String(field ?? "");
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Monta o .md de um artigo no formato Obsidian (frontmatter + wikilinks) —
// idêntico ao desktop, incluindo o mapa de caminhos de imagem já gravadas.
// Reaproveitado por platform/mdSync.ts (sincronização automática).
export function articleToMarkdown(article: Article, imageAssetPaths: Map<string, string>): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`title: "${article.title.replace(/"/g, '\\"')}"`);
  lines.push(`source: ${article.source}`);
  if (article.tags?.length) lines.push(`tags: [${article.tags.join(", ")}]`);
  lines.push(`created: ${article.createdAt ?? ""}`);
  lines.push(`updated: ${article.updatedAt ?? ""}`);
  lines.push("---", "");

  if (article.summary) {
    lines.push("## Resumo", "");
    for (const l of article.summary.split("\n").filter(Boolean)) {
      lines.push(l.startsWith("•") ? l.replace(/^•\s*/, "- ") : `- ${l}`);
    }
    lines.push("");
  }

  if (article.content) {
    lines.push("## Conteúdo", "");
    lines.push(article.source === "manual" ? article.content : htmlToMarkdown(article.content));
    lines.push("");
  }

  if (article.links?.length) {
    lines.push("## Conceitos vinculados", "");
    for (const link of article.links) {
      lines.push(`- [[${safeFilename(link.targetTitle)}]] — "${link.anchorText}"`);
    }
    lines.push("");
  }

  if (article.excerpts?.length) {
    lines.push("## Trechos salvos", "");
    const CATEGORY_TAG: Record<string, string> = { concept: "conceito", list: "lista", numeric: "dados" };
    for (const ex of article.excerpts) {
      const kind = ex.kind ?? "text";
      const catTag = ex.category ? CATEGORY_TAG[ex.category] : undefined;
      if (kind === "image") {
        const assetPath = imageAssetPaths.get(ex.id);
        lines.push(assetPath ? `![${ex.plainText || "imagem"}](${assetPath})` : "_(imagem não exportada)_");
        lines.push(`— de [[${safeFilename(ex.sourceArticleTitle)}]]`, "");
      } else if (kind === "table") {
        lines.push(ex.editedMarkdown ?? ex.plainText);
        lines.push(`\n— de [[${safeFilename(ex.sourceArticleTitle)}]]${catTag ? ` #${catTag}` : ""}`, "");
      } else {
        const body = ex.editedMarkdown ?? ex.plainText;
        for (const line of body.split("\n")) lines.push(`> ${line}`);
        lines.push(`> — de [[${safeFilename(ex.sourceArticleTitle)}]]${catTag ? ` #${catTag}` : ""}`, "");
      }
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

async function writeExportFile(relativePath: string, data: string, encoding?: Encoding) {
  await Filesystem.writeFile({
    path: `${EXPORT_DIR}/${relativePath}`,
    data, directory: Directory.Cache,
    encoding, recursive: true,
  });
}

// article:exportMarkdown foi substituído pela sincronização automática em
// platform/mdSync.ts — toda escrita em writeArticle() já mantém a pasta
// Documents/Wikibook atualizada, sem exportação manual.

// ── article:exportFlashcardsCsv ─────────────────────────────────────────────
// Exporta trechos de texto salvos como flashcards num CSV importável pelo
// Anki — roda o mesmo parser (parseFlashcardsFromText) usado pela revisão
// SM-2 dentro do app, para que o card exportado seja o mesmo que o usuário
// revisa aqui (inclusive os grupos de cloze, já em sintaxe {{c1::…}}), em vez
// de um card genérico por trecho inteiro sem relação com o que é estudado.
export async function exportFlashcardsCsv(): Promise<{ count: number }> {
  const articles = await listArticles();
  const rows: string[][] = [];
  for (const art of articles) {
    for (const ex of art.excerpts ?? []) {
      if ((ex.kind ?? "text") !== "text") continue;
      const md = ex.editedMarkdown ?? htmlToMarkdown(ex.html ?? "") ?? ex.plainText;
      if (!md) continue;
      const tag = `lexicon::${art.title}`.replace(/\s+/g, "_");
      for (const { front, back } of flattenDraftsForExport(parseFlashcardsFromText(md))) {
        if (front) rows.push([front, back, tag]);
      }
    }
  }
  if (rows.length === 0) return { count: 0 };

  const csv = rows.map(r => r.map(csvEscape).join(";")).join("\n") + "\n";
  const filePath = "lexicon-flashcards.csv";
  await writeExportFile(filePath, csv, Encoding.UTF8);
  const { uri } = await Filesystem.getUri({ path: `${EXPORT_DIR}/${filePath}`, directory: Directory.Cache });

  await Share.share({
    title: "Exportar flashcards (CSV/Anki)",
    dialogTitle: "Exportar flashcards",
    files: [uri],
  });

  return { count: rows.length };
}
