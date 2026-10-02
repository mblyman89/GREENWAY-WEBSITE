/**
 * src/components/admin/products/MasteredCards.tsx   (bible S35)
 *
 * Presentational only: the Live cards tab and a manual master's member list,
 * both built from mastered-menu-core rows. No reads here; the page loads and
 * windows the data (ListPager), so a menu of thousands of cards never renders
 * as one unbounded table (S35.8).
 */
import Link from "next/link";
import { formatMoney } from "@/lib/pos/format";
import { productPageHref } from "@/lib/pos/issue-fix-link-core";
import {
  marketLabel,
  priceRangeLabel,
  stockLabel,
  lotSearchHref,
  type MasteredCard,
  type MasterMemberView,
} from "@/lib/products/mastered-menu-core";

function SizesTable({ card }: { card: MasteredCard }) {
  if (card.sizes.length === 0) {
    return <p className="text-xs text-[var(--admin-text-faint)]">This card has no sizes on the live menu.</p>;
  }
  return (
    <table className="w-full text-left text-xs" data-testid="mastered-sizes">
      <thead className="text-[var(--admin-text-faint)]">
        <tr>
          <th className="py-1 pr-3 font-medium">Size</th>
          <th className="py-1 pr-3 font-medium">Price</th>
          <th className="py-1 pr-3 font-medium">Stock</th>
          <th className="py-1 pr-3 font-medium">Market</th>
          <th className="py-1 font-medium">From</th>
        </tr>
      </thead>
      <tbody>
        {card.sizes.map((s, i) => (
          <tr key={`${s.label}-${i}`} className="border-t border-[var(--admin-border)]" data-testid="mastered-size">
            <td className="py-1 pr-3 text-[var(--admin-text)]">{s.label || "—"}</td>
            <td className="py-1 pr-3">{formatMoney(s.priceMinor)}</td>
            <td className="py-1 pr-3">{s.onHand === null ? "Unknown" : s.onHand}</td>
            <td className="py-1 pr-3">{s.medical ? "Medical" : "Adult use"}</td>
            <td className="py-1">
              {s.lotKey ? (
                <Link href={lotSearchHref(s.lotKey)} className="text-[var(--admin-accent)] hover:underline">
                  Lot {s.lotKey}
                </Link>
              ) : (
                <span className="text-[var(--admin-text-faint)]">POS import</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function LiveCardRow({
  card,
  back,
  manualMaster,
  identityKey,
}: {
  card: MasteredCard;
  back: string;
  /** The manual master listing this key, if any (shown only; never used to group). */
  manualMaster: string | null;
  /** identity_key read opt-in for this page, or null (not available / not set). */
  identityKey: string | null;
}) {
  const identity = identityKey ?? card.identityKey;
  return (
    <li
      className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4"
      data-testid="live-card"
      data-sizes={card.sizes.length}
    >
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={productPageHref(card.key, back)}
            className="text-sm font-semibold text-[var(--admin-text)] hover:text-[var(--admin-accent)]"
          >
            {card.name}
          </Link>
          <p className="text-xs text-[var(--admin-text-muted)]">
            {card.vendor ?? "Vendor not set"} · {card.brand ?? "Brand not set"} · {card.category ?? "Category not set"}
          </p>
        </div>
        <div className="text-right text-xs text-[var(--admin-text-muted)]">
          <p className="font-semibold text-[var(--admin-text)]">
            {card.sizes.length === 1 ? "1 size" : `${card.sizes.length} sizes`} · {priceRangeLabel(card.priceRangeMinor, formatMoney)}
          </p>
          <p>
            {stockLabel(card.totalOnHand)} · {marketLabel(card.market)}
          </p>
        </div>
      </div>
      <SizesTable card={card} />
      <p className="mt-2 text-[11px] text-[var(--admin-text-faint)]">
        Product key {card.key} · Identity {identity ?? "not available"}
        {card.lotKeys.length > 0 && ` · Fed by ${card.lotKeys.length === 1 ? "1 restock lot" : `${card.lotKeys.length} restock lots`}`}
        {manualMaster && ` · Listed in manual master “${manualMaster}”`}
      </p>
    </li>
  );
}

export function MasterMembersList({ members, back }: { members: readonly MasterMemberView[]; back: string }) {
  if (members.length === 0) {
    return <p className="text-xs text-[var(--admin-text-faint)]">No members yet.</p>;
  }
  return (
    <ul className="space-y-1 text-xs" data-testid="master-members">
      {members.map((m) => (
        <li key={m.key} className="flex flex-wrap justify-between gap-2" data-testid="master-member">
          {m.card ? (
            <>
              <Link href={productPageHref(m.key, back)} className="text-[var(--admin-text)] hover:text-[var(--admin-accent)]">
                {m.card.name}
                {m.variantLabel && <span className="ml-1 text-[var(--admin-text-faint)]">({m.variantLabel})</span>}
              </Link>
              <span className="text-[var(--admin-text-muted)]">
                {m.card.sizes.map((s) => s.label).join(" · ") || "no sizes"} · {priceRangeLabel(m.card.priceRangeMinor, formatMoney)} ·{" "}
                {stockLabel(m.card.totalOnHand)}
              </span>
            </>
          ) : (
            <>
              <span className="text-[var(--admin-text)]">{m.key}</span>
              <span className="text-[var(--admin-orange)]">Not on the live menu</span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
