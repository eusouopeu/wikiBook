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
// do Electron, import com interop do esbuild no mobile.
// ─────────────────────────────────────────────────────────────────────────────

const { imageSearchEngines, videoSearchEngines } = require("./claudePrompts.js");

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

async function materializeResources(rawResources, lang, deps) {
  const { searchWikipedia, makeId } = deps;
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
async function materializeUnits(rawUnits, lang, deps) {
  const { makeId } = deps;
  const units = [];
  let previousStepId = null;
  for (const rawUnit of rawUnits) {
    const unitId = makeId();
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
