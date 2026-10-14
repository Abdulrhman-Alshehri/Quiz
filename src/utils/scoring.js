// Mirror of app_private.question_points in the database. The database is the
// only place points are awarded; this copy explains the rules on screen and is
// covered by unit tests so the two stay in step.
//
// linear (PRD default):  round(1000 * remaining / total)             0..1000
// half_floor (optional): round(1000 * (1 - (elapsed / total) / 2))   500..1000
export const SCORING_MODES = {
  linear: {
    label: 'Speed counts fully (PRD default)',
    summary: 'Correct answers earn up to 1,000 points, falling to 0 at the deadline.',
  },
  half_floor: {
    label: 'Knowledge first, speed as a bonus',
    summary: 'Correct answers earn 500 to 1,000 points depending on speed.',
  },
};

export function computePoints({ correct, elapsedMs, remainingMs, durationMs, mode = 'linear' }) {
  if (!correct || !durationMs || durationMs <= 0) return 0;
  const clamp = (v) => Math.min(Math.max(v, 0), durationMs);
  if (mode === 'half_floor') {
    return Math.round(1000 * (1 - clamp(elapsedMs) / durationMs / 2));
  }
  return Math.round((1000 * clamp(remainingMs)) / durationMs);
}

// Ranking rule used by the database leaderboard, for display and tests:
// points (high first), correct answers (high first), average response time
// (fast first, none last), join time (early first), participant id.
export function compareStanding(a, b) {
  if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
  if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;
  const ar = a.avgResponseMs ?? Infinity;
  const br = b.avgResponseMs ?? Infinity;
  if (ar !== br) return ar - br;
  const aj = Date.parse(a.joinedAt);
  const bj = Date.parse(b.joinedAt);
  if (aj !== bj) return aj - bj;
  return String(a.participantId).localeCompare(String(b.participantId));
}
