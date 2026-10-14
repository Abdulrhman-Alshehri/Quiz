import { parseTs } from '../lib/clock';

// Visual countdown drawn from the database deadline. It never decides whether an
// answer counts: the database does that when the answer arrives.
export function timerState(question, now) {
  const start = parseTs(question.startedAt);
  const end = parseTs(question.deadline);
  const durationMs = question.durationSeconds * 1000;
  if (question.paused) {
    const remaining = question.pausedRemainingMs ?? Math.max(0, end - now);
    return { phase: 'paused', remaining, fraction: remaining / durationMs, leadIn: 0 };
  }
  if (now < start) {
    return { phase: 'leadin', remaining: durationMs, fraction: 1, leadIn: start - now };
  }
  const remaining = Math.max(0, end - now);
  return { phase: remaining > 0 ? 'running' : 'done', remaining, fraction: remaining / durationMs, leadIn: 0 };
}

// The number is shown large on its own, so the label only needs the noun form.
const pluralRules = new Intl.PluralRules('ar');
function secondsLeftLabel(n) {
  const cat = pluralRules.select(n);
  if (cat === 'two') return 'ثانيتان متبقيتان';
  if (cat === 'few') return 'ثوان متبقية';
  return 'ثانية متبقية';
}

export function Timer({ question, now, size = 'm' }) {
  const t = timerState(question, now);
  const secs = t.phase === 'leadin' ? Math.ceil(t.leadIn / 1000) : Math.ceil(t.remaining / 1000);
  const low = t.phase === 'running' && t.remaining <= 5000;
  const label = {
    leadin: 'استعد',
    paused: 'متوقف مؤقتًا',
    done: 'انتهى الوقت',
    running: secondsLeftLabel(secs),
  }[t.phase];
  return (
    <div
      className={`timer timer--${size} is-${t.phase}${low ? ' is-low' : ''}`}
      role="timer"
      aria-label={t.phase === 'running' ? `${secs} ${label}` : label}
    >
      <span className="timer__num">{t.phase === 'done' ? 0 : secs}</span>
      <span className="timer__label">{label}</span>
      <span className="timer__track" aria-hidden="true">
        <span className="timer__fill" style={{ transform: `scaleX(${Math.max(0, Math.min(1, t.fraction))})` }} />
      </span>
    </div>
  );
}
