import { count, optionLetter } from '../utils/format';

// Answer options: white cards with a coloured badge holding a shape and an
// Arabic letter (أ ب ج د), so nothing relies on colour alone. Ids stay A-D in
// the database. Red and green are kept for right/wrong feedback only.
const SHAPE_PATHS = {
  A: <path d="M12 3 L22 20 H2 Z" />,
  B: <path d="M12 2 L22 12 L12 22 L2 12 Z" />,
  C: <circle cx="12" cy="12" r="9.5" />,
  D: <rect x="3" y="3" width="18" height="18" rx="1.5" />,
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
  correct: ' (الإجابة الصحيحة)',
  wrong: ' (إجابتك، غير صحيحة)',
  'correct-mine': ' (إجابتك، صحيحة)',
};

/** Participant answer button. state: idle | selected | other | correct | correct-mine | wrong | dim */
export function OptionButton({ option, state = 'idle', disabled, onSelect, hotkey }) {
  const letter = optionLetter(option.id);
  return (
    <button
      type="button"
      className={`opt opt--${option.id.toLowerCase()} is-${state}`}
      disabled={disabled}
      aria-pressed={state === 'selected' || state === 'correct-mine' || state === 'wrong'}
      aria-label={`${letter}: ${option.text}${STATE_SUFFIX[state] || ''}`}
      onClick={() => onSelect && onSelect(option.id)}
      data-option={option.id}
    >
      <span className="opt__mark" aria-hidden="true">
        <Shape id={option.id} />
        <span className="opt__letter">{letter}</span>
      </span>
      <span className="opt__text">{option.text}</span>
      {(state === 'correct' || state === 'correct-mine') && <span className="opt__flag" aria-hidden="true">✓</span>}
      {state === 'wrong' && <span className="opt__flag" aria-hidden="true">✕</span>}
      {hotkey && <span className="opt__key" aria-hidden="true">{hotkey}</span>}
    </button>
  );
}

/** Big-screen tile. While open: no hint of the answer. At reveal: correct tile marked, counts shown. */
export function OptionTile({ option, revealed, correct, count: n, total }) {
  const share = total > 0 ? Math.round((100 * (n || 0)) / total) : 0;
  const letter = optionLetter(option.id);
  return (
    <div
      className={`tile tile--${option.id.toLowerCase()} ${revealed ? (correct ? 'is-correct' : 'is-dim') : ''}`}
      aria-label={`${letter}: ${option.text}${revealed ? `${correct ? '، الإجابة الصحيحة' : ''}، ${count(n || 0, 'answer')}` : ''}`}
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
