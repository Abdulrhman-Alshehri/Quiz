import { useEffect, useRef, useState } from 'react';

// Arabic keyboards give two forms of some letters; compare the typed word loosely.
const normalize = (text) => String(text || '').trim().replace(/ى/g, 'ي').replace(/[أإآ]/g, 'ا');

/** Modal confirmation for anything that changes results. Optionally asks for a typed word. */
export function ConfirmDialog({ open, title, children, confirmLabel, requireText, tone = 'danger', busy, onConfirm, onCancel }) {
  const ref = useRef(null);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setTyped('');
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);

  const ready = !requireText || normalize(typed) === normalize(requireText);
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !busy) onConfirm();
        }}
      >
        <h2 id="dialog-title" className="dialog__title">{title}</h2>
        <div className="dialog__body">{children}</div>
        {requireText && (
          <label className="field">
            <span className="field__label">اكتب «{requireText}» للتأكيد</span>
            <input
              className="input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        )}
        <div className="dialog__actions">
          <button type="button" className="btn btn--quiet" onClick={onCancel} disabled={busy}>
            إلغاء
          </button>
          <button type="submit" className={`btn ${tone === 'danger' ? 'btn--danger' : 'btn--primary'}`} disabled={!ready || busy}>
            {busy ? 'جارٍ التنفيذ…' : confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
