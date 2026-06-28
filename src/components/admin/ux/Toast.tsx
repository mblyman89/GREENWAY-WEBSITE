"use client";

/**
 * Toast + useToast — lightweight success/error feedback after actions.
 *
 * Wrap the admin shell in <ToastProvider>. Anywhere inside, call:
 *   const { toast } = useToast();
 *   toast({ tone: "success", message: "Saved." });
 *
 * Toasts auto-dismiss; multiple stack bottom-right. No external deps.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

type Tone = "success" | "error" | "info" | "warning";

type ToastItem = {
  id: number;
  tone: Tone;
  message: string;
  duration: number;
};

type ToastInput = {
  tone?: Tone;
  message: string;
  duration?: number;
};

type ToastContextValue = {
  toast: (input: ToastInput) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_STYLES: Record<Tone, string> = {
  success: "border-[#7ed957]/40 bg-[#0f1a10] text-[#7ed957]",
  error: "border-red-500/40 bg-[#1a0f0f] text-red-300",
  info: "border-white/20 bg-[#161616] text-white/80",
  warning: "border-[#ffd700]/40 bg-[#1a170f] text-[#ffd700]",
};

const TONE_ICON: Record<Tone, string> = {
  success: "✓",
  error: "⚠",
  info: "ℹ",
  warning: "!",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((input: ToastInput) => {
    const id = nextId.current++;
    const item: ToastItem = {
      id,
      tone: input.tone ?? "info",
      message: input.message,
      duration: input.duration ?? 4000,
    };
    setItems((prev) => [...prev, item]);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
        {items.map((t) => (
          <ToastCard key={t.id} item={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(item.id), item.duration);
    return () => clearTimeout(timer);
  }, [item, onDismiss]);

  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-xl shadow-black/40 ${TONE_STYLES[item.tone]}`}
    >
      <span className="mt-0.5 text-base leading-none" aria-hidden="true">
        {TONE_ICON[item.tone]}
      </span>
      <span className="flex-1">{item.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        aria-label="Dismiss"
        className="text-white/40 transition hover:text-white/80"
      >
        ✕
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fail soft: if used outside a provider, no-op rather than crash.
    return { toast: () => undefined };
  }
  return ctx;
}
