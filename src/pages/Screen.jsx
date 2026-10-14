import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { messageFor } from '../lib/errors';
import { useNow, useServerClock } from '../lib/clock';
import { useFeed } from '../lib/useFeed';
import { joinUrl } from '../lib/router';
import { OptionTile } from '../components/Options';
import { Plate } from '../components/Plate';
import { QrCode } from '../components/QrCode';
import { Leaderboard } from '../components/Leaderboard';
import { Timer, timerState } from '../components/Timer';
import { ConnectionBadge, Spinner } from '../components/ui';
import { plural } from '../utils/format';

// Projector view. It never receives the answer key before the reveal and shows
// only the top of the leaderboard, so nobody is ranked last in front of the room.
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

  if (feed.error) {
    return (
      <main className="screen screen--message">
        <h1 className="screen__headline">{messageFor(feed.error)}</h1>
        <p className="screen__sub">Check the session code in the presenter console.</p>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="screen screen--message">
        <Spinner label="Connecting to the session…" />
      </main>
    );
  }

  const { session } = data;
  const url = joinUrl(session.code);
  const anyPlayed = (data.chapters || []).some((c) => c.status !== 'locked');
  let body;

  if (session.phase === 'ended') {
    body = <FinalBoard data={data} />;
  } else if (session.phase === 'question' && data.question) {
    body = <QuestionBoard data={data} now={now} />;
  } else if (session.phase === 'reveal' && data.question) {
    body = <RevealBoard data={data} now={now} />;
  } else if (session.phase === 'chapter_intro' && data.chapter) {
    body = <ChapterBoard data={data} url={url} />;
  } else if (session.phase === 'chapter_results' && data.chapter) {
    body = <StandingsBoard data={data} title={`Chapter ${data.chapter.order} complete`} subtitle={data.chapter.title} />;
  } else if (!anyPlayed) {
    body = <Lobby data={data} url={url} />;
  } else {
    body = <StandingsBoard data={data} title="Leaderboard" subtitle="Next chapter coming up" />;
  }

  // Late joiners get a small code between questions; it stays off the answer tiles.
  const showCornerQr =
    session.registrationOpen &&
    !(session.phase === 'idle' && !anyPlayed) &&
    !['question', 'reveal', 'ended'].includes(session.phase);
  return (
    <main className="screen">
      <header className="screen__bar">
        <span className="screen__title" dir="auto">{session.title}</span>
        <span className="screen__people">{plural(data.participantCount, 'player', 'players')}</span>
        <ConnectionBadge connection={feed.connection} />
      </header>
      {body}
      {showCornerQr && (
        <aside className="screen__corner" aria-label="Late joiners">
          <QrCode value={url} size={112} label="QR code to join this quiz" />
          <Plate code={session.code} size="xs" />
        </aside>
      )}
    </main>
  );
}

function Lobby({ data, url }) {
  const names = (data.leaderboard || []).map((r) => r.displayName);
  const shortUrl = url.replace(/^https?:\/\//, '');
  return (
    <section className="lobby">
      <div className="lobby__join">
        <h1 className="screen__headline">Scan to join</h1>
        <p className="screen__sub">Point your phone camera at the code, then enter your name.</p>
        <Plate code={data.session.code} size="xl" caption="Or open the link below and type this code" />
        <p className="lobby__url">{shortUrl}</p>
      </div>
      <div className="lobby__qr">
        <QrCode value={url} size={360} label="QR code to join this quiz" />
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
      <p className="chapter-board__num">Chapter {c.order}</p>
      <h1 className="chapter-board__title">{c.title}</h1>
      {c.description && <p className="screen__sub" dir="auto">{c.description}</p>}
      <p className="chapter-board__rules">
        {plural(c.questionCount, 'question', 'questions')}. Read the question, then answer on your phone before the timer runs out.
      </p>
    </section>
  );
}

function QuestionHeader({ data }) {
  const q = data.question;
  return (
    <div className="qboard__head">
      <span>
        Chapter {data.chapter?.order}: {data.chapter?.title}
      </span>
      <span className="qboard__count">
        Question {q.index} of {q.total}
      </span>
    </div>
  );
}

function QuestionBoard({ data, now }) {
  const q = data.question;
  const t = timerState(q, now);
  return (
    <section className="qboard">
      <QuestionHeader data={data} />
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
      <QuestionHeader data={data} />
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
          {r.explanation}
        </p>
      )}
    </section>
  );
}

function StandingsBoard({ data, title, subtitle }) {
  return (
    <section className="standings">
      <h1 className="screen__headline">{title}</h1>
      {subtitle && <p className="screen__sub">{subtitle}</p>}
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
