const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createListingCache, sortByUpdatedDesc, pushHistorySnapshot, HISTORY_MAX_ENTRIES,
  prepareExcerpt, htmlToMarkdown,
} = require("../lib/articleCore.js");

test("createListingCache: guarda a listagem até ser invalidado", () => {
  const cache = createListingCache();
  assert.equal(cache.get(), null);
  const list = [{ id: "a" }];
  assert.equal(cache.set(list), list);
  assert.equal(cache.get(), list);
  cache.invalidate();
  assert.equal(cache.get(), null);
});

test("sortByUpdatedDesc: mais recente primeiro, sem updatedAt vai pro fim", () => {
  const sorted = sortByUpdatedDesc([
    { id: "velho", updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "sem" },
    { id: "novo", updatedAt: "2026-02-01T00:00:00.000Z" },
  ]);
  assert.deepEqual(sorted.map(a => a.id), ["novo", "velho", "sem"]);
});

test("pushHistorySnapshot: versão anterior no topo e corta no limite", () => {
  const entries = Array.from({ length: HISTORY_MAX_ENTRIES }, (_, i) => ({ title: `v${i}` }));
  const out = pushHistorySnapshot(entries, { title: "atual", content: "c", summary: "s", updatedAt: "t" });
  assert.equal(out.length, HISTORY_MAX_ENTRIES);
  assert.deepEqual(out[0], { title: "atual", content: "c", summary: "s", updatedAt: "t" });
  assert.equal(out[HISTORY_MAX_ENTRIES - 1].title, `v${HISTORY_MAX_ENTRIES - 2}`);
});

test("prepareExcerpt: limpa links/refs e deriva plainText (texto e tabela)", () => {
  const text = prepareExcerpt('<p>Um <a href="/wiki/X" class="mw-link">termo</a><sup>[1]</sup></p>', "text");
  assert.equal(text.cleanHtml, '<p>Um <span class="wiki-term">termo</span></p>');
  assert.equal(text.plainText, "Um termo");

  const table = prepareExcerpt("<table><tr><th>A</th><th>B</th></tr><tr><td>1 | 2</td></tr></table>", "table");
  assert.equal(table.plainText, "| A | B |\n| --- | --- |\n| 1 \\| 2 |  |");

  assert.equal(htmlToMarkdown("<p><b>Oi</b> &amp; <i>tchau</i></p>"), "**Oi** & *tchau*");
});
