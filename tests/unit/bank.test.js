import { describe, expect, it } from 'vitest';
import {
  addOption,
  changeType,
  DEFAULT_LIMITS,
  draftFrom,
  moveId,
  newQuestion,
  removeOption,
  setOptionText,
  toggleCorrect,
  toPayload,
  validateChapter,
  validateQuestion,
} from '../../src/utils/bank.js';
import { isRightSelection } from '../../src/utils/scoring.js';
import { answerSummary, optionLetter, optionLetters } from '../../src/utils/format.js';

const filled = (draft, texts) => texts.reduce((d, t, i) => setOptionText(d, d.options[i].id, t), draft);

describe('multiple choice scoring (all or nothing)', () => {
  it('is right only for exactly the set of right answers', () => {
    expect(isRightSelection(['A', 'C'], ['C', 'A'])).toBe(true);
    expect(isRightSelection(['A', 'A', 'C'], ['A', 'C'])).toBe(true);
    expect(isRightSelection(['A'], ['A', 'C'])).toBe(false); // missed one
    expect(isRightSelection(['A', 'B', 'C'], ['A', 'C'])).toBe(false); // one too many
    expect(isRightSelection([], ['A'])).toBe(false);
  });
});

describe('option letters', () => {
  it('runs in abjad order to six options', () => {
    expect(['A', 'B', 'C', 'D', 'E', 'F'].map(optionLetter).join(' ')).toBe('أ ب ج د هـ و');
    expect(optionLetters(['A', 'E'])).toBe('أ، هـ');
  });
  it('summarises true/false answers by their word', () => {
    expect(answerSummary({ type: 'true_false', options: [{ id: 'A', text: 'صح' }, { id: 'B', text: 'خطأ' }], correctOptionIds: ['B'] })).toBe('خطأ');
    expect(answerSummary({ type: 'single', correctOptionId: 'C' })).toBe('ج');
  });
});

describe('question drafts', () => {
  it('starts with four empty options and the default time for the type', () => {
    const d = newQuestion('ch1');
    expect(d.options.map((o) => o.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(d.durationSeconds).toBe(20);
    expect(newQuestion('ch1', 'multiple').durationSeconds).toBe(30);
    expect(newQuestion('ch1', 'true_false').options.map((o) => o.text)).toEqual(['صح', 'خطأ']);
  });

  it('keeps options aside when switching to true/false and back', () => {
    let d = filled(newQuestion('ch1'), ['one', 'two', 'three', 'four']);
    d = toggleCorrect(d, 'C');
    d = changeType(d, 'true_false');
    expect(d.options.map((o) => o.text)).toEqual(['صح', 'خطأ']);
    expect(d.correctOptionIds).toEqual([]);
    d = changeType(d, 'single');
    expect(d.options.map((o) => o.text)).toEqual(['one', 'two', 'three', 'four']);
  });

  it('switching to single keeps only the first right answer; to multiple keeps them and the 30 s default', () => {
    let d = filled(newQuestion('ch1', 'multiple'), ['a', 'b', 'c', 'd']);
    d = toggleCorrect(toggleCorrect(d, 'B'), 'D');
    expect(d.correctOptionIds).toEqual(['B', 'D']);
    const single = changeType(d, 'single');
    expect(single.correctOptionIds).toEqual(['B']);
    expect(single.durationSeconds).toBe(20);
    expect(changeType(single, 'multiple').durationSeconds).toBe(30);
  });

  it('a custom time survives a type change', () => {
    const d = { ...newQuestion('ch1'), durationSeconds: 25 };
    expect(changeType(d, 'multiple').durationSeconds).toBe(25);
  });

  it('removing an option re-letters the rest and moves the right answers with them', () => {
    let d = filled(newQuestion('ch1', 'multiple'), ['a', 'b', 'c', 'd']);
    d = toggleCorrect(toggleCorrect(d, 'B'), 'D');
    d = removeOption(d, 'A');
    expect(d.options).toEqual([
      { id: 'A', text: 'b' },
      { id: 'B', text: 'c' },
      { id: 'C', text: 'd' },
    ]);
    expect(d.correctOptionIds).toEqual(['A', 'C']);
    expect(removeOption(d, 'A')).toBe(d); // multiple choice keeps at least three
  });

  it('adds options up to six', () => {
    let d = newQuestion('ch1');
    d = addOption(addOption(d));
    expect(d.options.map((o) => o.id)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(addOption(d)).toBe(d);
  });

  it('single choice allows one right answer; multiple toggles', () => {
    let d = newQuestion('ch1');
    d = toggleCorrect(toggleCorrect(d, 'A'), 'B');
    expect(d.correctOptionIds).toEqual(['B']);
    let m = newQuestion('ch1', 'multiple');
    m = toggleCorrect(toggleCorrect(toggleCorrect(m, 'C'), 'A'), 'C');
    expect(m.correctOptionIds).toEqual(['A']);
  });
});

describe('question validation (mirrors the database)', () => {
  const good = () => toggleCorrect(filled({ ...newQuestion('ch1'), text: 'Question?' }, ['a', 'b', 'c', 'd']), 'A');

  it('accepts a complete question', () => {
    expect(validateQuestion(good())).toEqual({});
  });
  it('needs text, option texts and a right answer', () => {
    const e = validateQuestion(newQuestion('ch1'));
    expect(e.text).toBeTruthy();
    expect(e.options).toBeTruthy();
    expect(e.correct).toBeTruthy();
    expect(e.optionIds).toEqual(['A', 'B', 'C', 'D']);
  });
  it('flags two options with the same text', () => {
    const d = setOptionText(good(), 'D', ' A ');
    const e = validateQuestion(d);
    expect(e.options).toMatch(/النص نفسه/);
    expect(e.optionIds.sort()).toEqual(['A', 'D']);
  });
  it('multiple choice needs two right answers and three options', () => {
    let d = changeType(good(), 'multiple');
    expect(validateQuestion(d).correct).toMatch(/إجابتين/);
    d = toggleCorrect(d, 'B');
    expect(validateQuestion(d)).toEqual({});
  });
  it('true/false needs its fixed options and one right answer', () => {
    let d = changeType(good(), 'true_false');
    expect(validateQuestion(d).correct).toBeTruthy();
    d = toggleCorrect(d, 'B');
    expect(validateQuestion(d)).toEqual({});
    expect(validateQuestion({ ...d, options: [{ id: 'A', text: 'نعم' }, { id: 'B', text: 'لا' }] }).options).toBeTruthy();
  });
  it('checks the time and the length limits', () => {
    expect(validateQuestion({ ...good(), durationSeconds: 3 }).durationSeconds).toBeTruthy();
    expect(validateQuestion({ ...good(), durationSeconds: 121 }).durationSeconds).toBeTruthy();
    expect(validateQuestion({ ...good(), text: 'x'.repeat(DEFAULT_LIMITS.maxText + 1) }).text).toBeTruthy();
    expect(validateQuestion({ ...good(), explanation: 'x'.repeat(401) }).explanation).toBeTruthy();
  });
  it('builds the save payload with trimmed text, sorted answers and the revision to check', () => {
    const d = { ...toggleCorrect(changeType(good(), 'multiple'), 'C'), id: 'ch1-q3', revision: 4, text: '  Q?  ' };
    const p = toPayload(d);
    expect(p.text).toBe('Q?');
    expect(p.correctOptionIds).toEqual(['A', 'C']);
    expect(p.expectedRevision).toBe(4);
    expect(p.id).toBe('ch1-q3');
    expect(toPayload(newQuestion('ch2')).id).toBeUndefined();
  });
  it('reads a saved question in either the old or the new shape', () => {
    expect(draftFrom({ id: 'q', chapterId: 'c', text: 't', options: [], correctOptionId: 'B' }).correctOptionIds).toEqual(['B']);
    expect(draftFrom({ id: 'q', chapterId: 'c', type: 'multiple', text: 't', options: [], correctOptionIds: ['A', 'C'] }).type).toBe('multiple');
  });
});

describe('chapters and ordering', () => {
  it('needs a title within the limit', () => {
    expect(validateChapter({ title: ' ', description: '' }).title).toBeTruthy();
    expect(validateChapter({ title: 'ok', description: 'x'.repeat(301) }).description).toBeTruthy();
    expect(validateChapter({ title: 'ok', description: '' })).toEqual({});
  });
  it('moves an id one place up or down, and not past the ends', () => {
    expect(moveId(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveId(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moveId(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
  });
});
