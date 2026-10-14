// Answer options. Each option has a colour, a letter and a shape, so nothing
// relies on colour alone. Red and green are kept for right/wrong feedback only.
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
  selected: ' (your answer)',
  correct: ' (correct answer)',
  wrong: ' (your answer, not correct)',
  'correct-mine': ' (your answer, correct)',
};

/** Participant answer button. state: idle | selected | other | correct | correct-mine | wrong | dim */
export function OptionButton({ option, state = 'idle', disabled, onSelect, hotkey }) {
  return (
    <button
      type="button"
      className={`opt opt--${option.id.toLowerCase()} is-${state}`}
      disabled={disabled}
      aria-pressed={state === 'selected' || state === 'correct-mine' || state === 'wrong'}
      aria-label={`${option.id}: ${option.text}${STATE_SUFFIX[state] || ''}`}
      onClick={() => onSelect && onSelect(option.id)}
      data-option={option.id}
    >
      <span className="opt__mark" aria-hidden="true">
        <Shape id={option.id} />
        <span className="opt__letter">{option.id}</span>
      </span>
      <span className="opt__text" dir="auto">{option.text}</span>
      {(state === 'correct' || state === 'correct-mine') && <span className="opt__flag" aria-hidden="true">✓</span>}
      {state === 'wrong' && <span className="opt__flag" aria-hidden="true">✕</span>}
      {hotkey && <span className="opt__key" aria-hidden="true">{hotkey}</span>}
    </button>
  );
}

/** Big-screen tile. While open: no hint of the answer. At reveal: correct tile marked, counts shown. */
export function OptionTile({ option, revealed, correct, count, total }) {
  const share = total > 0 ? Math.round((100 * (count || 0)) / total) : 0;
  return (
    <div
      className={`tile tile--${option.id.toLowerCase()} ${revealed ? (correct ? 'is-correct' : 'is-dim') : ''}`}
      aria-label={`${option.id}: ${option.text}${revealed ? `${correct ? ', correct answer' : ''}, ${count || 0} answers` : ''}`}
    >
      <span className="tile__mark" aria-hidden="true">
        <Shape id={option.id} />
      </span>
      <span className="tile__text" dir="auto">{option.text}</span>
      {revealed && (
        <span className="tile__count">
          {correct && <span className="tile__check" aria-hidden="true">✓</span>}
          <strong>{count || 0}</strong>
          <span className="tile__bar" aria-hidden="true">
            <span style={{ width: `${share}%` }} />
          </span>
        </span>
      )}
    </div>
  );
}
