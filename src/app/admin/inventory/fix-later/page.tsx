/**
 * src/app/admin/inventory/fix-later/page.tsx  (register-sell-everything-fix-later)
 *
 * The owner, verbatim: "I need ways of fixing a lot from the register, let
 * the system fix it for me so it can be sold, then set that item aside so I
 * can fix it properly. Everything must sell. No exceptions. We will fix it
 * all later."
 *
 * One sentence at the top answers "does everything with stock sell?". Below
 * it: the lots the register is selling ANYWAY (Quarantine, no menu product,
 * no COA, auto price / category, fixed at the register with "Fix & sell"),
 * each with what to fix, and separately the few lots that are stopped for
 * safety (recall, failed lab, destruction) with why.
 *
 * Read-only: every lot links to its own page to fix it.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { readFixLaterCoverage } from "@/lib/pos/register-fix-later-store";
import {
  FIX_LATER_REASON_LABELS,
  REGISTER_STOP_LABELS,
  coverageSentence,
  type FixLaterReason,
} from "@/lib/pos/register-fix-later-core";

export const dynamic = "force-dynamic";

const CARD = "rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5";
const H2 = "mb-3 text-sm font-black uppercase tracking-[0.14em] text-[var(--admin-text)]";

const REASON_SHORT: Record<FixLaterReason, string> = {
  quarantine: "Quarantine",
  no_menu_product: "No menu product",
  no_coa: "No COA",
  category_guessed: "Category guessed",
  price_from_cost: "Auto price (2x cost)",
  price_guessed: "Price guessed ($20)",
  fixed_at_register: "Fixed at register",
};

export default async function FixLaterPage() {
  await requirePermission("inventory.manage");
  const read = await readFixLaterCoverage();

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: "Inventory", href: "/admin/inventory" }, { label: "Fix later" }]} />
      <AdminPageHeader
        title="Fix later"
        subtitle="Everything with stock sells at the register. These lots are selling with something missing; fix each one properly when you have time."
      />
      {!read.ok ? (
        <div className={CARD} data-testid="fix-later-error">
          {read.error}
        </div>
      ) : (
        <>
          <div className={CARD} data-testid="fix-later-summary">
            <p className="text-base font-bold text-[var(--admin-text)]">{coverageSentence(read.coverage)}</p>
            {!read.complete ? (
              <p className="mt-2 text-sm text-[var(--admin-text-muted)]">The lot list may be incomplete (a read stopped early). Refresh to try again.</p>
            ) : null}
            <ul className="mt-3 space-y-1 text-sm text-[var(--admin-text-muted)]">
              {(Object.keys(read.coverage.byFixLater) as FixLaterReason[]).map((r) => (
                <li key={r}>
                  <strong>{read.coverage.byFixLater[r]}</strong> {REASON_SHORT[r]}: {FIX_LATER_REASON_LABELS[r]}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-[var(--admin-text-muted)]">
              At the register, a scan that finds nothing offers <strong>Fix &amp; sell</strong>: the system builds the line from the lot, adds
              it to the cart and lists it here.
            </p>
          </div>

          {read.coverage.stoppedLots > 0 ? (
            <div className={CARD} data-testid="fix-later-stopped">
              <h2 className={H2}>Stopped for safety ({read.coverage.stoppedLots})</h2>
              <table className="w-full text-sm">
                <tbody>
                  {read.coverage.rows
                    .filter((r) => !r.sells)
                    .map((r) => (
                      <tr key={r.lotId} className="border-t border-[var(--admin-border)]">
                        <td className="py-1 pr-3">
                          <Link className="underline" href={`/admin/inventory/${r.lotId}`}>
                            {r.label}
                          </Link>
                        </td>
                        <td className="py-1 pr-3">{r.units}</td>
                        <td className="py-1">{r.stop ? REGISTER_STOP_LABELS[r.stop] : "No product key on the lot."}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className={CARD} data-testid="fix-later-list">
            <h2 className={H2}>Selling now, fix later ({read.coverage.rows.filter((r) => r.sells && r.fixLater.length > 0).length})</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-[var(--admin-text-muted)]">
                  <th className="py-1 pr-3">Lot</th>
                  <th className="py-1 pr-3">Package</th>
                  <th className="py-1 pr-3">Units</th>
                  <th className="py-1">What to fix</th>
                </tr>
              </thead>
              <tbody>
                {read.coverage.rows
                  .filter((r) => r.sells && r.fixLater.length > 0)
                  .sort((a, b) => Number(b.fixLater.includes("fixed_at_register")) - Number(a.fixLater.includes("fixed_at_register")))
                  .map((r) => (
                    <tr key={r.lotId} className="border-t border-[var(--admin-border)] align-top">
                      <td className="py-1 pr-3">
                        <Link className="underline" href={`/admin/inventory/${r.lotId}`}>
                          {r.label}
                        </Link>
                      </td>
                      <td className="py-1 pr-3 font-mono text-xs">{read.lots.get(r.lotId)?.lotCode ?? ""}</td>
                      <td className="py-1 pr-3">{r.units}</td>
                      <td className="py-1">{r.fixLater.map((x) => REASON_SHORT[x]).join(" · ")}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
