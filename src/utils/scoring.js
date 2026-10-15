// Mirror of app_private.question_points in the database. The database is the
// only place points are awarded; this copy explains the rules on screen and is
// covered by unit tests so the two stay in step.
//
// linear (PRD default):  round(1000 * remaining / total)             0..1000
// half_floor (optional): round(1000 * (1 - (elapsed / total) / 2))   500..1000
export const SCORING_MODES = {
  linear: {
    label: 'السرعة محسوبة بالكامل (الافتراضي)',
    summary: 'الإجابة الصحيحة تكسب حتى 1,000 نقطة، وتنخفض حتى 0 عند انتهاء الوقت.',
  },
  half_floor: {
    label: 'المعرفة أولًا والسرعة مكافأة',
    summary: 'الإجابة الصحيحة تكسب من 500 إلى 1,000 نقطة حسب السرعة.',
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

// Multiple choice is all or nothing: an answer is right only when the chosen set
// is exactly the set of right answers (order and repeats do not matter).
// Mirrors the check in public.submit_answer.
export function isRightSelection(selected, correct) {
  const a = [...new Set(selected || [])].sort();
  const b = [...new Set(correct || [])].sort();
  return a.length > 0 && a.length === b.length && a.every((x, i) => x === b[i]);
}
