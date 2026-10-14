// Small shared pieces.
export function Spinner({ label = 'Loading' }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner__dot" aria-hidden="true" />
      <span className="spinner__label">{label}</span>
    </div>
  );
}

export function Notice({ tone = 'info', children, action }) {
  return (
    <div className={`notice notice--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div className="notice__text">{children}</div>
      {action}
    </div>
  );
}

const CONNECTION_TEXT = {
  live: 'Live',
  polling: 'Live (backup mode)',
  connecting: 'Connecting',
  offline: 'Reconnecting…',
};

export function ConnectionBadge({ connection }) {
  return (
    <span className={`conn conn--${connection}`} role="status" aria-live="polite">
      <span className="conn__dot" aria-hidden="true" />
      {CONNECTION_TEXT[connection] || connection}
    </span>
  );
}

/** The 0–10 recommendation scale: the emblem of this workshop's subject. */
export function NpsScale() {
  const cells = Array.from({ length: 11 }, (_, i) => i);
  return (
    <div className="nps-scale" aria-hidden="true">
      {cells.map((n) => (
        <span key={n} className={`nps-scale__cell ${n <= 6 ? 'is-detractor' : n <= 8 ? 'is-passive' : 'is-promoter'}`}>
          {n}
        </span>
      ))}
    </div>
  );
}

export function VisuallyHidden({ children, live }) {
  return (
    <span className="sr-only" aria-live={live || undefined}>
      {children}
    </span>
  );
}
