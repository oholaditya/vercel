import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';

interface Toast {
  id: number;
  kind: 'success' | 'error';
  message: string;
}

const Ctx = createContext<{ notify: (kind: Toast['kind'], message: string) => void } | null>(null);
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));

  const notify = useCallback((kind: Toast['kind'], message: string) => {
    const id = ++seq;
    setToasts((t) => [...t.slice(-3), { id, kind, message }]);
    setTimeout(() => dismiss(id), kind === 'error' ? 6000 : 3000);
  }, []);

  return (
    <Ctx.Provider value={{ notify }}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(92vw,360px)] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start gap-3 rounded-lg border bg-surface px-3.5 py-3 text-sm shadow-card ${
              t.kind === 'error' ? 'border-crit/40' : 'border-ok/30'
            }`}
          >
            {t.kind === 'error' ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-crit" />
            ) : (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" />
            )}
            <span className="flex-1 text-fg">{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="text-fg-3 hover:text-fg" aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToast outside ToastProvider');
  return c.notify;
}
