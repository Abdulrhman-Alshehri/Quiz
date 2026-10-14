import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { messageFor } from '../lib/errors';
import { navigate } from '../lib/router';
import { useAdminToken } from '../lib/useAdmin';
import { downloadJson } from '../utils/csv';
import { dateTime, fileStamp, plural } from '../utils/format';
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
        <a className="admin__brand" href="#/admin">NPS Live Quiz</a>
        <span className="admin__where">Presenter console</span>
        <button className="btn btn--quiet" type="button" onClick={signOut}>
          Sign out
        </button>
      </header>
      <div className="admin__grid">
        <div className="admin__col">
          {error && <Notice tone="error">{messageFor(error)}</Notice>}
          <NewSession token={token} onError={handle} />
          <section className="card" aria-labelledby="sessions-title">
            <h2 id="sessions-title" className="h3">Sessions</h2>
            {!sessions && <Spinner label="Loading sessions…" />}
            {sessions && current.length === 0 && <p className="muted">No open sessions. Create one above.</p>}
            <ul className="session-list">
              {current.map((s) => (
                <SessionRow key={s.id} s={s} />
              ))}
            </ul>
            {past.length > 0 && (
              <details className="past">
                <summary>Ended sessions ({past.length})</summary>
                <ul className="session-list">
                  {past.map((s) => (
                    <SessionRow key={s.id} s={s} />
                  ))}
                </ul>
                <p className="muted small">
                  Ended sessions keep their results for export. To remove a session completely, delete its row in the
                  Supabase dashboard (Table Editor, sessions); its participants and answers are removed with it.
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
        <a className="session-row__title" href={`#/admin/session/${s.id}`} dir="auto">
          {s.title}
        </a>
        <span className="muted small">
          {dateTime(s.createdAt)}. {plural(s.participants, 'participant', 'participants')}.{' '}
          {s.status === 'ended' ? 'Ended' : s.status === 'live' ? 'Live' : 'Not started'}
        </span>
      </div>
      <a className="btn btn--outline btn--s" href={`#/admin/session/${s.id}`}>
        Open
      </a>
    </li>
  );
}

function NewSession({ token, onError }) {
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const [title, setTitle] = useState(`NPS orientation, ${today}`);
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
      <h2 id="new-title" className="h3">New session</h2>
      <p className="muted small">Each session gets its own join code and keeps its results separate.</p>
      <form className="stack" onSubmit={create}>
        <label className="field">
          <span className="field__label">Title shown on the big screen</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required />
        </label>
        <div className="row">
          <label className="field">
            <span className="field__label">Seconds per question</span>
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
            <span className="field__label">Show right or wrong</span>
            <select className="input" value={feedback} onChange={(e) => setFeedback(e.target.value)}>
              <option value="on_reveal">At the reveal (recommended)</option>
              <option value="immediate">Right after each answer</option>
            </select>
          </label>
        </div>
        <fieldset className="field">
          <legend className="field__label">Scoring</legend>
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
            <strong>Run questions automatically.</strong> Reveal when time is up and move on after a short pause. You can switch
            this on or off during the session.
          </span>
        </label>
        {error && <Notice tone="error">{messageFor(error)}</Notice>}
        <button className="btn btn--primary" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create session'}
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
      setError(new Error('That file is not valid JSON. Export the current bank to see the expected format.'));
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
      <h2 id="bank-title" className="h3">Question bank</h2>
      <p className="muted small">
        New sessions copy these questions. Sessions that already exist keep the questions they started with.
      </p>
      {!bank && <Spinner label="Loading questions…" />}
      {bank && (
        <ol className="bank">
          {bank.chapters.map((c) => (
            <li key={c.id}>
              <details>
                <summary>
                  <strong>{c.title}</strong> <span className="muted">({plural(c.questions.length, 'question', 'questions')})</span>
                </summary>
                <ol className="bank__qs">
                  {c.questions.map((q) => (
                    <li key={q.id}>
                      <span dir="auto">{q.text}</span>
                      <span className="muted small">
                        {' '}
                        Answer {q.correctOptionId}, {q.durationSeconds} s{q.sourceRef ? `, ${q.sourceRef}` : ''}
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
          {plural(bank.chapters.length, 'chapter', 'chapters')}, {plural(total, 'question', 'questions')}. A session needs exactly 4
          chapters with 5 questions each.
        </p>
      )}
      <div className="btn-row">
        <button
          className="btn btn--outline btn--s"
          type="button"
          disabled={!bank}
          onClick={() => downloadJson(`question-bank-${fileStamp()}.private.json`, bank)}
        >
          Download bank (JSON)
        </button>
        <button className="btn btn--outline btn--s" type="button" onClick={() => fileRef.current && fileRef.current.click()}>
          Import a new bank
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={pick} />
      </div>
      <p className="muted small">The download contains the answer key. Keep it out of shared folders and the public repository.</p>
      {result && (
        <Notice tone="success">
          Imported {plural(result.questions, 'question', 'questions')}.{' '}
          {result.retiredQuestions ? `${plural(result.retiredQuestions, 'old question was', 'old questions were')} retired and kept in history.` : ''}
        </Notice>
      )}
      {error && <Notice tone="error">{messageFor(error)}</Notice>}
      <ConfirmDialog
        open={!!preview}
        title="Replace the question bank?"
        confirmLabel="Import questions"
        tone="primary"
        busy={importing}
        onConfirm={doImport}
        onCancel={() => setPreview(null)}
      >
        {preview && (
          <p>
            <strong>{preview.name}</strong> has {plural(preview.chapters, 'chapter', 'chapters')} and{' '}
            {plural(preview.questions, 'question', 'questions')}. Questions not in this file are retired, not deleted. Sessions that
            already exist are not changed.
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
      setMsg({ tone: 'error', text: 'The two new passcodes do not match.' });
      return;
    }
    setBusy(true);
    try {
      await api.admin.changePasscode(token, current, next);
      setMsg({ tone: 'success', text: 'Passcode changed. Other devices have been signed out.' });
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
      <h2 id="pass-title" className="h3">Presenter passcode</h2>
      <details>
        <summary>Change the passcode</summary>
        <form className="stack" onSubmit={submit}>
          <label className="field">
            <span className="field__label">Current passcode</span>
            <input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          </label>
          <label className="field">
            <span className="field__label">New passcode (10 to 72 characters)</span>
            <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={10} maxLength={72} required />
          </label>
          <label className="field">
            <span className="field__label">New passcode again</span>
            <input className="input" type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required />
          </label>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <button className="btn btn--outline" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Change passcode'}
          </button>
        </form>
      </details>
    </section>
  );
}
