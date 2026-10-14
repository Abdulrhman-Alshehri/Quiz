import { toCsv } from './csv';

const STATUS_LABEL = {
  completed: 'Completed all chapters',
  in_progress: 'In progress',
  not_started: 'Not started',
};

// Results per participant: the columns the PRD lists, plus rank and timing.
export function resultsCsv(exported) {
  const { session, chapters, rows } = exported;
  const columns = [
    { label: 'Session ID', value: () => session.id },
    { label: 'Session code', value: () => session.code },
    { label: 'Session title', value: () => session.title },
    { label: 'Rank', value: (r) => r.rank },
    { label: 'Participant ID', value: (r) => r.participantId },
    { label: 'Display name', value: (r) => r.displayName },
    ...chapters.map((c, i) => ({
      label: `Chapter ${i + 1} points (${c.title})`,
      value: (r) => (r.chapterPoints && r.chapterPoints[c.id] !== undefined ? r.chapterPoints[c.id] : 0),
    })),
    { label: 'Overall points', value: (r) => r.totalPoints },
    { label: 'Correct answers', value: (r) => r.correct },
    { label: 'Incorrect answers', value: (r) => r.incorrect },
    { label: 'Timed out', value: (r) => r.timedOut },
    { label: 'Accuracy %', value: (r) => Number(r.accuracy) },
    {
      label: 'Average response (s)',
      value: (r) => (r.avgResponseMs === null || r.avgResponseMs === undefined ? '' : Number((r.avgResponseMs / 1000).toFixed(2))),
    },
    { label: 'Chapters completed', value: (r) => r.chaptersCompleted },
    { label: 'Completion status', value: (r) => STATUS_LABEL[r.completionStatus] || r.completionStatus },
    { label: 'Joined at (UTC)', value: (r) => r.joinedAt },
  ];
  return toCsv(columns, rows);
}

// One row per question: how the room answered. Use it to see which ideas need re-teaching.
export function itemAnalysisCsv(items, session) {
  const columns = [
    { label: 'Session code', value: () => session.code },
    { label: 'Chapter', value: (r) => `${r.chapterOrder}. ${r.chapterTitle}` },
    { label: 'Question #', value: (r) => r.questionOrder },
    { label: 'Question ID', value: (r) => r.questionId },
    { label: 'Question', value: (r) => r.questionText },
    { label: 'Correct option', value: (r) => r.correctOptionId },
    { label: 'Played', value: (r) => r.played },
    { label: 'Answered', value: (r) => r.answered },
    { label: 'Correct', value: (r) => r.correct },
    { label: '% correct (of all who saw it)', value: (r) => (r.pctCorrect === null ? '' : Number(r.pctCorrect)) },
    { label: 'Timed out', value: (r) => r.timedOut },
    { label: 'Chose A', value: (r) => r.optionA },
    { label: 'Chose B', value: (r) => r.optionB },
    { label: 'Chose C', value: (r) => r.optionC },
    { label: 'Chose D', value: (r) => r.optionD },
    {
      label: 'Average response (s)',
      value: (r) => (r.avgResponseMs === null || r.avgResponseMs === undefined ? '' : Number((r.avgResponseMs / 1000).toFixed(2))),
    },
  ];
  return toCsv(columns, items);
}
