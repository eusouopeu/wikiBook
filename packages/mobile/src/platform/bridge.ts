// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/platform/bridge.ts
// Implementa window.lexicon com a MESMA assinatura do preload.js do desktop
// (contextBridge → ipcRenderer.invoke), para que App.tsx/useStore.ts/
// ArticleView.tsx em @lexicon/shared funcionem sem nenhuma alteração.
// ─────────────────────────────────────────────────────────────────────────────

import { Dialog } from "@capacitor/dialog";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import * as articles from "./articles";
import * as config from "./config";
import * as wikipedia from "./wikipedia";
import * as claude from "./claude";
import * as flashcards from "./flashcards";
import * as exporter from "./export";
import * as sync from "./sync";
import * as paths from "./paths";
import * as mdSync from "./mdSync";

interface IpcResponse<T = unknown> { ok: boolean; data?: T; error?: string; }

async function invoke(channel: string, payload?: any): Promise<IpcResponse> {
  try {
    switch (channel) {
      case "article:list":
        return { ok: true, data: await articles.listArticles() };
      case "article:get":
        return { ok: true, data: await articles.getArticle(payload.id) };
      case "article:save":
        return { ok: true, data: await articles.saveArticle(payload.article) };
      case "article:delete":
        await articles.deleteArticle(payload.id);
        await flashcards.trashFlashcards(payload.id);
        return { ok: true };
      case "article:restore": {
        const restored = await articles.restoreArticle(payload.id);
        await flashcards.restoreFlashcards(payload.id);
        return { ok: true, data: restored };
      }
      case "article:listTrash":
        return { ok: true, data: await articles.listTrash() };
      case "article:purge":
        await articles.purgeArticle(payload.id);
        await flashcards.purgeFlashcards(payload.id);
        return { ok: true };
      case "article:addLink":
        return {
          ok: true,
          data: await articles.addLink(payload.parentId, payload.anchorText, payload.targetId, payload.targetTitle),
        };
      case "article:removeLink":
        return { ok: true, data: await articles.removeLink(payload.parentId, payload.linkId) };
      case "article:appendExcerpt":
        return { ok: true, data: await articles.appendExcerpt(payload) };
      case "article:appendImage":
        return { ok: true, data: await articles.appendImage(payload) };
      case "article:removeExcerpt":
        return { ok: true, data: await articles.removeExcerpt(payload.targetId, payload.excerptId) };
      case "article:updateExcerpt":
        return {
          ok: true,
          data: await articles.updateExcerpt(payload.articleId, payload.excerptId, payload.editedMarkdown),
        };
      case "article:updateExcerptOutline":
        return { ok: true, data: await articles.updateExcerptOutline(payload.articleId, payload.outline) };
      case "article:getHistory":
        return { ok: true, data: await articles.getArticleHistory(payload.id) };
      case "article:revertVersion":
        return { ok: true, data: await articles.revertArticleVersion(payload.id, payload.updatedAt) };
      case "article:addAttachment":
        return {
          ok: true,
          data: await articles.addAttachment(payload.articleId, payload.name, payload.mimeType, payload.dataBase64),
        };
      case "article:removeAttachment":
        return { ok: true, data: await articles.removeAttachment(payload.articleId, payload.attachmentId) };
      case "article:getAttachmentData":
        return { ok: true, data: await articles.readAttachmentData(payload.articleId, payload.attachmentId) };
      case "article:exportAttachment": {
        // Sem "salvar em pasta" no mobile — grava num arquivo temporário e
        // delega o destino final ao share sheet nativo (mesma UX de
        // exportMarkdown/exportFlashcardsCsv em ./export.ts).
        const { dataBase64, name } = await articles.readAttachmentData(payload.articleId, payload.attachmentId);
        const tmpPath = `attachment-export/${name}`;
        await Filesystem.writeFile({ path: tmpPath, data: dataBase64, directory: Directory.Cache, recursive: true });
        const { uri } = await Filesystem.getUri({ path: tmpPath, directory: Directory.Cache });
        await Share.share({ title: "Exportar anexo", dialogTitle: "Exportar anexo", files: [uri] });
        return { ok: true, data: { filePath: uri } };
      }

      // Confirmação nativa cross-platform (ver packages/shared/lib/confirmDialog.ts)
      // — Dialog.confirm em vez de window.confirm(), que dentro da WebView do
      // Capacitor renderiza com estilo inconsistente com o resto do app.
      case "dialog:confirm": {
        const { value } = await Dialog.confirm({
          title: payload?.title ?? "Confirmar",
          message: payload?.message ?? "",
          okButtonTitle: "Confirmar",
          cancelButtonTitle: "Cancelar",
        });
        return { ok: true, data: { confirmed: value } };
      }

      case "config:get":
        return {
          ok: true,
          data: payload?.key ? await config.getConfigValue(payload.key) : await config.getAllConfig(),
        };
      case "config:set":
        await config.setConfigValue(payload.key, payload.value);
        return { ok: true };

      case "sync:test":
        return { ok: true, data: await sync.testConnection(payload.serverUrl) };
      case "sync:run":
        return { ok: true, data: await sync.runSync(payload.serverUrl, payload.token) };

      case "wikipedia:search":
        return { ok: true, data: await wikipedia.search(payload.query, payload.lang ?? "pt") };
      case "wikipedia:fetch":
        return { ok: true, data: await wikipedia.fetchArticle(payload.query, payload.exactTitle, payload.lang ?? "pt") };

      case "claude:summarize":
        return { ok: true, data: { summary: await claude.summarize(payload.text, payload.title ?? "", payload.bypassCache ?? false) } };
      case "claude:generate":
        return { ok: true, data: { summary: await claude.generate(payload.title, payload.context ?? "", payload.templateId ?? "padrao") } };
      case "claude:generateTemplates":
        return { ok: true, data: claude.generateTemplates() };
      case "claude:ask":
        return {
          ok: true,
          data: {
            answer: await claude.ask(payload.question, payload.articleTitle, payload.articleText, payload.relatedContext ?? ""),
          },
        };
      case "flashcards:regenerate":
        return { ok: true, data: await flashcards.regenerate(payload.articleId) };
      case "flashcards:list":
        return { ok: true, data: await flashcards.list(payload.articleId) };
      case "flashcards:listDue":
        return { ok: true, data: await flashcards.listDue() };
      case "flashcards:grade":
        return { ok: true, data: await flashcards.grade(payload.articleId, payload.cardId, payload.grade) };

      case "article:exportFlashcardsCsv":
        return { ok: true, data: await exporter.exportFlashcardsCsv() };

      case "mdsync:getStatus":
        return { ok: true, data: await mdSync.getStatus() };
      case "mdsync:selectFolder": {
        // Sem escolha de pasta arbitrária no mobile — este canal apenas
        // (re)liga a sincronização automática na pasta fixa Documents/Wikibook.
        await mdSync.setEnabled(true);
        const status = await mdSync.resyncAll();
        return { ok: true, data: { folder: (await mdSync.getStatus()).folder, count: status.count } };
      }
      case "mdsync:disable":
        await mdSync.setEnabled(false);
        return { ok: true };
      case "mdsync:resync":
        return { ok: true, data: await mdSync.resyncAll() };
      case "mdsync:openFolder":
        return { ok: true, data: await mdSync.shareAll() };

      case "path:list":
        return { ok: true, data: await paths.listPaths() };
      case "path:get":
        return { ok: true, data: await paths.getPath(payload.id) };
      case "path:save":
        return { ok: true, data: await paths.savePath(payload.path) };
      case "path:delete":
        await paths.deletePath(payload.id);
        return { ok: true };
      case "path:consolidateProfile":
        return { ok: true, data: { profileSummary: await claude.consolidateProfile(payload.goal, payload.answers ?? []) } };
      case "path:generate":
        return { ok: true, data: { units: await claude.generatePath(payload.goal, payload.profileSummary, payload.model, payload.lang ?? "pt") } };

      // Sem BrowserWindow própria no mobile — abre no navegador do sistema.
      // Os recursos de vídeo da trilha são links de busca (sem API do
      // YouTube integrada), então qualquer navegador serve.
      case "browser:open":
        window.open(payload.url, "_blank", "noopener,noreferrer");
        return { ok: true };

      default:
        return { ok: false, error: `Canal "${channel}" ainda não implementado no mobile.` };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function installLexiconBridge() {
  window.lexicon = { invoke };
}
