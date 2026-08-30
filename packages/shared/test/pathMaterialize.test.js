// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/test/pathMaterialize.test.js
// Testes de packages/shared/lib/pathMaterialize.js — a montagem de
// unidades/passos/recursos de uma trilha a partir da resposta bruta do
// Claude, compartilhada entre pathHandlers.js (desktop) e claude.ts (mobile).
// searchWikipedia e makeId são injetados (ver comentário do próprio arquivo),
// então o teste usa dublês determinísticos em vez de rede ou crypto real.
// ─────────────────────────────────────────────────────────────────────────────

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { materializeUnits, materializeResources } = require("../lib/pathMaterialize");

function fakeDeps({ searchResults = [] } = {}) {
  let counter = 0;
  return {
    makeId: () => `id-${++counter}`,
    searchWikipedia: async (query) => {
      if (query === "sem-resultado") return [];
      if (query === "erro-de-rede") throw new Error("network down");
      return searchResults.length ? searchResults : [{ title: query }];
    },
  };
}

test("materializeUnits encadeia pré-requisitos linearmente entre passos e unidades", async () => {
  const rawUnits = [
    { title: "Unidade 1", steps: [{ title: "Passo 1", objective: "o1", practice: "p1", estimatedMinutes: 10, resources: [] }, { title: "Passo 2", objective: "o2", practice: "p2", estimatedMinutes: 10, resources: [] }] },
    { title: "Unidade 2", steps: [{ title: "Passo 3", objective: "o3", practice: "p3", estimatedMinutes: 10, resources: [] }] },
  ];
  const units = await materializeUnits(rawUnits, "pt", fakeDeps());
  const flat = units.flatMap(u => u.steps);

  assert.equal(flat.length, 3);
  assert.equal(flat[0].status, "available");
  assert.deepEqual(flat[0].prerequisiteIds, []);
  assert.equal(flat[1].status, "locked");
  assert.deepEqual(flat[1].prerequisiteIds, [flat[0].id]);
  // O primeiro passo da 2ª unidade encadeia com o último da 1ª — a cadeia é
  // sobre o percurso achatado, não reinicia por unidade.
  assert.deepEqual(flat[2].prerequisiteIds, [flat[1].id]);
  assert.equal(flat[2].status, "locked");

  // order é global (0,1,2,…), não reinicia por unidade
  assert.deepEqual(flat.map(s => s.order), [0, 1, 2]);
});

test("materializeResources resolve recurso wikipedia contra a busca de verdade", async () => {
  const deps = fakeDeps({ searchResults: [{ title: "Fotossíntese" }] });
  const [resource] = await materializeResources(
    [{ kind: "wikipedia", query: "fotossíntese" }], "pt", deps
  );
  assert.equal(resource.kind, "wikipedia");
  assert.equal(resource.title, "Fotossíntese");
  assert.equal(resource.url, "https://pt.wikipedia.org/wiki/Fotoss%C3%ADntese");
  assert.equal(resource.verified, true);
});

test("materializeResources cai para a página de busca quando a Wikipédia não acha nada", async () => {
  const deps = fakeDeps();
  const [resource] = await materializeResources(
    [{ kind: "wikipedia", query: "sem-resultado" }], "pt", deps
  );
  assert.match(resource.url, /w\/index\.php\?search=/);
  // Fallback nunca afirma ser um artigo real — mas ainda assim "verified"
  // (é uma URL de busca de verdade, não um título inventado pelo Claude).
  assert.equal(resource.verified, true);
});

test("materializeResources cai para a página de busca quando a busca falha (erro de rede)", async () => {
  const deps = fakeDeps();
  const [resource] = await materializeResources(
    [{ kind: "wikipedia", query: "erro-de-rede" }], "pt", deps
  );
  assert.match(resource.url, /w\/index\.php\?search=/);
});

test("materializeResources gera engines de busca determinísticos para image-search/video-search", async () => {
  const deps = fakeDeps();
  const resources = await materializeResources(
    [
      { kind: "image-search", title: "Mapa mental", query: "mapa mental x" },
      { kind: "video-search", title: "Vídeo explicativo", query: "explicação x" },
    ], "pt", deps
  );
  assert.equal(resources[0].kind, "image-search");
  assert.ok(Array.isArray(resources[0].engines) && resources[0].engines.length > 0);
  assert.equal(resources[1].kind, "video-search");
  assert.ok(Array.isArray(resources[1].engines) && resources[1].engines.length > 0);
});
