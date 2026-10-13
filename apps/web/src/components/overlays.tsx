import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import './overlays.css';

/* ------------------------------------------------------------ Dialog */

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  icon?: IconName;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md';
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Modal dialog. Traps focus, restores it on close, closes on Escape or backdrop, and becomes a bottom sheet on phones. */
export function Dialog({ open, onClose, title, description, icon, children, footer, size = 'md' }: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const restore = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restore.current = document.activeElement as HTMLElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => {
      const first = panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
      if (event.key === 'Tab' && panel.current) {
        const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.offsetParent !== null);
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items.at(-1)!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      restore.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="dialog" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={panel}
        className={`dialog__panel dialog__panel--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <header className="dialog__header">
          {icon ? (
            <span className="dialog__icon">
              <Icon name={icon} size={20} />
            </span>
          ) : null}
          <div className="dialog__heading">
            <h2 className="dialog__title" id={titleId}>
              {title}
            </h2>
            {description ? (
              <p className="dialog__description" id={descriptionId}>
                {description}
              </p>
            ) : null}
          </div>
          <Button variant="ghost" size="sm" icon="close" iconOnlyLabel="Close dialog" onClick={onClose} />
        </header>
        <div className="dialog__body">{children}</div>
        {footer ? <footer className="dialog__footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------ Toasts */

export interface ToastInput {
  title: string;
  detail?: string;
  tone?: 'info' | 'success' | 'warning' | 'critical';
  icon?: IconName;
}

interface ToastItem extends ToastInput {
  id: number;
}

const ToastContext = createContext<(toast: ToastInput) => void>(() => undefined);

export function useToast(): (toast: ToastInput) => void {
  return useContext(ToastContext);
}

const TONE_ICON: Record<NonNullable<ToastInput['tone']>, IconName> = { info: 'info', success: 'success', warning: 'warning', critical: 'critical' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);
  const push = useCallback(
    (toast: ToastInput) => {
      counter.current += 1;
      const id = counter.current;
      setItems((current) => [...current.slice(-3), { ...toast, id }]);
      window.setTimeout(() => dismiss(id), toast.tone === 'critical' ? 8000 : 5200);
    },
    [dismiss],
  );
  return (
    <ToastContext.Provider value={push}>
      {children}
      {createPortal(
        <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
          {items.map((item) => (
            <div key={item.id} className={`toast toast--${item.tone ?? 'info'}`} role="status">
              <span className="toast__icon">
                <Icon name={item.icon ?? TONE_ICON[item.tone ?? 'info']} size={18} />
              </span>
              <div className="toast__text">
                <p className="toast__title">{item.title}</p>
                {item.detail ? <p className="toast__detail">{item.detail}</p> : null}
              </div>
              <button type="button" className="toast__close" aria-label="Dismiss notification" onClick={() => dismiss(item.id)}>
                <Icon name="close" size={16} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

/* ------------------------------------------------------------ Confirm */

interface ConfirmProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({ open, title, description, confirmLabel, tone = 'primary', pending, onConfirm, onClose }: ConfirmProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      icon={tone === 'danger' ? 'warning' : 'info'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={pending} onClick={onConfirm} data-autofocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="dialog__text">{description}</p>
    </Dialog>
  );
}
