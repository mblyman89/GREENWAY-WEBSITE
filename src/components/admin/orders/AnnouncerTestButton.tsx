"use client";

/**
 * src/components/admin/orders/AnnouncerTestButton.tsx
 *
 * The "▶ Test all speakers" button, and the sentence it prints afterwards.
 *
 * THE REAL FAILURE THIS COMES FROM
 * --------------------------------
 * The owner pressed this button and reported: "the back office test speaker
 * button does nothing, it hangs."
 *
 * Nothing was hanging. The old markup was:
 *
 *     <form action={announcerTestAllAction}>
 *       <Button type="submit" ...>▶ Test all speakers</Button>
 *     </form>
 *
 * ...against a server action that returned void, inside a server component, so
 * there was no pending state, no disabled state, and nothing rendered when it
 * finished. Pressing it produced literally zero visible change. On top of that
 * the Pi collects work on a long-poll of up to POLL_HOLD_SECONDS, so the chime
 * itself can be ~25 seconds behind the click.
 *
 * A button that looks identical before, during and after, followed by up to 25
 * seconds of silence, IS a hang as far as the person pressing it is concerned.
 * There is no way for them to tell the difference, and no reason they should
 * have to.
 *
 * So this component is deliberately three separate promises, not one:
 *
 *   1. IMMEDIATELY  - the button changes to "Sending…", spins, and is disabled,
 *                     so the press is acknowledged inside one frame and cannot
 *                     be double-fired into a queue of duplicate chimes.
 *   2. ON RETURN    - a sentence appears saying how many speakers it went to.
 *   3. ABOUT THE WAIT - that sentence also states the expected delay, so the
 *                     silence that follows is an expectation instead of a
 *                     symptom.
 *
 * The wording itself lives in describeTestOutcome() in announcer-fanout-core,
 * which is pure and self-tested. This file is the plumbing only.
 *
 * Why useActionState and not useFormStatus: useFormStatus gives the pending
 * flag but throws the action's RETURN VALUE away, and the return value is the
 * half that answers "did it actually go anywhere?". useActionState gives both,
 * and it is already the established pattern in this codebase (DeviceManager,
 * VendorAchForm, HandbookAckForm).
 */
import { useActionState } from "react";

import { Button } from "@/components/admin/ui/Button";
import {
  announcerTestAllAction,
  type AnnouncerTestResult,
} from "@/app/admin/orders/announcer-actions";

export function AnnouncerTestButton() {
  const [state, formAction, pending] = useActionState<AnnouncerTestResult | null, FormData>(
    announcerTestAllAction,
    null,
  );

  return (
    <div className="flex flex-col items-end gap-1.5">
      <form action={formAction}>
        <Button type="submit" variant="primary" size="sm" disabled={pending} aria-busy={pending}>
          {pending ? (
            <>
              {/* The press is acknowledged before the server has said anything. */}
              <span
                aria-hidden
                className="mr-1.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent align-[-1px]"
              />
              Sending…
            </>
          ) : (
            "▶ Test all speakers"
          )}
        </Button>
      </form>

      {/*
        role="status" + aria-live so a screen reader announces the outcome too.
        It is always mounted while there is a result, and never replaces the
        button, so the screen does not jump under a finger mid-press.
      */}
      <p
        role="status"
        aria-live="polite"
        className="max-w-[22rem] text-right text-[0.68rem] leading-snug text-[var(--admin-text-muted)]"
      >
        {pending
          ? "Sending the test to your speakers…"
          : state
            ? state.message
            : ""}
      </p>
    </div>
  );
}
