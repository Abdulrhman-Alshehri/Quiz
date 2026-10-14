import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { messageFor } from '../lib/errors';
import { parseTs, useNow, useServerClock } from '../lib/clock';
import { useFeed } from '../lib/useFeed';
import { joinUrl, screenUrl } from '../lib/router';
import { useAdminToken } from '../lib/useAdmin';
import { downloadCsv } from '../utils/csv';
import { itemAnalysisCsv, resultsCsv } from '../utils/exports';
import { fileStamp, percent, plural, points, seconds } from '../utils/format';
import { SCORING_MODES } from '../utils/scoring';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Shape } from '../components/Options';
import { Plate } from '../components/Plate';
import { QrCode } from '../components/QrCode';
import { Timer } from '../components/Timer';
import { ConnectionBadge, Notice, Spinner } from '../components/ui';
import AdminLogin from './AdminLogin';

export default function AdminSession({ sessionId }) {
  const { admin, signIn, signOut } = useAdminToken();
  if (!admin) return <AdminLogin onSignedIn={signIn} reason="Sign in to open this session's console." />;
  return <Console token={admin.token} sessionId={sessionId} onSignOut={signOut} />;
}

// The single next step for the presenter, so nobody has to think about the order.
function nextAction(data, now) {
  const s = data.session;
  if (s.status === 'ended') return null;
  const active = data.chapters.find((c) => c.id === s.activeChapterId);
  if (s.phase === 'question' && data.question) {
    const over = now > parseTs(data.question.deadline) + (s.settings.graceMs ?? 1000);
    return { kind: 'reveal', label: over ? 'Reveal the answer' : 'Close and reveal now', strong: over };
  }
  if (s.phase === 'chapter_intro' && active) {
    return { kind: 'next', label: `Show question ${active.revealedCount + 1} of ${active.questionCount}`, strong: true };
  }
  if (s.phase === 'reveal' && active) {
    if (active.revealedCount < active.questionCount) {
      return { kind: 'next', label: `Show question ${active.revealedCount + 1} of ${active.questionCount}`, strong: true };
    }
    return { kind: 'finish', label: `Show chapter ${active.order} results`, strong: true };
  }
  const upcoming = data.chapters.find((c) => c.status !== 'completed');
  if (upcoming) {
    return { kind: 'start', chapterId: upcoming.id, label: `Start chapter ${upcoming.order}: ${upcoming.title}`, strong: true };
  }
  return { kind: 'end', label: 'Show final results and end the session', strong: true };
}

function phaseText(data) {
  const s = data.session;
  const active = data.chapters.find((c) => c.id === s.activeChapterId);
  if (s.status === 'ended') return 'Session ended. Final results are on the big screen and on every phone.';
  if (s.paused) return 'Paused. Phones show a paused message and nobody can answer.';
  switch (s.phase) {
    case 'chapter_intro':
      return `Chapter ${active?.order} intro is on the big screen.`;
    case 'question':
      return `Question ${data.question?.index} of ${data.question?.total} is open.`;
    case 'reveal':
      return `Question ${data.question?.index} answer is revealed.`;
    case 'chapter_results':
      return `Chapter ${active?.order} results are on the big screen.`;
    default:
      return data.chapters.some((c) => c.status !== 'locked')
        ? 'Between chapters. The leaderboard is on the big screen.'
        : 'Waiting room. The big screen shows the join code.';
  }
}

function Console({ token, sessionId, onSignOut }) {
  useServerClock();
  const now = useNow(250);
  const feed = useFeed({
    key: `${sessionId}:${token}`,
    fetcher: () => api.admin.getSession(token, sessionId),
    sessionId,
    pollMs: 2500,
    fastPollMs: 1200,
  });
  const data = feed.data;
  const refresh = feed.refresh;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [autoPending, setAutoPending] = useState(null);
  const auto = useRef({ key: null, introKey: null, introAt: 0 });
  const serverAuto = !!data?.session?.settings?.autoAdvance;

  // The switch moves at once; it settles when the server confirms the change.
  useEffect(() => {
    if (autoPending !== null && serverAuto === autoPending) setAutoPending(null);
  }, [serverAuto, autoPending]);

  useEffect(() => {
    if (feed.error?.code === 'ADMIN_AUTH_REQUIRED') onSignOut();
  }, [feed.error, onSignOut]);

  const run = useCallback(
    async (fn, success) => {
      setBusy(true);
      setNotice(null);
      try {
        const res = await fn();
        if (success) setNotice({ tone: 'success', text: typeof success === 'function' ? success(res) : success });
        return res;
      } catch (e) {
        if (e.code === 'ADMIN_AUTH_REQUIRED') onSignOut();
        else setNotice({ tone: 'error', text: messageFor(e) });
        return null;
      } finally {
        setBusy(false);
        refresh();
      }
    },
    [onSignOut, refresh],
  );

  const doAction = useCallback(
    (action) => {
      if (!action) return null;
      switch (action.kind) {
        case 'start':
          return run(() => api.admin.startChapter(token, sessionId, action.chapterId));
        case 'next':
          return run(() => api.admin.nextQuestion(token, sessionId));
        case 'reveal':
          return run(() => api.admin.reveal(token, sessionId));
        case 'finish':
          return run(() => api.admin.finishChapter(token, sessionId));
        case 'end':
          return setConfirm({ kind: 'end' });
        default:
          return null;
      }
    },
    [run, token, sessionId],
  );

  // Automatic mode: reveal when time is up (or everyone answered), move on after a pause.
  useEffect(() => {
    if (!data || busy) return;
    const s = data.session;
    const settings = s.settings || {};
    if (!settings.autoAdvance || s.status === 'ended' || s.paused) return;
    const delay = (settings.autoNextDelaySec ?? 8) * 1000;
    const fire = (key, action) => {
      if (auto.current.key === key) return;
      auto.current.key = key;
      doAction(action);
    };
    const q = data.question;
    if (s.phase === 'question' && q) {
      const everyone = data.live && data.participantCount > 0 && data.live.answered + data.live.timedOut >= data.participantCount;
      const timeUp = now > parseTs(q.deadline) + (settings.graceMs ?? 1000) + 300;
      if (timeUp || (everyone && now > parseTs(q.startedAt) + 1500)) fire(`reveal:${q.id}:${q.startedAt}`, { kind: 'reveal' });
    } else if (s.phase === 'reveal' && q && q.revealedAt) {
      if (now > parseTs(q.revealedAt) + delay) {
        const action = nextAction(data, now);
        if (action && (action.kind === 'next' || action.kind === 'finish')) fire(`after:${q.id}:${q.revealedAt}`, action);
      }
    } else if (s.phase === 'chapter_intro') {
      const key = `${s.activeChapterId}:${s.version}`;
      if (auto.current.introKey !== key) {
        auto.current.introKey = key;
        auto.current.introAt = now;
      }
      if (now > auto.current.introAt + delay) fire(`intro:${key}`, { kind: 'next' });
    }
  }, [now, data, busy, doAction]);

  if (!data) {
    return (
      <main className="admin">
        {feed.error ? <Notice tone="error">{messageFor(feed.error)}</Notice> : <Spinner label="Loading the session…" />}
        <a className="link" href="#/admin">All sessions</a>
      </main>
    );
  }

  const s = data.session;
  const settings = s.settings || {};
  const action = nextAction(data, now);
  const ended = s.status === 'ended';
  const active = data.chapters.find((c) => c.id === s.activeChapterId);

  const exportResults = () =>
    run(async () => {
      const ex = await api.admin.exportResults(token, sessionId);
      downloadCsv(`nps-quiz-results-${s.code}-${fileStamp()}.csv`, resultsCsv(ex));
      return ex;
    }, (ex) => `Downloaded results for ${plural(ex.rows.length, 'participant', 'participants')}.`);

  const exportItems = () =>
    run(async () => {
      const items = await api.admin.exportItems(token, sessionId);
      downloadCsv(`nps-quiz-questions-${s.code}-${fileStamp()}.csv`, itemAnalysisCsv(items, s));
      return items;
    }, 'Downloaded the question analysis.');

  const saveSetting = (patch, text) => run(() => api.admin.updateSettings(token, sessionId, patch), text);

  return (
    <main className="admin console">
      <header className="admin__bar">
        <a className="admin__brand" href="#/admin">NPS Live Quiz</a>
        <span className="admin__where" dir="auto">{s.title}</span>
        <ConnectionBadge connection={feed.connection} />
        <a className="btn btn--outline btn--s" href={screenUrl(s.code)} target="_blank" rel="noopener">
          Open big screen
        </a>
      </header>

      <div className="console__grid">
        <section className="card console__control" aria-labelledby="control-title">
          <div className="console__status">
            <Plate code={s.code} size="s" />
            <div>
              <h1 id="control-title" className="h3">{phaseText(data)}</h1>
              <p className="muted small">
                {plural(data.participantCount, 'participant', 'participants')}, {data.activeCount} active now. Joining is{' '}
                {s.registrationOpen ? 'open' : 'closed'}.
              </p>
            </div>
          </div>

          {data.question && s.phase === 'question' && (
            <div className="console__timer">
              <Timer question={data.question} now={now} />
              <p className="console__answered">
                <strong>{data.live?.answered ?? 0}</strong> of {data.participantCount} answered
              </p>
            </div>
          )}

          {action && (
            <button
              className={`btn btn--xl btn--block ${action.strong ? 'btn--primary' : 'btn--outline'}`}
              type="button"
              disabled={busy}
              onClick={() => doAction(action)}
            >
              {action.label}
            </button>
          )}

          <div className="btn-row">
            {s.phase === 'question' && !s.paused && (
              <button className="btn btn--outline btn--s" type="button" disabled={busy} onClick={() => run(() => api.admin.pause(token, sessionId))}>
                Pause timer
              </button>
            )}
            {s.phase === 'question' && s.paused && (
              <button className="btn btn--primary btn--s" type="button" disabled={busy} onClick={() => run(() => api.admin.resume(token, sessionId))}>
                Resume timer
              </button>
            )}
            {!ended && (
              <button
                className="btn btn--outline btn--s"
                type="button"
                disabled={busy}
                onClick={() =>
                  run(() => api.admin.setRegistration(token, sessionId, !s.registrationOpen), s.registrationOpen ? 'Joining is now closed.' : 'Joining is open again.')
                }
              >
                {s.registrationOpen ? 'Close joining' : 'Reopen joining'}
              </button>
            )}
            {active && active.status === 'open' && s.phase !== 'question' && active.revealedCount < active.questionCount && (
              <button className="btn btn--quiet btn--s" type="button" disabled={busy} onClick={() => setConfirm({ kind: 'skip', chapter: active })}>
                Skip the rest of this chapter
              </button>
            )}
          </div>

          {!ended && (
            <label className="choice choice--switch">
              <input
                type="checkbox"
                checked={autoPending ?? !!settings.autoAdvance}
                onChange={async (e) => {
                  const on = e.target.checked;
                  setAutoPending(on);
                  const res = await saveSetting({ autoAdvance: on }, on ? 'Automatic mode is on.' : 'Automatic mode is off.');
                  if (res === null) setAutoPending(null);
                }}
              />
              <span>
                <strong>Automatic mode.</strong> Reveals when time is up or everyone has answered, then moves on after{' '}
                {settings.autoNextDelaySec ?? 8} seconds. Keep this console open.
              </span>
            </label>
          )}
          {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        </section>

        <section className="card console__join" aria-labelledby="join-title">
          <h2 id="join-title" className="h3">Join link</h2>
          <QrCode value={joinUrl(s.code)} size={176} label="QR code for this session" />
          <CopyField label="This session" value={joinUrl(s.code)} />
          <CopyField label="Permanent link for slides (opens the newest open session)" value={joinUrl()} />
        </section>

        {data.question && (
          <LiveQuestion data={data} />
        )}

        <section className="card console__chapters" aria-labelledby="chapters-title">
          <h2 id="chapters-title" className="h3">Chapters</h2>
          <ol className="console-chapters">
            {data.chapters.map((c) => {
              const canStart = !ended && c.status !== 'completed' && s.phase !== 'question' && c.id !== s.activeChapterId;
              return (
                <li key={c.id} className={`console-chapters__item is-${c.status}${c.id === s.activeChapterId ? ' is-active' : ''}`}>
                  <span className="console-chapters__num">{c.order}</span>
                  <span className="console-chapters__info">
                    <strong>{c.title}</strong>
                    <span className="muted small">
                      {c.status === 'locked' ? 'Not started' : c.status === 'open' ? 'In progress' : 'Completed'}. {c.revealedCount} of {c.questionCount} played,{' '}
                      {plural(c.completedBy, 'person', 'people')} finished.
                    </span>
                  </span>
                  <span className="console-chapters__actions">
                    {canStart && (
                      <button className="btn btn--outline btn--s" type="button" disabled={busy} onClick={() => run(() => api.admin.startChapter(token, sessionId, c.id))}>
                        {c.status === 'open' ? 'Continue' : 'Start'}
                      </button>
                    )}
                    {!ended && c.status !== 'locked' && (
                      <button className="btn btn--quiet btn--s" type="button" disabled={busy} onClick={() => setConfirm({ kind: 'resetChapter', chapter: c })}>
                        Reset
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="card console__people" aria-labelledby="people-title">
          <div className="card__head">
            <h2 id="people-title" className="h3">Leaderboard</h2>
            <div className="btn-row">
              <button className="btn btn--outline btn--s" type="button" disabled={busy} onClick={exportResults}>
                Download results (CSV)
              </button>
              <button className="btn btn--outline btn--s" type="button" disabled={busy} onClick={exportItems}>
                Download question analysis (CSV)
              </button>
            </div>
          </div>
          <p className="muted small">
            Only revealed questions count, so scores update at each reveal. The big screen shows the top{' '}
            {settings.screenLeaderboardSize ?? 10}; everyone sees their own rank on their phone.
          </p>
          <PeopleTable rows={data.leaderboard} onRemove={(p) => setConfirm({ kind: 'remove', participant: p })} ended={ended} busy={busy} />
        </section>

        <SettingsCard settings={settings} ended={ended} busy={busy} onSave={saveSetting} />

        {!ended && (
          <section className="card card--danger" aria-labelledby="danger-title">
            <h2 id="danger-title" className="h3">End or reset</h2>
            <p className="muted small">
              Resets void answers rather than erase them, so they stay available for audit. Ending a session stops all answers
              and keeps the results for export.
            </p>
            <div className="btn-row">
              <button className="btn btn--outline btn--s" type="button" disabled={busy} onClick={() => setConfirm({ kind: 'resetSession' })}>
                Reset the whole session
              </button>
              <button className="btn btn--danger btn--s" type="button" disabled={busy} onClick={() => setConfirm({ kind: 'end' })}>
                End session
              </button>
            </div>
          </section>
        )}
      </div>

      <ConfirmDialog
        open={confirm?.kind === 'resetChapter'}
        title={`Reset chapter ${confirm?.chapter?.order}?`}
        confirmLabel="Reset chapter"
        requireText="RESET"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const c = confirm.chapter;
          await run(() => api.admin.resetChapter(token, sessionId, c.id, 'RESET'), (r) => `Chapter ${c.order} reset. ${plural(r.voidedAnswers, 'answer was', 'answers were')} voided.`);
          setConfirm(null);
        }}
      >
        <p>
          Everyone's answers for <strong>{confirm?.chapter?.title}</strong> are voided and their chapter points go back to zero. The
          chapter can then be played again. Voided answers are kept for audit.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm?.kind === 'resetSession'}
        title="Reset the whole session?"
        confirmLabel="Reset session"
        requireText="RESET"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          await run(() => api.admin.resetSession(token, sessionId, 'RESET'), (r) => `Session reset. ${plural(r.voidedAnswers, 'answer was', 'answers were')} voided.`);
          setConfirm(null);
        }}
      >
        <p>All answers in this session are voided, every score goes back to zero and all chapters lock again. Participants stay joined.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm?.kind === 'end'}
        title="End this session?"
        confirmLabel="End session"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          await run(() => api.admin.endSession(token, sessionId), 'Session ended. Final results are showing everywhere.');
          setConfirm(null);
        }}
      >
        <p>Nobody can join or answer after this, and phones show final positions. Results stay available for download.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm?.kind === 'skip'}
        title="Skip the rest of this chapter?"
        confirmLabel="Skip and show results"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          await run(() => api.admin.finishChapter(token, sessionId, true), 'Chapter closed early.');
          setConfirm(null);
        }}
      >
        <p>The unplayed questions in this chapter are skipped and nobody can score on them. Chapter results show now.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm?.kind === 'remove'}
        title={`Remove ${confirm?.participant?.displayName}?`}
        confirmLabel="Remove"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          await run(() => api.admin.removeParticipant(token, confirm.participant.participantId), 'Participant removed.');
          setConfirm(null);
        }}
      >
        <p>
          Use this for a duplicate or inappropriate name. Their phone is signed out of the quiz and they disappear from the
          leaderboard. They can join again with another name.
        </p>
      </ConfirmDialog>
    </main>
  );
}

function CopyField({ label, value }) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      inputRef.current?.select();
      document.execCommand && document.execCommand('copy');
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <label className="field copy">
      <span className="field__label">{label}</span>
      <span className="copy__row">
        <input ref={inputRef} className="input input--mono" value={value} readOnly onFocus={(e) => e.target.select()} />
        <button className="btn btn--outline btn--s" type="button" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </span>
    </label>
  );
}

function LiveQuestion({ data }) {
  const q = data.question;
  const live = data.live || { answered: 0, timedOut: 0, correct: 0, incorrect: 0, notAnswered: data.participantCount, distribution: {} };
  const answered = live.answered || 0;
  return (
    <section className="card console__question" aria-labelledby="live-title">
      <h2 id="live-title" className="h3">
        Question {q.index} of {q.total}
      </h2>
      <p className="console__qtext" dir="auto">{q.text}</p>
      <ul className="dist">
        {q.options.map((o) => {
          const n = live.distribution?.[o.id] || 0;
          const pct = answered ? Math.round((100 * n) / answered) : 0;
          return (
            <li key={o.id} className={`dist__row dist__row--${o.id.toLowerCase()}${o.id === q.correctOptionId ? ' is-key' : ''}`}>
              <span className="dist__label">
                <Shape id={o.id} /> <strong>{o.id}</strong> <span dir="auto">{o.text}</span>
                {o.id === q.correctOptionId && <span className="dist__key">correct</span>}
              </span>
              <span className="dist__bar" aria-hidden="true">
                <span style={{ width: `${pct}%` }} />
              </span>
              <span className="dist__n">{n}</span>
            </li>
          );
        })}
      </ul>
      <dl className="mini-stats">
        <div><dt>Answered</dt><dd>{answered}</dd></div>
        <div><dt>Correct</dt><dd>{live.correct || 0}</dd></div>
        <div><dt>Wrong</dt><dd>{live.incorrect || 0}</dd></div>
        <div><dt>Timed out</dt><dd>{live.timedOut || 0}</dd></div>
        <div><dt>Not answered yet</dt><dd>{q.revealedAt ? 0 : live.notAnswered ?? 0}</dd></div>
      </dl>
      <p className="muted small">This panel shows the answer key. Do not project the console; use the big screen view.</p>
    </section>
  );
}

function PeopleTable({ rows, onRemove, ended, busy }) {
  if (!rows || rows.length === 0) return <p className="empty">Nobody has joined yet. Show the QR code on the big screen.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Name</th>
            <th scope="col" className="num">Points</th>
            <th scope="col" className="num">Correct</th>
            <th scope="col" className="num">Accuracy</th>
            <th scope="col" className="num">Avg time</th>
            <th scope="col" className="num">Chapters</th>
            <th scope="col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.participantId}>
              <td>{r.rank}</td>
              <td>
                <span className={`presence${r.active ? ' is-on' : ''}`} title={r.active ? 'Active now' : 'Not seen in the last 25 seconds'} aria-label={r.active ? 'Active now' : 'Inactive'} />
                <span dir="auto">{r.displayName}</span>
              </td>
              <td className="num">{points(r.totalPoints)}</td>
              <td className="num">{r.correctCount}</td>
              <td className="num">{percent(r.accuracy)}</td>
              <td className="num">{seconds(r.avgResponseMs)}</td>
              <td className="num">{r.chaptersCompleted}</td>
              <td>
                {!ended && (
                  <button className="btn btn--quiet btn--xs" type="button" disabled={busy} onClick={() => onRemove(r)}>
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SettingsCard({ settings, ended, busy, onSave }) {
  const [secondsValue, setSecondsValue] = useState(settings.durationOverride ?? 20);
  useEffect(() => {
    setSecondsValue(settings.durationOverride ?? 20);
  }, [settings.durationOverride]);
  if (ended) return null;
  return (
    <section className="card" aria-labelledby="settings-title">
      <h2 id="settings-title" className="h3">Settings for this session</h2>
      <div className="stack">
        <form
          className="row row--end"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(secondsValue);
            onSave({ durationOverride: n === 20 ? null : n }, `Questions not yet played now run for ${n} seconds.`);
          }}
        >
          <label className="field">
            <span className="field__label">Seconds per question (questions not yet played)</span>
            <input className="input" type="number" min={10} max={60} value={secondsValue} onChange={(e) => setSecondsValue(e.target.value)} />
          </label>
          <button className="btn btn--outline btn--s" type="submit" disabled={busy}>
            Apply
          </button>
        </form>
        <label className="field">
          <span className="field__label">Show right or wrong</span>
          <select
            className="input"
            value={settings.feedbackMode || 'on_reveal'}
            disabled={busy}
            onChange={(e) => onSave({ feedbackMode: e.target.value }, 'Feedback setting saved.')}
          >
            <option value="on_reveal">At the reveal (recommended)</option>
            <option value="immediate">Right after each answer</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">Scoring (applies to answers from now on)</span>
          <select
            className="input"
            value={settings.scoringMode || 'linear'}
            disabled={busy}
            onChange={(e) => onSave({ scoringMode: e.target.value }, 'Scoring setting saved.')}
          >
            {Object.entries(SCORING_MODES).map(([value, m]) => (
              <option key={value} value={value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Names on the big-screen leaderboard</span>
          <select
            className="input"
            value={settings.screenLeaderboardSize ?? 10}
            disabled={busy}
            onChange={(e) => onSave({ screenLeaderboardSize: Number(e.target.value) }, 'Leaderboard size saved.')}
          >
            {[3, 5, 10, 15, 20].map((n) => (
              <option key={n} value={n}>
                Top {n}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}
