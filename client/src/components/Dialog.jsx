import { useEffect, useRef } from 'react';

// A modal built on the native `<dialog>` element, which gives focus trapping, Escape to close and a
// backdrop for free. `children` render only while open, so their state resets every time.
// `labelledBy` is the id of the element that names the dialog.
export function Dialog({ open, onClose, labelledBy, wide = false, children }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className={wide ? 'wide' : undefined}
      aria-labelledby={labelledBy}
      onClose={onClose}
    >
      {open ? children : null}
    </dialog>
  );
}
