import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { messageFor } from '../lib/errors';
import { parseTs, useNow, useServerClock } from '../lib/clock';
import { useFeed } from '../lib/useFeed';
import { joinUrl, screenUrl } from '../lib/router';
import { useAdminToken } from '../lib/useAdmin';
import { downloadCsv } from '../utils/csv';
import { itemAnalysisCsv, resultsCsv } from '../utils/exports';
import { count, fileStamp, optionLetter, percent, points, seconds, typeLabel } from '../utils/format';
import { SCORING_MODES } from '../utils/scoring';
import { Logo } from '../components/Brand';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DurationChoice } from '../components/DurationChoice';
import { Shape } from '../components/Options';
import { Plate } from '../components/Plate';
import { QrCode } from '../components/QrCode';
import { Timer } from '../components/Timer';
import { ConnectionBadge, Notice, Spinner } from '../components/ui';
import AdminLogin from './AdminLogin';

// Typed before a reset. The database still receives its own fixed confirmation value.
const CONFIRM_WORD = 'تصفير';

export default function AdminSession({ sessionId }) {
  const { admin, signIn, signOut } = useAdminToken();
  if (!admin) return <AdminLogin onSignedIn={signIn} reason="سجل الدخول لفتح لوحة تحكم هذه الجلسة." />;
  return <Console token={admin.token} sessionId={sessionId} onSignOut={signOut} />;
}

// The single next step for the presenter, so nobody has to think about the order.
function nextAction(data, now) {
  const s = data.session;
  if (s.status === 'ended') return null;
  const active = data.chapters.find((c) => c.id === s.activeChapterId);
  if (s.phase === 'question' && data.question) {
    const over = now > parseTs(data.question.deadline) + (s.settings.graceMs ?? 1000);
    return { kind: 'reveal', label: over ? 'اكشف الإجابة' : 'أغلق السؤال واكشف الإجابة الآن', strong: over };
  }
  if (s.phase === 'chapter_intro' && active) {
    return { kind: 'next', label: `اعرض السؤال ${active.revealedCount + 1} من ${active.questionCount}`, strong: true };
  }
  if (s.phase === 'reveal' && active) {
    if (active.revealedCount < active.questionCount) {
      return { kind: 'next', label: `اعرض السؤال ${active.revealedCount + 1} من ${active.questionCount}`, strong: true };
    }
    return { kind: 'finish', label: `اعرض نتائج الفصل ${active.order}`, strong: true };
  }
  const upcoming = data.chapters.find((c) => c.status !== 'completed');
  if (upcoming) {
    return { kind: 'start', chapterId: upcoming.id, label: `ابدأ الفصل ${upcoming.order}: ${upcoming.title}`, strong: true };
  }
  return { kind: 'end', label: 'اعرض النتائج النهائية وأنه الجلسة', strong: true };
}

function phaseText(data) {
  const s = data.session;
  const active = data.chapters.find((c) => c.id === s.activeChapterId);
  if (s.status === 'ended') return 'انتهت الجلسة. النتائج النهائية معروضة على الشاشة الكبيرة وعلى كل الجوالات.';
  if (s.paused) return 'متوقفة مؤقتًا. تعرض الجوالات رسالة التوقف ولا يمكن لأحد الإجابة.';
  switch (s.phase) {
    case 'chapter_intro':
      return `مقدمة الفصل ${active?.order} معروضة على الشاشة الكبيرة.`;
    case 'question':
      return `السؤال ${data.question?.index} من ${data.question?.total} مفتوح.`;
    case 'reveal':
      return `تم كشف إجابة السؤال ${data.question?.index}.`;
    case 'chapter_results':
      return `نتائج الفصل ${active?.order} معروضة على الشاشة الكبيرة.`;
    default:
      return data.chapters.some((c) => c.status !== 'locked')
        ? 'بين الفصول. لوحة الصدارة معروضة على الشاشة الكبيرة.'
        : 'غرفة الانتظار. الشاشة الكبيرة تعرض رمز الانضمام.';
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
        {feed.error ? <Notice tone="error">{messageFor(feed.error)}</Notice> : <Spinner label="جارٍ تحميل الجلسة…" />}
        <a className="link" href="#/admin">كل الجلسات</a>
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
    }, (ex) => `تم تنزيل نتائج ${count(ex.rows.length, 'participant')}.`);

  const exportItems = () =>
    run(async () => {
      const items = await api.admin.exportItems(token, sessionId);
      downloadCsv(`nps-quiz-questions-${s.code}-${fileStamp()}.csv`, itemAnalysisCsv(items, s));
      return items;
    }, 'تم تنزيل تحليل الأسئلة.');

  const saveSetting = (patch, text) => run(() => api.admin.updateSettings(token, sessionId, patch), text);

  return (
    <main className="admin console">
      <header className="admin__bar on-blue">
        <Logo />
        <a className="admin__brand" href="#/admin">مسابقة NPS المباشرة</a>
        <span className="admin__where">
          <bdi>{s.title}</bdi>
        </span>
        <ConnectionBadge connection={feed.connection} />
        <a className="btn btn--outline btn--s" href={screenUrl(s.code)} target="_blank" rel="noopener">
          فتح الشاشة الكبيرة
        </a>
      </header>

      <div className="console__grid">
        <section className="card console__control" aria-labelledby="control-title">
          <div className="console__status">
            <Plate code={s.code} size="s" />
            <div>
              <h1 id="control-title" className="h3">{phaseText(data)}</h1>
              <p className="muted small">
                المشاركون: {data.participantCount}، النشطون الآن: {data.activeCount}. الانضمام {s.registrationOpen ? 'مفتوح' : 'مغلق'}.
              </p>
            </div>
          </div>

          {data.question && s.phase === 'question' && (
            <div className="console__timer">
              <Timer question={data.question} now={now} />
              <p className="console__answered">
                <strong>{data.live?.answered ?? 0}</strong> من {data.participantCount} أجابوا
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
                إيقاف مؤقت
              </button>
            )}
            {s.phase === 'question' && s.paused && (
              <button className="btn btn--primary btn--s" type="button" disabled={busy} onClick={() => run(() => api.admin.resume(token, sessionId))}>
                استئناف
              </button>
            )}
            {!ended && (
              <button
                className="btn btn--outline btn--s"
                type="button"
                disabled={busy}
                onClick={() =>
                  run(() => api.admin.setRegistration(token, sessionId, !s.registrationOpen), s.registrationOpen ? 'تم إغلاق الانضمام.' : 'تمت إعادة فتح الانضمام.')
                }
              >
                {s.registrationOpen ? 'إغلاق الانضمام' : 'إعادة فتح الانضمام'}
              </button>
            )}
            {active && active.status === 'open' && s.phase !== 'question' && active.revealedCount < active.questionCount && (
              <button className="btn btn--quiet btn--s" type="button" disabled={busy} onClick={() => setConfirm({ kind: 'skip', chapter: active })}>
                تخطي بقية هذا الفصل
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
                  const res = await saveSetting({ autoAdvance: on }, on ? 'تم تشغيل الوضع التلقائي.' : 'تم إيقاف الوضع التلقائي.');
                  if (res === null) setAutoPending(null);
                }}
              />
              <span>
                <strong>الوضع التلقائي.</strong> يكشف الإجابة عند انتهاء الوقت أو عند إجابة الجميع، ثم ينتقل بعد{' '}
                {count(settings.autoNextDelaySec ?? 8, 'second')}. أبق لوحة التحكم هذه مفتوحة.
              </span>
            </label>
          )}
          {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        </section>

        <section className="card console__join" aria-labelledby="join-title">
          <h2 id="join-title" className="h3">رابط الانضمام</h2>
          <QrCode value={joinUrl(s.code)} size={176} label="رمز QR لهذه الجلسة" />
          <CopyField label="رابط هذه الجلسة" value={joinUrl(s.code)} />
          <CopyField label="الرابط الدائم للشرائح (يفتح أحدث جلسة مفتوحة)" value={joinUrl()} />
        </section>

        {data.question && (
          <LiveQuestion data={data} />
        )}

        <section className="card console__chapters" aria-labelledby="chapters-title">
          <h2 id="chapters-title" className="h3">الفصول</h2>
          <ol className="console-chapters">
            {data.chapters.map((c) => {
              const canStart = !ended && c.status !== 'completed' && s.phase !== 'question' && c.id !== s.activeChapterId;
              return (
                <li key={c.id} className={`console-chapters__item is-${c.status}${c.id === s.activeChapterId ? ' is-active' : ''}`}>
                  <span className="console-chapters__num">{c.order}</span>
                  <span className="console-chapters__info">
                    <strong>{c.title}</strong>
                    <span className="muted small">
                      {c.status === 'locked' ? 'لم يبدأ' : c.status === 'open' ? 'قيد التقدم' : 'مكتمل'}. عُرض {c.revealedCount} من{' '}
                      {c.questionCount}، وأنهاه {c.completedBy}.
                    </span>
                  </span>
                  <span className="console-chapters__actions">
                    {canStart && (
                      <button className="btn btn--outline btn--s" type="button" disabled={busy} onClick={() => run(() => api.admin.startChapter(token, sessionId, c.id))}>
                        {c.status === 'open' ? 'متابعة' : 'ابدأ'}
                      </button>
                    )}
                    {!ended && c.status !== 'locked' && (
                      <button className="btn btn--quiet btn--s" type="button" disabled={busy} onClick={() => setConfirm({ kind: 'resetChapter', chapter: c })}>
                        إعادة تعيين
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
            <h2 id="people-title" className="h3">لوحة الصدارة</h2>
            <div className="btn-row">
              <button className="btn btn--outline btn--s" type="button" disabled={busy} onClick={exportResults}>
                تنزيل النتائج (CSV)
              </button>
              <button className="btn btn--outline btn--s" type="button" disabled={busy} onClick={exportItems}>
                تنزيل تحليل الأسئلة (CSV)
              </button>
            </div>
          </div>
          <p className="muted small">
            لا تُحتسب إلا الأسئلة المكشوفة، لذا تتحدث النتائج عند كل كشف. تعرض الشاشة الكبيرة أول{' '}
            {settings.screenLeaderboardSize ?? 10}، ويرى كل مشارك ترتيبه على جواله.
          </p>
          <PeopleTable rows={data.leaderboard} onRemove={(p) => setConfirm({ kind: 'remove', participant: p })} ended={ended} busy={busy} />
        </section>

        <SettingsCard settings={settings} ended={ended} busy={busy} onSave={saveSetting} />

        {!ended && (
          <section className="card card--danger" aria-labelledby="danger-title">
            <h2 id="danger-title" className="h3">إنهاء الجلسة أو إعادة تعيينها</h2>
            <p className="muted small">
              إعادة التعيين تلغي الإجابات ولا تمحوها، فتبقى متاحة للتدقيق. إنهاء الجلسة يوقف كل الإجابات ويحتفظ بالنتائج
              للتصدير.
            </p>
            <div className="btn-row">
              <button className="btn btn--outline btn--s" type="button" disabled={busy} onClick={() => setConfirm({ kind: 'resetSession' })}>
                إعادة تعيين الجلسة كاملة
              </button>
              <button className="btn btn--danger btn--s" type="button" disabled={busy} onClick={() => setConfirm({ kind: 'end' })}>
                إنهاء الجلسة
              </button>
            </div>
          </section>
        )}
      </div>

      <ConfirmDialog
        open={confirm?.kind === 'resetChapter'}
        title={`إعادة تعيين الفصل ${confirm?.chapter?.order}؟`}
        confirmLabel="إعادة تعيين الفصل"
        requireText={CONFIRM_WORD}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const c = confirm.chapter;
          await run(() => api.admin.resetChapter(token, sessionId, c.id, 'RESET'), (r) => `تمت إعادة تعيين الفصل ${c.order}. الإجابات الملغاة: ${r.voidedAnswers}.`);
          setConfirm(null);
        }}
      >
        <p>
          تُلغى إجابات الجميع في فصل <strong>{confirm?.chapter?.title}</strong> وتعود نقاط الفصل إلى الصفر، ثم يمكن لعبه من جديد.
          تبقى الإجابات الملغاة محفوظة للتدقيق.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm?.kind === 'resetSession'}
        title="إعادة تعيين الجلسة كاملة؟"
        confirmLabel="إعادة تعيين الجلسة"
        requireText={CONFIRM_WORD}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          await run(() => api.admin.resetSession(token, sessionId, 'RESET'), (r) => `تمت إعادة تعيين الجلسة. الإجابات الملغاة: ${r.voidedAnswers}.`);
          setConfirm(null);
        }}
      >
        <p>تُلغى كل الإجابات في هذه الجلسة، وتعود كل النتائج إلى الصفر، وتُقفل كل الفصول من جديد. يبقى المشاركون منضمين.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm?.kind === 'end'}
        title="إنهاء هذه الجلسة؟"
        confirmLabel="إنهاء الجلسة"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          await run(() => api.admin.endSession(token, sessionId), 'انتهت الجلسة، والنتائج النهائية معروضة في كل مكان.');
          setConfirm(null);
        }}
      >
        <p>لن يتمكن أحد من الانضمام أو الإجابة بعد ذلك، وتعرض الجوالات الترتيب النهائي. تبقى النتائج متاحة للتنزيل.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm?.kind === 'skip'}
        title="تخطي بقية هذا الفصل؟"
        confirmLabel="تخط واعرض النتائج"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          await run(() => api.admin.finishChapter(token, sessionId, true), 'تم إغلاق الفصل مبكرًا.');
          setConfirm(null);
        }}
      >
        <p>تُتخطى الأسئلة التي لم تُعرض في هذا الفصل ولا يمكن لأحد كسب نقاط عليها، وتظهر نتائج الفصل الآن.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm?.kind === 'remove'}
        title={`إزالة ${confirm?.participant?.displayName}؟`}
        confirmLabel="إزالة"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          await run(() => api.admin.removeParticipant(token, confirm.participant.participantId), 'تمت إزالة المشارك.');
          setConfirm(null);
        }}
      >
        <p>
          استخدم هذا للأسماء المكررة أو غير اللائقة. يخرج جوال المشارك من المسابقة ويختفي اسمه من لوحة الصدارة، ويمكنه الانضمام
          مجددًا باسم آخر.
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
        <input ref={inputRef} className="input input--mono" dir="ltr" value={value} readOnly onFocus={(e) => e.target.select()} />
        <button className="btn btn--outline btn--s" type="button" onClick={copy}>
          {copied ? 'تم النسخ' : 'نسخ'}
        </button>
      </span>
    </label>
  );
}

function LiveQuestion({ data }) {
  const q = data.question;
  const live = data.live || { answered: 0, timedOut: 0, correct: 0, incorrect: 0, notAnswered: data.participantCount, distribution: {} };
  const answered = live.answered || 0;
  const correctIds = q.correctOptionIds || (q.correctOptionId ? [q.correctOptionId] : []);
  return (
    <section className="card console__question" aria-labelledby="live-title">
      <h2 id="live-title" className="h3">
        السؤال {q.index} من {q.total} · {typeLabel(q.type)}
      </h2>
      <p className="console__qtext">{q.text}</p>
      {q.type === 'multiple' && (
        <p className="muted small">يكسب النقاط من يختار كل الإجابات الصحيحة ولا شيء غيرها. الأعداد لكل خيار، والمشارك قد يختار أكثر من خيار.</p>
      )}
      <ul className="dist">
        {q.options.map((o) => {
          const n = live.distribution?.[o.id] || 0;
          const pct = answered ? Math.round((100 * n) / answered) : 0;
          const key = correctIds.includes(o.id);
          return (
            <li key={o.id} className={`dist__row dist__row--${o.id.toLowerCase()}${key ? ' is-key' : ''}`} data-option={o.id}>
              <span className="dist__label">
                <Shape id={o.id} /> <strong>{optionLetter(o.id)}</strong> <span>{o.text}</span>
                {key && <span className="dist__key">صحيحة</span>}
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
        <div><dt>أجابوا</dt><dd>{answered}</dd></div>
        <div><dt>صحيحة</dt><dd>{live.correct || 0}</dd></div>
        <div><dt>خاطئة</dt><dd>{live.incorrect || 0}</dd></div>
        <div><dt>انتهى وقتهم</dt><dd>{live.timedOut || 0}</dd></div>
        <div><dt>لم يجيبوا بعد</dt><dd>{q.revealedAt ? 0 : live.notAnswered ?? 0}</dd></div>
      </dl>
      <p className="muted small">تعرض هذه اللوحة الإجابة الصحيحة. لا تعرض لوحة التحكم على جهاز العرض؛ استخدم الشاشة الكبيرة.</p>
    </section>
  );
}

function PeopleTable({ rows, onRemove, ended, busy }) {
  if (!rows || rows.length === 0) return <p className="empty">لم ينضم أحد بعد. اعرض رمز QR على الشاشة الكبيرة.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">الترتيب</th>
            <th scope="col">الاسم</th>
            <th scope="col" className="num">النقاط</th>
            <th scope="col" className="num">صحيحة</th>
            <th scope="col" className="num">الدقة</th>
            <th scope="col" className="num">متوسط الزمن</th>
            <th scope="col" className="num">الفصول</th>
            <th scope="col"><span className="sr-only">إجراءات</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.participantId}>
              <td>{r.rank}</td>
              <td>
                <span className={`presence${r.active ? ' is-on' : ''}`} title={r.active ? 'نشط الآن' : 'غير نشط خلال آخر 25 ثانية'} aria-label={r.active ? 'نشط الآن' : 'غير نشط'} />
                <bdi>{r.displayName}</bdi>
              </td>
              <td className="num">{points(r.totalPoints)}</td>
              <td className="num">{r.correctCount}</td>
              <td className="num">{percent(r.accuracy)}</td>
              <td className="num">{seconds(r.avgResponseMs)}</td>
              <td className="num">{r.chaptersCompleted}</td>
              <td>
                {!ended && (
                  <button className="btn btn--quiet btn--xs" type="button" disabled={busy} onClick={() => onRemove(r)}>
                    إزالة
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
  const override = settings.durationOverride ?? null;
  const [timing, setTiming] = useState(override ? 'fixed' : 'bank');
  const [secondsValue, setSecondsValue] = useState(override ?? 20);
  useEffect(() => {
    setTiming(override ? 'fixed' : 'bank');
    setSecondsValue(override ?? 20);
  }, [override]);
  if (ended) return null;
  return (
    <section className="card" aria-labelledby="settings-title">
      <h2 id="settings-title" className="h3">إعدادات هذه الجلسة</h2>
      <div className="stack">
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(secondsValue);
            onSave(
              { durationOverride: timing === 'bank' ? null : n },
              timing === 'bank'
                ? 'الأسئلة التي لم تُعرض بعد تأخذ مدتها من بنك الأسئلة.'
                : `مدة الأسئلة التي لم تُعرض بعد: ${count(n, 'second')}.`,
            );
          }}
        >
          <DurationChoice
            timing={timing}
            seconds={secondsValue}
            onTiming={setTiming}
            onSeconds={setSecondsValue}
            name="session-timing"
            disabled={busy}
          />
          <p className="muted small">ينطبق على الأسئلة التي لم تُعرض بعد في هذه الجلسة.</p>
          <button className="btn btn--outline btn--s" type="submit" disabled={busy}>
            تطبيق المدة
          </button>
        </form>
        <label className="field">
          <span className="field__label">إظهار الصواب والخطأ</span>
          <select
            className="input"
            value={settings.feedbackMode || 'on_reveal'}
            disabled={busy}
            onChange={(e) => onSave({ feedbackMode: e.target.value }, 'تم حفظ إعداد إظهار النتيجة.')}
          >
            <option value="on_reveal">عند كشف الإجابة (موصى به)</option>
            <option value="immediate">فور كل إجابة</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">طريقة احتساب النقاط (تنطبق على الإجابات من الآن)</span>
          <select
            className="input"
            value={settings.scoringMode || 'linear'}
            disabled={busy}
            onChange={(e) => onSave({ scoringMode: e.target.value }, 'تم حفظ طريقة الاحتساب.')}
          >
            {Object.entries(SCORING_MODES).map(([value, m]) => (
              <option key={value} value={value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">عدد الأسماء في لوحة الصدارة على الشاشة الكبيرة</span>
          <select
            className="input"
            value={settings.screenLeaderboardSize ?? 10}
            disabled={busy}
            onChange={(e) => onSave({ screenLeaderboardSize: Number(e.target.value) }, 'تم حفظ عدد الأسماء.')}
          >
            {[3, 5, 10, 15, 20].map((n) => (
              <option key={n} value={n}>
                أول {n}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}
