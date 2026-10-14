import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { messageFor } from '../lib/errors';
import { useNow, useServerClock } from '../lib/clock';
import { useFeed } from '../lib/useFeed';
import { navigate } from '../lib/router';
import { clearSeat, getSeat, lastSeatSessionId } from '../lib/storage';
import { BluePage, Logo } from '../components/Brand';
import { OptionButton } from '../components/Options';
import { Timer, timerState } from '../components/Timer';
import { ConnectionBadge, Notice, Spinner, VisuallyHidden } from '../components/ui';
import { count, optionLetter, percent, points, seconds } from '../utils/format';

export default function Play({ query }) {
  const sessionId = query.get('s') || lastSeatSessionId();
  const seat = getSeat(sessionId);
  if (!seat) return <NoSeat />;
  return <Game key={seat.token} seat={seat} />;
}

function NoSeat() {
  useEffect(() => {
    const t = setTimeout(() => navigate('/join', { replace: true }), 1500);
    return () => clearTimeout(t);
  }, []);
  return (
    <BluePage>
      <h1 className="h1">انضم أولًا</h1>
      <p className="lead">هذا الجوال لم ينضم إلى مسابقة بعد. جارٍ فتح صفحة الانضمام…</p>
      <a className="btn btn--primary btn--xl" href="#/join">انضم إلى المسابقة</a>
    </BluePage>
  );
}

function Game({ seat }) {
  useServerClock();
  const now = useNow(100);
  const feed = useFeed({
    key: seat.token,
    fetcher: () => api.participantState(seat.token),
    sessionId: seat.sessionId,
    pollMs: 4000,
    fastPollMs: 1500,
  });
  const state = feed.data;
  const refresh = feed.refresh;
  const [pending, setPending] = useState({});
  const sendState = useRef({});
  const lastStanding = useRef(null);
  if (state?.standing) lastStanding.current = state.standing;
  const standing = state?.standing || lastStanding.current;

  // One send per question launch. The key includes the start time so a question
  // replayed after a chapter reset can be answered again.
  const submit = useCallback(
    async (launchKey, questionId, optionId) => {
      const cur = sendState.current[launchKey];
      if (cur === 'sending' || cur === 'sent') return;
      sendState.current[launchKey] = 'sending';
      setPending((p) => ({ ...p, [launchKey]: { optionId, status: 'sending' } }));
      try {
        const res = await api.submitAnswer(seat.token, questionId, optionId);
        sendState.current[launchKey] = 'sent';
        setPending((p) => ({
          ...p,
          [launchKey]: { optionId: res.selectedOptionId || optionId, status: 'sent', result: res },
        }));
      } catch (e) {
        sendState.current[launchKey] = 'failed';
        setPending((p) => ({ ...p, [launchKey]: { optionId, status: 'failed', error: e } }));
      }
      refresh();
    },
    [seat.token, refresh],
  );

  const fatal = feed.error && ['PARTICIPANT_NOT_FOUND', 'PARTICIPANT_REMOVED'].includes(feed.error.code);
  if (fatal) {
    return (
      <BluePage>
        <h1 className="h1">{feed.error.code === 'PARTICIPANT_REMOVED' ? 'أُزيل اسمك من هذه المسابقة' : 'لم يُعثر على مكانك'}</h1>
        <p className="lead">{messageFor(feed.error)}</p>
        <button
          className="btn btn--primary btn--block btn--xl"
          type="button"
          onClick={() => {
            clearSeat(seat.sessionId);
            navigate(`/join?code=${encodeURIComponent(seat.code)}`);
          }}
        >
          انضم مرة أخرى
        </button>
      </BluePage>
    );
  }

  // Chapter intros and the final result use the deck's blue section-slide look;
  // questions, reveals and results use the light content-slide look.
  const phase = state?.session?.phase;
  const active = state?.chapters.find((c) => c.id === state.session.activeChapterId);
  const blue = (phase === 'chapter_intro' && !!active) || phase === 'ended';
  let body;
  if (!state) {
    body = <Spinner label="جارٍ الاتصال بالمسابقة…" />;
  } else {
    if (phase === 'ended') {
      body = <FinalView state={state} standing={standing} />;
    } else if (phase === 'question' && state.question) {
      const launchKey = `${state.question.id}@${state.question.startedAt}`;
      body = (
        <QuestionView
          q={state.question}
          chapter={active}
          now={now}
          pending={pending[launchKey]}
          onAnswer={(optionId) => submit(launchKey, state.question.id, optionId)}
          feedbackMode={state.session.feedbackMode}
        />
      );
    } else if (phase === 'reveal' && state.question) {
      body = <RevealView q={state.question} chapter={active} standing={standing} count={state.participantCount} />;
    } else if (phase === 'chapter_intro' && active) {
      body = <ChapterIntro chapter={active} />;
    } else if (phase === 'chapter_results' && active) {
      body = <ChapterResults chapter={active} state={state} standing={standing} />;
    } else {
      body = <WaitingRoom state={state} />;
    }
  }

  return (
    <div className={`play${blue ? ' play--blue surface-blue' : ''}`}>
      <header className="hud on-blue">
        <div className="hud__top">
          <Logo />
          <ConnectionBadge connection={feed.connection} />
        </div>
        <div className="hud__me">
          <span className="hud__name">
            <bdi>{seat.displayName}</bdi>
          </span>
          <span className="hud__score">
            <strong>{points(standing?.totalPoints ?? 0)}</strong> نقطة
          </span>
          {standing?.rank && state && standing.answeredCount + standing.timedOutCount > 0 && (
            <span className="hud__rank">
              المركز {standing.rank} من {state.participantCount}
            </span>
          )}
        </div>
      </header>
      {feed.connection === 'offline' && (
        <Notice tone="warn">انقطع الاتصال. أبق هذه الصفحة مفتوحة؛ ستعيد الاتصال تلقائيًا، وإجاباتك المرسلة محفوظة.</Notice>
      )}
      <main className={`play__main${blue ? ' on-blue' : ''}`}>{body}</main>
    </div>
  );
}

// 1-4 on any keyboard (also Arabic-Indic digits), and the Latin or Arabic option letters.
const KEYMAP = {
  1: 'A', 2: 'B', 3: 'C', 4: 'D',
  '١': 'A', '٢': 'B', '٣': 'C', '٤': 'D',
  a: 'A', b: 'B', c: 'C', d: 'D',
  'أ': 'A', 'ا': 'A', 'ب': 'B', 'ج': 'C', 'د': 'D',
};

function QuestionView({ q, chapter, now, pending, onAnswer, feedbackMode }) {
  const t = timerState(q, now);
  const fromServer = q.myAnswer && q.myAnswer.selectedOptionId ? q.myAnswer : null;
  const fromLocal = pending && pending.status !== 'failed' ? { selectedOptionId: pending.optionId } : null;
  const mine = fromServer || fromLocal;
  const sending = pending?.status === 'sending';
  const immediate = feedbackMode === 'immediate';
  const result = immediate ? (fromServer && fromServer.isCorrect !== null && fromServer.isCorrect !== undefined ? fromServer : pending?.result) : null;
  const canAnswer = !mine && t.phase === 'running';
  const secs = Math.ceil(t.remaining / 1000);
  const answerRef = useRef(onAnswer);
  answerRef.current = onAnswer;

  // Keyboard: 1-4 answers on laptops and tablets with keyboards.
  useEffect(() => {
    if (!canAnswer) return undefined;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const id = KEYMAP[String(e.key).toLowerCase()];
      if (id) answerRef.current(id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canAnswer]);

  const optionState = (id) => {
    if (mine) {
      if (id !== mine.selectedOptionId) return 'other';
      if (result && result.isCorrect === true) return 'correct-mine';
      if (result && result.isCorrect === false) return 'wrong';
      return 'selected';
    }
    return canAnswer ? 'idle' : 'dim';
  };

  let status;
  if (t.phase === 'paused') status = 'أوقف المقدم المسابقة مؤقتًا. يكمل المؤقت عند الاستئناف.';
  else if (t.phase === 'leadin') status = `اقرأ السؤال. تفتح الإجابات خلال ${Math.ceil(t.leadIn / 1000)} ث.`;
  else if (sending) status = 'جارٍ إرسال إجابتك…';
  else if (mine && result && result.isCorrect) status = `إجابة صحيحة. +${points(result.points)} نقطة.`;
  else if (mine && result && result.isCorrect === false) status = 'ليست هذه. تظهر الإجابة الصحيحة عند الكشف.';
  else if (mine) status = `تم تسجيل إجابتك: ${optionLetter(mine.selectedOptionId)}. بانتظار كشف الإجابة.`;
  else if (pending?.status === 'failed') status = `${messageFor(pending.error)}${t.phase === 'running' ? ' اختر إجابة للمحاولة مرة أخرى.' : ''}`;
  else if (t.phase === 'done') status = 'انتهى الوقت. بانتظار كشف الإجابة.';
  else status = 'اختر إجابة واحدة. لديك محاولة واحدة.';

  return (
    <section className="q" aria-labelledby="q-text">
      <div className="q__meta">
        <span>{chapter ? `الفصل ${chapter.order}: ${chapter.title}` : 'سؤال'}</span>
        <span className="q__count">
          السؤال {q.index} من {q.total}
        </span>
      </div>
      <Timer question={q} now={now} />
      <h1 id="q-text" className="q__text">
        {q.text}
      </h1>
      {t.phase !== 'leadin' && (
        <div className="opts" role="group" aria-label="الإجابات">
          {q.options.map((o, i) => (
            <OptionButton
              key={o.id}
              option={o}
              state={optionState(o.id)}
              disabled={!canAnswer}
              onSelect={onAnswer}
              hotkey={canAnswer ? String(i + 1) : null}
            />
          ))}
        </div>
      )}
      <p className={`q__status${pending?.status === 'failed' ? ' is-error' : ''}`} role="status" aria-live="polite">
        {status}
      </p>
      <VisuallyHidden live="assertive">
        {t.phase === 'running' && (secs === 10 || secs === 5) ? `بقيت ${count(secs, 'second')}` : ''}
      </VisuallyHidden>
    </section>
  );
}

function RevealView({ q, chapter, standing, count: total }) {
  const my = q.myAnswer;
  const outcome = !my ? 'none' : my.status === 'timed_out' ? 'timeout' : my.isCorrect ? 'correct' : 'wrong';
  const correct = q.options.find((o) => o.id === q.correctOptionId);
  const chosen = my && my.selectedOptionId ? q.options.find((o) => o.id === my.selectedOptionId) : null;
  const copy = {
    correct: { title: 'إجابة صحيحة', icon: '✓' },
    wrong: { title: 'ليست هذه المرة', icon: '✕' },
    timeout: { title: 'انتهى الوقت', icon: '⏱' },
    none: { title: 'انضممت بعد هذا السؤال', icon: '·' },
  }[outcome];
  return (
    <section className={`reveal reveal--${outcome}`} aria-labelledby="reveal-title">
      <p className="q__meta">
        <span>{chapter ? `الفصل ${chapter.order}` : ''}</span>
        <span className="q__count">
          السؤال {q.index} من {q.total}
        </span>
      </p>
      <div className="reveal__badge">
        <span className="reveal__icon" aria-hidden="true">{copy.icon}</span>
        <h1 id="reveal-title" className="reveal__title">{copy.title}</h1>
        {outcome === 'correct' && (
          <p className="reveal__points">
            <bdi dir="ltr">+{points(my.points)}</bdi> نقطة
          </p>
        )}
        {(outcome === 'wrong' || outcome === 'timeout') && <p className="reveal__points">0 نقطة</p>}
      </div>
      <div className="reveal__answers">
        <p className="reveal__label">الإجابة الصحيحة</p>
        {correct && <OptionButton option={correct} state={outcome === 'correct' ? 'correct-mine' : 'correct'} disabled />}
        {outcome === 'wrong' && chosen && (
          <>
            <p className="reveal__label">إجابتك</p>
            <OptionButton option={chosen} state="wrong" disabled />
          </>
        )}
      </div>
      {q.explanation && (
        <p className="reveal__why">
          <span className="reveal__why-label">التوضيح</span>
          {q.explanation}
        </p>
      )}
      {standing && (
        <p className="reveal__standing">
          مجموعك <strong>{points(standing.totalPoints)}</strong> نقطة، وترتيبك <strong>{standing.rank}</strong> من {total}.
        </p>
      )}
      <p className="muted">يظهر السؤال التالي هنا تلقائيًا.</p>
    </section>
  );
}

function ChapterIntro({ chapter }) {
  return (
    <section className="intro">
      <p className="intro__num">الفصل {chapter.order}</p>
      <h1 className="intro__title">{chapter.title}</h1>
      {chapter.description && <p className="lead">{chapter.description}</p>}
      <p className="intro__rules">
        {count(chapter.questionCount, 'question')}. يظهر السؤال أولًا، ثم تفتح الإجابات الأربع مع بدء المؤقت. الإجابة الصحيحة
        الأسرع تكسب نقاطًا أكثر.
      </p>
      <p className="muted">انظر إلى الشاشة الكبيرة. سيظهر السؤال الأول هنا أيضًا.</p>
    </section>
  );
}

function ChapterStats({ chapter, standing, count: total }) {
  const s = chapter.stats || {};
  const questions = chapter.questionCount || 0;
  const correct = s.correct || 0;
  const seen = s.seen || 0;
  return (
    <dl className="stats">
      <div>
        <dt>الإجابات الصحيحة</dt>
        <dd>
          {correct} من {questions}
        </dd>
      </div>
      <div>
        <dt>الدقة</dt>
        <dd>{questions ? percent(Math.round((100 * correct) / questions)) : '–'}</dd>
      </div>
      <div>
        <dt>نقاط الفصل</dt>
        <dd>{points(s.points)}</dd>
      </div>
      <div>
        <dt>متوسط زمن الإجابة</dt>
        <dd>{seconds(s.avgResponseMs)}</dd>
      </div>
      <div>
        <dt>الحالة</dt>
        <dd>{seen >= questions && questions > 0 ? 'مكتمل' : `أجبت عن ${seen} من ${questions}`}</dd>
      </div>
      {standing?.rank && (
        <div>
          <dt>الترتيب العام</dt>
          <dd>
            {standing.rank} من {total}
          </dd>
        </div>
      )}
    </dl>
  );
}

function ChapterResults({ chapter, state, standing }) {
  return (
    <section className="results">
      <p className="intro__num">اكتمل الفصل {chapter.order}</p>
      <h1 className="h1">{chapter.title}</h1>
      <ChapterStats chapter={chapter} standing={standing} count={state.participantCount} />
      <ChapterList chapters={state.chapters} activeId={null} />
    </section>
  );
}

function WaitingRoom({ state }) {
  const played = state.chapters.some((c) => c.status !== 'locked');
  return (
    <section className="wait">
      <h1 className="h1">
        {played ? (
          'الفصل التالي قريبًا'
        ) : (
          <>
            أنت معنا، <bdi>{state.participant.displayName}</bdi>
          </>
        )}
      </h1>
      <p className="lead">تابع الشاشة الكبيرة. المقدم يبدأ كل فصل، وهذه الصفحة تتابع معه تلقائيًا.</p>
      <p className="muted">عدد المنضمين: {state.participantCount}</p>
      <ChapterList chapters={state.chapters} activeId={state.session.activeChapterId} />
    </section>
  );
}

function ChapterList({ chapters, activeId }) {
  return (
    <section className="chapters" aria-labelledby="chapters-title">
      <h2 id="chapters-title" className="h3">الفصول</h2>
      <ol className="chapters__list">
        {chapters.map((c) => {
          const label = c.status === 'completed' ? 'مكتمل' : c.status === 'open' ? (c.id === activeId ? 'مباشر الآن' : 'بدأ') : 'مقفل';
          return (
            <li key={c.id} className={`chapters__item is-${c.status}`}>
              <span className="chapters__num" aria-hidden="true">{c.order}</span>
              <span className="chapters__title">
                {c.title}
                <span className="chapters__desc">{c.description}</span>
              </span>
              <span className="chapters__status">
                {label}
                {c.status === 'completed' && c.stats ? (
                  <span className="chapters__pts">
                    {points(c.stats.points)} نقطة، {c.stats.correct || 0}/{c.questionCount}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function FinalView({ state, standing }) {
  const totalQuestions = state.chapters.reduce((n, c) => n + (c.questionCount || 0), 0);
  return (
    <section className="final">
      <p className="intro__num">اكتملت المسابقة</p>
      <h1 className="h1">
        شكرًا، <bdi>{state.participant.displayName}</bdi>
      </h1>
      {standing ? (
        <>
          <p className="final__label">ترتيبك النهائي</p>
          <p className="final__rank">
            {standing.rank}
            <span> من {state.participantCount}</span>
          </p>
          <dl className="stats">
            <div>
              <dt>مجموع النقاط</dt>
              <dd>{points(standing.totalPoints)}</dd>
            </div>
            <div>
              <dt>الإجابات الصحيحة</dt>
              <dd>
                {standing.correctCount} من {totalQuestions}
              </dd>
            </div>
            <div>
              <dt>الدقة</dt>
              <dd>{percent(standing.accuracy)}</dd>
            </div>
            <div>
              <dt>متوسط زمن الإجابة</dt>
              <dd>{seconds(standing.avgResponseMs)}</dd>
            </div>
          </dl>
        </>
      ) : (
        <Spinner label="جارٍ تحميل نتائجك…" />
      )}
      <ChapterList chapters={state.chapters} activeId={null} />
    </section>
  );
}
