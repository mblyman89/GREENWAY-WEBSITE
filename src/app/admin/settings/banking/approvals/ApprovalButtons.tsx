"use client";

/**
 * R41 S0: one small form per decision (approve / reject / withdraw / check
 * off), so every request and review item is decided one at a time and the
 * result comes back in words right next to it. An approved vendor ACH build
 * hands its file to Michael's browser here.
 */
import { useActionState, useEffect, useRef } from "react";
import type { ApprovalState } from "./actions";

type Act = (prev: ApprovalState, fd: FormData) => Promise<ApprovalState>;

const btn: Record<"confirm" | "danger" | "neutral", string> = {
  confirm: "rounded-[var(--admin-radius)] bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-emerald-950 hover:bg-emerald-400 disabled:opacity-50",
  danger: "rounded-[var(--admin-radius)] border border-red-400/40 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50",
  neutral: "rounded-[var(--admin-radius)] border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/[0.06] disabled:opacity-50",
};

export function DecisionForm({
  action,
  idName,
  id,
  label,
  pendingLabel,
  tone,
  notePlaceholder,
  confirmText,
}: {
  action: Act;
  idName: "request_id" | "review_id";
  id: string;
  label: string;
  pendingLabel: string;
  tone: "confirm" | "danger" | "neutral";
  notePlaceholder: string;
  /** Asked in the browser before sending (for Approve). */
  confirmText?: string;
}) {
  const [state, formAction, pending] = useActionState<ApprovalState, FormData>(action, null);
  const downloaded = useRef<string | null>(null);

  useEffect(() => {
    if (!state?.file || !state.filename || downloaded.current === state.filename) return;
    downloaded.current = state.filename;
    const blob = new Blob([state.file], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = state.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [state]);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name={idName} value={id} />
      <div className="flex flex-wrap items-center gap-2">
        <input
          name="note"
          maxLength={1000}
          placeholder={notePlaceholder}
          aria-label={notePlaceholder}
          className="min-w-[12rem] flex-1 rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white placeholder:text-white/30"
        />
        <button type="submit" disabled={pending} className={btn[tone]}>
          {pending ? pendingLabel : label}
        </button>
      </div>
      {state ? (
        <p role="status" className={`text-xs font-semibold ${state.ok ? "text-emerald-300" : "text-red-300"}`}>
          {state.message}
          {state.file && state.filename ? ` (${state.filename})` : ""}
        </p>
      ) : null}
    </form>
  );
}
