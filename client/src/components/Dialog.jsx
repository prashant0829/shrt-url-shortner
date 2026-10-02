import { useEffect, useRef } from 'react';

/**
 * A modal built on the native `<dialog>` element, which gives focus trapping, Escape to close and
 * a backdrop for free. `children` are only rendered while open, so their state resets every time.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose Called when the dialog closes (Escape, or a programmatic close).
 * @param {string} props.labelledBy id of the element that names the dialog.
 * @param {boolean} [props.wide]
 */
export function Dialog({ open, onClose, labelledBy, wide = false, children }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={wide ? 'wide' : undefined}
      aria-labelledby={labelledBy}
      onClose={onClose}
    >
      {open ? children : null}
    </dialog>
  );
}
