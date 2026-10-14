import { describe, expect, it } from 'vitest';
import { normalizeName, validateName } from '../../src/utils/names.js';
import { fromSupabaseError } from '../../src/lib/errors.js';

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
    expect(e.message).toMatch(/already joined/);
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
