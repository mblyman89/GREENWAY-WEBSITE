/**
 * D239 N-10 (SOP-22 G-120): the "Sunday checklist" strip on Blog & Newsletter
 * and the Send Center. Shows SOP-22 Forms 8.1 (Monday brief) and 8.2 (the 12
 * pre-publish checks) in the app, with links to where each step is done.
 * Server component; collapsed by default so it never gets in the way.
 */
import Link from "next/link";
import {
  MONDAY_BRIEF,
  PRE_PUBLISH_CHECKS,
  SUNDAY_STEPS,
  type ChecklistItem,
} from "@/lib/cms/sunday-checklist-core";

function Row({ item, n }: { item: ChecklistItem; n: number }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span aria-hidden className="mt-0.5 inline-block h-4 w-4 shrink-0 rounded border border-[var(--admin-border-strong)]" />
      <span>
        <span className="text-[var(--admin-text-faint)]">{n}.</span> {item.text}
        {item.newsletterOnly ? <span className="ml-1 text-xs text-[var(--admin-text-muted)]">(newsletter)</span> : null}
        {item.href ? (
          <>
            {" "}
            <Link href={item.href} className="text-xs text-[var(--admin-accent)] underline">
              {item.where}
            </Link>
          </>
        ) : null}
      </span>
    </li>
  );
}

export function SundayChecklistStrip({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const head = "mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]";
  return (
    <details
      id="sunday-checklist"
      data-testid="sunday-checklist"
      open={defaultOpen}
      className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4"
    >
      <summary className="cursor-pointer text-sm font-semibold">
        Sunday checklist <span className="font-normal text-[var(--admin-text-muted)]">(SOP-22 Forms 8.1 and 8.2: Monday brief and the 12 pre-publish checks)</span>
      </summary>
      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        <div data-testid="sunday-checklist-steps">
          <p className={head}>The week, start to Sunday</p>
          <ol className="space-y-1.5">
            {SUNDAY_STEPS.map((it, i) => (
              <Row key={it.id} item={it} n={i + 1} />
            ))}
          </ol>
        </div>
        <div data-testid="sunday-checklist-brief">
          <p className={head}>Monday brief (Form 8.1)</p>
          <ol className="space-y-1.5">
            {MONDAY_BRIEF.map((it, i) => (
              <Row key={it.id} item={it} n={i + 1} />
            ))}
          </ol>
        </div>
        <div data-testid="sunday-checklist-checks">
          <p className={head}>Before you publish (Form 8.2)</p>
          <ol className="space-y-1.5">
            {PRE_PUBLISH_CHECKS.map((it, i) => (
              <Row key={it.id} item={it} n={i + 1} />
            ))}
          </ol>
          <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
            Every post and every newsletter. If any answer is no, fix it before you publish or approve (WAC 314-55-155).
          </p>
        </div>
      </div>
    </details>
  );
}
