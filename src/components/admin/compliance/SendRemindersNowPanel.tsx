"use client";

/**
 * src/components/admin/compliance/SendRemindersNowPanel.tsx   (slice books-90)
 *
 * THE BUTTON THAT MAKES THE REMINDER ENGINE PRESSABLE.
 *
 * The engine behind this has been able to email since Task W, and the cron
 * route's docblock has described a manual "run reminders now" button since the
 * day it was written — authorize() even accepts a staff session so that button
 * could exist. Nobody built it. Until now the only way to make the system speak
 * was to wait for 8am and hope, which is not something Michael can see, test or
 * trust.
 *
 * books-90 needed it for a second reason. This is the slice that starts
 * emailing him about large unapproved entries, and standing rule 133 says a
 * feature is not shipped until a human can cause the effect. A scheduler is not
 * a human.
 *
 * WHY PRESSING IT TWICE IS SAFE, AND WHY THE PANEL SAYS SO. Every reminder is
 * deduped against compliance_reminder_log on a per-day key. A second press
 * re-plans everything and sends only what has not already gone out, reporting
 * the rest as "already sent today". The panel states this next to the button,
 * because a button whose safety is undocumented is a button nobody presses.
 */

import { useState, useTransition } from "react";

import { Button } from "@/components/admin/ui";
import { sendRemindersNowAction } from "@/app/admin/compliance/calendar/actions";
import type { ReminderRunResult } from "@/lib/notifications/compliance-reminders";

export default function SendRemindersNowPanel() {
  const [result, setResult] = useState<ReminderRunResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="save"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setResult(await sendRemindersNowAction());
            })
          }
        >
          {pending ? "Sending…" : "Send reminders now"}
        </Button>
        <p className="text-xs text-[var(--admin-muted)]">
          Runs the same checks as the 8am email. Safe to press twice — anything already
          sent today is skipped, not repeated.
        </p>
      </div>

      {result && (
        <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
          {!result.ran ? (
            <p className="text-sm text-[var(--admin-text)]">
              Nothing ran — the database is not configured in this environment.
            </p>
          ) : (
            <p className="text-sm text-[var(--admin-text)]">
              <strong>{result.sent}</strong> sent · {result.deduped} already sent today ·{" "}
              {result.unsent} with nowhere to send · {result.planned} checked.
            </p>
          )}

          {/* The notes carry every "I could not read X" the run produced. They
              are the difference between "nothing was due" and "nothing could be
              looked at", and hiding them would make those two look identical. */}
          {result.notes.length > 0 && (
            <ul className="mt-2 space-y-1">
              {result.notes.map((n, i) => (
                <li key={i} className="text-xs text-[var(--admin-muted)]">
                  • {n}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
