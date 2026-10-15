import { useRef, useState } from 'react';
import { api } from '../lib/api';
import { messageFor } from '../lib/errors';
import { downloadJson } from '../utils/csv';
import { count, fileStamp } from '../utils/format';
import { ConfirmDialog } from './ConfirmDialog';
import { Notice } from './ui';

// Download the bank as JSON, or replace it from a JSON file. The file holds the
// answer key, so it must stay out of shared folders and the public repository.
export function BankFileActions({ token, bank, onImported, onAuthError }) {
  const [preview, setPreview] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const pick = async (e) => {
    setError(null);
    setResult(null);
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const chapters = Array.isArray(parsed.chapters) ? parsed.chapters : [];
      const questions = chapters.reduce((n, c) => n + (Array.isArray(c.questions) ? c.questions.length : 0), 0);
      setPreview({ name: file.name, data: parsed, chapters: chapters.length, questions });
    } catch {
      setError(new Error('هذا الملف ليس بصيغة JSON صالحة. نزّل البنك الحالي لترى الصيغة المطلوبة.'));
    }
  };

  const doImport = async () => {
    setImporting(true);
    try {
      const res = await api.admin.importBank(token, preview.data);
      setResult(res);
      setPreview(null);
      if (onImported) onImported(res);
    } catch (err) {
      if (err.code === 'ADMIN_AUTH_REQUIRED' && onAuthError) onAuthError(err);
      else setError(err);
      setPreview(null);
    } finally {
      setImporting(false);
    }
  };

  // The download is the editable part of the bank only (no limits, status or retired items).
  const download = () => {
    const file = {
      format: bank.format ?? 2,
      exportedAt: bank.exportedAt,
      chapters: bank.chapters.map((c) => ({
        id: c.id,
        title: c.title,
        description: c.description,
        questions: c.questions.map((q) => ({
          id: q.id,
          type: q.type,
          text: q.text,
          options: q.options,
          correctOptionIds: q.correctOptionIds,
          explanation: q.explanation,
          durationSeconds: q.durationSeconds,
          sourceRef: q.sourceRef,
        })),
      })),
    };
    downloadJson(`question-bank-${fileStamp()}.private.json`, file);
  };

  return (
    <>
      <div className="btn-row">
        <button className="btn btn--outline btn--s" type="button" disabled={!bank} onClick={download}>
          تنزيل البنك (JSON)
        </button>
        <button className="btn btn--outline btn--s" type="button" onClick={() => fileRef.current && fileRef.current.click()}>
          استيراد بنك من ملف
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={pick} data-testid="bank-file" />
      </div>
      <p className="muted small">الملف المنزّل يحتوي على الإجابات الصحيحة. احفظه بعيدًا عن المجلدات المشتركة والمستودع العام.</p>
      {result && (
        <Notice tone="success">
          تم استيراد {count(result.chapters, 'chapter')} و{count(result.questions, 'question')}.{' '}
          {result.retiredQuestions ? `الأسئلة التي لم ترد في الملف أُوقفت (${result.retiredQuestions}) ويمكن استعادتها.` : ''}
        </Notice>
      )}
      {error && <Notice tone="error">{messageFor(error)}</Notice>}
      <ConfirmDialog
        open={!!preview}
        title="استبدال بنك الأسئلة كاملًا؟"
        confirmLabel="استيراد الأسئلة"
        tone="primary"
        busy={importing}
        onConfirm={doImport}
        onCancel={() => setPreview(null)}
      >
        {preview && (
          <p>
            يحتوي الملف <bdi>{preview.name}</bdi> على {count(preview.chapters, 'chapter')} و{count(preview.questions, 'question')}.
            ما ليس في الملف يُوقف ولا يُحذف، والجلسات الموجودة لا تتغير.
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}
