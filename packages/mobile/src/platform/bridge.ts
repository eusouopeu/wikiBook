// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/platform/bridge.ts
// Implementa window.lexicon com a MESMA assinatura do preload.js do desktop
// (contextBridge → ipcRenderer.invoke), para que App.tsx/useStore.ts/
// ArticleView.tsx em @lexicon/shared funcionem sem nenhuma alteração.
// Canais ainda não portados (flashcards:*, article:appendExcerpt/appendImage/
// export*) devolvem ok:false — useStore.ts já trata isso com graceful
// fallback onde importa.
// ─────────────────────────────────────────────────────────────────────────────

import * as articles from "./articles";
import * as config from "./config";
import * as wikipedia from "./wikipedia";
import * as claude from "./claude";

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
        return { ok: true };
      case "article:addLink":
        return {
          ok: true,
          data: await articles.addLink(payload.parentId, payload.anchorText, payload.targetId, payload.targetTitle),
        };
      case "article:removeLink":
        return { ok: true, data: await articles.removeLink(payload.parentId, payload.linkId) };

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
