"use client";

/**
 * ConfirmDialog — a friendly, accessible confirmation modal for actions that
 * are destructive or hard to undo (delete, archive, publish-to-live, etc.).
 *
 * Design principle: "never a scary screen." We always explain the consequence
 * in plain language and offer an obvious way out. For high-risk actions you can
 * require the user to type a confirmation word so they can't fat-finger it.
 *
 * Usage:
 *   const [open, setOpen] = useState(false);
 *   <button onClick={() => setOpen(true)}>Delete</button>
 *   <ConfirmDialog
 *     open={open}
 *     title="Delete this draft?"
 *     description="This permanently removes the draft. Published content is not affected."
 *     confirmLabel="Delete draft"
 *     tone="danger"
 *     onConfirm={async () => { await doDelete(); }}
 *     onCancel={() => setOpen(false)}
 *   />
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

type Tone = "danger" | "warning" | "primary";

const TONE_BUTTON: Record<Tone, string> = {
  danger: "bg-red-500/90 text-white hover:bg-red-500",
  warning: "bg-[#ffd700] text-black hover:bg-[#ffe23f]",
  primary: "bg-[#7ed957] text-black hover:bg-[#94e570]",
};

const TONE_ICON: Record<Tone, string> = {
  danger: "🗑️",
  warning: "⚠️",
  primary: "✅",
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "primary",
  requireTextToConfirm,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: Tone;
  /** If set, the user must type this exact word to enable the confirm button. */
  requireTextToConfirm?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const titleId = useId();
  const descId = useId();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Reset typed text + focus the safest action whenever the dialog opens.
  useEffect(() => {
    if (open) {
      setTyped("");
      setBusy(false);
      // Focus confirm only if no typed gate; otherwise let the input get focus.
      if (!requireTextToConfirm) {
        const t = setTimeout(() => confirmRef.current?.focus(), 30);
        return () => clearTimeout(t);
      }
    }
  }, [open, requireTextToConfirm]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const gateOk =
    !requireTextToConfirm ||
    typed.trim().toLowerCase() === requireTextToConfirm.trim().toLowerCase();

  async function handleConfirm() {
    if (!gateOk || busy) return;
    try {
      setBusy(true);
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => !busy && onCancel()}
      />
      {/* Card */}
      <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#0a0a0a] p-6 shadow-2xl shadow-black/60">
        <div className="flex items-start gap-3">
          <span className="text-2xl leading-none" aria-hidden>
            {TONE_ICON[tone]}
          </span>
          <div className="flex-1">
            <h2 id={titleId} className="text-lg font-semibold text-white">
              {title}
            </h2>
            {description && (
              <p
                id={descId}
                className="mt-2 text-sm leading-relaxed text-white/70"
              >
                {description}
              </p>
            )}
          </div>
        </div>

        {children && <div className="mt-4">{children}</div>}

        {requireTextToConfirm && (
          <label className="mt-4 block">
            <span className="text-xs text-white/60">
              Type{" "}
              <span className="font-mono font-semibold text-white">
                {requireTextToConfirm}
              </span>{" "}
              to confirm
            </span>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && gateOk) handleConfirm();
              }}
              className="mt-1 w-full rounded-lg border border-white/15 bg-[#161616] px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]/60"
              placeholder={requireTextToConfirm}
            />
          </label>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/5 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={handleConfirm}
            disabled={!gateOk || busy}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${TONE_BUTTON[tone]}`}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
