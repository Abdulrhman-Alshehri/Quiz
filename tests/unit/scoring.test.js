import { describe, expect, it } from 'vitest';
import { compareStanding, computePoints } from '../../src/utils/scoring.js';

describe('computePoints (mirror of app_private.question_points)', () => {
  const base = { durationMs: 20000 };

  it('gives 1,000 for a correct answer at the very start (PRD formula)', () => {
    expect(computePoints({ ...base, correct: true, elapsedMs: 0, remainingMs: 20000 })).toBe(1000);
  });

  it('scales with the time remaining', () => {
    expect(computePoints({ ...base, correct: true, elapsedMs: 5000, remainingMs: 15000 })).toBe(750);
    expect(computePoints({ ...base, correct: true, elapsedMs: 19990, remainingMs: 10 })).toBe(1);
  });

  it('gives 0 at the deadline, for wrong answers and for time-outs', () => {
    expect(computePoints({ ...base, correct: true, elapsedMs: 20000, remainingMs: 0 })).toBe(0);
    expect(computePoints({ ...base, correct: false, elapsedMs: 1000, remainingMs: 19000 })).toBe(0);
    expect(computePoints({ ...base, correct: null, elapsedMs: 0, remainingMs: 0 })).toBe(0);
  });

  it('clamps remaining time to the question duration', () => {
    expect(computePoints({ ...base, correct: true, elapsedMs: -50, remainingMs: 25000 })).toBe(1000);
    expect(computePoints({ ...base, correct: true, elapsedMs: 21000, remainingMs: -500 })).toBe(0);
  });

  it('half_floor mode keeps correct answers between 500 and 1,000', () => {
    const p = (elapsedMs) => computePoints({ ...base, correct: true, elapsedMs, remainingMs: 20000 - elapsedMs, mode: 'half_floor' });
    expect(p(0)).toBe(1000);
    expect(p(10000)).toBe(750);
    expect(p(20000)).toBe(500);
    expect(p(30000)).toBe(500);
  });

  it('rounds to whole points like the database', () => {
    expect(computePoints({ durationMs: 6000, correct: true, elapsedMs: 2001, remainingMs: 3999 })).toBe(Math.round((1000 * 3999) / 6000));
  });
});

describe('compareStanding (leaderboard tie-breakers)', () => {
  const row = (o) => ({ participantId: 'p', totalPoints: 0, correctCount: 0, avgResponseMs: null, joinedAt: '2026-10-14T10:00:00Z', ...o });

  it('orders by points first', () => {
    const rows = [row({ participantId: 'a', totalPoints: 500 }), row({ participantId: 'b', totalPoints: 900 })];
    expect(rows.sort(compareStanding).map((r) => r.participantId)).toEqual(['b', 'a']);
  });

  it('breaks ties on correct answers, then average response time', () => {
    const rows = [
      row({ participantId: 'slow', totalPoints: 800, correctCount: 2, avgResponseMs: 9000 }),
      row({ participantId: 'fewer', totalPoints: 800, correctCount: 1, avgResponseMs: 1000 }),
      row({ participantId: 'fast', totalPoints: 800, correctCount: 2, avgResponseMs: 4000 }),
    ];
    expect(rows.sort(compareStanding).map((r) => r.participantId)).toEqual(['fast', 'slow', 'fewer']);
  });

  it('puts people with no answers after those who answered, then earliest join, then id', () => {
    const rows = [
      row({ participantId: 'z', joinedAt: '2026-10-14T10:00:05Z' }),
      row({ participantId: 'answered', avgResponseMs: 15000 }),
      row({ participantId: 'y', joinedAt: '2026-10-14T10:00:05Z' }),
      row({ participantId: 'early', joinedAt: '2026-10-14T09:59:00Z' }),
    ];
    expect(rows.sort(compareStanding).map((r) => r.participantId)).toEqual(['answered', 'early', 'y', 'z']);
  });
});
