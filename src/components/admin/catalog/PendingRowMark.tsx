"use client";

/**
 * D247 (owner: "is there a way to click the apply or save or whatever button, it goes onto the
 * server or where ever, and then we move on?").
 *
 * Put inside a row's <form>. The moment the form is sent, its table row (and the row's full-width
 * detail row, `<id>-detail`) is dimmed and locked with "Saving - keep working", so a second click
 * can never send it twice and the eye moves straight on to the next product. It clears ITSELF when
 * the server answers - success (the row leaves the list) or a refusal (the row comes back pinned with
 * the reason) - because useFormStatus follows that one form's own request. Nothing is guessed on the
 * client: the server still decides everything.
 */
import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

export const ROW_PENDING_ATTR = "data-row-pending";

export function PendingRowMark({ label = "Saving\u2026 keep working" }: { label?: string }) {
  const { pending } = useFormStatus();
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const row = el.closest("tr");
    if (!row) return;
    const baseId = row.id.endsWith("-detail") ? row.id.slice(0, -"-detail".length) : row.id;
    const rows = [row, baseId ? document.getElementById(baseId) : null, baseId ? document.getElementById(`${baseId}-detail`) : null].filter(
      (r, i, a): r is HTMLElement => Boolean(r) && a.indexOf(r) === i,
    );
    for (const r of rows) {
      if (pending) r.setAttribute(ROW_PENDING_ATTR, "1");
      else r.removeAttribute(ROW_PENDING_ATTR);
    }
    return () => {
      for (const r of rows) r.removeAttribute(ROW_PENDING_ATTR);
    };
  }, [pending]);

  return (
    <span ref={ref} role="status" aria-live="polite" className="text-xs font-semibold text-[var(--admin-text-muted)]" data-testid="row-pending-mark">
      {pending ? label : null}
    </span>
  );
}
