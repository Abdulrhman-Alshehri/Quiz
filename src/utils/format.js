// Arabic display helpers. Numbers stay in Western digits (0-9), as on the deck,
// the join code and the scores; dates use the Gregorian calendar.
const number = new Intl.NumberFormat('en-US');
const AR_LOCALE = 'ar-SA-u-ca-gregory-nu-latn';
const pluralRules = new Intl.PluralRules('ar');

export function points(value) {
  return number.format(Math.round(value || 0));
}

export function seconds(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '–';
  return `${(ms / 1000).toFixed(1)} ث`;
}

// Wrapped in a left-to-right isolate so it reads "100%" after Arabic words,
// instead of the bidi rules moving the sign to the other side ("%100").
export function percent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '–';
  const n = Number(value);
  return `⁦${Number.isInteger(n) ? n : n.toFixed(1)}%⁩`;
}

export function dateTime(value) {
  const d = new Date(String(value || '').replace(/(\.\d{3})\d+/, '$1'));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(AR_LOCALE, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function longDate(date = new Date()) {
  return date.toLocaleDateString(AR_LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });
}

// Arabic counted nouns change form with the number: 1, 2, 3-10, 11-99 and 100+.
// Each entry lists the forms; {n} is replaced by the formatted number.
export const NOUNS = {
  question: { zero: 'لا أسئلة', one: 'سؤال واحد', two: 'سؤالان', few: '{n} أسئلة', many: '{n} سؤالًا', other: '{n} سؤال' },
  chapter: { zero: 'لا فصول', one: 'فصل واحد', two: 'فصلان', few: '{n} فصول', many: '{n} فصلًا', other: '{n} فصل' },
  participant: { zero: 'لا مشاركين', one: 'مشارك واحد', two: 'مشاركان', few: '{n} مشاركين', many: '{n} مشاركًا', other: '{n} مشارك' },
  answer: { zero: 'لا إجابات', one: 'إجابة واحدة', two: 'إجابتان', few: '{n} إجابات', many: '{n} إجابة', other: '{n} إجابة' },
  second: { zero: '0 ثانية', one: 'ثانية واحدة', two: 'ثانيتان', few: '{n} ثوان', many: '{n} ثانية', other: '{n} ثانية' },
  option: { zero: 'لا خيارات', one: 'خيار واحد', two: 'خياران', few: '{n} خيارات', many: '{n} خيارًا', other: '{n} خيار' },
};

export function count(n, noun) {
  const forms = typeof noun === 'string' ? NOUNS[noun] : noun;
  const form = forms[pluralRules.select(n)] ?? forms.other;
  return form.replace('{n}', points(n));
}

// Display letters for up to six options (abjad order). Ids stay A-F in the database.
export const OPTION_IDS = ['A', 'B', 'C', 'D', 'E', 'F'];
export const OPTION_LETTERS = { A: 'أ', B: 'ب', C: 'ج', D: 'د', E: 'هـ', F: 'و' };

export function optionLetter(id) {
  return OPTION_LETTERS[id] || id;
}

export function optionLetters(ids) {
  return (ids || []).map(optionLetter).join('، ');
}

// Question types as the presenter and the participants see them.
export const QUESTION_TYPES = {
  single: { label: 'اختيار واحد', hint: 'إجابة صحيحة واحدة. يضغط المشارك على إجابة فتُرسل فورًا.' },
  multiple: {
    label: 'اختيار متعدد',
    hint: 'إجابتان صحيحتان أو أكثر. يختار المشارك كل ما يراه صحيحًا ثم يضغط «تأكيد الإجابة»، ولا يكسب النقاط إلا إذا اختار الإجابات الصحيحة كلها ولا شيء غيرها.',
  },
  true_false: { label: 'صح أو خطأ', hint: 'خياران ثابتان: «صح» و«خطأ».' },
};

export function typeLabel(type) {
  return (QUESTION_TYPES[type] || QUESTION_TYPES.single).label;
}

// The right answer(s) in words: the text for true/false, the letters otherwise.
export function answerSummary(question) {
  const ids = question.correctOptionIds || (question.correctOptionId ? [question.correctOptionId] : []);
  if (question.type === 'true_false') {
    return ids.map((id) => (question.options || []).find((o) => o.id === id)?.text || optionLetter(id)).join('، ');
  }
  return optionLetters(ids);
}

export function fileStamp(date = new Date()) {
  const pad = (x) => String(x).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}
