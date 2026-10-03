import { Dialog } from './Dialog.jsx';

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
