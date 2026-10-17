import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Input } from './Field';

export interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/** Accessible modal: Escape closes, focus moves in, backdrop click closes. */
export function Dialog({ open, title, onClose, children, footer }: DialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

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

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  /** Destructive/legal actions (TC no-dues override, rule 13): the user must type this word. */
  typeToConfirm?: string;
  /** When true the user must also enter a reason (overrides, cancellations, reductions). */
  requireReason?: boolean;
  onReasonChange?: (reason: string) => void;
  tone?: 'primary' | 'danger';
}

export function ConfirmDialog({
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
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) {
      setTyped('');
      setReason('');
    }
  }, [open]);

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
