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
import { count, optionLetters, percent, points, seconds, typeLabel } from '../utils/format';

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
    async (launchKey, questionId, optionIds, auto = false) => {
      const cur = sendState.current[launchKey];
      if (cur === 'sending' || cur === 'sent') return;
      sendState.current[launchKey] = 'sending';
      setPending((p) => ({ ...p, [launchKey]: { optionIds, status: 'sending', auto } }));
      try {
        const res = await api.submitAnswer(seat.token, questionId, optionIds);
        sendState.current[launchKey] = 'sent';
        setPending((p) => ({
          ...p,
          [launchKey]: { optionIds: res.selectedOptionIds || optionIds, status: 'sent', result: res, auto },
        }));
      } catch (e) {
        sendState.current[launchKey] = 'failed';
        setPending((p) => ({ ...p, [launchKey]: { optionIds, status: 'failed', error: e, auto } }));
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
          key={launchKey}
          q={state.question}
          chapter={active}
          now={now}
          pending={pending[launchKey]}
          onAnswer={(optionIds, auto) => submit(launchKey, state.question.id, optionIds, auto)}
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

// 1-6 on any keyboard (also Arabic-Indic digits), and the Latin or Arabic option letters.
const KEYMAP = {
  1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'E', 6: 'F',
  '١': 'A', '٢': 'B', '٣': 'C', '٤': 'D', '٥': 'E', '٦': 'F',
  a: 'A', b: 'B', c: 'C', d: 'D', e: 'E', f: 'F',
  'أ': 'A', 'ا': 'A', 'ب': 'B', 'ج': 'C', 'د': 'D', 'ه': 'E', 'و': 'F',
};

function chosenIds(answer) {
  if (!answer) return null;
  if (answer.selectedOptionIds && answer.selectedOptionIds.length) return answer.selectedOptionIds;
  return answer.selectedOptionId ? [answer.selectedOptionId] : null;
}

// How a recorded answer reads back: the option text for true/false, letters otherwise.
function describeChoice(q, ids) {
  if (q.type === 'true_false') return ids.map((id) => q.options.find((o) => o.id === id)?.text || id).join('، ');
  return optionLetters(ids);
}

function QuestionView({ q, chapter, now, pending, onAnswer, feedbackMode }) {
  const multi = q.type === 'multiple';
  const t = timerState(q, now);
  const serverIds = chosenIds(q.myAnswer);
  const localIds = pending && pending.status !== 'failed' ? pending.optionIds : null;
  const mine = serverIds || localIds;
  const sending = pending?.status === 'sending';
  const immediate = feedbackMode === 'immediate';
  const fromServer = serverIds ? q.myAnswer : null;
  const result = immediate
    ? fromServer && fromServer.isCorrect !== null && fromServer.isCorrect !== undefined
      ? fromServer
      : pending?.result
    : null;
  const canAnswer = !mine && t.phase === 'running';
  const secs = Math.ceil(t.remaining / 1000);
  // Multiple choice: options ticked but not yet confirmed.
  const [picked, setPicked] = useState([]);
  const autoSent = useRef(false);
  const live = useRef({});
  live.current = { canAnswer, picked, onAnswer, multi };

  const choose = useCallback((id) => {
    const cur = live.current;
    if (!cur.canAnswer) return;
    if (cur.multi) setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].sort()));
    else cur.onAnswer([id]);
  }, []);
  const confirm = useCallback(() => {
    const cur = live.current;
    if (cur.canAnswer && cur.picked.length) cur.onAnswer(cur.picked);
  }, []);

  // Keyboard: 1-6 answer (or tick, for multiple choice); Enter confirms.
  useEffect(() => {
    if (!canAnswer) return undefined;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter' && live.current.multi) {
        e.preventDefault();
        confirm();
        return;
      }
      const id = KEYMAP[String(e.key).toLowerCase()];
      if (id && q.options.some((o) => o.id === id)) choose(id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canAnswer, choose, confirm, q.options]);

  // Time is up with options ticked but not confirmed: send them, so a complete
  // answer still counts (the database accepts it within the grace period).
  useEffect(() => {
    if (multi && !mine && t.phase === 'done' && picked.length && !autoSent.current) {
      autoSent.current = true;
      onAnswer(picked, true);
    }
  }, [multi, mine, t.phase, picked, onAnswer]);

  const optionState = (id) => {
    if (mine) {
      if (!mine.includes(id)) return 'other';
      if (!multi && result && result.isCorrect === true) return 'correct-mine';
      if (!multi && result && result.isCorrect === false) return 'wrong';
      return 'selected';
    }
    if (!canAnswer) return 'dim';
    return multi && picked.includes(id) ? 'checked' : 'idle';
  };

  let status;
  if (t.phase === 'paused') status = 'أوقف المقدم المسابقة مؤقتًا. يكمل المؤقت عند الاستئناف.';
  else if (t.phase === 'leadin') status = `اقرأ السؤال. تفتح الإجابات خلال ${Math.ceil(t.leadIn / 1000)} ث.`;
  else if (sending) status = 'جارٍ إرسال إجابتك…';
  else if (mine && result && result.isCorrect) status = `إجابة صحيحة. +${points(result.points)} نقطة.`;
  else if (mine && result && result.isCorrect === false) {
    status = multi
      ? 'ليست الإجابة الكاملة الصحيحة. تظهر الإجابات الصحيحة عند الكشف.'
      : 'ليست هذه. تظهر الإجابة الصحيحة عند الكشف.';
  } else if (mine) {
    status = `${pending?.auto ? 'انتهى الوقت فأُرسلت اختياراتك. ' : ''}تم تسجيل إجابتك: ${describeChoice(q, mine)}. بانتظار كشف الإجابة.`;
  } else if (pending?.status === 'failed') {
    status = `${messageFor(pending.error)}${t.phase === 'running' ? (multi ? ' اضغط «تأكيد الإجابة» للمحاولة مرة أخرى.' : ' اختر إجابة للمحاولة مرة أخرى.') : ''}`;
  } else if (t.phase === 'done') status = 'انتهى الوقت. بانتظار كشف الإجابة.';
  else if (multi) {
    status = picked.length
      ? `اخترت ${count(picked.length, 'option')}. اضغط «تأكيد الإجابة» عندما تنتهي.`
      : 'اختر كل الإجابات الصحيحة، ثم اضغط «تأكيد الإجابة». لديك محاولة واحدة.';
  } else if (q.type === 'true_false') status = 'صح أم خطأ؟ لديك محاولة واحدة.';
  else status = 'اختر إجابة واحدة. لديك محاولة واحدة.';

  return (
    <section className="q" aria-labelledby="q-text">
      <div className="q__meta">
        <span>{chapter ? `الفصل ${chapter.order}: ${chapter.title}` : 'سؤال'}</span>
        <span className="q__count">
          السؤال {q.index} من {q.total}
        </span>
      </div>
      {q.type && q.type !== 'single' && (
        <p className={`q__type q__type--${q.type}`}>
          {typeLabel(q.type)}
          {multi ? ': اختر كل الإجابات الصحيحة' : ''}
        </p>
      )}
      <Timer question={q} now={now} />
      <h1 id="q-text" className="q__text">
        {q.text}
      </h1>
      {t.phase !== 'leadin' && (
        <>
          <div
            className={`opts opts--n${q.options.length}${q.type === 'true_false' ? ' opts--tf' : ''}`}
            role="group"
            aria-label={multi ? 'الإجابات، يمكن اختيار أكثر من إجابة' : 'الإجابات'}
          >
            {q.options.map((o, i) => (
              <OptionButton
                key={o.id}
                option={o}
                state={optionState(o.id)}
                disabled={!canAnswer}
                onSelect={choose}
                hotkey={canAnswer ? String(i + 1) : null}
                multi={multi}
              />
            ))}
          </div>
          {multi && !mine && (
            <button
              className="btn btn--primary btn--block btn--xl q__confirm"
              type="button"
              disabled={!canAnswer || picked.length === 0 || sending}
              onClick={confirm}
            >
              تأكيد الإجابة{picked.length ? ` (${picked.length})` : ''}
            </button>
          )}
        </>
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
  const multi = q.type === 'multiple';
  const correctIds = q.correctOptionIds || (q.correctOptionId ? [q.correctOptionId] : []);
  const mine = chosenIds(my) || [];
  const copy = {
    correct: { title: 'إجابة صحيحة', icon: '✓' },
    wrong: { title: 'ليست هذه المرة', icon: '✕' },
    timeout: { title: 'انتهى الوقت', icon: '⏱' },
    none: { title: 'انضممت بعد هذا السؤال', icon: '·' },
  }[outcome];
  const correct = q.options.filter((o) => correctIds.includes(o.id));
  const chosen = q.options.filter((o) => mine.includes(o.id));
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
      {multi ? (
        <div className="reveal__answers">
          <p className="reveal__label">
            {outcome === 'correct'
              ? 'اخترت الإجابات الصحيحة كلها.'
              : outcome === 'wrong'
                ? 'النقاط لمن يختار الإجابات الصحيحة كلها ولا شيء غيرها. الصحيحة باللون الأخضر:'
                : 'الإجابات الصحيحة باللون الأخضر:'}
          </p>
          {q.options.map((o) => {
            const right = correctIds.includes(o.id);
            const picked = mine.includes(o.id);
            let state = 'dim';
            if (right && picked) state = 'correct-mine';
            else if (right) state = outcome === 'wrong' ? 'missed' : 'correct';
            else if (picked) state = 'wrong';
            return <OptionButton key={o.id} option={o} state={state} disabled />;
          })}
        </div>
      ) : (
        <div className="reveal__answers">
          <p className="reveal__label">الإجابة الصحيحة</p>
          {correct.map((o) => (
            <OptionButton key={o.id} option={o} state={outcome === 'correct' ? 'correct-mine' : 'correct'} disabled />
          ))}
          {outcome === 'wrong' && chosen.length > 0 && (
            <>
              <p className="reveal__label">إجابتك</p>
              {chosen.map((o) => (
                <OptionButton key={o.id} option={o} state="wrong" disabled />
              ))}
            </>
          )}
        </div>
      )}
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
        {count(chapter.questionCount, 'question')}. يظهر السؤال أولًا، ثم تفتح الإجابات مع بدء المؤقت. الإجابة الصحيحة
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
