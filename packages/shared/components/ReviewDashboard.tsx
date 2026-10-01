// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/ReviewDashboard.tsx
// Painel de revisão diária (aba "Revisão" no desktop e no mobile): o que está
// vencido agora, sequência de dias seguidos revisando, mapa de calor das
// últimas semanas e previsão dos próximos 7 dias. Quem abre a sessão de
// revisão (ReviewModal) é o shell, via onStartReview — ele já é dono da
// revisão global e recarrega este painel ao fechá-la.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo } from "react";
import { useStore } from "../store/useStore";
import { computeReviewStats, localDayKey, type DayCount } from "../lib/reviewStats";

const WEEKDAY_LABELS = ["D", "S", "T", "Q", "Q", "S", "S"];

function formatDay(key: string, opts: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", opts);
}

// Nível de intensidade 0–4 relativo ao dia mais cheio do período exibido
function heatLevel(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.ceil((count / max) * 4));
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export const ReviewDashboard: React.FC<{ onStartReview: () => void }> = ({ onStartReview }) => {
  const overview = useStore(s => s.reviewOverview);
  const loadReviewOverview = useStore(s => s.loadReviewOverview);
  const showToast = useStore(s => s.showToast);

  useEffect(() => {
    loadReviewOverview().catch(e => showToast(`Falha ao carregar a revisão: ${e.message}`, "error"));
  }, [loadReviewOverview, showToast]);

  const stats = useMemo(
    () => overview && computeReviewStats({ dueDates: overview.dueDates, reviewLog: overview.reviewLog }),
    [overview],
  );

  if (!stats) {
    return <div className="review-dashboard"><p className="review-muted">Carregando…</p></div>;
  }

  if (stats.totalCards === 0) {
    return (
      <div className="empty-state">
        <p>Nenhum flashcard ainda. Eles surgem de destaques e listas nos artigos e trechos salvos.</p>
      </div>
    );
  }

  const today = localDayKey(new Date());
  const heatMax = Math.max(0, ...stats.heatmap.map(c => c.count));
  const weeks: DayCount[][] = [];
  for (let i = 0; i < stats.heatmap.length; i += 7) weeks.push(stats.heatmap.slice(i, i + 7));
  const upcomingMax = Math.max(1, ...stats.upcoming.map(d => d.count));

  return (
    <div className="review-dashboard">
      <section className="review-hero">
        <div className="review-hero-count">
          <strong>{stats.dueNow}</strong>
          <span>{stats.dueNow === 1 ? "card para revisar agora" : "cards para revisar agora"}</span>
        </div>
        <button className="primary" disabled={stats.dueNow === 0} onClick={onStartReview}>
          {stats.dueNow === 0 ? "Tudo em dia" : "Revisar agora"}
        </button>
      </section>

      <section className="review-stats">
        <div className="review-stat">
          <strong>{plural(stats.streak, "dia", "dias")}</strong>
          <span>sequência</span>
        </div>
        <div className="review-stat">
          <strong>{stats.reviewedToday}</strong>
          <span>revisados hoje</span>
        </div>
        <div className="review-stat">
          <strong>{stats.totalCards}</strong>
          <span>cards no total</span>
        </div>
      </section>

      <section className="review-section">
        <h3>Últimas semanas</h3>
        <div className="review-heatmap" role="img" aria-label="Revisões por dia nas últimas semanas">
          <div className="review-heatmap-labels">
            {WEEKDAY_LABELS.map((l, i) => <span key={i}>{i % 2 === 1 ? l : ""}</span>)}
          </div>
          {weeks.map(week => (
            <div key={week[0].date} className="review-heatmap-week">
              {week.map(cell => (
                <span
                  key={cell.date}
                  className={`review-heatmap-cell level-${heatLevel(cell.count, heatMax)} ${cell.date > today ? "future" : ""} ${cell.date === today ? "today" : ""}`}
                  title={cell.date > today ? "" : `${formatDay(cell.date, { day: "2-digit", month: "short" })}: ${plural(cell.count, "revisão", "revisões")}`}
                />
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="review-section">
        <h3>Próximos 7 dias</h3>
        <ul className="review-upcoming">
          {stats.upcoming.map(d => (
            <li key={d.date}>
              <span className="review-upcoming-day">{formatDay(d.date, { weekday: "short", day: "2-digit" })}</span>
              <span className="review-upcoming-bar">
                <i style={{ width: `${(d.count / upcomingMax) * 100}%` }} />
              </span>
              <span className="review-upcoming-count">{d.count}</span>
            </li>
          ))}
        </ul>
        {stats.dueToday > stats.dueNow && (
          <p className="review-muted">
            Mais {plural(stats.dueToday - stats.dueNow, "card vence", "cards vencem")} ainda hoje.
          </p>
        )}
      </section>
    </div>
  );
};
