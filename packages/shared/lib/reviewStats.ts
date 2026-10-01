// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/lib/reviewStats.ts
// Estatísticas do painel de revisão diária — funções puras sobre o que
// flashcards:overview devolve (vencimentos + revisões por dia). Dias são
// sempre do fuso LOCAL ("AAAA-MM-DD"), igual à chave gravada no log de
// revisões, para a sequência virar à meia-noite do usuário e não em UTC.
// Testado em test/reviewStats.test.js.
// ─────────────────────────────────────────────────────────────────────────────

export interface DayCount { date: string; count: number }

export interface ReviewStats {
  totalCards: number;
  // Vencidos até este instante (o que a revisão global mostra agora)
  dueNow: number;
  // Vencidos até o fim do dia local de hoje
  dueToday: number;
  // Previsão dos próximos 7 dias (amanhã em diante), um item por dia
  upcoming: DayCount[];
  reviewedToday: number;
  // Dias seguidos com pelo menos uma revisão. Hoje ainda sem revisão não
  // quebra a sequência — ela só zera se ontem também ficou vazio.
  streak: number;
  // Semanas completas (domingo → sábado) terminando na semana atual, em
  // ordem cronológica; dias depois de hoje entram com count 0.
  heatmap: DayCount[];
}

export function localDayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);
}

export function computeReviewStats({ dueDates, reviewLog, now = new Date(), weeks = 12 }: {
  dueDates: string[];
  reviewLog: Record<string, number>;
  now?: Date;
  weeks?: number;
}): ReviewStats {
  const nowMs = now.getTime();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();

  const upcoming: DayCount[] = [];
  const upcomingIdx = new Map<string, number>();
  for (let i = 1; i <= 7; i++) {
    const date = localDayKey(addDays(now, i));
    upcomingIdx.set(date, upcoming.length);
    upcoming.push({ date, count: 0 });
  }

  let dueNow = 0;
  let dueToday = 0;
  for (const iso of dueDates) {
    const t = new Date(iso).getTime();
    if (t <= nowMs) dueNow++;
    if (t < endOfToday) { dueToday++; continue; }
    const idx = upcomingIdx.get(localDayKey(new Date(t)));
    if (idx !== undefined) upcoming[idx].count++;
  }

  const todayKey = localDayKey(now);
  const reviewedToday = reviewLog[todayKey] ?? 0;
  let streak = 0;
  for (let i = reviewedToday > 0 ? 0 : 1; (reviewLog[localDayKey(addDays(now, -i))] ?? 0) > 0; i++) {
    streak++;
  }

  const weekEnd = addDays(now, 6 - now.getDay());
  const heatmap: DayCount[] = [];
  for (let i = weeks * 7 - 1; i >= 0; i--) {
    const date = localDayKey(addDays(weekEnd, -i));
    heatmap.push({ date, count: date > todayKey ? 0 : (reviewLog[date] ?? 0) });
  }

  return { totalCards: dueDates.length, dueNow, dueToday, upcoming, reviewedToday, streak, heatmap };
}
