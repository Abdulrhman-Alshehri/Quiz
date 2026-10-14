import { percent, points } from '../utils/format';

/** Ranked list for the big screen and the participant final screen. */
export function Leaderboard({ rows, highlightName, total, compact = false }) {
  if (!rows || rows.length === 0) {
    return <p className="empty">تظهر النتائج هنا بعد كشف أول إجابة.</p>;
  }
  const top = Math.max(1, ...rows.map((r) => r.totalPoints || 0));
  return (
    <ol className={`board${compact ? ' board--compact' : ''}`} aria-label="لوحة الصدارة">
      {rows.map((r) => (
        <li key={`${r.rank}-${r.displayName}`} className={`board__row${r.displayName === highlightName ? ' is-me' : ''}`}>
          <span className="board__rank">{r.rank}</span>
          <span className="board__name">
            <bdi>{r.displayName}</bdi>
          </span>
          <span className="board__meta">
            {r.correctCount} صحيحة · {percent(r.accuracy)}
          </span>
          <span className="board__pts">{points(r.totalPoints)}</span>
          <span className="board__bar" aria-hidden="true">
            <span style={{ width: `${Math.round((100 * (r.totalPoints || 0)) / top)}%` }} />
          </span>
        </li>
      ))}
      {total > rows.length && <li className="board__more">و{total - rows.length} آخرون</li>}
    </ol>
  );
}
