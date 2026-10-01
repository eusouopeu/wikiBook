const { test } = require("node:test");
const assert = require("node:assert/strict");
const { computeReviewStats, localDayKey } = require("../lib/reviewStats.ts");

// "Agora" fixo ao meio-dia local, para não depender de fuso/horário do teste.
const NOW = new Date(2026, 9, 1, 12, 0, 0); // 1º out 2026
const day = (offset) => localDayKey(new Date(2026, 9, 1 + offset, 12));

test("computeReviewStats: conta vencidos agora, até o fim do dia e previsão dos próximos dias", () => {
  const dueDates = [
    new Date(2026, 8, 20).toISOString(),        // atrasado
    new Date(2026, 9, 1, 11).toISOString(),     // venceu hoje cedo
    new Date(2026, 9, 1, 20).toISOString(),     // vence hoje à noite
    new Date(2026, 9, 2, 9).toISOString(),      // amanhã
    new Date(2026, 9, 2, 18).toISOString(),     // amanhã
    new Date(2026, 9, 5, 9).toISOString(),      // em 4 dias
  ];
  const s = computeReviewStats({ dueDates, reviewLog: {}, now: NOW });
  assert.equal(s.totalCards, 6);
  assert.equal(s.dueNow, 2);
  assert.equal(s.dueToday, 3);
  assert.equal(s.upcoming.length, 7);
  assert.deepEqual(s.upcoming[0], { date: day(1), count: 2 });
  assert.deepEqual(s.upcoming[3], { date: day(4), count: 1 });
});

test("computeReviewStats: sequência conta dias seguidos e não quebra se hoje ainda não teve revisão", () => {
  const log = { [day(-1)]: 5, [day(-2)]: 3, [day(-3)]: 1, [day(-5)]: 9 };
  const s = computeReviewStats({ dueDates: [], reviewLog: log, now: NOW });
  assert.equal(s.reviewedToday, 0);
  assert.equal(s.streak, 3);

  const s2 = computeReviewStats({ dueDates: [], reviewLog: { ...log, [day(0)]: 2 }, now: NOW });
  assert.equal(s2.reviewedToday, 2);
  assert.equal(s2.streak, 4);

  const s3 = computeReviewStats({ dueDates: [], reviewLog: { [day(-2)]: 4 }, now: NOW });
  assert.equal(s3.streak, 0);
});

test("computeReviewStats: heatmap cobre semanas completas terminando hoje, em ordem cronológica", () => {
  const s = computeReviewStats({ dueDates: [], reviewLog: { [day(0)]: 7, [day(-10)]: 2 }, now: NOW, weeks: 12 });
  assert.equal(s.heatmap.length % 7, 0);
  const last = s.heatmap.filter(c => c.date <= day(0)).at(-1);
  assert.deepEqual(last, { date: day(0), count: 7 });
  assert.equal(s.heatmap.find(c => c.date === day(-10)).count, 2);
  const dates = s.heatmap.map(c => c.date);
  assert.deepEqual([...dates].sort(), dates);
});
