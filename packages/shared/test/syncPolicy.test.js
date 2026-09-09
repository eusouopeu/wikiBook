const { test } = require("node:test");
const assert = require("node:assert/strict");
const { resolveMdSyncDirection, computeSyncConflicts } = require("../lib/syncPolicy.js");

test("resolveMdSyncDirection: arquivo inexistente sempre empurra", () => {
  assert.equal(resolveMdSyncDirection("2026-01-01T00:00:00.000Z", null), "push");
});

test("resolveMdSyncDirection: arquivo editado depois do último save do artigo puxa de volta", () => {
  assert.equal(
    resolveMdSyncDirection("2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z"),
    "pull",
  );
});

test("resolveMdSyncDirection: artigo salvo depois do arquivo empurra", () => {
  assert.equal(
    resolveMdSyncDirection("2026-01-02T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
    "push",
  );
});

test("resolveMdSyncDirection: mesmos instantes não faz nada", () => {
  assert.equal(
    resolveMdSyncDirection("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
    "none",
  );
});

test("computeSyncConflicts: só relata artigos locais que existem e serão sobrescritos", () => {
  const local = [
    { id: "1", title: "A", updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "2", title: "B", updatedAt: "2026-01-05T00:00:00.000Z" },
  ];
  const merged = [
    { id: "1", title: "A (celular)", updatedAt: "2026-01-03T00:00:00.000Z" }, // mais novo → conflito
    { id: "2", title: "B", updatedAt: "2026-01-05T00:00:00.000Z" },           // igual → sem conflito
    { id: "3", title: "C", updatedAt: "2026-01-01T00:00:00.000Z" },          // não existe local → sem conflito
  ];
  assert.deepEqual(computeSyncConflicts(local, merged), [{ id: "1", title: "A" }]);
});
