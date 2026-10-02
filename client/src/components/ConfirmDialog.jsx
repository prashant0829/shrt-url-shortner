import { Dialog } from './Dialog.jsx';

/**
 * Asks before something destructive. Replaces `window.confirm`: it is styled, accessible and testable.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {string} props.title
 * @param {string} props.message
 * @param {string} props.confirmLabel
 * @param {() => void} props.onConfirm
 * @param {() => void} props.onCancel
 */
export function ConfirmDialog({ open, title, message, confirmLabel, onConfirm, onCancel }) {
  return (
    <Dialog open={open} onClose={onCancel} labelledBy="confirm-title">
      <div className="confirm">
        <h2 id="confirm-title">{title}</h2>
        <p className="muted">{message}</p>
        <div className="dialog-actions">
          <button className="btn" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn danger-solid" type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
