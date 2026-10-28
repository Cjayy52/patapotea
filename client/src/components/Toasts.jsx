import { useToast } from '../context/ToastContext.jsx';

export function Toasts() {
  const { toasts, dismiss } = useToast();
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          <span className="bar" />
          <span className="msg">{t.message}</span>
          <button type="button" className="x" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">×</button>
        </div>
      ))}
    </div>
  );
}
