import { createContext, useCallback, useContext, useMemo, useState } from 'react';
const ToastContext = createContext(null);
const toneClass = {
  success: 'border-success/40 bg-success/10 text-success',
  error: 'border-danger/40 bg-danger/10 text-danger',
  info: 'border-info/40 bg-info/10 text-info',
};
/**
 * Toasts report the real outcome of a real action (success after the API confirms, error with
 * the server's human-readable message). Never used as a placeholder for unbuilt features.
 */
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const notify = useCallback((message, tone = 'info') => {
    const id = Date.now() + Math.random();
    setItems((cur) => [...cur, { id, tone, message }]);
    window.setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), 5000);
  }, []);
  const api = useMemo(() => ({ notify }), [notify]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`rounded-lg border px-4 py-3 text-sm ${toneClass[t.tone]}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
