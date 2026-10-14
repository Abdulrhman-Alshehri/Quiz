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
import { ordinal, percent, plural, points, seconds } from '../utils/format';

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
      <h1 className="h1">Join first</h1>
      <p className="lead">This phone has not joined a quiz yet. Opening the join page…</p>
      <a className="btn btn--primary btn--xl" href="#/join">Join the quiz</a>
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
        <h1 className="h1">{feed.error.code === 'PARTICIPANT_REMOVED' ? 'You were removed from this quiz' : 'Your place was not found'}</h1>
        <p className="lead">{messageFor(feed.error)}</p>
        <button
          className="btn btn--primary btn--block btn--xl"
          type="button"
          onClick={() => {
            clearSeat(seat.sessionId);
            navigate(`/join?code=${encodeURIComponent(seat.code)}`);
          }}
        >
          Join again
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
    body = <Spinner label="Connecting to the quiz…" />;
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
          <span className="hud__name" dir="auto">{seat.displayName}</span>
          <span className="hud__score">
            <strong>{points(standing?.totalPoints ?? 0)}</strong> pts
          </span>
          {standing?.rank && state && standing.answeredCount + standing.timedOutCount > 0 && (
            <span className="hud__rank">
              {ordinal(standing.rank)} of {state.participantCount}
            </span>
          )}
        </div>
      </header>
      {feed.connection === 'offline' && (
        <Notice tone="warn">Connection lost. Keep this page open; it reconnects by itself and your saved answers are safe.</Notice>
      )}
      <main className={`play__main${blue ? ' on-blue' : ''}`}>{body}</main>
    </div>
  );
}

const KEYMAP = { 1: 'A', 2: 'B', 3: 'C', 4: 'D', a: 'A', b: 'B', c: 'C', d: 'D' };

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

  // Keyboard: 1-4 or A-D answers on laptops and tablets with keyboards.
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
  if (t.phase === 'paused') status = 'The presenter paused the quiz. The timer continues when they resume.';
  else if (t.phase === 'leadin') status = `Read the question. Answers open in ${Math.ceil(t.leadIn / 1000)} s.`;
  else if (sending) status = 'Sending your answer…';
  else if (mine && result && result.isCorrect) status = `Correct. +${points(result.points)} points.`;
  else if (mine && result && result.isCorrect === false) status = 'Not this one. The correct answer shows at the reveal.';
  else if (mine) status = `Locked in: ${mine.selectedOptionId}. Waiting for the reveal.`;
  else if (pending?.status === 'failed') status = `${messageFor(pending.error)}${t.phase === 'running' ? ' Tap an answer to try again.' : ''}`;
  else if (t.phase === 'done') status = 'Time is up. Waiting for the reveal.';
  else status = 'Tap one answer. You get one try.';

  return (
    <section className="q" aria-labelledby="q-text">
      <div className="q__meta">
        <span>{chapter ? `Chapter ${chapter.order}: ${chapter.title}` : 'Question'}</span>
        <span className="q__count">
          Question {q.index} of {q.total}
        </span>
      </div>
      <Timer question={q} now={now} />
      <h1 id="q-text" className="q__text" dir="auto">
        {q.text}
      </h1>
      {t.phase !== 'leadin' && (
        <div className="opts" role="group" aria-label="Answers">
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
        {t.phase === 'running' && (secs === 10 || secs === 5) ? `${secs} seconds left` : ''}
      </VisuallyHidden>
    </section>
  );
}

function RevealView({ q, chapter, standing, count }) {
  const my = q.myAnswer;
  const outcome = !my ? 'none' : my.status === 'timed_out' ? 'timeout' : my.isCorrect ? 'correct' : 'wrong';
  const correct = q.options.find((o) => o.id === q.correctOptionId);
  const chosen = my && my.selectedOptionId ? q.options.find((o) => o.id === my.selectedOptionId) : null;
  const copy = {
    correct: { title: 'Correct', icon: '✓' },
    wrong: { title: 'Not this time', icon: '✕' },
    timeout: { title: 'Time ran out', icon: '⏱' },
    none: { title: 'You joined after this question', icon: '·' },
  }[outcome];
  return (
    <section className={`reveal reveal--${outcome}`} aria-labelledby="reveal-title">
      <p className="q__meta">
        <span>{chapter ? `Chapter ${chapter.order}` : ''}</span>
        <span className="q__count">
          Question {q.index} of {q.total}
        </span>
      </p>
      <div className="reveal__badge">
        <span className="reveal__icon" aria-hidden="true">{copy.icon}</span>
        <h1 id="reveal-title" className="reveal__title">{copy.title}</h1>
        {outcome === 'correct' && <p className="reveal__points">+{points(my.points)} points</p>}
        {(outcome === 'wrong' || outcome === 'timeout') && <p className="reveal__points">0 points</p>}
      </div>
      <div className="reveal__answers">
        <p className="reveal__label">Correct answer</p>
        {correct && <OptionButton option={correct} state={outcome === 'correct' ? 'correct-mine' : 'correct'} disabled />}
        {outcome === 'wrong' && chosen && (
          <>
            <p className="reveal__label">Your answer</p>
            <OptionButton option={chosen} state="wrong" disabled />
          </>
        )}
      </div>
      {q.explanation && (
        <p className="reveal__why" dir="auto">
          <span className="reveal__why-label">Why</span>
          {q.explanation}
        </p>
      )}
      {standing && (
        <p className="reveal__standing">
          Total <strong>{points(standing.totalPoints)}</strong> points. You are <strong>{ordinal(standing.rank)}</strong> of {count}.
        </p>
      )}
      <p className="muted">The next question appears here by itself.</p>
    </section>
  );
}

function ChapterIntro({ chapter }) {
  return (
    <section className="intro">
      <p className="intro__num">Chapter {chapter.order}</p>
      <h1 className="intro__title">{chapter.title}</h1>
      {chapter.description && <p className="lead" dir="auto">{chapter.description}</p>}
      <p className="intro__rules">
        {plural(chapter.questionCount, 'question', 'questions')}. Each question shows first, then the four answers open with
        the timer. Faster correct answers earn more points.
      </p>
      <p className="muted">Look up at the big screen. The first question appears here too.</p>
    </section>
  );
}

function ChapterStats({ chapter, standing, count }) {
  const s = chapter.stats || {};
  const total = chapter.questionCount || 0;
  const correct = s.correct || 0;
  const seen = s.seen || 0;
  return (
    <dl className="stats">
      <div>
        <dt>Correct</dt>
        <dd>
          {correct} of {total}
        </dd>
      </div>
      <div>
        <dt>Accuracy</dt>
        <dd>{total ? percent(Math.round((100 * correct) / total)) : '–'}</dd>
      </div>
      <div>
        <dt>Chapter points</dt>
        <dd>{points(s.points)}</dd>
      </div>
      <div>
        <dt>Average answer time</dt>
        <dd>{seconds(s.avgResponseMs)}</dd>
      </div>
      <div>
        <dt>Status</dt>
        <dd>{seen >= total && total > 0 ? 'Completed' : `Answered ${seen} of ${total}`}</dd>
      </div>
      {standing?.rank && (
        <div>
          <dt>Overall rank</dt>
          <dd>
            {ordinal(standing.rank)} of {count}
          </dd>
        </div>
      )}
    </dl>
  );
}

function ChapterResults({ chapter, state, standing }) {
  return (
    <section className="results">
      <p className="intro__num">Chapter {chapter.order} complete</p>
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
        {played ? 'Next chapter coming up' : <>You are in, <span dir="auto">{state.participant.displayName}</span></>}
      </h1>
      <p className="lead">
        Watch the big screen. The presenter starts each chapter; this page follows along by itself.
      </p>
      <p className="muted">{plural(state.participantCount, 'person has', 'people have')} joined.</p>
      <ChapterList chapters={state.chapters} activeId={state.session.activeChapterId} />
    </section>
  );
}

function ChapterList({ chapters, activeId }) {
  return (
    <section className="chapters" aria-labelledby="chapters-title">
      <h2 id="chapters-title" className="h3">Chapters</h2>
      <ol className="chapters__list">
        {chapters.map((c) => {
          const label = c.status === 'completed' ? 'Completed' : c.status === 'open' ? (c.id === activeId ? 'Live now' : 'Started') : 'Locked';
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
                    {points(c.stats.points)} pts, {c.stats.correct || 0}/{c.questionCount}
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
      <p className="intro__num">Quiz complete</p>
      <h1 className="h1">Thanks, <span dir="auto">{state.participant.displayName}</span></h1>
      {standing ? (
        <>
          <p className="final__label">Final position</p>
          <p className="final__rank">
            {ordinal(standing.rank)}
            <span> of {state.participantCount}</span>
          </p>
          <dl className="stats">
            <div>
              <dt>Total points</dt>
              <dd>{points(standing.totalPoints)}</dd>
            </div>
            <div>
              <dt>Correct</dt>
              <dd>
                {standing.correctCount} of {totalQuestions}
              </dd>
            </div>
            <div>
              <dt>Accuracy</dt>
              <dd>{percent(standing.accuracy)}</dd>
            </div>
            <div>
              <dt>Average answer time</dt>
              <dd>{seconds(standing.avgResponseMs)}</dd>
            </div>
          </dl>
        </>
      ) : (
        <Spinner label="Loading your results…" />
      )}
      <ChapterList chapters={state.chapters} activeId={null} />
    </section>
  );
}
