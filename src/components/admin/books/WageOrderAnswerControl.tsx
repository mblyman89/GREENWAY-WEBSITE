"use client";

/**
 * src/components/admin/books/WageOrderAnswerControl.tsx   (books-40c)
 *
 * THE OFF SWITCH FOR THE DEADLINE REMINDERS.
 *
 * WHY THIS EXISTS, VERBATIM (standing rule 1)
 *
 *   "I am not sure the best way to be notified about ending garnishments or
 *    for filing the 20 day notice, etc."
 *
 * The rest of this slice built the notifying. This file is the part that lets
 * the notifying STOP, and it is not an afterthought - it is the reason the
 * notifying is allowed to be as loud as it is.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THERE IS NO DISMISS BUTTON HERE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The watchman escalates to critical every single day, indefinitely, once a
 * support order's twenty-day answer deadline passes. Alarms that aggressive
 * need an off switch or they get filtered into a folder, and a filtered alarm
 * is worse than no alarm because it feels like coverage.
 *
 * The obvious off switch would have been "dismiss". It would also have been
 * the wrong one. Dismissing records that Michael saw a message; it does not
 * record that the duty was discharged. Those are different facts with very
 * different consequences, and only one of them is a defence. So the only way
 * to silence a reminder is to record the fact that makes it unnecessary - the
 * answer was filed on this date, or this kind of order carries no answer duty
 * and here is the written reason.
 *
 * `snoozePathsInAnswerFlow()` in `wage-order-watch-mentor-gates.ts` reads this
 * file and fails the build if a dismiss, snooze, mute or hide-until path ever
 * appears in it. Its companion `snoozeDetectorSelfTest()` proves that check can
 * still detect something, because "found nothing" and "can no longer see
 * anything" are indistinguishable from the outside.
 *
 * Both read CODE, not prose: the paragraphs above deliberately use the words
 * dismiss and snooze, and it would be perverse if explaining the rule tripped
 * the check enforcing it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS COMPONENT DECIDES NOTHING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Whether a draft is recordable is decided by `validateAnswerRecord` in
 * `wage-order-lifecycle-core.ts` - the same pure function the server re-runs.
 * There is not one date comparison and not one order-kind test in the JSX. The
 * browser check exists so nothing is sent that cannot succeed, and the server
 * check exists because a server must never trust a browser; because both call
 * the same function, Michael cannot get one explanation from the form and a
 * different one from the server.
 *
 * `today` is a PROP, taken from the board's Pacific date, not from the
 * browser's clock. A laptop in another timezone - or one left open past
 * midnight - would otherwise disagree with the server about whether a date is
 * in the future.
 *
 * NOTHING HERE IMPORTS THE WRITE STORE. `wage-order-write-store.ts` begins with
 * `import "server-only"` and a client component that reaches it breaks the
 * bundle with `request: node:fs`. The action arrives as a prop.
 */

import { useState } from "react";

import { Badge, Button } from "@/components/admin/ui";
import {
  MIN_ANSWER_WAIVER_REASON_CHARS,
  validateAnswerRecord,
  type AnswerRecordDraft,
} from "@/lib/payroll/wage-order-lifecycle-core";
import { hasAnswerDuty } from "@/lib/payroll/wage-order-watch-core";
import { ANSWER_REFUSAL_LESSONS } from "@/lib/payroll/wage-order-watch-mentor";
import type { WageOrderKind } from "@/lib/payroll/garnishment-core";

/**
 * The server action's answer, described structurally.
 *
 * NOT imported as a type from the write store: importing anything from a
 * `server-only` module - even a type - puts it in this file's import graph, and
 * the purity gate walks the graph rather than reasoning about type erasure.
 * These fields mirror `WageOrderWriteResult` exactly, and the page checks the
 * two agree at the call site.
 */
export type AnswerWriteResult =
  | { readonly ok: true; readonly orderId: string; readonly message: string; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly code: string; readonly message: string };

export type RecordAnswerAction = (input: {
  orderId: string;
  draft: AnswerRecordDraft;
}) => Promise<AnswerWriteResult>;

export type WageOrderAnswerControlProps = {
  readonly orderId: string;
  readonly caseNumber: string;
  readonly employeeName: string;
  /**
   * The order kind, already normalised by the store into a value the engine
   * recognises. Passed straight to the core, never compared in this file.
   */
  readonly orderKind: WageOrderKind;
  /** ISO date of service, or null if it was never recorded. */
  readonly servedDate: string | null;
  /** Already recorded? Then this renders as a settled fact, not a form. */
  readonly answerFiledAt: string | null;
  readonly answerNotRequired: boolean;
  /** The board's Pacific date. NOT the browser's clock - see the header. */
  readonly today: string;
  readonly onRecord: RecordAnswerAction;
};

/** The lesson for a refusal code, or null if the code is unrecognised. */
function lessonForCode(code: string) {
  return ANSWER_REFUSAL_LESSONS.find((l) => l.code === code) ?? null;
}

export function WageOrderAnswerControl({
  orderId,
  caseNumber,
  employeeName,
  orderKind,
  servedDate,
  answerFiledAt,
  answerNotRequired,
  today,
  onRecord,
}: WageOrderAnswerControlProps) {
  const [open, setOpen] = useState(false);
  const [filedAt, setFiledAt] = useState("");
  const [note, setNote] = useState("");
  const [notRequired, setNotRequired] = useState(false);
  const [waivedReason, setWaivedReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AnswerWriteResult | null>(null);

  /* ── NO DUTY, NO FORM ────────────────────────────────────────────────────
     A federal or state tax levy carries no chapter 26.18 or chapter 6.27 duty
     to answer, so there is nothing here to record and offering the form would
     invite somebody to record a fact that does not exist.

     THE DECISION IS NOT MADE HERE. `hasAnswerDuty()` in the watch core owns
     it, and it is the same function the reminder engine consults, so a screen
     that offers the form and a cron that sends reminders can never disagree
     about which orders have a duty. The cast is safe in the only direction
     that matters: a kind the engine could not classify has already been
     normalised by the store to the conservative placeholder, so it is watched
     rather than dropped. */
  if (!hasAnswerDuty(orderKind)) {
    return null;
  }

  /* ── ALREADY SETTLED ─────────────────────────────────────────────────────
     Shown as a recorded fact rather than a form. There is deliberately no
     "edit" here: an answer date is a record of something that physically
     happened, and the way to correct a wrong one is to say so on the order's
     notes rather than to quietly overwrite the only date on file. */
  if (answerFiledAt !== null) {
    return (
      <div className="mt-3 rounded-[var(--admin-radius-sm)] bg-[var(--admin-surface-2)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="green">Answer filed</Badge>
          <span className="text-xs text-[var(--admin-text-muted)]">
            Recorded as filed on {answerFiledAt}. No answer reminders will be sent for this order.
          </span>
        </div>
      </div>
    );
  }

  if (answerNotRequired) {
    return (
      <div className="mt-3 rounded-[var(--admin-radius-sm)] bg-[var(--admin-surface-2)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">No answer required</Badge>
          <span className="text-xs text-[var(--admin-text-muted)]">
            Marked as carrying no Washington answer duty, with the reason on the record. Answer
            reminders are off for this order. Any expiry warnings still apply.
          </span>
        </div>
      </div>
    );
  }

  /* ── THE DRAFT, JUDGED BY THE CORE ───────────────────────────────────────
     One call. Every rule about dates, exemptions and support orders lives on
     the other side of it, and the server runs the identical function. */
  const draft: AnswerRecordDraft = {
    filedAt: filedAt.trim() || null,
    note: note.trim() || null,
    notRequired,
    waivedReason: waivedReason.trim() || null,
  };
  const check = validateAnswerRecord(draft, orderKind, servedDate, today);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      // Checked here as well as on the server, so nothing is sent that cannot
      // succeed - and the sentence shown is the same sentence the server would
      // have returned, because both come from the same core function.
      if (!check.ok) {
        setResult({ ok: false, code: check.refusal.code, message: check.refusal.message });
        return;
      }
      const res = await onRecord({ orderId, draft });
      setResult(res);
      if (res.ok) {
        setOpen(false);
        setFiledAt("");
        setNote("");
        setNotRequired(false);
        setWaivedReason("");
      }
    } catch {
      /*
       * The action is written never to throw. If one arrives anyway it is a
       * network or deployment fault, and the honest thing to say is that the
       * outcome is UNKNOWN - not that it failed. Guessing "failed" invites a
       * second attempt, and here that is the cheap direction: worst case the
       * same true date is written twice. But it is still a guess, so it is not
       * made.
       */
      setResult({
        ok: false,
        code: "WRITE_FAILED",
        message:
          "The record could not be sent to the server, so it is NOT known whether it went " +
          "through. Reload the garnishments page and look at whether the answer date is showing " +
          "before entering it again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      {!open ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="confirm" onClick={() => setOpen(true)}>
            Record the answer
          </Button>
          <span className="text-xs text-[var(--admin-text-faint)]">
            This is the only thing that stops the answer reminders. There is no dismiss.
          </span>
        </div>
      ) : (
        <div className="rounded-[var(--admin-radius-sm)] bg-[var(--admin-surface-2)] p-3">
          <p className="text-sm font-semibold text-[var(--admin-text)]">
            Record the employer answer
          </p>
          <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
            {employeeName} &middot; case {caseNumber}
          </p>

          {/* ── THE DATE ──────────────────────────────────────────────────── */}
          <div className="mt-3">
            <label
              htmlFor={`answer-date-${orderId}`}
              className="text-xs font-semibold text-[var(--admin-text)]"
            >
              What date did the answer leave Greenway?
            </label>
            <input
              id={`answer-date-${orderId}`}
              type="date"
              value={filedAt}
              disabled={notRequired}
              onChange={(e) => setFiledAt(e.target.value)}
              className="admin-focus mt-1 w-full rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-2 text-sm text-[var(--admin-text)] disabled:opacity-50"
            />
            <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
              The date it was actually posted, faxed or submitted &mdash; not today&rsquo;s date, and
              not the date you finished writing it. This is the date you would quote if the
              registry ever asks.
            </p>
          </div>

          {/* ── THE NOTE ──────────────────────────────────────────────────── */}
          <div className="mt-3">
            <label
              htmlFor={`answer-note-${orderId}`}
              className="text-xs font-semibold text-[var(--admin-text)]"
            >
              How it went out (optional, but write one)
            </label>
            <textarea
              id={`answer-note-${orderId}`}
              value={note}
              rows={2}
              onChange={(e) => setNote(e.target.value)}
              placeholder="employer answer, certified mail 7020 1810 0001 2345 6789, receipt in payroll binder"
              className="admin-focus mt-1 w-full rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-2 text-sm text-[var(--admin-text)]"
            />
            <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
              The date here is a record of what you did. It is not evidence that you did it &mdash;
              the receipt is. Writing down where the receipt lives is how you find it in two
              years.
            </p>
          </div>

          {/* ── THE EXEMPTION ─────────────────────────────────────────────── */}
          <div className="mt-3 rounded-[var(--admin-radius-sm)] bg-[var(--admin-surface)] p-3">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={notRequired}
                onChange={(e) => setNotRequired(e.target.checked)}
                className="admin-focus mt-0.5"
              />
              <span className="text-xs text-[var(--admin-text)]">
                <span className="font-semibold">This order needs no Washington answer.</span> Tick
                this only for orders with no duty to answer under chapter 26.18 or chapter 6.27
                RCW &mdash; an IRS levy, for example, which is satisfied by returning the exemption
                certificate. It is refused outright on support orders.
              </span>
            </label>

            {notRequired ? (
              <div className="mt-3">
                <label
                  htmlFor={`answer-waiver-${orderId}`}
                  className="text-xs font-semibold text-[var(--admin-text)]"
                >
                  Why does this order carry no answer duty?
                </label>
                <textarea
                  id={`answer-waiver-${orderId}`}
                  value={waivedReason}
                  rows={2}
                  onChange={(e) => setWaivedReason(e.target.value)}
                  placeholder="IRS Form 668-W levy: satisfied by returning the exemption certificate, no ch. 26.18 answer duty"
                  className="admin-focus mt-1 w-full rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-2 text-sm text-[var(--admin-text)]"
                />
                <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                  At least {MIN_ANSWER_WAIVER_REASON_CHARS} characters, and it goes on the
                  permanent record. If you cannot write the sentence, you do not yet know the
                  exemption is correct &mdash; and the safe move is to answer the order.
                </p>
              </div>
            ) : null}
          </div>

          {/* ── WHY THE BUTTON IS OFF ─────────────────────────────────────── */}
          {!check.ok ? (
            <div className="mt-3 rounded-[var(--admin-radius-sm)] bg-[var(--admin-orange-soft)] p-3">
              <p className="text-xs text-[var(--admin-orange)]">{check.refusal.message}</p>
              <p className="mt-1 text-xs text-[var(--admin-text-muted)]">{check.refusal.fix}</p>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="confirm"
              disabled={busy || !check.ok}
              onClick={() => void run()}
            >
              {busy ? "Working\u2026" : "Record it"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="neutral"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setResult(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* ── THE ANSWER FROM THE SERVER ────────────────────────────────────
          Rendered verbatim. It is written for Michael and it is more specific
          than anything this component could say - it names the case number on
          success and the rule on a refusal. */}
      {result ? (
        <div
          className={`mt-3 rounded-[var(--admin-radius-sm)] border p-3 ${
            result.ok
              ? "border-[var(--admin-accent)]/50 bg-[var(--admin-surface-2)]"
              : "border-[var(--admin-danger)]/50 bg-[var(--admin-surface-2)]"
          }`}
        >
          <p
            className={`text-sm ${
              result.ok ? "text-[var(--admin-text)]" : "text-[var(--admin-danger)]"
            }`}
          >
            {result.message}
          </p>

          {result.ok
            ? result.warnings.map((w) => (
                <p key={w} className="mt-1 text-xs text-[var(--admin-orange)]">
                  {w}
                </p>
              ))
            : (() => {
                // WHAT TO DO NEXT, for the code that actually came back. A
                // refusal without a next step is a dead end, and a dead end is
                // where people start clicking the same button repeatedly.
                const lesson = lessonForCode(result.code);
                return lesson ? (
                  <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                    <span className="font-semibold">What to do: </span>
                    {lesson.whatToDo}
                  </p>
                ) : null;
              })()}
        </div>
      ) : null}
    </div>
  );
}
