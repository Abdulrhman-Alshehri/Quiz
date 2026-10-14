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
import { count } from '../utils/format';

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
              <p className="screen__sub">تحقق من رمز الجلسة في لوحة تحكم المقدم.</p>
            </>
          ) : (
            <Spinner label="جارٍ الاتصال بالجلسة…" />
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
    title: `الفصل ${data.chapter?.order}: ${data.chapter?.title}`,
    subtitle: `السؤال ${data.question.index} من ${data.question.total}`,
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
      title: `اكتمل الفصل ${data.chapter.order}`,
      subtitle: data.chapter.title,
      body: <StandingsBoard data={data} />,
    };
  } else if (!anyPlayed) {
    view = { blue: true, body: <Lobby data={data} url={url} upcoming={upcoming} /> };
  } else {
    view = {
      heading: true,
      title: 'لوحة الصدارة',
      subtitle: upcoming ? `التالي: الفصل ${upcoming.order}، ${upcoming.title}` : 'الفصل التالي قريبًا',
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
            <Title className="screen__title">{view.title}</Title>
            {view.subtitle && <p className="screen__subtitle">{view.subtitle}</p>}
          </div>
        )}
      </header>
      <div className="screen__body">{view.body}</div>
      <footer className="screen__foot">
        <span className="screen__foot-brand">
          <bdi>{session.title}</bdi> | {BRAND_FOOTER}
        </span>
        <span className="screen__people">المشاركون: {data.participantCount}</span>
        <ConnectionBadge connection={feed.connection} />
      </footer>
      {showCornerQr && (
        <aside className="screen__corner" aria-label="للمنضمين متأخرين">
          <p className="screen__corner-label">تأخرت؟ امسح للانضمام</p>
          <QrCode value={url} size={112} label="رمز QR للانضمام إلى هذه المسابقة" />
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
        <h1 className="screen__headline">وقت المسابقة</h1>
        <p className="screen__sub">
          {upcoming ? `الفصل ${upcoming.order}: ${upcoming.title}` : <bdi>{data.session.title}</bdi>}
        </p>
        <ol className="steps-list lobby__steps">
          <li>
            <span className="step-num" aria-hidden="true">1</span>
            <span>امسح رمز QR بجوالك</span>
          </li>
          <li>
            <span className="step-num" aria-hidden="true">2</span>
            <span>اكتب اسمك وانضم</span>
          </li>
          <li>
            <span className="step-num" aria-hidden="true">3</span>
            <span>أجب من جوالك قبل انتهاء الوقت: الإجابة الصحيحة الأسرع تكسب نقاطًا أكثر</span>
          </li>
        </ol>
        <p className="lobby__note">لا حاجة إلى حساب: امسح الرمز واكتب اسمك وابدأ.</p>
      </div>
      <div className="lobby__card">
        <div className="lobby__qr">
          <QrCode value={url} size={440} fluid label="رمز QR للانضمام إلى هذه المسابقة" />
        </div>
        <h2 className="lobby__card-title">امسح للانضمام</h2>
        <p className="lobby__url">
          أو افتح <bdi dir="ltr">{site}</bdi>
        </p>
        <Plate code={data.session.code} size="l" caption="رمز الانضمام" />
      </div>
      <div className="lobby__people">
        <p className="lobby__count">
          عدد المنضمين <strong>{data.participantCount}</strong>
        </p>
        {names.length > 0 && (
          <ul className="lobby__names" aria-label="أول المنضمين">
            {names.map((n) => (
              <li key={n}>
                <bdi>{n}</bdi>
              </li>
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
        <span className="sr-only">الفصل {c.order}: </span>
        {c.title}
      </h1>
      {c.description && <p className="screen__sub">{c.description}</p>}
      <p className="chapter-board__rules">
        {count(c.questionCount, 'question')}. اقرأ السؤال، ثم أجب من جوالك قبل انتهاء الوقت.
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
        <h1 className="qboard__text">{q.text}</h1>
        <div className="qboard__side">
          <Timer question={q} now={now} size="l" />
          <p className="qboard__answered">
            <strong>{q.answeredCount}</strong> من {data.participantCount} أجابوا
          </p>
        </div>
      </div>
      {t.phase === 'leadin' ? (
        <p className="qboard__ready">تفتح الإجابات خلال {Math.ceil(t.leadIn / 1000)}…</p>
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
        <h1 className="qboard__text">{q.text}</h1>
        <div className="qboard__side">
          <p className="qboard__score">
            <strong>{r.correctCount}</strong> من {data.participantCount} أجابوا إجابة صحيحة
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
        <p className="qboard__why">
          <span className="reveal__why-label">التوضيح</span>
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
      <h1 className="screen__headline">النتائج النهائية</h1>
      <p className="screen__sub">شكرًا لمشاركتكم</p>
      {podium.length > 0 ? (
        <ol className="podium" aria-label="المراكز الثلاثة الأولى">
          {order.map((r) => (
            <li key={r.rank} className={`podium__place podium__place--${r.rank}`}>
              <span className="podium__name">
                <bdi>{r.displayName}</bdi>
              </span>
              <span className="podium__pts">{r.totalPoints.toLocaleString('en-US')}</span>
              <span className="podium__step">{r.rank}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="screen__sub">لم تُسجل أي إجابات في هذه الجلسة.</p>
      )}
      {rest.length > 0 && <Leaderboard rows={rest} total={Math.max(0, data.participantCount - 3)} compact />}
    </section>
  );
}
