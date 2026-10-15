import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../../src/utils/csv.js';
import { itemAnalysisCsv, resultsCsv } from '../../src/utils/exports.js';

describe('csvCell', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('Al-Khobar, East')).toBe('"Al-Khobar, East"');
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  it('neutralises spreadsheet formulas in text', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+966500000000')).toBe("'+966500000000");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tTab')).toBe("'\tTab");
  });

  it('leaves real numbers alone, including negatives', () => {
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(1000)).toBe('1000');
    expect(csvCell(NaN)).toBe('');
  });

  it('keeps Arabic names intact', () => {
    expect(csvCell('ماجد القميعة')).toBe('ماجد القميعة');
  });

  it('writes empty cells for null and undefined', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
});

describe('toCsv', () => {
  it('builds a header and CRLF rows', () => {
    const csv = toCsv([{ label: 'Name', value: (r) => r.n }, { label: 'Pts', value: (r) => r.p }], [{ n: 'A', p: 1 }, { n: '=B', p: 2 }]);
    expect(csv).toBe("Name,Pts\r\nA,1\r\n'=B,2\r\n");
  });
});

describe('result exports', () => {
  const exported = {
    session: { id: 's-1', code: 'ABC234', title: 'NPS orientation' },
    chapters: [{ id: 'ch1', title: 'Customer Data Platform' }, { id: 'ch2', title: 'NPS 1.0, Measurement' }],
    rows: [
      {
        participantId: 'p-1', displayName: '=Mona', joinedAt: '2026-10-14T10:00:00Z', rank: 1, totalPoints: 1700,
        chapterPoints: { ch1: 1700 }, correct: 2, incorrect: 1, timedOut: 2, answered: 3, accuracy: 40,
        avgResponseMs: 4321, chaptersCompleted: 1, completionStatus: 'in_progress',
      },
    ],
  };

  it('has every PRD column and per-chapter scores (0 for unplayed chapters)', () => {
    const [header, line] = resultsCsv(exported).trim().split('\r\n');
    expect(header.startsWith('معرف الجلسة,')).toBe(true);
    expect(header).toContain('معرف المشارك');
    expect(header).toContain('الاسم');
    expect(header).toContain('نقاط الفصل 1 (Customer Data Platform)');
    expect(header).toContain('"نقاط الفصل 2 (NPS 1.0, Measurement)"');
    expect(header).toContain('مجموع النقاط');
    expect(header).toContain('الدقة %');
    expect(header).toContain('حالة الإكمال');
    expect(line).toContain('قيد التقدم');
    expect(line).toContain("'=Mona");
    expect(line).toContain('1700,0,1700');
    expect(line).toContain('4.32');
  });

  it('item analysis lists option counts, with the Arabic option letter', () => {
    const csv = itemAnalysisCsv(
      [{ chapterOrder: 1, chapterTitle: 'CDP', questionOrder: 2, questionId: 'ch1-q2', questionText: 'When?', correctOptionId: 'D', played: true, answered: 10, correct: 7, timedOut: 1, pctCorrect: 63.6, optionA: 1, optionB: 1, optionC: 1, optionD: 7, avgResponseMs: 6000 }],
      { code: 'ABC234' },
    );
    // Rows from before question types read as single choice with four options (E and F left empty).
    expect(csv.split('\r\n')[1]).toBe('ABC234,1. CDP,2,ch1-q2,اختيار واحد,When?,د,نعم,10,7,63.6,1,1,1,1,7,,,6');
  });

  it('item analysis shows the type, every right answer and up to six option counts', () => {
    const [header, line] = itemAnalysisCsv(
      [{ chapterOrder: 2, chapterTitle: 'NPS', questionOrder: 1, questionId: 'ch2-q1', questionType: 'multiple', questionText: 'Pick all', correctOptionIds: ['A', 'E'], optionCount: 5, played: true, answered: 4, correct: 1, timedOut: 0, pctCorrect: 25, optionA: 3, optionB: 1, optionC: 0, optionD: 2, optionE: 2, optionF: 0, avgResponseMs: 12000 }],
      { code: 'ABC234' },
    ).trim().split('\r\n');
    expect(header).toContain('نوع السؤال');
    expect(header).toContain('اختاروا هـ');
    expect(header).toContain('اختاروا و');
    // Six option columns: A-E counted, F empty because this question has five options.
    expect(line).toBe('ABC234,2. NPS,1,ch2-q1,اختيار متعدد,Pick all,أ، هـ,نعم,4,1,25,0,3,1,0,2,2,,12');
  });
});
