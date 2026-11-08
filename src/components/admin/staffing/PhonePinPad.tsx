"use client";

/**
 * PhonePinPad — Slice 70 [item 8]
 *
 * Mobile-first PIN pad for the phone clock-in page. Big touch targets, no
 * keyboard needed. Submits a plain <form> POST to clockByPinPhoneAction so it
 * works even without JS; the on-screen keypad just fills the hidden PIN field.
 */
import { useState } from "react";
import { BREAK_NOTE_MAX, type BreakReason } from "@/lib/staffing/break-clock-core";

export function PhonePinPad({
  action,
  breakOption = false,
}: {
  action: (formData: FormData) => void | Promise<void>;
  /** D211 — show "Lunch" / "Other" so a phone punch can be a break clock-out. */
  breakOption?: boolean;
}) {
  const [pin, setPin] = useState("");
  const [breakReason, setBreakReason] = useState<BreakReason | "">("");
  const [breakNote, setBreakNote] = useState("");
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
  const ready = pin.length >= 4 && (breakReason !== "other" || breakNote.trim().length >= 3);

  return (
    <form action={action} className="mx-auto w-full max-w-xs">
      <input type="hidden" name="pin" value={pin} />
      {breakOption ? (
        <>
          <input type="hidden" name="break_reason" value={breakReason} />
          <input type="hidden" name="break_note" value={breakNote} />
        </>
      ) : null}

      {/* PIN display dots */}
      <div className="mb-6 flex items-center justify-center gap-3">
        {Array.from({ length: max }).map((_, i) => (
          <span
            key={i}
            className={`h-4 w-4 rounded-full border transition ${
              i < pin.length ? "border-[var(--admin-accent)] bg-[var(--admin-accent)]" : "border-white/25 bg-transparent"
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
            ? "bg-[var(--admin-accent)] text-black active:scale-[0.98]"
            : "cursor-not-allowed bg-white/10 text-white/40"
        }`}
      >
        {breakReason ? "Clock out for a break" : "Clock In / Out"}
      </button>
      {breakOption ? (
        <div className="mt-4 rounded-xl border border-[var(--admin-border)] p-3 text-left">
          <p className="mb-2 text-xs text-white/60">Going on a break? (Your drawer stays open. Short paid rests stay on the clock.)</p>
          <div className="grid grid-cols-3 gap-2">
            {(["", "lunch", "other"] as const).map((r) => (
              <button
                key={r || "none"}
                type="button"
                onClick={() => setBreakReason(r)}
                aria-pressed={breakReason === r}
                className={`rounded-lg border px-2 py-2 text-sm font-semibold ${
                  breakReason === r ? "border-[var(--admin-accent)] bg-[var(--admin-accent)]/15 text-white" : "border-[var(--admin-border)] text-white/60"
                }`}
              >
                {r === "" ? "No break" : r === "lunch" ? "Lunch" : "Other"}
              </button>
            ))}
          </div>
          {breakReason === "other" ? (
            <input
              value={breakNote}
              onChange={(e) => setBreakNote(e.target.value)}
              maxLength={BREAK_NOTE_MAX}
              placeholder="Why? (a few words)"
              aria-label="Break note"
              className="mt-2 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm text-white"
            />
          ) : null}
          <p className="mt-2 text-[11px] text-white/40">Back from a break? Choose No break and enter your PIN to clock in.</p>
        </div>
      ) : null}
      <p className="mt-3 text-center text-xs text-white/40">Enter your 4–6 digit PIN, then tap Clock In / Out.</p>
    </form>
  );
}
