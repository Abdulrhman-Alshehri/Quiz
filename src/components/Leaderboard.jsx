import { percent, points } from '../utils/format';

/** Ranked list for the big screen and the participant final screen. */
export function Leaderboard({ rows, highlightName, total, compact = false }) {
  if (!rows || rows.length === 0) {
    return <p className="empty">Scores appear here after the first answer is revealed.</p>;
  }
  const top = Math.max(1, ...rows.map((r) => r.totalPoints || 0));
  return (
    <ol className={`board${compact ? ' board--compact' : ''}`} aria-label="Leaderboard">
      {rows.map((r) => (
        <li key={`${r.rank}-${r.displayName}`} className={`board__row${r.displayName === highlightName ? ' is-me' : ''}`}>
          <span className="board__rank">{r.rank}</span>
          <span className="board__name" dir="auto">{r.displayName}</span>
          <span className="board__meta">
            {r.correctCount} correct, {percent(r.accuracy)}
          </span>
          <span className="board__pts">{points(r.totalPoints)}</span>
          <span className="board__bar" aria-hidden="true">
            <span style={{ width: `${Math.round((100 * (r.totalPoints || 0)) / top)}%` }} />
          </span>
        </li>
      ))}
      {total > rows.length && <li className="board__more">and {total - rows.length} more</li>}
    </ol>
  );
}
