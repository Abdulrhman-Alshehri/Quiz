import { describe, expect, it } from 'vitest';
import { normalizeName, validateName } from '../../src/utils/names.js';
import { fromSupabaseError } from '../../src/lib/errors.js';
import { count, optionLetter, seconds } from '../../src/utils/format.js';

describe('names (same rules as join_session)', () => {
  it('trims and collapses spaces', () => {
    expect(normalizeName('  Omar    Al  Juhani ')).toBe('Omar Al Juhani');
  });
  it('rejects empty and whitespace-only names', () => {
    expect(validateName('')).toBe('NAME_REQUIRED');
    expect(validateName('    ')).toBe('NAME_REQUIRED');
  });
  it('rejects names over 30 characters after trimming', () => {
    expect(validateName('x'.repeat(30))).toBeNull();
    expect(validateName(`  ${'x'.repeat(30)}  `)).toBeNull();
    expect(validateName('x'.repeat(31))).toBe('NAME_TOO_LONG');
  });
  it('accepts Arabic names', () => {
    expect(validateName('سارة')).toBeNull();
  });
});

describe('error mapping', () => {
  it('maps database codes to plain messages', () => {
    const e = fromSupabaseError({ code: 'P0001', message: 'NAME_TAKEN' });
    expect(e.code).toBe('NAME_TAKEN');
    expect(e.message).toMatch(/انضم شخص بهذا الاسم/);
  });
  it('keeps detail after a colon for bank errors', () => {
    const e = fromSupabaseError({ code: 'P0001', message: 'BANK_INVALID:chapter 2 must have exactly 5 questions' });
    expect(e.code).toBe('BANK_INVALID');
    expect(e.message).toContain('chapter 2 must have exactly 5 questions');
  });
  it('recognises network failures', () => {
    expect(fromSupabaseError({ code: '', message: 'TypeError: Failed to fetch' }).code).toBe('NETWORK');
  });
});

describe('Arabic counted nouns and display letters', () => {
  it('uses the right Arabic form for 1, 2, 3-10, 11-99 and 100+', () => {
    expect(count(1, 'question')).toBe('سؤال واحد');
    expect(count(2, 'question')).toBe('سؤالان');
    expect(count(5, 'question')).toBe('5 أسئلة');
    expect(count(20, 'question')).toBe('20 سؤالًا');
    expect(count(100, 'question')).toBe('100 سؤال');
    expect(count(3, 'participant')).toBe('3 مشاركين');
    expect(count(1200, 'participant')).toBe('1,200 مشارك');
  });
  it('shows options as أ ب ج د and seconds with the Arabic abbreviation', () => {
    expect(['A', 'B', 'C', 'D'].map(optionLetter).join('')).toBe('أبجد');
    expect(seconds(4321)).toBe('4.3 ث');
  });
});
