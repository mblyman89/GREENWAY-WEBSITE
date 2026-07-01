"use client";

/**
 * PhonePinPad — Slice 70 [item 8]
 *
 * Mobile-first PIN pad for the phone clock-in page. Big touch targets, no
 * keyboard needed. Submits a plain <form> POST to clockByPinPhoneAction so it
 * works even without JS; the on-screen keypad just fills the hidden PIN field.
 */
import { useState } from "react";

export function PhonePinPad({ action }: { action: (formData: FormData) => void | Promise<void> }) {
  const [pin, setPin] = useState("");
  const max = 6;

  function push(d: string) {
    setPin((p) => (p.length >= max ? p : p + d));
  }
  function backspace() {
    setPin((p) => p.slice(0, -1));
  }
  function clearAll() {
    setPin("");
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
  const ready = pin.length >= 4;

  return (
    <form action={action} className="mx-auto w-full max-w-xs">
      <input type="hidden" name="pin" value={pin} />

      {/* PIN display dots */}
      <div className="mb-6 flex items-center justify-center gap-3">
        {Array.from({ length: max }).map((_, i) => (
          <span
            key={i}
            className={`h-4 w-4 rounded-full border transition ${
              i < pin.length ? "border-[#7ed957] bg-[#7ed957]" : "border-white/25 bg-transparent"
            }`}
          />
        ))}
      </div>

      {/* Keypad */}
      <div className="grid grid-cols-3 gap-3">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => push(k)}
            className="admin-card-interactive rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] py-5 text-2xl font-semibold text-white active:scale-95"
          >
            {k}
          </button>
        ))}
        <button
          type="button"
          onClick={clearAll}
          className="rounded-2xl border border-[var(--admin-border)] bg-transparent py-5 text-sm font-semibold text-white/60 active:scale-95"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => push("0")}
          className="admin-card-interactive rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] py-5 text-2xl font-semibold text-white active:scale-95"
        >
          0
        </button>
        <button
          type="button"
          onClick={backspace}
          className="rounded-2xl border border-[var(--admin-border)] bg-transparent py-5 text-xl font-semibold text-white/60 active:scale-95"
          aria-label="Backspace"
        >
          ⌫
        </button>
      </div>

      <button
        type="submit"
        disabled={!ready}
        className={`mt-6 w-full rounded-2xl py-4 text-lg font-bold transition ${
          ready
            ? "bg-[#7ed957] text-black active:scale-[0.98]"
            : "cursor-not-allowed bg-white/10 text-white/40"
        }`}
      >
        Clock In / Out
      </button>
      <p className="mt-3 text-center text-xs text-white/40">Enter your 4–6 digit PIN, then tap Clock In / Out.</p>
    </form>
  );
}
