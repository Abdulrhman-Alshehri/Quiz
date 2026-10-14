import { useState } from 'react';
import { api } from '../lib/api';
import { QuizError, messageFor } from '../lib/errors';
import { BluePage } from '../components/Brand';
import { Notice } from '../components/ui';

export default function AdminLogin({ onSignedIn, reason }) {
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!passcode) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.admin.login(passcode);
      if (res && res.ok) {
        onSignedIn(res.token, res.expiresAt);
      } else {
        setError(new QuizError(res?.error || 'INVALID_PASSCODE'));
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <BluePage className="admin--login">
      <form className="card login" onSubmit={submit}>
        <h1 className="h2">Presenter sign-in</h1>
        <p className="muted">Enter the presenter passcode to run sessions, see results and download reports.</p>
        {reason && <Notice tone="info">{reason}</Notice>}
        <label className="field">
          <span className="field__label">Passcode</span>
          <input
            className="input"
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            autoComplete="current-password"
            autoFocus
          />
        </label>
        {error && <Notice tone="error">{messageFor(error)}</Notice>}
        <button className="btn btn--primary btn--block" type="submit" disabled={busy || !passcode}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="muted small">Sign-in lasts 12 hours on this browser. Sign out when you use a shared laptop.</p>
        <a className="link" href="#/">Back to the start page</a>
      </form>
    </BluePage>
  );
}
