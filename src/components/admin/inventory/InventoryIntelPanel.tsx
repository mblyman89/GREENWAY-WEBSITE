/**
 * src/components/admin/inventory/InventoryIntelPanel.tsx  (Task L)
 *
 * Server component — the "inventory intelligence" band for the Inventory
 * command center. Renders ABC mix, months-of-supply vs the WAC 314-55-079(10)
 * 4-month ceiling, aging buckets, 30-day shrink telemetry (WAC
 * 314-55-089(4)(c): undocumented reductions are deemed sales), count-cadence
 * status, the DOH-compliant stock check, and the FEFO sell-first shortlist.
 * Pure display — all math lives in inventory-intel-core.ts (self-tested).
 */
import Link from "next/link";
import { Badge } from "@/components/admin/ui";
import { InfoHint } from "@/components/admin/ux";
import {
  AGING_BUCKETS,
  MAX_MONTHS_ON_HAND,
  COUNT_CADENCE_DAYS,
  type CommandCenter,
  type IntelLot,
} from "@/lib/inventory/inventory-intel-core";

function money(minor: number): string {
  return `$${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
      <div className="mb-2 flex items-center gap-1.5">
        <h3 className="text-xs font-black uppercase tracking-[0.14em] text-[var(--admin-text-muted)]">
          {title}
        </h3>
        {hint ? <InfoHint text={hint} /> : null}
      </div>
      {children}
    </div>
  );
}

export function InventoryIntelPanel({
  center,
  sellFirst,
}: {
  center: CommandCenter;
  sellFirst: IntelLot[];
}) {
  const { abcCounts, aging, supply, shrink30, overdue, medicalInStock } = center;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-[var(--admin-text)]">
          Inventory intelligence
        </h2>
        <span className="text-xs text-[var(--admin-text-faint)]">
          Real lot data · money at cost · docs/INVENTORY_COMPLIANCE_WA.md
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Months of supply vs the 4-month WAC ceiling */}
        <Card
          title="Months of supply"
          hint={`WAC 314-55-079(10): a retailer may keep at most ${MAX_MONTHS_ON_HAND} months of average inventory on premises. Estimated from real lot depletion.`}
        >
          {supply.months == null ? (
            <p className="text-sm text-[var(--admin-text-faint)]">
              Not enough depletion history yet to estimate.
            </p>
          ) : (
            <div className="flex items-baseline gap-2">
              <span
                className={`text-2xl font-black ${supply.overCeiling ? "text-[var(--admin-danger)]" : "text-[var(--admin-text)]"}`}
              >
                {supply.months}
              </span>
              <span className="text-xs text-[var(--admin-text-faint)]">
                / {MAX_MONTHS_ON_HAND} mo max
              </span>
              {supply.overCeiling ? <Badge tone="danger">over ceiling</Badge> : <Badge tone="green">ok</Badge>}
            </div>
          )}
          <p className="mt-2 text-xs text-[var(--admin-text-faint)]">
            On hand {money(supply.onHandValueMinor)} · depleting ≈{" "}
            {money(supply.monthlyDepletionMinor)}/mo
          </p>
        </Card>

        {/* ABC mix + count cadence */}
        <Card
          title="ABC mix & count cadence"
          hint="Lots classed by on-hand value at cost: A = top 80% of value (count every 30 days), B = next 15% (90 days), C = tail (180 days)."
        >
          <div className="flex items-center gap-4 text-sm">
            {(["A", "B", "C"] as const).map((cls) => (
              <div key={cls} className="text-center">
                <div className="text-lg font-black text-[var(--admin-text)]">{abcCounts[cls]}</div>
                <div className="text-[10px] uppercase tracking-wide text-[var(--admin-text-faint)]">
                  {cls} · {COUNT_CADENCE_DAYS[cls]}d
                </div>
              </div>
            ))}
            <div className="ml-auto text-center">
              <div
                className={`text-lg font-black ${overdue.total > 0 ? "text-[var(--admin-orange)]" : "text-[var(--admin-accent)]"}`}
              >
                {overdue.total}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-[var(--admin-text-faint)]">
                overdue
              </div>
            </div>
          </div>
          <p className="mt-2 text-xs text-[var(--admin-text-faint)]">
            {overdue.total > 0 ? (
              <>
                {overdue.byClass.A} A · {overdue.byClass.B} B · {overdue.byClass.C} C past cadence —{" "}
                <Link href="/admin/inventory/cycle-counts" className="text-[var(--admin-accent)] hover:underline">
                  start a focused count →
                </Link>
              </>
            ) : (
              "Every active lot is inside its count cadence."
            )}
          </p>
        </Card>

        {/* Shrink 30d */}
        <Card
          title="Documented reductions (30d)"
          hint="WAC 314-55-089(4)(c): inventory reductions that are not adequately documented are deemed sales and assessed the 37% excise. Everything here IS documented — the goal is a small, explained number."
        >
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-[var(--admin-text)]">
              {money(shrink30.totalValueMinor)}
            </span>
            <span className="text-xs text-[var(--admin-text-faint)]">
              {shrink30.totalUnits.toLocaleString()} units at cost
            </span>
          </div>
          <ul className="mt-2 space-y-0.5 text-xs text-[var(--admin-text-faint)]">
            <li>Shrink/damage/theft: {money(shrink30.byGroup.shrink.valueMinor)}</li>
            <li>Destruction/recall: {money(shrink30.byGroup.destruction.valueMinor)}</li>
            <li>Samples: {money(shrink30.byGroup.samples.valueMinor)}</li>
            <li>Count corrections: {money(shrink30.byGroup.correction.valueMinor)}</li>
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Aging */}
        <Card
          title="Aging (days on hand, active lots)"
          hint="Value at cost by receipt age. 90+ day cannabis is a markdown / return-to-vendor candidate before it becomes destruction paperwork."
        >
          <table className="w-full text-sm">
            <tbody>
              {AGING_BUCKETS.map((b) => {
                const row = aging[b];
                const label = b === "unknown" ? "No receipt date" : `${b} days`;
                const hot = b === "90+" && row.lots > 0;
                return (
                  <tr key={b} className="border-b border-[var(--admin-border)] last:border-0">
                    <td className="py-1.5 text-[var(--admin-text-muted)]">{label}</td>
                    <td className="py-1.5 text-right text-[var(--admin-text-faint)]">
                      {row.lots} lot{row.lots === 1 ? "" : "s"}
                    </td>
                    <td
                      className={`py-1.5 text-right font-semibold ${hot ? "text-[var(--admin-orange)]" : "text-[var(--admin-text)]"}`}
                    >
                      {money(row.valueMinor)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-[var(--admin-text-faint)]">
            DOH-compliant (medical) lots in stock:{" "}
            {medicalInStock > 0 ? (
              <span className="font-semibold text-[var(--admin-accent)]">{medicalInStock}</span>
            ) : (
              <span className="font-semibold text-[var(--admin-orange)]">
                0 — an endorsed retailer must always keep compliant product in stock or on order (WAC 314-55-080)
              </span>
            )}
          </p>
        </Card>

        {/* FEFO sell-first */}
        <Card
          title="Sell first (FEFO)"
          hint="First-Expired, First-Out: active lots with stock ranked by expiry. Rotate these to the front — expired product is unsellable destruction paperwork."
        >
          {sellFirst.length === 0 ? (
            <p className="text-sm text-[var(--admin-text-faint)]">
              No active lots with an expiry date and stock on hand.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--admin-border)]">
              {sellFirst.map((l) => {
                const expired = l.expiresOn != null && l.expiresOn < today;
                return (
                  <li key={l.id} className="flex items-center justify-between gap-3 py-1.5">
                    <Link
                      href={`/admin/inventory/${l.id}`}
                      className="min-w-0 truncate text-sm text-[var(--admin-text)] hover:text-[var(--admin-accent)]"
                    >
                      {l.productName ?? "(unnamed lot)"}
                    </Link>
                    <span
                      className={`shrink-0 text-xs ${expired ? "font-bold text-[var(--admin-danger)]" : "text-[var(--admin-text-faint)]"}`}
                    >
                      {l.expiresOn}
                      {expired ? " · EXPIRED" : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </section>
  );
}
