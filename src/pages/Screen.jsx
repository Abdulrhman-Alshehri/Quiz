import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { messageFor } from '../lib/errors';
import { useNow, useServerClock } from '../lib/clock';
import { useFeed } from '../lib/useFeed';
import { appBaseUrl, joinUrl } from '../lib/router';
import { BRAND_FOOTER, Logo } from '../components/Brand';
import { OptionTile } from '../components/Options';
import { Plate } from '../components/Plate';
import { QrCode } from '../components/QrCode';
import { Leaderboard } from '../components/Leaderboard';
import { Timer, timerState } from '../components/Timer';
import { ConnectionBadge, Spinner } from '../components/ui';
import { plural } from '../utils/format';

// Projector view. It never receives the answer key before the reveal and shows
// only the top of the leaderboard, so nobody is ranked last in front of the room.
// It follows the deck: blue title/section slides for the lobby, chapter intros
// and the final result; a blue header band over a light page for the rest.
export default function Screen({ code }) {
  useServerClock();
  const now = useNow(100);
  const [sessionId, setSessionId] = useState(null);
  const feed = useFeed({
    key: code,
    fetcher: () => api.screenState(code),
    sessionId,
    pollMs: 3000,
    fastPollMs: 1200,
  });
  const data = feed.data;

  useEffect(() => {
    if (data?.session?.id) setSessionId(data.session.id);
  }, [data?.session?.id]);

  if (feed.error || !data) {
    return (
      <main className="screen on-blue surface-blue">
        <header className="screen__bar on-blue">
          <Logo />
        </header>
        <div className="screen__body screen--message">
          {feed.error ? (
            <>
              <h1 className="screen__headline">{messageFor(feed.error)}</h1>
              <p className="screen__sub">Check the session code in the presenter console.</p>
            </>
          ) : (
            <Spinner label="Connecting to the session…" />
          )}
        </div>
      </main>
    );
  }

  const { session } = data;
  const url = joinUrl(session.code);
  const chapters = data.chapters || [];
  const anyPlayed = chapters.some((c) => c.status !== 'locked');
  const upcoming = chapters.find((c) => c.status !== 'completed');
  const questionBand = () => ({
    title: `Chapter ${data.chapter?.order}: ${data.chapter?.title}`,
    subtitle: `Question ${data.question.index} of ${data.question.total}`,
  });

  let view;
  if (session.phase === 'ended') {
    view = { blue: true, body: <FinalBoard data={data} /> };
  } else if (session.phase === 'question' && data.question) {
    view = { ...questionBand(), body: <QuestionBoard data={data} now={now} /> };
  } else if (session.phase === 'reveal' && data.question) {
    view = { ...questionBand(), body: <RevealBoard data={data} /> };
  } else if (session.phase === 'chapter_intro' && data.chapter) {
    view = { blue: true, body: <ChapterBoard data={data} /> };
  } else if (session.phase === 'chapter_results' && data.chapter) {
    view = {
      heading: true,
      title: `Chapter ${data.chapter.order} complete`,
      subtitle: data.chapter.title,
      body: <StandingsBoard data={data} />,
    };
  } else if (!anyPlayed) {
    view = { blue: true, body: <Lobby data={data} url={url} upcoming={upcoming} /> };
  } else {
    view = {
      heading: true,
      title: 'Leaderboard',
      subtitle: upcoming ? `Up next: Chapter ${upcoming.order}, ${upcoming.title}` : 'Next chapter coming up',
      body: <StandingsBoard data={data} />,
    };
  }

  // Late joiners get a small code between questions; it stays off the answer tiles.
  const showCornerQr =
    session.registrationOpen &&
    !(session.phase === 'idle' && !anyPlayed) &&
    !['question', 'reveal', 'ended'].includes(session.phase);
  const Title = view.heading ? 'h1' : 'p';
  return (
    <main className={`screen${view.blue ? ' on-blue surface-blue' : ''}`}>
      <header className="screen__bar on-blue">
        <Logo />
        {view.title && (
          <div className="screen__heading">
            <Title className="screen__title" dir="auto">{view.title}</Title>
            {view.subtitle && <p className="screen__subtitle" dir="auto">{view.subtitle}</p>}
          </div>
        )}
      </header>
      <div className="screen__body">{view.body}</div>
      <footer className="screen__foot">
        <span className="screen__foot-brand">
          <span dir="auto">{session.title}</span> | {BRAND_FOOTER}
        </span>
        <span className="screen__people">{plural(data.participantCount, 'player', 'players')}</span>
        <ConnectionBadge connection={feed.connection} />
      </footer>
      {showCornerQr && (
        <aside className="screen__corner" aria-label="Late joiners">
          <p className="screen__corner-label">Join late? Scan</p>
          <QrCode value={url} size={112} label="QR code to join this quiz" />
          <Plate code={session.code} size="xs" />
        </aside>
      )}
    </main>
  );
}

function Lobby({ data, url, upcoming }) {
  const names = (data.leaderboard || []).map((r) => r.displayName);
  const site = appBaseUrl().replace(/^https?:\/\//, '').replace(/\/$/, '');
  return (
    <section className="lobby">
      <div className="lobby__join">
        <h1 className="screen__headline">Quiz time</h1>
        <p className="screen__sub" dir="auto">
          {upcoming ? `Chapter ${upcoming.order}: ${upcoming.title}` : data.session.title}
        </p>
        <ol className="steps-list lobby__steps">
          <li>
            <span className="step-num" aria-hidden="true">1</span>
            <span>Scan the QR code with your phone</span>
          </li>
          <li>
            <span className="step-num" aria-hidden="true">2</span>
            <span>Enter your name and join</span>
          </li>
          <li>
            <span className="step-num" aria-hidden="true">3</span>
            <span>Answer on your phone before the timer runs out: faster correct answers earn more points</span>
          </li>
        </ol>
        <p className="lobby__note">No account needed: scan, enter your name and play.</p>
      </div>
      <div className="lobby__card">
        <div className="lobby__qr">
          <QrCode value={url} size={440} fluid label="QR code to join this quiz" />
        </div>
        <h2 className="lobby__card-title">Scan to join</h2>
        <p className="lobby__url">or go to {site}</p>
        <Plate code={data.session.code} size="l" caption="Join code" />
      </div>
      <div className="lobby__people">
        <p className="lobby__count">
          <strong>{data.participantCount}</strong> {data.participantCount === 1 ? 'person has' : 'people have'} joined
        </p>
        {names.length > 0 && (
          <ul className="lobby__names" aria-label="First people to join">
            {names.map((n) => (
              <li key={n} dir="auto">{n}</li>
            ))}
            {data.participantCount > names.length && <li className="lobby__more">+{data.participantCount - names.length}</li>}
          </ul>
        )}
      </div>
    </section>
  );
}

function ChapterBoard({ data }) {
  const c = data.chapter;
  return (
    <section className="chapter-board">
      <p className="chapter-board__num" aria-hidden="true">
        {String(c.order).padStart(2, '0')}
      </p>
      <h1 className="chapter-board__title">
        <span className="sr-only">Chapter {c.order}: </span>
        {c.title}
      </h1>
      {c.description && <p className="screen__sub" dir="auto">{c.description}</p>}
      <p className="chapter-board__rules">
        {plural(c.questionCount, 'question', 'questions')}. Read the question, then answer on your phone before the timer runs out.
      </p>
    </section>
  );
}

function QuestionBoard({ data, now }) {
  const q = data.question;
  const t = timerState(q, now);
  return (
    <section className="qboard">
      <div className="qboard__main">
        <h1 className="qboard__text" dir="auto">{q.text}</h1>
        <div className="qboard__side">
          <Timer question={q} now={now} size="l" />
          <p className="qboard__answered">
            <strong>{q.answeredCount}</strong> of {data.participantCount} answered
          </p>
        </div>
      </div>
      {t.phase === 'leadin' ? (
        <p className="qboard__ready">Answers open in {Math.ceil(t.leadIn / 1000)}…</p>
      ) : (
        <div className="tiles">
          {q.options.map((o) => (
            <OptionTile key={o.id} option={o} revealed={false} />
          ))}
        </div>
      )}
    </section>
  );
}

function RevealBoard({ data }) {
  const q = data.question;
  const r = data.reveal;
  const totalAnswers = Object.values(r.distribution || {}).reduce((a, b) => a + b, 0);
  return (
    <section className="qboard qboard--reveal">
      <div className="qboard__main">
        <h1 className="qboard__text" dir="auto">{q.text}</h1>
        <div className="qboard__side">
          <p className="qboard__score">
            <strong>{r.correctCount}</strong> of {data.participantCount} got it right
          </p>
        </div>
      </div>
      <div className="tiles">
        {q.options.map((o) => (
          <OptionTile
            key={o.id}
            option={o}
            revealed
            correct={o.id === r.correctOptionId}
            count={r.distribution?.[o.id] || 0}
            total={totalAnswers}
          />
        ))}
      </div>
      {r.explanation && (
        <p className="qboard__why" dir="auto">
          <span className="reveal__why-label">Why</span>
          {r.explanation}
        </p>
      )}
    </section>
  );
}

function StandingsBoard({ data }) {
  return (
    <section className="standings">
      <Leaderboard rows={data.leaderboard} total={data.participantCount} />
    </section>
  );
}

function FinalBoard({ data }) {
  const rows = data.leaderboard || [];
  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);
  const order = [podium[1], podium[0], podium[2]].filter(Boolean);
  return (
    <section className="final-board">
      <h1 className="screen__headline">Final results</h1>
      <p className="screen__sub">Thank you for playing</p>
      {podium.length > 0 ? (
        <ol className="podium" aria-label="Top three">
          {order.map((r) => (
            <li key={r.rank} className={`podium__place podium__place--${r.rank}`}>
              <span className="podium__name" dir="auto">{r.displayName}</span>
              <span className="podium__pts">{r.totalPoints.toLocaleString('en-US')}</span>
              <span className="podium__step">{r.rank}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="screen__sub">No answers were recorded in this session.</p>
      )}
      {rest.length > 0 && <Leaderboard rows={rest} total={Math.max(0, data.participantCount - 3)} compact />}
    </section>
  );
}
