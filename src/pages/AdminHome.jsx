import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { messageFor } from '../lib/errors';
import { navigate } from '../lib/router';
import { useAdminToken } from '../lib/useAdmin';
import { downloadJson } from '../utils/csv';
import { count, dateTime, fileStamp, longDate, optionLetter } from '../utils/format';
import { SCORING_MODES } from '../utils/scoring';
import { Logo } from '../components/Brand';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Plate } from '../components/Plate';
import { Notice, Spinner } from '../components/ui';
import AdminLogin from './AdminLogin';

export default function AdminHome() {
  const { admin, signIn, signOut } = useAdminToken();
  if (!admin) return <AdminLogin onSignedIn={signIn} />;
  return <Dashboard token={admin.token} onSignOut={signOut} />;
}

function Dashboard({ token, onSignOut }) {
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState(null);

  const handle = useCallback(
    (e) => {
      if (e?.code === 'ADMIN_AUTH_REQUIRED') onSignOut();
      else setError(e);
    },
    [onSignOut],
  );

  const load = useCallback(() => {
    api.admin.listSessions(token).then(setSessions).catch(handle);
  }, [token, handle]);

  useEffect(() => {
    load();
  }, [load]);

  const signOut = async () => {
    try {
      await api.admin.logout(token);
    } catch {
      // token is cleared locally either way
    }
    onSignOut();
  };

  const current = (sessions || []).filter((s) => s.status !== 'ended');
  const past = (sessions || []).filter((s) => s.status === 'ended');

  return (
    <main className="admin">
      <header className="admin__bar on-blue">
        <Logo />
        <a className="admin__brand" href="#/admin">مسابقة NPS المباشرة</a>
        <span className="admin__where">لوحة تحكم المقدم</span>
        <button className="btn btn--quiet" type="button" onClick={signOut}>
          تسجيل الخروج
        </button>
      </header>
      <div className="admin__grid">
        <div className="admin__col">
          {error && <Notice tone="error">{messageFor(error)}</Notice>}
          <NewSession token={token} onError={handle} />
          <section className="card" aria-labelledby="sessions-title">
            <h2 id="sessions-title" className="h3">الجلسات</h2>
            {!sessions && <Spinner label="جارٍ تحميل الجلسات…" />}
            {sessions && current.length === 0 && <p className="muted">لا توجد جلسات مفتوحة. أنشئ جلسة من النموذج أعلاه.</p>}
            <ul className="session-list">
              {current.map((s) => (
                <SessionRow key={s.id} s={s} />
              ))}
            </ul>
            {past.length > 0 && (
              <details className="past">
                <summary>الجلسات المنتهية ({past.length})</summary>
                <ul className="session-list">
                  {past.map((s) => (
                    <SessionRow key={s.id} s={s} />
                  ))}
                </ul>
                <p className="muted small">
                  تحتفظ الجلسات المنتهية بنتائجها للتصدير. لحذف جلسة نهائيًا، احذف صفها من لوحة Supabase (Table Editor ثم
                  sessions)، وتُحذف معها مشاركاتها وإجاباتها.
                </p>
              </details>
            )}
          </section>
        </div>
        <div className="admin__col">
          <BankPanel token={token} onError={handle} />
          <PasscodePanel token={token} onError={handle} />
        </div>
      </div>
    </main>
  );
}

function SessionRow({ s }) {
  return (
    <li className="session-row">
      <Plate code={s.code} size="xs" />
      <div className="session-row__info">
        <a className="session-row__title" href={`#/admin/session/${s.id}`}>
          <bdi>{s.title}</bdi>
        </a>
        <span className="muted small">
          {dateTime(s.createdAt)} · المشاركون: {s.participants} ·{' '}
          {s.status === 'ended' ? 'منتهية' : s.status === 'live' ? 'جارية' : 'لم تبدأ'}
        </span>
      </div>
      <a className="btn btn--outline btn--s" href={`#/admin/session/${s.id}`}>
        فتح
      </a>
    </li>
  );
}

function NewSession({ token, onError }) {
  const [title, setTitle] = useState(`ورشة تعريف NPS، ${longDate()}`);
  const [seconds, setSeconds] = useState(20);
  const [scoring, setScoring] = useState('linear');
  const [feedback, setFeedback] = useState('on_reveal');
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.admin.createSession(token, title, {
        durationOverride: Number(seconds) === 20 ? null : Number(seconds),
        scoringMode: scoring,
        feedbackMode: feedback,
        autoAdvance: auto,
      });
      navigate(`/admin/session/${res.sessionId}`);
    } catch (err) {
      if (err.code === 'ADMIN_AUTH_REQUIRED') onError(err);
      else setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="new-title">
      <h2 id="new-title" className="h3">جلسة جديدة</h2>
      <p className="muted small">لكل جلسة رمز انضمام خاص بها، ونتائجها منفصلة عن غيرها.</p>
      <form className="stack" onSubmit={create}>
        <label className="field">
          <span className="field__label">العنوان على الشاشة الكبيرة</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required />
        </label>
        <div className="row">
          <label className="field">
            <span className="field__label">عدد الثواني لكل سؤال</span>
            <input
              className="input"
              type="number"
              min={10}
              max={60}
              value={seconds}
              onChange={(e) => setSeconds(e.target.value)}
              required
            />
          </label>
          <label className="field">
            <span className="field__label">إظهار الصواب والخطأ</span>
            <select className="input" value={feedback} onChange={(e) => setFeedback(e.target.value)}>
              <option value="on_reveal">عند كشف الإجابة (موصى به)</option>
              <option value="immediate">فور كل إجابة</option>
            </select>
          </label>
        </div>
        <fieldset className="field">
          <legend className="field__label">طريقة احتساب النقاط</legend>
          {Object.entries(SCORING_MODES).map(([value, m]) => (
            <label key={value} className="choice">
              <input type="radio" name="scoring" value={value} checked={scoring === value} onChange={() => setScoring(value)} />
              <span>
                <strong>{m.label}.</strong> {m.summary}
              </span>
            </label>
          ))}
        </fieldset>
        <label className="choice">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          <span>
            <strong>تشغيل الأسئلة تلقائيًا.</strong> تُكشف الإجابة عند انتهاء الوقت، ثم ينتقل إلى السؤال التالي بعد مهلة قصيرة.
            يمكنك تشغيله أو إيقافه أثناء الجلسة.
          </span>
        </label>
        {error && <Notice tone="error">{messageFor(error)}</Notice>}
        <button className="btn btn--primary" type="submit" disabled={busy}>
          {busy ? 'جارٍ الإنشاء…' : 'إنشاء الجلسة'}
        </button>
      </form>
    </section>
  );
}

function BankPanel({ token, onError }) {
  const [bank, setBank] = useState(null);
  const [preview, setPreview] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const load = useCallback(() => {
    api.admin.getBank(token).then(setBank).catch(onError);
  }, [token, onError]);
  useEffect(() => {
    load();
  }, [load]);

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
      load();
    } catch (err) {
      if (err.code === 'ADMIN_AUTH_REQUIRED') onError(err);
      else setError(err);
      setPreview(null);
    } finally {
      setImporting(false);
    }
  };

  const total = bank ? bank.chapters.reduce((n, c) => n + c.questions.length, 0) : 0;
  return (
    <section className="card" aria-labelledby="bank-title">
      <h2 id="bank-title" className="h3">بنك الأسئلة</h2>
      <p className="muted small">الجلسات الجديدة تنسخ هذه الأسئلة، والجلسات الموجودة تحتفظ بالأسئلة التي بدأت بها.</p>
      {!bank && <Spinner label="جارٍ تحميل الأسئلة…" />}
      {bank && (
        <ol className="bank">
          {bank.chapters.map((c) => (
            <li key={c.id}>
              <details>
                <summary>
                  <strong>{c.title}</strong> <span className="muted">({count(c.questions.length, 'question')})</span>
                </summary>
                <ol className="bank__qs">
                  {c.questions.map((q) => (
                    <li key={q.id}>
                      <span>{q.text}</span>
                      <span className="muted small">
                        {' '}
                        الإجابة {optionLetter(q.correctOptionId)}، {q.durationSeconds} ث{q.sourceRef ? `، ${q.sourceRef}` : ''}
                      </span>
                    </li>
                  ))}
                </ol>
              </details>
            </li>
          ))}
        </ol>
      )}
      {bank && (
        <p className="muted small">
          {count(bank.chapters.length, 'chapter')}، {count(total, 'question')}. تحتاج الجلسة إلى 4 فصول بالضبط، في كل منها 5
          أسئلة.
        </p>
      )}
      <div className="btn-row">
        <button
          className="btn btn--outline btn--s"
          type="button"
          disabled={!bank}
          onClick={() => downloadJson(`question-bank-${fileStamp()}.private.json`, bank)}
        >
          تنزيل البنك (JSON)
        </button>
        <button className="btn btn--outline btn--s" type="button" onClick={() => fileRef.current && fileRef.current.click()}>
          استيراد بنك جديد
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={pick} />
      </div>
      <p className="muted small">الملف المنزّل يحتوي على الإجابات الصحيحة. احفظه بعيدًا عن المجلدات المشتركة والمستودع العام.</p>
      {result && (
        <Notice tone="success">
          تم استيراد {count(result.questions, 'question')}.{' '}
          {result.retiredQuestions ? `الأسئلة القديمة الموقوفة: ${result.retiredQuestions}، وهي محفوظة في السجل.` : ''}
        </Notice>
      )}
      {error && <Notice tone="error">{messageFor(error)}</Notice>}
      <ConfirmDialog
        open={!!preview}
        title="استبدال بنك الأسئلة؟"
        confirmLabel="استيراد الأسئلة"
        tone="primary"
        busy={importing}
        onConfirm={doImport}
        onCancel={() => setPreview(null)}
      >
        {preview && (
          <p>
            يحتوي الملف <bdi>{preview.name}</bdi> على {count(preview.chapters, 'chapter')} و{count(preview.questions, 'question')}.
            الأسئلة غير الموجودة فيه تُوقف ولا تُحذف، والجلسات الموجودة لا تتغير.
          </p>
        )}
      </ConfirmDialog>
    </section>
  );
}

function PasscodePanel({ token, onError }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setMsg(null);
    if (next !== again) {
      setMsg({ tone: 'error', text: 'رمزا المرور الجديدان غير متطابقين.' });
      return;
    }
    setBusy(true);
    try {
      await api.admin.changePasscode(token, current, next);
      setMsg({ tone: 'success', text: 'تم تغيير رمز المرور، وتم تسجيل خروج الأجهزة الأخرى.' });
      setCurrent('');
      setNext('');
      setAgain('');
    } catch (err) {
      if (err.code === 'ADMIN_AUTH_REQUIRED') onError(err);
      else setMsg({ tone: 'error', text: messageFor(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="pass-title">
      <h2 id="pass-title" className="h3">رمز مرور المقدم</h2>
      <details>
        <summary>تغيير رمز المرور</summary>
        <form className="stack" onSubmit={submit}>
          <label className="field">
            <span className="field__label">رمز المرور الحالي</span>
            <input className="input" dir="ltr" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          </label>
          <label className="field">
            <span className="field__label">رمز المرور الجديد (من 10 إلى 72 حرفًا)</span>
            <input className="input" dir="ltr" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={10} maxLength={72} required />
          </label>
          <label className="field">
            <span className="field__label">أعد كتابة رمز المرور الجديد</span>
            <input className="input" dir="ltr" type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required />
          </label>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <button className="btn btn--outline" type="submit" disabled={busy}>
            {busy ? 'جارٍ الحفظ…' : 'تغيير رمز المرور'}
          </button>
        </form>
      </details>
    </section>
  );
}
