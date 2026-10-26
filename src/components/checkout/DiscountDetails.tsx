"use client";

/**
 * Discount transparency: the website's view of the SAME breakdown the
 * register receipt, the emailed receipt and the printed pickup ticket use
 * (src/lib/pos/receipt-discount-core.ts). It shows the regular price, what
 * was saved, the percent off per item, the deal and how it works, cost-floor
 * caps, and an order-level "your savings" block with the total percent off.
 * What shows is controlled by the owner's ONLINE discount settings in the
 * receipt builder (PosReceiptConfig.onlineDiscount).
 */
import {
  lineDiscountRows,
  orderSummaryBlock,
  type DiscountBreakdown,
  type DiscountDisplayConfig,
  type LineDiscountBreakdown,
} from "@/lib/pos/receipt-discount-core";
import { formatMinorCurrency } from "@/lib/leafly/format";

export function WebLineDiscount({
  line,
  cfg,
}: {
  line: LineDiscountBreakdown | undefined;
  cfg: DiscountDisplayConfig;
}) {
  if (!line || !line.discounted) return null;
  const rows = lineDiscountRows(line, cfg);
  if (rows.length === 0) return null;
  return (
    <ul className="mt-2 grid gap-0.5 text-xs" aria-label={`Discount details for ${line.productName}`}>
      {rows.map((r, k) => (
        <li
          key={k}
          className={`flex justify-between gap-3 ${r.emphasis ? "font-black text-[var(--greenway)]" : "font-semibold text-zinc-400"}`}
        >
          <span>{r.text}</span>
          {r.amountMinor != null ? (
            <span className="shrink-0 tabular-nums">{`\u2212${formatMinorCurrency(r.amountMinor)}`}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function WebOrderSavings({
  breakdown,
  cfg,
  className = "",
}: {
  breakdown: DiscountBreakdown;
  cfg: DiscountDisplayConfig;
  className?: string;
}) {
  const block = orderSummaryBlock(breakdown.summary, cfg);
  if (!block) return null;
  return (
    <section
      className={`rounded-2xl border border-[var(--greenway)]/40 bg-[var(--greenway)]/5 p-4 text-sm ${className}`}
      aria-label={block.title}
    >
      <h3 className="text-xs font-black uppercase tracking-[0.16em] text-[var(--greenway)]">{block.title}</h3>
      {block.rows.length > 0 ? (
        <dl className="mt-2 grid gap-1">
          {block.rows.map((r, k) => (
            <div
              key={k}
              className={`flex justify-between gap-4 ${r.label.startsWith("  ") ? "pl-3 text-xs" : ""} ${
                r.emphasis ? "font-black text-[var(--greenway)]" : "font-semibold text-zinc-300"
              }`}
            >
              <dt>{r.label.trim()}</dt>
              <dd className="tabular-nums">{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {block.notes.length > 0 ? (
        <div className="mt-3 border-t border-white/10 pt-2">
          <p className="text-[0.66rem] font-black uppercase tracking-[0.16em] text-zinc-400">How your discounts work</p>
          <ul className="mt-1 grid list-disc gap-1 pl-4 text-xs leading-relaxed text-zinc-400">
            {block.notes.map((n, k) => (
              <li key={k}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
