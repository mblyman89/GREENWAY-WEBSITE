/**
 * src/components/admin/inventory/RegisterSellabilityBanner.tsx   (SLICE 16)
 *
 * "These lots have stock, but the register cannot sell them — and here is
 * exactly why, and exactly what to do about it."
 *
 * The owner discovered the register/back-office divergence by scanning
 * packages at the counter with a customer waiting. This banner is the answer
 * to that: the same question, answered in the back office, before the shift.
 *
 * A SERVER COMPONENT that renders plain markup and takes only serialisable
 * props. PR #1095 was a production crash caused by passing a FUNCTION prop
 * across the RSC boundary; nothing here crosses that line — no handlers, no
 * client hooks, and every decision already made server-side by the pure core.
 *
 * SILENT WHEN CLEAN. It renders nothing at all when nothing is blocked, and
 * nothing when the read could not prove its claim. A banner that cries wolf,
 * or that guesses, is worse than no banner — it trains the owner to ignore it.
 */
import Link from "next/link";
import type { LotDiagnosis, SellabilitySummary } from "@/lib/pos/register-availability-core";

/** Plain-English heading per blocking cause, worst/most-actionable first. */
const CAUSE_ORDER: { code: LotDiagnosis["code"]; label: string }[] = [
  { code: "no_product_link", label: "Not linked to a product" },
  { code: "no_menu_card", label: "Not on the published menu" },
  { code: "hidden_card", label: "Hidden on the menu" },
  { code: "recall_hold", label: "Under a recall hold" },
];

export function RegisterSellabilityBanner({
  summary,
  blocked,
}: {
  summary: SellabilitySummary | null;
  blocked: LotDiagnosis[];
}) {
  // No verdict, or nothing wrong: say nothing.
  if (!summary || summary.headline == null || blocked.length === 0) return null;

  const groups = CAUSE_ORDER.map((c) => ({
    ...c,
    lots: blocked.filter((b) => b.code === c.code),
  })).filter((g) => g.lots.length > 0);

  return (
    <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 p-5">
      <h2 className="text-sm font-semibold text-[var(--admin-orange)]">
        Stock on hand that the register cannot sell
      </h2>
      <p className="mt-1 text-sm text-[var(--admin-text)]">{summary.headline}</p>
      <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
        These lots have units on hand, so they are not simply sold out. Each one needs the fix
        listed beside it before it can be scanned and rung up at the register.
      </p>

      <div className="mt-4 space-y-4">
        {groups.map((g) => (
          <div key={g.code}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
              {g.label} · {g.lots.length}
            </h3>
            <ul className="mt-2 space-y-1.5">
              {g.lots.map((lot) => (
                <li key={lot.lotId} className="text-sm">
                  <Link
                    href={`/admin/inventory/${lot.lotId}`}
                    className="font-medium text-[var(--admin-text)] underline-offset-2 hover:text-[var(--admin-accent)] hover:underline"
                  >
                    {lot.label}
                  </Link>
                  {lot.fix && (
                    <span className="text-[var(--admin-text-muted)]"> — {lot.fix}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {summary.blocked > blocked.length && (
        <p className="mt-4 text-xs text-[var(--admin-text-faint)]">
          Showing {blocked.length} of {summary.blocked}. Fix these first, then reload to see the
          rest.
        </p>
      )}
    </section>
  );
}
