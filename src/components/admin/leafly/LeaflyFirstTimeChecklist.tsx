"use client";

/**
 * src/components/admin/leafly/LeaflyFirstTimeChecklist.tsx   (Slice B)
 *
 * THE ORDER YOU DO THINGS IN IS THE WHOLE SAFETY STORY.
 *
 * `FIRST_TIME_CHECKLIST` is not a to-do list; it is an ORDERING. Every item
 * that cannot affect a customer comes before every item that can, and a CI
 * test asserts that the list never returns to a safe step once it has gone
 * live. That ordering is the actual safety mechanism, so this component
 * renders the boundary as a visible line rather than leaving it implicit in
 * fourteen similar-looking rows.
 *
 * WHY PROGRESS IS LOCAL AND DELIBERATELY FORGETFUL
 * ------------------------------------------------
 * Ticks live in React state and vanish on reload. That is a choice, not an
 * omission. Persisting them would make the page look like a record of what
 * happened on Leafly's side, and it is nothing of the kind -- it is a record
 * of what someone clicked in a browser. The system already keeps real evidence
 * of real pushes (the evidence panel, the sync log); inventing a second,
 * weaker source of truth that LOOKS authoritative is how people end up
 * trusting a tick instead of the log.
 */

import { useMemo, useState } from "react";
import { Badge, Card, CardHeader } from "@/components/admin/ui";
import { FIRST_TIME_CHECKLIST } from "@/lib/leafly/helper-core";

export function LeaflyFirstTimeChecklist() {
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());

  const firstLiveIndex = useMemo(
    () => FIRST_TIME_CHECKLIST.findIndex((c) => c.live),
    [],
  );

  const toggle = (id: string) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const safeTotal = firstLiveIndex < 0 ? FIRST_TIME_CHECKLIST.length : firstLiveIndex;
  const safeDone = FIRST_TIME_CHECKLIST.slice(0, safeTotal).filter((c) =>
    done.has(c.id),
  ).length;
  const allSafeDone = safeDone === safeTotal;

  return (
    <Card>
      <CardHeader
        title="First time through, in order"
        subtitle="Everything above the line is reversible. Nothing above the line can reach a customer."
      />

      <p className="mt-3 text-sm text-[var(--admin-muted)]">
        {safeDone} of {safeTotal} rehearsal steps ticked. Ticks are just for
        your place in the list &mdash; they are not saved, and they are not
        evidence. The sync log and the evidence panel are the record.
      </p>

      <ol className="mt-4 list-none">
        {FIRST_TIME_CHECKLIST.map((item, i) => {
          const isChecked = done.has(item.id);
          const isBoundary = i === firstLiveIndex && firstLiveIndex > 0;

          return (
            <li key={item.id}>
              {isBoundary ? (
                <div className="my-3 flex items-center gap-3">
                  <span className="h-px flex-1 bg-[var(--admin-danger)]" />
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-danger)]">
                    Below here, customers can see it
                  </span>
                  <span className="h-px flex-1 bg-[var(--admin-danger)]" />
                </div>
              ) : null}

              <label
                className={`flex cursor-pointer items-start gap-3 border-b border-[var(--admin-border)] py-3 ${
                  // Live steps are dimmed until the rehearsal is finished. Not
                  // DISABLED -- the owner may have a legitimate reason to jump
                  // ahead, and a back office that refuses to let its owner act
                  // teaches people to work around it. Dimmed says "are you
                  // sure"; disabled says "you are not trusted".
                  item.live && !allSafeDone ? "opacity-60" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggle(item.id)}
                  className="mt-1 h-4 w-4 shrink-0 accent-[var(--admin-accent)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span
                      className={`text-sm font-medium ${
                        isChecked
                          ? "text-[var(--admin-muted)] line-through"
                          : "text-[var(--admin-text)]"
                      }`}
                    >
                      {i + 1}. {item.label}
                    </span>
                    {item.live ? (
                      <Badge tone="danger">Customers can see this</Badge>
                    ) : (
                      <Badge tone="green">Rehearsal</Badge>
                    )}
                  </span>
                  <span className="mt-1 block text-sm text-[var(--admin-muted)]">
                    {item.why}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
