// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/platform/bridge.ts
// Implementa window.lexicon com a MESMA assinatura do preload.js do desktop
// (contextBridge → ipcRenderer.invoke), para que App.tsx/useStore.ts/
// ArticleView.tsx em @lexicon/shared funcionem sem nenhuma alteração.
// Canal ainda não portado (article:export*) devolve ok:false — a exportação
// é a última fase do roadmap (Filesystem + Share).
// ─────────────────────────────────────────────────────────────────────────────

import * as articles from "./articles";
import * as config from "./config";
import * as wikipedia from "./wikipedia";
import * as claude from "./claude";
import * as flashcards from "./flashcards";

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
        await flashcards.deleteFlashcards(payload.id);
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

      case "config:get":
        return {
          ok: true,
          data: payload?.key ? await config.getConfigValue(payload.key) : await config.getAllConfig(),
        };
      case "config:set":
        await config.setConfigValue(payload.key, payload.value);
        return { ok: true };

      case "wikipedia:search":
        return { ok: true, data: await wikipedia.search(payload.query, payload.lang ?? "pt") };
      case "wikipedia:fetch":
        return { ok: true, data: await wikipedia.fetchArticle(payload.query, payload.exactTitle, payload.lang ?? "pt") };

      case "claude:summarize":
        return { ok: true, data: { summary: await claude.summarize(payload.text, payload.title ?? "") } };
      case "claude:generate":
        return { ok: true, data: { summary: await claude.generate(payload.title, payload.context ?? "") } };
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
