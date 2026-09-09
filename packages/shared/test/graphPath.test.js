const { test } = require("node:test");
const assert = require("node:assert/strict");
const { findShortestPath } = require("../lib/graphPath.js");

test("caminho direto entre nós adjacentes", () => {
  const edges = [{ source: "a", target: "b" }];
  assert.deepEqual(findShortestPath(edges, "a", "b"), ["a", "b"]);
});

test("menor caminho passando por nó intermediário, ignorando aresta mais longa", () => {
  const edges = [
    { source: "a", target: "b" },
    { source: "b", target: "c" },
    { source: "a", target: "d" },
    { source: "d", target: "e" },
    { source: "e", target: "c" },
  ];
  assert.deepEqual(findShortestPath(edges, "a", "c"), ["a", "b", "c"]);
});

test("nós desconexos retornam null", () => {
  const edges = [{ source: "a", target: "b" }, { source: "x", target: "y" }];
  assert.equal(findShortestPath(edges, "a", "y"), null);
});

test("origem igual ao destino retorna caminho de um nó", () => {
  assert.deepEqual(findShortestPath([], "a", "a"), ["a"]);
});
