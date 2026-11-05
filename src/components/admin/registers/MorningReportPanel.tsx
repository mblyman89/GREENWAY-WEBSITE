/**
 * MorningReportPanel (D182, round slice S5): the night watch's morning report.
 *
 * Server component. Shown on the admin cockpit (compact: only when something
 * needs doing) and in full on /admin/registers/night-watch. This IS the nudge
 * the owner asked for ("Nudges by admin screens only for now"): every gap is
 * named, with who owes it and a link to the screen that fixes it.
 *
 * Owner-only items (the seal, the bank run, exception decisions, copied
 * second counts) are shown to the owner; the crew sees the crew's list.
 */
import Link from "next/link";
import { morningReportNow, NIGHT_WATCH_PAGE } from "@/lib/registers/night-watch-store";
import type { MorningReport } from "@/lib/registers/night-watch-core";

export async function MorningReportPanel({ isOwner, compact = false, report }: { isOwner: boolean; compact?: boolean; report?: MorningReport }) {
  const r = report ?? (await morningReportNow().catch(() => null));
  if (!r) {
    return (
      <div data-testid="morning-report-error" className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-4 py-3 text-sm text-[var(--admin-danger)]">
        The morning report could not be built. Open Register Activity and check drawers and bags by hand.
      </div>
    );
  }
  const items = isOwner ? r.items : r.items.filter((x) => x.who === "crew");
  if (items.length === 0) {
    return compact ? null : (
      <div data-testid="morning-report-clear" className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
        ✅ {r.status === "clear" ? r.headline : `Nothing for the crew on ${r.day}.`}
      </div>
    );
  }
  const red = items.filter((x) => x.severity === "red").length;
  return (
    <section
      data-testid="morning-report"
      aria-label="Morning report"
      className={`rounded-[var(--admin-radius)] border px-4 py-3 ${red > 0 ? "border-[var(--admin-danger)]/50 bg-[var(--admin-danger-soft)]" : "border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)]"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={`text-sm font-bold ${red > 0 ? "text-[var(--admin-danger)]" : "text-[var(--admin-text)]"}`}>
          🌙 Morning report · {r.day}: {items.length} to fix{red > 0 ? ` (${red} urgent)` : ""}
        </h2>
        {compact ? (
          <Link href={NIGHT_WATCH_PAGE} className="text-xs font-semibold underline">
            Full report
          </Link>
        ) : null}
      </div>
      <ol className="mt-2 space-y-1.5 text-sm">
        {items.map((x) => (
          <li key={x.key} data-testid={`watch-${x.key}`} className="flex flex-wrap items-baseline gap-x-2">
            <span
              className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${x.severity === "red" ? "bg-[var(--admin-danger)] text-white" : "bg-[var(--admin-surface-2)] text-[var(--admin-text)]"}`}
            >
              {x.severity === "red" ? "Urgent" : "To do"}
            </span>
            <span className="text-xs font-semibold text-[var(--admin-text-muted)]">{x.who === "crew" ? "Crew" : "Michael"}</span>
            <span className="text-[var(--admin-text)]">{x.sentence}</span>
            <Link href={x.href} className="text-xs font-semibold underline">
              Fix it
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
