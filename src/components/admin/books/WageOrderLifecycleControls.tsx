"use client";

/**
 * src/components/admin/books/WageOrderLifecycleControls.tsx   (books-40b)
 *
 * THE THREE BUTTONS THAT WERE MISSING.
 *
 * WHY THIS EXISTS, VERBATIM (standing rule 1)
 *
 *   "Let's finish the garnishments and child support feature now"
 *
 * The books-38 gap report found three complete, tested, guarded server actions
 * with no caller anywhere in the application, and said so plainly:
 *
 *   "They are correct, they are guarded, they are covered by tests - and there
 *    is no way to click them. So today you can enter an order and you cannot
 *    mark one finished."
 *
 * The books-40 report printed the count as a table: `createWageOrderAction` 2,
 * and 0 for each of the other three. This component is what makes those three
 * numbers non-zero. `lifecycleActionCallCounts()` in
 * `wage-order-lifecycle-mentor-gates.ts` re-derives that table from source, and
 * the owner report quotes it rather than asserting it.
 *
 * WHY A CONFIRMATION STEP RATHER THAN A ONE-CLICK BUTTON
 *
 * Ending a wage order cannot be undone through this screen, and the cost of
 * doing it wrongly falls on real people in both directions - the employee whose
 * pay keeps being taken, or the child whose support stops. A single click on a
 * red button next to a list of similar-looking rows is how the wrong order gets
 * ended. So every action opens a panel that says what will happen, whether it
 * can be undone, and the one thing worth checking first, all of which comes
 * from `wage-order-lifecycle-core.ts` rather than being written into the JSX.
 *
 * THIS COMPONENT DECIDES NOTHING
 *
 * It does not decide which buttons are lawful - `lifecycleOptionsFor(status)`
 * does. There is deliberately not a single `status === "active"` comparison in
 * the rendering code, and `controlDelegatesToCore()` in the gates module fails
 * the build if one appears. Nor is hiding a button a control: the server guards
 * every transition against the CURRENT database status, so a stale page whose
 * order was ended in another tab gets a refusal with an explanation instead of
 * a silent overwrite.
 *
 * NOTHING HERE IMPORTS THE WRITE STORE
 *
 * `wage-order-write-store.ts` begins with `import "server-only"`, and a client
 * component that reaches it breaks the bundle - see
 * `tests/compliance/client-bundle-purity.test.ts` and the deployments that died
 * on `request: node:fs`. The actions arrive as props from the server component,
 * and the shared five-character rule comes from the pure core module.
 */

import { useState } from "react";

import { Badge, Button } from "@/components/admin/ui";
import {
  LIFECYCLE_REFUSAL_LESSONS,
  type LifecycleRefusalLesson,
} from "@/lib/payroll/wage-order-lifecycle-mentor";
import {
  lifecycleOptionsFor,
  noActionsExplanation,
  readLifecycleStatus,
  validateTerminationReason,
  type LifecycleActionKey,
  type LifecycleOption,
} from "@/lib/payroll/wage-order-lifecycle-core";

/**
 * The shape of a server action's answer, described structurally.
 *
 * NOT imported as a type from the write store, because importing anything from
 * a `server-only` module - even a type - puts it in this file's import graph,
 * and the purity gate walks the graph rather than reasoning about erasure.
 * These fields mirror `WageOrderWriteResult` exactly; the page passes the real
 * actions in and TypeScript checks the two agree at that call site.
 */
export type LifecycleWriteResult =
  | { readonly ok: true; readonly orderId: string; readonly message: string; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly code: string; readonly message: string };

export type WageOrderLifecycleActions = {
  readonly onTerminate: (input: { orderId: string; reason: string }) => Promise<LifecycleWriteResult>;
  readonly onSuspend: (input: { orderId: string; note: string | null }) => Promise<LifecycleWriteResult>;
  readonly onResume: (input: { orderId: string }) => Promise<LifecycleWriteResult>;
};

export type WageOrderLifecycleControlsProps = {
  readonly orderId: string;
  /** The raw status string from the database. Read, never trusted blindly. */
  readonly status: string;
  /** Shown in the confirmation panel so the wrong row cannot be ended quietly. */
  readonly caseNumber: string;
  readonly employeeName: string;
  readonly actions: WageOrderLifecycleActions;
};

/** The lesson for a refusal code, or null if the code is unrecognised. */
function lessonForCode(code: string): LifecycleRefusalLesson | null {
  return LIFECYCLE_REFUSAL_LESSONS.find((l) => l.code === code) ?? null;
}

export function WageOrderLifecycleControls({
  orderId,
  status,
  caseNumber,
  employeeName,
  actions,
}: WageOrderLifecycleControlsProps) {
  /** Which confirmation panel is open, if any. */
  const [open, setOpen] = useState<LifecycleActionKey | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LifecycleWriteResult | null>(null);

  // THE DECISION IS NOT MADE HERE. The core owns it; this reads the answer.
  const parsed = readLifecycleStatus(status);
  const options = lifecycleOptionsFor(parsed);
  const noneBecause = noActionsExplanation(parsed);

  /** The browser-side check on the reason, so nothing is sent that cannot succeed. */
  const reasonCheck = validateTerminationReason(reason);

  function close() {
    setOpen(null);
    setReason("");
    setNote("");
  }

  async function run(key: LifecycleActionKey) {
    setBusy(true);
    setResult(null);
    try {
      let res: LifecycleWriteResult;
      if (key === "end") {
        // Checked again here rather than only disabling the button, because a
        // disabled button is a hint and this is the thing the database will
        // refuse. The refusal it produces is the same sentence the server
        // would have sent, so Michael never sees two different explanations
        // for one rule.
        if (!reasonCheck.ok) {
          setResult({
            ok: false,
            code: reasonCheck.refusal.code,
            message: reasonCheck.refusal.message,
          });
          return;
        }
        res = await actions.onTerminate({ orderId, reason: reasonCheck.reason });
      } else if (key === "pause") {
        res = await actions.onSuspend({ orderId, note: note.trim() || null });
      } else {
        res = await actions.onResume({ orderId });
      }
      setResult(res);
      if (res.ok) close();
    } catch {
      /*
       * The actions are written never to throw. If one arrives anyway it is a
       * network or deployment fault, and the honest thing to say is that the
       * outcome is UNKNOWN.
       *
       * "It failed" would be a guess, and the wrong guess in the expensive
       * direction: it invites a second click, and a second click that succeeds
       * on an order somebody else already changed overwrites their reason. So
       * this says reload and look, which is the only safe instruction when you
       * genuinely do not know what happened.
       */
      setResult({
        ok: false,
        code: "WRITE_FAILED",
        message:
          "The change could not be sent to the server, so it is NOT known whether it went " +
          "through. Do not click again yet - reload the garnishments page and look at where " +
          "this order actually stands first.",
      });
    } finally {
      setBusy(false);
    }
  }

  /* ── Nothing can be done to this order, and the screen says why ───────── */
  if (options.length === 0) {
    return (
      <div className="mt-3 rounded-[var(--admin-radius-sm)] bg-[var(--admin-surface-2)] p-3">
        <p className="text-xs text-[var(--admin-text-muted)]">
          {noneBecause ??
            "No action is available for this order."}
        </p>
      </div>
    );
  }

  const openOption: LifecycleOption | null =
    open === null ? null : (options.find((o) => o.key === open) ?? null);

  return (
    <div className="mt-4 border-t border-[var(--admin-border)] pt-3">
      {/* ── THE BUTTONS ──────────────────────────────────────────────────
          Rendered from the core's list, in the core's order: the reversible
          option first, the irreversible one last, so the red button is never
          the one nearest the thumb. */}
      <div className="flex flex-wrap items-center gap-2">
        {options.map((o) => (
          <Button
            key={o.key}
            type="button"
            size="sm"
            variant={o.variant}
            disabled={busy}
            onClick={() => {
              setResult(null);
              setOpen(open === o.key ? null : o.key);
            }}
          >
            {o.label}
          </Button>
        ))}
        {!openOption ? (
          <span className="text-xs text-[var(--admin-text-faint)]">
            Nothing changes until you confirm on the next step.
          </span>
        ) : null}
      </div>

      {/* ── THE CONFIRMATION PANEL ───────────────────────────────────────
          Every sentence in here comes from the core module, so the warning a
          person reads and the rule the system enforces cannot drift apart. */}
      {openOption ? (
        <div
          className={`mt-3 rounded-[var(--admin-radius-sm)] p-3 ${
            openOption.reversible
              ? "bg-[var(--admin-surface-2)]"
              : "bg-[var(--admin-danger-soft)]"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p
              className={`text-sm font-semibold ${
                openOption.reversible
                  ? "text-[var(--admin-text)]"
                  : "text-[var(--admin-danger)]"
              }`}
            >
              {openOption.confirmTitle}
            </p>
            <Badge tone={openOption.reversible ? "neutral" : "danger"}>
              {openOption.reversible ? "Can be undone" : "Cannot be undone"}
            </Badge>
          </div>

          {/* WHICH ORDER. Named explicitly, because the rows look alike and
              ending the wrong one is the mistake this panel exists to stop. */}
          <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
            {employeeName} &middot; case {caseNumber}
          </p>

          <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
            <span className="font-semibold">What happens: </span>
            {openOption.whatHappens}
          </p>
          <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
            <span className="font-semibold">Before you click: </span>
            {openOption.beforeYouClick}
          </p>

          {/* ── THE REASON, ON ENDING ONLY ────────────────────────────────
              Required by the pure core, by the server store, and by 0198's
              `wage_orders_terminated_has_note` CHECK. Three layers, one
              number, all three reading the same constant. */}
          {openOption.requiresReason ? (
            <div className="mt-3">
              <label
                htmlFor={`end-reason-${orderId}`}
                className="text-xs font-semibold text-[var(--admin-text)]"
              >
                Why is this order ending?
              </label>
              <textarea
                id={`end-reason-${orderId}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="released by the registry 2026-04-02"
                className="admin-focus mt-1 w-full rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-2 text-sm text-[var(--admin-text)]"
              />
              {!reasonCheck.ok ? (
                <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                  {reasonCheck.refusal.fix}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="mt-3">
              <label
                htmlFor={`pause-note-${orderId}`}
                className="text-xs font-semibold text-[var(--admin-text)]"
              >
                {openOption.key === "pause"
                  ? "A note for yourself (optional, but write one)"
                  : "Nothing further is needed"}
              </label>
              {openOption.key === "pause" ? (
                <textarea
                  id={`pause-note-${orderId}`}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="unpaid leave, expected back 2026-07-01"
                  className="admin-focus mt-1 w-full rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-2 text-sm text-[var(--admin-text)]"
                />
              ) : null}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={openOption.variant}
              disabled={busy || (openOption.requiresReason && !reasonCheck.ok)}
              onClick={() => void run(openOption.key)}
            >
              {busy ? "Working\u2026" : `Yes - ${openOption.label.toLowerCase()}`}
            </Button>
            <Button type="button" size="sm" variant="neutral" disabled={busy} onClick={close}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {/* ── THE ANSWER FROM THE SERVER ───────────────────────────────────
          The server's own sentence is rendered verbatim. It is written for
          Michael and it is more specific than anything this component could
          say - it names the case number on success, and on a refusal it names
          the rule. Warnings are shown separately from the message, because
          "we did this, and here is something to watch" must never be skimmed
          as though it were "we did not do this". */}
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
                // WHAT TO DO NEXT, for the refusal code that actually came
                // back. A refusal without a next step is a dead end, and a
                // dead end is where people start clicking repeatedly.
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
