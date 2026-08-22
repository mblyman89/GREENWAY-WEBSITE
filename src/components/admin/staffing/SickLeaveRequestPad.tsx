"use client";

/**
 * src/components/admin/staffing/SickLeaveRequestPad.tsx   (books-35 phase F)
 *
 * THE EMPLOYEE'S HALF OF OPTION 1 — asking for a sick day, at the clock, with
 * a PIN and nothing else.
 *
 * WHY THIS EXISTS AT THE CLOCK RATHER THAN BEHIND A LOGIN
 *
 * Migration 0198 explains the constraint in its own words, and it is worth
 * reading before changing anything here:
 *
 *   "employees.staff_id is nullable 'for floor-only staff who just clock in at
 *    a shared station'. Most of Greenway's employees have no back-office login
 *    at all. If requesting sick leave required is_owner(), or even required a
 *    staff profile, then the people the statute is written to protect would be
 *    structurally unable to ask. The request would have to travel by text
 *    message to Michael, which is precisely the undocumented channel this
 *    migration exists to replace."
 *
 * That is the whole design. A budtender with no email address can ask for a
 * sick day on the same screen they already use twice a day, and the asking is
 * written down.
 *
 * WHY WRITING IT DOWN IS THE POINT
 *
 * RCW 49.46.210 and WAC 296-128-770 make retaliation for USING paid sick leave
 * unlawful, and the employee's remedy does not depend on the employer agreeing
 * that a request was made. A request that arrived as a text message at 6am is
 * a request; it is simply one with no record. When the question is asked two
 * years later — and it is asked precisely when relations have soured — the
 * employer who can produce the request, the decision, the decider and the date
 * is in a completely different position from the one who cannot.
 *
 * WHAT THIS PAD DELIBERATELY DOES NOT DO
 *
 * It does not tell the employee whether the request will be approved. It does
 * not show them their balance and it does not refuse a request the engine
 * would refuse. WAC 296-128-630(1) gives the employee the choice to REQUEST;
 * the answer comes from Michael, with his name on it. A pad that quietly
 * swallowed "you do not have enough hours" would be a denial issued by a
 * machine, with no decision, no decider, and no record of either — which is
 * exactly what option 1 exists to prevent. So everything that could go wrong
 * travels to the inbox and is refused there, by a person, in writing.
 *
 * NO ARITHMETIC HERE, AND NO BALANCE
 *
 * The only numbers this file handles are the preset durations, which are
 * constants in minutes, and they are sent as minutes. Hours never appear as a
 * decimal anywhere in this path.
 */

import { useState, useTransition } from "react";

type SubmitResult = { ok: true; message: string } | { ok: false; message: string };

export type SickLeaveRequestPadProps = {
  readonly submitAction: (input: {
    pin: string;
    leaveDate: string;
    minutes: number;
    purpose: string;
    noticeKind: string;
    employeeNote: string;
  }) => Promise<SubmitResult>;
  /** Today in Pacific, computed on the SERVER and passed in. */
  readonly todayPacific: string;
};

/**
 * THE PURPOSES, IN THE EMPLOYEE'S LANGUAGE.
 *
 * The values are migration 0198's CHECK constraint verbatim; the labels are
 * the plain-English version an employee would recognise at 6am. The mapping is
 * asserted against the migration by
 * tests/compliance/leave-request-pad.test.ts, so a sixth purpose added to the
 * schema cannot ship without wording.
 *
 * "Own health" is first because it is the common case, and the list says what
 * each one covers rather than making the employee guess which box their
 * situation belongs in — guessing wrong is how a qualifying absence gets
 * recorded as something that is not covered.
 */
const PURPOSES: ReadonlyArray<{ value: string; label: string; help: string }> = [
  {
    value: "own_health",
    label: "I am sick, or I have a medical appointment",
    help: "Your own illness, injury, health condition, or preventive care.",
  },
  {
    value: "family_care",
    label: "I am caring for a family member",
    help: "A child, parent, spouse, registered domestic partner, grandparent, grandchild or sibling.",
  },
  {
    value: "closure",
    label: "My workplace or my child's school is closed",
    help: "Closed by order of a public official for a health-related reason.",
  },
  {
    value: "immigration",
    label: "Immigration proceedings",
    help: "Attending an immigration proceeding for yourself or a family member.",
  },
  {
    value: "domestic_violence",
    label: "Domestic violence, sexual assault or stalking",
    help: "For yourself or a family member. You do not have to say any more than this.",
  },
];

/**
 * PRESET DURATIONS IN MINUTES.
 *
 * Presets rather than a free number box, because a text field invites "8" and
 * an employee who means eight HOURS while the field means eight MINUTES has
 * asked for almost nothing and will not find out until Michael reads it.
 */
const DURATIONS: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 480, label: "A full day (8 hours)" },
  { minutes: 240, label: "Half a day (4 hours)" },
  { minutes: 120, label: "2 hours" },
  { minutes: 60, label: "1 hour" },
];

export function SickLeaveRequestPad({ submitAction, todayPacific }: SickLeaveRequestPadProps) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [leaveDate, setLeaveDate] = useState(todayPacific);
  const [minutes, setMinutes] = useState(480);
  const [purpose, setPurpose] = useState("own_health");
  const [noticeKind, setNoticeKind] = useState("unforeseeable");
  const [employeeNote, setEmployeeNote] = useState("");
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setResult(null);
    startTransition(async () => {
      const res = await submitAction({
        pin,
        leaveDate,
        minutes,
        purpose,
        noticeKind,
        employeeNote,
      });
      setResult(res);
      if (res.ok) {
        // The PIN is cleared on success so the next person at a SHARED station
        // cannot submit a request under the previous employee's identity by
        // simply tapping the button again.
        setPin("");
        setEmployeeNote("");
      }
    });
  }

  if (!open) {
    return (
      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-2xl border border-[var(--admin-border)] bg-transparent px-5 py-3 text-sm font-semibold text-white/70 active:scale-95"
        >
          Request a sick day
        </button>
        <p className="mt-2 text-xs text-white/40">
          Asking here puts it in writing. Nothing comes off your balance until it is approved.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
      <h2 className="text-base font-bold text-white">Request a sick day</h2>
      <p className="mt-1 text-xs text-white/50">
        This goes to Michael for a decision. It does not appear on your timesheet, and nothing is
        taken off your balance, until he approves it.
      </p>

      {result ? (
        <div
          className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
            result.ok
              ? "border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 text-[var(--admin-accent)]"
              : "border-red-500/40 bg-red-500/10 text-red-300"
          }`}
        >
          {result.message}
        </div>
      ) : null}

      <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-white/50">
        Your PIN
      </label>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        placeholder="4-6 digits"
        className="mt-1 w-full rounded-xl border border-[var(--admin-border)] bg-transparent px-3 py-3 text-lg text-white"
      />
      <p className="mt-1 text-xs text-white/40">
        The same PIN you clock in with. It is how we know the request is yours.
      </p>

      <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-white/50">
        Which day
      </label>
      <input
        type="date"
        value={leaveDate}
        onChange={(e) => setLeaveDate(e.target.value)}
        className="mt-1 w-full rounded-xl border border-[var(--admin-border)] bg-transparent px-3 py-3 text-white"
      />

      <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-white/50">
        How much time
      </label>
      <div className="mt-1 grid grid-cols-2 gap-2">
        {DURATIONS.map((d) => (
          <button
            key={d.minutes}
            type="button"
            onClick={() => setMinutes(d.minutes)}
            className={`rounded-xl border px-3 py-3 text-sm font-semibold active:scale-95 ${
              minutes === d.minutes
                ? "border-[var(--admin-accent)] bg-[var(--admin-accent)]/10 text-[var(--admin-accent)]"
                : "border-[var(--admin-border)] bg-transparent text-white/70"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-white/50">
        Why
      </label>
      <div className="mt-1 space-y-2">
        {PURPOSES.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => setPurpose(p.value)}
            className={`block w-full rounded-xl border px-3 py-3 text-left active:scale-[0.99] ${
              purpose === p.value
                ? "border-[var(--admin-accent)] bg-[var(--admin-accent)]/10"
                : "border-[var(--admin-border)] bg-transparent"
            }`}
          >
            <span
              className={`block text-sm font-semibold ${
                purpose === p.value ? "text-[var(--admin-accent)]" : "text-white/80"
              }`}
            >
              {p.label}
            </span>
            <span className="mt-0.5 block text-xs text-white/40">{p.help}</span>
          </button>
        ))}
      </div>

      {/*
        WAC 296-128-650(1)(a) allows a ten-day advance notice requirement for
        FORESEEABLE leave; (1)(b) allows only "as soon as possible" for
        UNFORESEEABLE leave. Two different rules, so the record has to know
        which one applied. It defaults to unforeseeable because waking up ill
        is the common case and because it is the answer that asks LESS of the
        employee - defaulting the other way would quietly record every sudden
        illness as late notice.
      */}
      <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-white/50">
        Did you know about this in advance?
      </label>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setNoticeKind("unforeseeable")}
          className={`rounded-xl border px-3 py-3 text-sm font-semibold active:scale-95 ${
            noticeKind === "unforeseeable"
              ? "border-[var(--admin-accent)] bg-[var(--admin-accent)]/10 text-[var(--admin-accent)]"
              : "border-[var(--admin-border)] bg-transparent text-white/70"
          }`}
        >
          No, it came up suddenly
        </button>
        <button
          type="button"
          onClick={() => setNoticeKind("foreseeable")}
          className={`rounded-xl border px-3 py-3 text-sm font-semibold active:scale-95 ${
            noticeKind === "foreseeable"
              ? "border-[var(--admin-accent)] bg-[var(--admin-accent)]/10 text-[var(--admin-accent)]"
              : "border-[var(--admin-border)] bg-transparent text-white/70"
          }`}
        >
          Yes, it was planned
        </button>
      </div>

      <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-white/50">
        Anything you want to add (optional)
      </label>
      <textarea
        rows={2}
        value={employeeNote}
        onChange={(e) => setEmployeeNote(e.target.value)}
        className="mt-1 w-full rounded-xl border border-[var(--admin-border)] bg-transparent px-3 py-2 text-sm text-white"
      />
      {/*
        WAC 296-128-660(4): "Employer-required verification may not result in an
        unreasonable burden or expense on the employee." Nothing on this pad
        asks for a diagnosis, and this note is optional, so the screen cannot
        become an informal way of demanding one.
      */}
      <p className="mt-1 text-xs text-white/40">
        You do not have to say what is wrong with you.
      </p>

      <button
        type="button"
        disabled={pending || pin.length < 4}
        onClick={submit}
        className={`mt-5 w-full rounded-2xl py-4 text-base font-bold transition ${
          pending || pin.length < 4
            ? "cursor-not-allowed bg-white/10 text-white/40"
            : "bg-[var(--admin-accent)] text-black active:scale-[0.98]"
        }`}
      >
        Send this request
      </button>

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="mt-3 w-full rounded-2xl border border-[var(--admin-border)] py-3 text-sm font-semibold text-white/50 active:scale-95"
      >
        Cancel
      </button>
    </div>
  );
}
