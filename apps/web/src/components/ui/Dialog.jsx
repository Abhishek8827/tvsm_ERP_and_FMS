import { useEffect, useId, useRef, useState } from 'react';
import { Button } from './Button';
import { Input } from './Field';
/** Accessible modal: Escape closes, focus moves in, backdrop click closes. */
export function Dialog({ open, title, onClose, children, footer }) {
  const titleId = useId();
  const panelRef = useRef(null);
  // WHY a ref: parents often pass a new onClose function on every render. If the effect depended
  // on it, focus would jump back to the dialog on every keystroke typed inside it.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onCloseRef.current();
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative w-full max-w-md rounded-card bg-surface p-6 shadow-xl"
      >
        <h2 id={titleId} className="text-lg font-semibold text-ink">
          {title}
        </h2>
        <div className="mt-3 text-sm text-ink">{children}</div>
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
/**
 * The inner component holds the typed word and the reason. Because the whole thing unmounts
 * when the dialog closes, the fields always start empty next time, with no effect needed.
 */
export function ConfirmDialog(props) {
  if (!props.open) return null;
  return <ConfirmDialogInner {...props} />;
}

function ConfirmDialogInner({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  loading,
  typeToConfirm,
  requireReason,
  onReasonChange,
  tone = 'primary',
}) {
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const typedOk = !typeToConfirm || typed === typeToConfirm;
  const reasonOk = !requireReason || reason.trim().length >= 3;
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={!typedOk || !reasonOk}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div>{description}</div>
        {requireReason && (
          <Input
            label="Reason (required)"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              onReasonChange?.(e.target.value);
            }}
          />
        )}
        {typeToConfirm && (
          <Input
            label={`Type ${typeToConfirm} to confirm`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
          />
        )}
      </div>
    </Dialog>
  );
}
