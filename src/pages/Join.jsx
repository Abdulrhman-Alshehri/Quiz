import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { messageFor } from '../lib/errors';
import { navigate } from '../lib/router';
import { clearSeat, getSeat, saveSeat } from '../lib/storage';
import { NAME_MAX, normalizeName, validateName } from '../utils/names';
import { QuizError } from '../lib/errors';
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
      <main className="page page--narrow">
        <Spinner label="Finding the live quiz…" />
      </main>
    );
  }

  if (lookup === 'missing') {
    return (
      <main className="page page--narrow">
        <h1 className="h1">Join the quiz</h1>
        <p className="lead">Type the join code shown under the QR code on the big screen.</p>
        {error && <Notice tone="error">{messageFor(error)}</Notice>}
        <form className="stack" onSubmit={submitCode}>
          <label className="field">
            <span className="field__label">Join code</span>
            <input
              className="input input--plate"
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
          <button className="btn btn--primary btn--block" type="submit">
            Find quiz
          </button>
        </form>
      </main>
    );
  }

  const closed = session.status === 'ended' || !session.registrationOpen;

  return (
    <main className="page page--narrow join">
      <p className="join__kicker">You are joining</p>
      <h1 className="h1" dir="auto">{session.title}</h1>
      <Plate code={session.code} size="s" />

      {seat && (
        <section className="card card--quiet join__resume" aria-labelledby="resume-title">
          <h2 id="resume-title" className="h3">Welcome back, <span dir="auto">{seat.displayName}</span></h2>
          <p className="muted">This phone already has a place in this quiz. Your answers are saved.</p>
          <button className="btn btn--primary btn--block" type="button" onClick={() => navigate(`/play?s=${seat.sessionId}`)}>
            Continue as {seat.displayName}
          </button>
          <button
            className="btn btn--quiet btn--block"
            type="button"
            onClick={() => {
              clearSeat(seat.sessionId);
              setSeat(null);
            }}
          >
            Join with a different name
          </button>
        </section>
      )}

      {!seat && session.status === 'ended' && <Notice tone="info">This quiz has ended. Thanks for taking part.</Notice>}
      {!seat && session.status !== 'ended' && !session.registrationOpen && (
        <Notice tone="info">Joining is closed right now. Ask the presenter to reopen it.</Notice>
      )}

      {!seat && !closed && (
        <form className="stack" onSubmit={join} noValidate>
          <label className="field">
            <span className="field__label">Your name, as you want it on the leaderboard</span>
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
              Up to {NAME_MAX} characters. Everyone in the room will see it.
            </span>
          </label>
          {error && <Notice tone="error">{messageFor(error)}</Notice>}
          <button className="btn btn--primary btn--block btn--xl" type="submit" disabled={busy}>
            {busy ? 'Joining…' : 'Join quiz'}
          </button>
        </form>
      )}
    </main>
  );
}
