// Question-bank rules for the editor. The database checks every save again
// (app_private.question_problem / prepare_question); these copies give the
// presenter the same messages before anything is sent.
import { OPTION_IDS, optionLetter } from './format';

export const DEFAULT_LIMITS = {
  maxChapters: 10,
  maxQuestionsPerChapter: 10,
  minOptions: 2,
  maxOptions: 6,
  minOptionsMultiple: 3,
  maxTitle: 120,
  maxDescription: 300,
  maxText: 300,
  maxOption: 120,
  maxExplanation: 400,
  maxSourceRef: 200,
  minSeconds: 5,
  maxSeconds: 120,
  defaultSeconds: { single: 20, multiple: 30, true_false: 20 },
  trueFalseOptions: ['صح', 'خطأ'],
};

export function limitsOf(bank) {
  return { ...DEFAULT_LIMITS, ...(bank?.limits || {}) };
}

// Characters as the database counts them (code points, not UTF-16 units).
export function charCount(text) {
  return [...String(text ?? '')].length;
}

export function trueFalseOptions(limits = DEFAULT_LIMITS) {
  return [
    { id: 'A', text: limits.trueFalseOptions[0] },
    { id: 'B', text: limits.trueFalseOptions[1] },
  ];
}

function blankOptions(n) {
  return OPTION_IDS.slice(0, n).map((id) => ({ id, text: '' }));
}

export function minOptionsFor(type, limits = DEFAULT_LIMITS) {
  if (type === 'true_false') return 2;
  return type === 'multiple' ? limits.minOptionsMultiple : limits.minOptions;
}

export function newQuestion(chapterId, type = 'single', limits = DEFAULT_LIMITS) {
  return {
    id: null,
    revision: null,
    chapterId,
    type,
    text: '',
    options: type === 'true_false' ? trueFalseOptions(limits) : blankOptions(4),
    correctOptionIds: [],
    explanation: '',
    durationSeconds: limits.defaultSeconds[type],
    sourceRef: '',
  };
}

// An editable copy of a saved question.
export function draftFrom(question) {
  return {
    id: question.id,
    revision: question.revision ?? null,
    chapterId: question.chapterId,
    type: question.type || 'single',
    text: question.text || '',
    options: (question.options || []).map((o) => ({ id: o.id, text: o.text })),
    correctOptionIds: [...(question.correctOptionIds || (question.correctOptionId ? [question.correctOptionId] : []))],
    explanation: question.explanation || '',
    durationSeconds: question.durationSeconds ?? DEFAULT_LIMITS.defaultSeconds[question.type || 'single'],
    sourceRef: question.sourceRef || '',
  };
}

// Switching type keeps what still fits: the options (kept aside while the
// question is true/false), the right answer(s) where they still make sense,
// and the time when it was the old type's default.
export function changeType(draft, type, limits = DEFAULT_LIMITS) {
  if (!type || type === draft.type) return draft;
  const next = { ...draft, type };
  if (Number(draft.durationSeconds) === limits.defaultSeconds[draft.type]) {
    next.durationSeconds = limits.defaultSeconds[type];
  }
  if (type === 'true_false') {
    next.keptOptions = draft.type === 'true_false' ? draft.keptOptions : draft.options;
    next.options = trueFalseOptions(limits);
    next.correctOptionIds = [];
    return next;
  }
  if (draft.type === 'true_false') {
    next.options = draft.keptOptions && draft.keptOptions.length ? draft.keptOptions : blankOptions(4);
    next.correctOptionIds = [];
  }
  if (type === 'multiple' && next.options.length < limits.minOptionsMultiple) {
    next.options = [...next.options, ...blankOptions(limits.minOptionsMultiple).slice(next.options.length)];
  }
  if (type === 'single' && next.correctOptionIds.length > 1) {
    next.correctOptionIds = next.correctOptionIds.slice(0, 1);
  }
  return next;
}

export function setOptionText(draft, id, text) {
  return { ...draft, options: draft.options.map((o) => (o.id === id ? { ...o, text } : o)) };
}

export function addOption(draft, limits = DEFAULT_LIMITS) {
  if (draft.type === 'true_false' || draft.options.length >= limits.maxOptions) return draft;
  return { ...draft, options: [...draft.options, { id: OPTION_IDS[draft.options.length], text: '' }] };
}

// Removing an option re-letters the ones after it, and the right answers follow.
export function removeOption(draft, id, limits = DEFAULT_LIMITS) {
  if (draft.type === 'true_false' || draft.options.length <= minOptionsFor(draft.type, limits)) return draft;
  const kept = draft.options.filter((o) => o.id !== id);
  const rename = new Map(kept.map((o, i) => [o.id, OPTION_IDS[i]]));
  return {
    ...draft,
    options: kept.map((o, i) => ({ id: OPTION_IDS[i], text: o.text })),
    correctOptionIds: draft.correctOptionIds.filter((c) => rename.has(c)).map((c) => rename.get(c)).sort(),
  };
}

export function toggleCorrect(draft, id) {
  if (draft.type === 'multiple') {
    const on = draft.correctOptionIds.includes(id);
    const ids = on ? draft.correctOptionIds.filter((c) => c !== id) : [...draft.correctOptionIds, id];
    return { ...draft, correctOptionIds: ids.sort() };
  }
  return { ...draft, correctOptionIds: [id] };
}

/**
 * Problems with a draft, as Arabic messages keyed by field:
 * text, options, correct, explanation, sourceRef, durationSeconds, chapterId.
 * optionIds lists the options that need attention. Empty object = valid.
 */
export function validateQuestion(draft, limits = DEFAULT_LIMITS) {
  const errors = {};
  const bad = new Set();
  const type = draft.type;
  if (!['single', 'multiple', 'true_false'].includes(type)) errors.type = 'اختر نوع السؤال.';
  if (!draft.chapterId) errors.chapterId = 'اختر الفصل.';
  const text = String(draft.text || '').trim();
  if (!text) errors.text = 'اكتب نص السؤال.';
  else if (charCount(text) > limits.maxText) errors.text = `نص السؤال أطول من ${limits.maxText} حرف.`;

  const options = draft.options || [];
  const min = minOptionsFor(type, limits);
  if (options.length < min || options.length > limits.maxOptions) {
    errors.options =
      type === 'multiple'
        ? `سؤال الاختيار المتعدد يحتاج من ${limits.minOptionsMultiple} إلى ${limits.maxOptions} خيارات.`
        : `يحتاج السؤال من خيارين إلى ${limits.maxOptions} خيارات.`;
  }
  const seen = new Map();
  options.forEach((o, i) => {
    const t = String(o.text || '').trim();
    if (o.id !== OPTION_IDS[i]) errors.options = errors.options || 'ترتيب الخيارات غير صحيح. أعد فتح السؤال.';
    if (!t) {
      bad.add(o.id);
      errors.options = errors.options || `اكتب نص الخيار ${optionLetter(o.id)}.`;
    } else if (charCount(t) > limits.maxOption) {
      bad.add(o.id);
      errors.options = errors.options || `نص الخيار ${optionLetter(o.id)} أطول من ${limits.maxOption} حرف.`;
    }
    const key = t.toLowerCase();
    if (t && seen.has(key)) {
      bad.add(o.id);
      bad.add(seen.get(key));
      errors.options = errors.options || `الخياران ${optionLetter(seen.get(key))} و${optionLetter(o.id)} لهما النص نفسه.`;
    } else if (t) {
      seen.set(key, o.id);
    }
  });
  if (type === 'true_false') {
    const [a, b] = limits.trueFalseOptions;
    if (options.length !== 2 || options[0]?.text !== a || options[1]?.text !== b) {
      errors.options = `خيارا سؤال الصح والخطأ هما «${a}» و«${b}».`;
    }
  }

  const correct = draft.correctOptionIds || [];
  const ids = options.map((o) => o.id);
  if (correct.length === 0) {
    errors.correct = type === 'multiple' ? 'حدّد الإجابات الصحيحة.' : 'حدّد الإجابة الصحيحة.';
  } else if (correct.some((c) => !ids.includes(c))) {
    errors.correct = 'إحدى الإجابات الصحيحة ليست من الخيارات.';
  } else if (type === 'multiple' && correct.length < 2) {
    errors.correct = 'سؤال الاختيار المتعدد يحتاج إجابتين صحيحتين على الأقل. لسؤال له إجابة صحيحة واحدة اختر «اختيار واحد».';
  } else if (type !== 'multiple' && correct.length !== 1) {
    errors.correct = 'لهذا النوع إجابة صحيحة واحدة فقط.';
  }

  if (charCount(String(draft.explanation || '').trim()) > limits.maxExplanation) {
    errors.explanation = `التوضيح أطول من ${limits.maxExplanation} حرف.`;
  }
  if (charCount(String(draft.sourceRef || '').trim()) > limits.maxSourceRef) {
    errors.sourceRef = `المرجع أطول من ${limits.maxSourceRef} حرف.`;
  }
  const secs = Number(draft.durationSeconds);
  if (!Number.isInteger(secs) || secs < limits.minSeconds || secs > limits.maxSeconds) {
    errors.durationSeconds = `المدة عدد صحيح من ${limits.minSeconds} إلى ${limits.maxSeconds} ثانية.`;
  }
  if (bad.size) errors.optionIds = [...bad];
  return errors;
}

// What the database expects (admin_save_question).
export function toPayload(draft) {
  const payload = {
    chapterId: draft.chapterId,
    type: draft.type,
    text: String(draft.text || '').trim(),
    options: draft.options.map((o) => ({ id: o.id, text: String(o.text || '').trim() })),
    correctOptionIds: [...draft.correctOptionIds].sort(),
    explanation: String(draft.explanation || '').trim(),
    durationSeconds: Number(draft.durationSeconds),
    sourceRef: String(draft.sourceRef || '').trim(),
  };
  if (draft.id) {
    payload.id = draft.id;
    if (draft.revision !== null && draft.revision !== undefined) payload.expectedRevision = draft.revision;
  }
  return payload;
}

export function sameDraft(a, b) {
  return JSON.stringify(toPayload(a)) === JSON.stringify(toPayload(b));
}

export function validateChapter(draft, limits = DEFAULT_LIMITS) {
  const errors = {};
  const title = String(draft.title || '').trim();
  if (!title) errors.title = 'اكتب عنوان الفصل.';
  else if (charCount(title) > limits.maxTitle) errors.title = `العنوان أطول من ${limits.maxTitle} حرف.`;
  if (charCount(String(draft.description || '').trim()) > limits.maxDescription) {
    errors.description = `الوصف أطول من ${limits.maxDescription} حرف.`;
  }
  return errors;
}

// New order of ids after moving one item up (-1) or down (+1).
export function moveId(ids, id, step) {
  const i = ids.indexOf(id);
  const j = i + step;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
