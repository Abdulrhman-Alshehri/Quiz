import { toCsv } from './csv';
import { optionLetter } from './format';

const STATUS_LABEL = {
  completed: 'أكمل كل الفصول',
  in_progress: 'قيد التقدم',
  not_started: 'لم يبدأ',
};

// Results per participant: the columns the PRD lists, plus rank and timing.
export function resultsCsv(exported) {
  const { session, chapters, rows } = exported;
  const columns = [
    { label: 'معرف الجلسة', value: () => session.id },
    { label: 'رمز الجلسة', value: () => session.code },
    { label: 'عنوان الجلسة', value: () => session.title },
    { label: 'الترتيب', value: (r) => r.rank },
    { label: 'معرف المشارك', value: (r) => r.participantId },
    { label: 'الاسم', value: (r) => r.displayName },
    ...chapters.map((c, i) => ({
      label: `نقاط الفصل ${i + 1} (${c.title})`,
      value: (r) => (r.chapterPoints && r.chapterPoints[c.id] !== undefined ? r.chapterPoints[c.id] : 0),
    })),
    { label: 'مجموع النقاط', value: (r) => r.totalPoints },
    { label: 'إجابات صحيحة', value: (r) => r.correct },
    { label: 'إجابات خاطئة', value: (r) => r.incorrect },
    { label: 'انتهى الوقت', value: (r) => r.timedOut },
    { label: 'الدقة %', value: (r) => Number(r.accuracy) },
    {
      label: 'متوسط زمن الإجابة (ث)',
      value: (r) => (r.avgResponseMs === null || r.avgResponseMs === undefined ? '' : Number((r.avgResponseMs / 1000).toFixed(2))),
    },
    { label: 'الفصول المكتملة', value: (r) => r.chaptersCompleted },
    { label: 'حالة الإكمال', value: (r) => STATUS_LABEL[r.completionStatus] || r.completionStatus },
    { label: 'وقت الانضمام (UTC)', value: (r) => r.joinedAt },
  ];
  return toCsv(columns, rows);
}

// One row per question: how the room answered. Use it to see which ideas need re-teaching.
export function itemAnalysisCsv(items, session) {
  const columns = [
    { label: 'رمز الجلسة', value: () => session.code },
    { label: 'الفصل', value: (r) => `${r.chapterOrder}. ${r.chapterTitle}` },
    { label: 'رقم السؤال', value: (r) => r.questionOrder },
    { label: 'معرف السؤال', value: (r) => r.questionId },
    { label: 'السؤال', value: (r) => r.questionText },
    { label: 'الخيار الصحيح', value: (r) => optionLetter(r.correctOptionId) },
    { label: 'عُرض', value: (r) => r.played },
    { label: 'أجابوا', value: (r) => r.answered },
    { label: 'صحيحة', value: (r) => r.correct },
    { label: '% الصحيحة (من كل من شاهده)', value: (r) => (r.pctCorrect === null ? '' : Number(r.pctCorrect)) },
    { label: 'انتهى الوقت', value: (r) => r.timedOut },
    { label: 'اختاروا أ', value: (r) => r.optionA },
    { label: 'اختاروا ب', value: (r) => r.optionB },
    { label: 'اختاروا ج', value: (r) => r.optionC },
    { label: 'اختاروا د', value: (r) => r.optionD },
    {
      label: 'متوسط زمن الإجابة (ث)',
      value: (r) => (r.avgResponseMs === null || r.avgResponseMs === undefined ? '' : Number((r.avgResponseMs / 1000).toFixed(2))),
    },
  ];
  return toCsv(columns, items);
}
