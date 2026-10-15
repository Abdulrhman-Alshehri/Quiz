import { count, optionLetter } from '../utils/format';

// Answer options: white cards with a coloured badge holding a shape and an
// Arabic letter (أ ب ج د هـ و), so nothing relies on colour alone. Ids stay A-F
// in the database. Red and green are kept for right/wrong feedback only.
const SHAPE_PATHS = {
  A: <path d="M12 3 L22 20 H2 Z" />,
  B: <path d="M12 2 L22 12 L12 22 L2 12 Z" />,
  C: <circle cx="12" cy="12" r="9.5" />,
  D: <rect x="3" y="3" width="18" height="18" rx="1.5" />,
  E: <path d="M12 2.5 L21.5 9.4 L17.9 20.5 H6.1 L2.5 9.4 Z" />,
  F: <path d="M7 3 H17 L22 12 L17 21 H7 L2 12 Z" />,
};

export function Shape({ id, className = '' }) {
  return (
    <svg className={`shape ${className}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {SHAPE_PATHS[id] || SHAPE_PATHS.D}
    </svg>
  );
}

const STATE_SUFFIX = {
  selected: ' (إجابتك)',
  correct: ' (إجابة صحيحة)',
  wrong: ' (إجابتك، غير صحيحة)',
  'correct-mine': ' (إجابتك، صحيحة)',
  missed: ' (إجابة صحيحة لم تخترها)',
};

/**
 * Participant answer button.
 * state: idle | checked | selected | other | correct | correct-mine | missed | wrong | dim
 * multi: multiple-choice question; while it can still be answered the button is a
 * checkbox (checked = ticked but not yet confirmed).
 */
export function OptionButton({ option, state = 'idle', disabled, onSelect, hotkey, multi = false }) {
  const letter = optionLetter(option.id);
  const ticking = multi && (state === 'idle' || state === 'checked');
  const a11y = ticking
    ? { role: 'checkbox', 'aria-checked': state === 'checked' }
    : { 'aria-pressed': state === 'selected' || state === 'correct-mine' || state === 'wrong' };
  return (
    <button
      type="button"
      className={`opt opt--${option.id.toLowerCase()} is-${state}${multi ? ' opt--multi' : ''}`}
      disabled={disabled}
      {...a11y}
      aria-label={`${letter}: ${option.text}${ticking ? '' : STATE_SUFFIX[state] || ''}`}
      onClick={() => onSelect && onSelect(option.id)}
      data-option={option.id}
    >
      <span className="opt__mark" aria-hidden="true">
        <Shape id={option.id} />
        <span className="opt__letter">{letter}</span>
      </span>
      <span className="opt__text">{option.text}</span>
      {ticking && (
        <span className="opt__box" aria-hidden="true">
          {state === 'checked' ? '✓' : ''}
        </span>
      )}
      {(state === 'correct' || state === 'correct-mine' || state === 'missed') && (
        <span className="opt__flag" aria-hidden="true">✓</span>
      )}
      {state === 'wrong' && <span className="opt__flag" aria-hidden="true">✕</span>}
      {hotkey && <span className="opt__key" aria-hidden="true">{hotkey}</span>}
    </button>
  );
}

/** Big-screen tile. While open: no hint of the answer. At reveal: right tiles marked, counts shown. */
export function OptionTile({ option, revealed, correct, count: n, total }) {
  const share = total > 0 ? Math.round((100 * (n || 0)) / total) : 0;
  const letter = optionLetter(option.id);
  return (
    <div
      className={`tile tile--${option.id.toLowerCase()} ${revealed ? (correct ? 'is-correct' : 'is-dim') : ''}`}
      data-option={option.id}
      aria-label={`${letter}: ${option.text}${revealed ? `${correct ? '، إجابة صحيحة' : ''}، ${count(n || 0, 'answer')}` : ''}`}
    >
      <span className="tile__mark" aria-hidden="true">
        <Shape id={option.id} />
        <span className="tile__letter">{letter}</span>
      </span>
      <span className="tile__text">{option.text}</span>
      {revealed && (
        <span className="tile__count">
          {correct && <span className="tile__check" aria-hidden="true">✓</span>}
          <strong>{n || 0}</strong>
          <span className="tile__bar" aria-hidden="true">
            <span style={{ width: `${share}%` }} />
          </span>
        </span>
      )}
    </div>
  );
}
