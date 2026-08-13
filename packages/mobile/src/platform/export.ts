// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/platform/export.ts
// Porta de article:exportMarkdown/article:exportFlashcardsCsv em
// articleHandlers.js. A formatação (Markdown Obsidian, CSV) é pura e copiada
// sem alteração; o que muda é a saída: o desktop deixa escolher uma pasta
// (dialog.showOpenDialog/showSaveDialog) e grava lá — não existe "escolher
// pasta" no mobile. Aqui os arquivos vão para Directory.Cache (área de
// rascunho do app) e o destino final é decidido pelo usuário no share sheet
// nativo (Arquivos, iCloud Drive, Google Drive, AirDrop, e-mail…).
//
// Ressalva: @capacitor/share só suporta a opção `files` (múltiplos arquivos)
// nativamente — o fallback web usa a Web Share API do navegador, que não
// aceita `files`. Ou seja, dá pra verificar a GERAÇÃO dos arquivos (conteúdo
// Markdown/CSV correto) no preview de browser, mas não o passo de share em
// si — só confirmável num device/simulador de verdade.
// ─────────────────────────────────────────────────────────────────────────────

import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import type { Article } from "@lexicon/shared";
import { listArticles, htmlToMarkdown } from "./articles";
import { parseFlashcardsFromText, flattenDraftsForExport } from "./flashcards";

const EXPORT_DIR = "lexicon-export";
const ASSETS_DIR = `${EXPORT_DIR}/assets`;

const MIME_EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
  "image/webp": "webp", "image/svg+xml": "svg",
};
function extFromMime(mime: string): string {
  return MIME_EXT[mime] ?? "png";
}

function dataUriToBase64(dataUri: string): { mime: string; base64: string } | null {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mime: match[1], base64: match[2] };
}

// Nome de arquivo seguro a partir do título (mantém espaços — padrão Obsidian)
function safeFilename(title: string): string {
  return title.replace(/[/\\:*?"<>|#^[\]]/g, "-").trim().slice(0, 120) || "sem-titulo";
}

function csvEscape(field: unknown): string {
  const s = String(field ?? "");
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Monta o .md de um artigo no formato Obsidian (frontmatter + wikilinks) —
// idêntico ao desktop, incluindo o mapa de caminhos de imagem já gravadas.
function articleToMarkdown(article: Article, imageAssetPaths: Map<string, string>): string {
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

async function ensureAssetsDir() {
  try {
    await Filesystem.mkdir({ path: ASSETS_DIR, directory: Directory.Cache, recursive: true });
  } catch {
    // já existe
  }
}

async function extractImageAssets(article: Article): Promise<Map<string, string>> {
  const imageAssetPaths = new Map<string, string>();
  let dirEnsured = false;
  for (const ex of article.excerpts ?? []) {
    if ((ex.kind ?? "text") !== "image") continue;
    const match = ex.html.match(/src="(data:[^"]+)"/);
    if (!match) continue;
    const decoded = dataUriToBase64(match[1]);
    if (!decoded) continue;
    if (!dirEnsured) { await ensureAssetsDir(); dirEnsured = true; }
    const filename = `${safeFilename(article.title)}-${ex.id.slice(0, 8)}.${extFromMime(decoded.mime)}`;
    await Filesystem.writeFile({
      path: `${ASSETS_DIR}/${filename}`, data: decoded.base64, directory: Directory.Cache,
    });
    imageAssetPaths.set(ex.id, `assets/${filename}`);
  }
  return imageAssetPaths;
}

// ── article:exportMarkdown ──────────────────────────────────────────────────
export async function exportMarkdown(): Promise<{ count: number }> {
  const articles = await listArticles();
  const fileUris: string[] = [];

  for (const article of articles) {
    const imageAssetPaths = await extractImageAssets(article);
    const filePath = `${safeFilename(article.title)}.md`;
    await writeExportFile(filePath, articleToMarkdown(article, imageAssetPaths), Encoding.UTF8);
    const { uri } = await Filesystem.getUri({ path: `${EXPORT_DIR}/${filePath}`, directory: Directory.Cache });
    fileUris.push(uri);
  }

  if (fileUris.length === 0) return { count: 0 };

  await Share.share({
    title: "Exportar artigos (Markdown)",
    dialogTitle: "Exportar artigos",
    files: fileUris,
  });

  return { count: articles.length };
}

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

  const csv = rows.map(r => r.map(csvEscape).join(",")).join("\n") + "\n";
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
