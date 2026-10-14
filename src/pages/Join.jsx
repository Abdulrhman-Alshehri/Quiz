import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { messageFor } from '../lib/errors';
import { navigate } from '../lib/router';
import { clearSeat, getSeat, saveSeat } from '../lib/storage';
import { NAME_MAX, normalizeName, validateName } from '../utils/names';
import { QuizError } from '../lib/errors';
import { BluePage } from '../components/Brand';
import { Plate } from '../components/Plate';
import { Notice, Spinner } from '../components/ui';

export default function Join({ query }) {
  const codeParam = (query.get('code') || '').trim().toUpperCase();
  const [session, setSession] = useState(null);
  const [lookup, setLookup] = useState('loading'); // loading | found | missing
  const [codeInput, setCodeInput] = useState(codeParam);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [seat, setSeat] = useState(null);

  useEffect(() => {
    let alive = true;
    setLookup('loading');
    api
      .resolveSession(codeParam || null)
      .then((s) => {
        if (!alive) return;
        setSession(s);
        setSeat(getSeat(s.sessionId));
        setLookup('found');
      })
      .catch((e) => {
        if (!alive) return;
        setSession(null);
        setLookup('missing');
        if (codeParam || e.code !== 'SESSION_NOT_FOUND') setError(e);
      });
    return () => {
      alive = false;
    };
  }, [codeParam]);

  const submitCode = (e) => {
    e.preventDefault();
    const code = codeInput.replace(/\s+/g, '').toUpperCase();
    if (!code) return;
    setError(null);
    navigate(`/join?code=${encodeURIComponent(code)}`);
  };

  const join = async (e) => {
    e.preventDefault();
    const problem = validateName(name);
    if (problem) {
      setError(new QuizError(problem));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.joinSession(session.code, normalizeName(name));
      saveSeat({
        sessionId: res.sessionId,
        participantId: res.participantId,
        token: res.token,
        code: res.code,
        displayName: res.displayName,
      });
      navigate(`/play?s=${res.sessionId}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (lookup === 'loading') {
    return (
      <BluePage className="join-page">
        <Spinner label="جارٍ البحث عن المسابقة…" />
      </BluePage>
    );
  }

  if (lookup === 'missing') {
    return (
      <BluePage className="join-page">
        <h1 className="h1">انضم إلى المسابقة</h1>
        <p className="lead">اكتب رمز الانضمام الظاهر تحت رمز QR على الشاشة الكبيرة.</p>
        <form className="card join-card" onSubmit={submitCode}>
          {error && <Notice tone="error">{messageFor(error)}</Notice>}
          <label className="field">
            <span className="field__label">رمز الانضمام</span>
            <input
              className="input input--plate"
              dir="ltr"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              maxLength={8}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              inputMode="text"
              placeholder="ABC 234"
            />
          </label>
          <button className="btn btn--primary btn--block btn--xl" type="submit">
            ابحث عن المسابقة
          </button>
        </form>
      </BluePage>
    );
  }

  const closed = session.status === 'ended' || !session.registrationOpen;

  return (
    <BluePage className="join-page">
      <p className="join__kicker">أنت تنضم إلى</p>
      <h1 className="h1">
        <bdi>{session.title}</bdi>
      </h1>
      <Plate code={session.code} size="s" />

      <div className="card join-card">
        {seat && (
          <section className="join__resume" aria-labelledby="resume-title">
            <h2 id="resume-title" className="h3">
              مرحبًا بعودتك، <bdi>{seat.displayName}</bdi>
            </h2>
            <p className="muted">لهذا الجوال مكان محفوظ في هذه المسابقة، وإجاباتك محفوظة.</p>
            <button className="btn btn--primary btn--block btn--xl" type="button" onClick={() => navigate(`/play?s=${seat.sessionId}`)}>
              تابع باسم <bdi>{seat.displayName}</bdi>
            </button>
            <button
              className="btn btn--quiet btn--block"
              type="button"
              onClick={() => {
                clearSeat(seat.sessionId);
                setSeat(null);
              }}
            >
              انضم باسم آخر
            </button>
          </section>
        )}

        {!seat && session.status === 'ended' && <Notice tone="info">انتهت هذه المسابقة. شكرًا لمشاركتك.</Notice>}
        {!seat && session.status !== 'ended' && !session.registrationOpen && (
          <Notice tone="info">الانضمام مغلق الآن. اطلب من المقدم إعادة فتحه.</Notice>
        )}

        {!seat && !closed && (
          <form className="stack" onSubmit={join} noValidate>
            <label className="field">
              <span className="field__label">اسمك كما تريده أن يظهر في لوحة الصدارة</span>
              <input
                className="input input--big"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={NAME_MAX + 10}
                autoComplete="name"
                autoFocus
                dir="auto"
                aria-describedby="name-help"
                aria-invalid={error ? 'true' : 'false'}
              />
              <span id="name-help" className="field__help">
                حتى {NAME_MAX} حرفًا. سيراه جميع الحاضرين.
              </span>
            </label>
            {error && <Notice tone="error">{messageFor(error)}</Notice>}
            <button className="btn btn--primary btn--block btn--xl" type="submit" disabled={busy}>
              {busy ? 'جارٍ الانضمام…' : 'انضم الآن'}
            </button>
          </form>
        )}
      </div>
    </BluePage>
  );
}
