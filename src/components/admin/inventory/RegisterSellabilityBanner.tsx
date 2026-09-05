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
import type { RestorableProduct } from "@/lib/inventory/register-sellability-store";
import { restoreProductToSaleAction } from "@/app/admin/inventory/actions";

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

/**
 * SLICE 18 - RESTORE TO SALE.
 *
 * Owner: "I will test that while you build the proper restore to sale button."
 *
 * The register's "86 it" button wrote `inventory_status = "unavailable"` and
 * NOTHING in the back office could ever write it back - the endpoint's own
 * header promised a back-office undo that was never built. Slice 16 recon
 * proved it; this is the missing half.
 *
 * Each row here is a product that is flagged unavailable while real, active
 * lot units sit behind it. The button does not set "in-stock": the server
 * recomputes the status from those units, so it can only ever clear a stale
 * flag, never invent inventory. Recalled and hidden products are excluded
 * upstream and can never appear here.
 *
 * A plain server-action form - no client component, no function props (the
 * PR #1095 crash), so it works with JavaScript disabled and cannot break the
 * RSC boundary.
 */
export function RestoreToSalePanel({ restorable }: { restorable: RestorableProduct[] }) {
  // Nothing 86'd that stock contradicts: say nothing at all.
  if (restorable.length === 0) return null;

  return (
    <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 p-5">
      <h2 className="text-sm font-semibold text-[var(--admin-accent)]">
        Marked unavailable, but you have stock
      </h2>
      <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
        Someone pressed &ldquo;86&rdquo; on these at a register, or they were emptied and then restocked.
        They are on the shelf now. Restoring recomputes each one from its live lot count, so it can
        only clear a stale flag &mdash; it can never invent stock.
      </p>

      <ul className="mt-4 space-y-2">
        {restorable.map((p) => (
          <li
            key={p.productKey}
            className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2"
          >
            <span className="text-sm">
              <span className="font-medium text-[var(--admin-text)]">{p.name}</span>
              <span className="text-[var(--admin-text-muted)]">
                {" "}
                &mdash; {p.units} {p.units === 1 ? "unit" : "units"} on hand
              </span>
            </span>
            <form action={restoreProductToSaleAction}>
              <input type="hidden" name="productKey" value={p.productKey} />
              <input type="hidden" name="returnTo" value="/admin/inventory" />
              <button
                type="submit"
                className="rounded-[var(--admin-radius)] bg-[var(--admin-accent)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
              >
                Restore to sale &rarr; {p.nextStatus}
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
