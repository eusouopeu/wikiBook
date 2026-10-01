// @ts-check
// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/lib/pathMaterialize.js
// Monta as unidades/passos/recursos de uma trilha a partir da resposta bruta
// do Claude (path:generate) — resolve cada recurso "wikipedia" contra a busca
// de verdade (nunca aceita título/URL inventado pelo modelo) e deriva
// pré-requisitos automaticamente (linear dentro da unidade, encadeando entre
// unidades, em vez de pedir ao Claude para apontar índices).
//
// Antes duplicado byte a byte entre pathHandlers.js (desktop) e claude.ts
// (mobile) — a única parte que de fato varia por plataforma é a busca na
// Wikipédia (Node https vs. CapacitorHttp) e a geração de id (Node
// crypto.randomUUID() vs. o Web Crypto global do WebView), por isso as duas
// vêm injetadas em `deps` em vez de importadas aqui.
//
// CommonJS plano, mesmo padrão de claudePrompts.js: require() direto no main
// do Electron, import com interop do esbuild no mobile. Tipado via JSDoc +
// `// @ts-check`.
// ─────────────────────────────────────────────────────────────────────────────

const { imageSearchEngines, videoSearchEngines } = require("./claudePrompts.js");

/** @typedef {import("../shared/types").PathResource} PathResource */
/** @typedef {import("../shared/types").PathStep} PathStep */
/** @typedef {import("../shared/types").PathUnit} PathUnit */

// Formato bruto devolvido pelo Claude (schema de GENERATE_PATH_TOOL em
// claudePrompts.js) — resources/steps opcionais porque a resposta não é
// validada (o código já trata ausência com `?? []`).
/** @typedef {{ kind: "wikipedia" | "video-search" | "image-search"; title: string; query: string }} RawResource */
/** @typedef {{ title: string; objective: string; estimatedMinutes: number | string; practice: string; resources?: RawResource[] }} RawStep */
/** @typedef {{ title: string; steps?: RawStep[] }} RawUnit */

/** @typedef {(query: string, lang: string, limit: number) => Promise<{ title: string }[]>} SearchWikipedia */
/** @typedef {{ searchWikipedia: SearchWikipedia; makeId: () => string }} MaterializeDeps */

/**
 * @param {SearchWikipedia} searchWikipedia
 * @param {string} query
 * @param {string} lang
 * @returns {Promise<{ title: string; url: string; verified: boolean }>}
 */
async function resolveWikipediaResource(searchWikipedia, query, lang) {
  try {
    const results = await searchWikipedia(query, lang, 1);
    if (results.length > 0) {
      const title = results[0].title;
      return {
        title,
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
        verified: true,
      };
    }
  } catch {
    // segue para o fallback de busca
  }
  return {
    title: `Buscar "${query}" na Wikipédia`,
    url: `https://${lang}.wikipedia.org/w/index.php?search=${encodeURIComponent(query)}`,
    verified: true,
  };
}

/**
 * @param {RawResource[] | undefined} rawResources
 * @param {string} lang
 * @param {MaterializeDeps} deps
 * @returns {Promise<PathResource[]>}
 */
async function materializeResources(rawResources, lang, deps) {
  const { searchWikipedia, makeId } = deps;
  /** @type {PathResource[]} */
  const out = [];
  for (const r of rawResources ?? []) {
    if (r.kind === "wikipedia") {
      const resolved = await resolveWikipediaResource(searchWikipedia, r.query, lang);
      out.push({
        id: makeId(), kind: "wikipedia",
        title: resolved.title, url: resolved.url, query: r.query, verified: resolved.verified,
      });
    } else if (r.kind === "image-search") {
      out.push({
        id: makeId(), kind: "image-search",
        title: r.title, query: r.query, verified: true, engines: imageSearchEngines(r.query),
      });
    } else {
      out.push({
        id: makeId(), kind: "video-search",
        title: r.title, query: r.query, verified: true, engines: videoSearchEngines(r.query),
      });
    }
  }
  return out;
}

// deps: { searchWikipedia(query, lang, limit), makeId() } — injetados pelo
// chamador (ver pathHandlers.js/claude.ts) porque dependem de plataforma.
/**
 * @param {RawUnit[]} rawUnits
 * @param {string} lang
 * @param {MaterializeDeps} deps
 * @returns {Promise<PathUnit[]>}
 */
async function materializeUnits(rawUnits, lang, deps) {
  const { makeId } = deps;
  /** @type {PathUnit[]} */
  const units = [];
  /** @type {string | null} */
  let previousStepId = null;
  for (const rawUnit of rawUnits) {
    const unitId = makeId();
    /** @type {PathStep[]} */
    const steps = [];
    let order = units.reduce((acc, u) => acc + u.steps.length, 0);
    for (const rawStep of rawUnit.steps ?? []) {
      const stepId = makeId();
      const resources = await materializeResources(rawStep.resources, lang, deps);
      steps.push({
        id: stepId,
        order: order++,
        title: rawStep.title,
        objective: rawStep.objective,
        estimatedMinutes: Number(rawStep.estimatedMinutes) || 15,
        practice: rawStep.practice,
        prerequisiteIds: previousStepId ? [previousStepId] : [],
        resources,
        status: previousStepId ? "locked" : "available",
      });
      previousStepId = stepId;
    }
    units.push({ id: unitId, title: rawUnit.title, steps });
  }
  return units;
}

module.exports = { materializeResources, materializeUnits };
