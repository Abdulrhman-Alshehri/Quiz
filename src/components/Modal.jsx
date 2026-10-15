import { useEffect, useRef } from 'react';

/**
 * A modal dialog for forms. Its content is mounted only while it is open, so a
 * form inside always starts from the values it is given. Escape closes it
 * unless something is being saved.
 */
export function Modal({ open, labelledBy, onClose, busy, wide = false, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`dialog${wide ? ' dialog--wide' : ''}`}
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      {open ? children : null}
    </dialog>
  );
}
