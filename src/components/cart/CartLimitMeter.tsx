"use client";

/**
 * src/components/cart/CartLimitMeter.tsx
 *
 * Customer-facing WAC 314-55-095 legal-limit meter for the shop cart. Mirrors
 * the FRONT-END POS register meter (src/app/pos/SaleFlow.tsx): an OK / NEAR /
 * OVER badge plus a per-bucket progress bar (green while safe, amber near the
 * line, red over it).
 *
 * PURE PRESENTATION: all limit math lives in the shared self-tested core
 * (src/lib/menu/cart-limit-meter-core.ts, which reuses the same engine + gram
 * parse the register uses). This component only renders the result. It NEVER
 * blocks checkout — the online cart is a pre-order estimate; the authoritative
 * gate stays server-side (the /api/orders placement flag + the POS completion
 * hard gate). Matches the storefront's existing "confirmed in store" caveat.
 */
import { useMemo } from "react";
import {
  activeBuckets,
  evaluateCartMeter,
  hasTrackedWeight,
  meterStatus,
  type CartLimitLineInput,
  type CartLimitStatus,
} from "@/lib/menu/cart-limit-meter-core";

type CartLimitMeterProps = {
  /** The cart lines (a subset of the cart items — category/quantity/variantLabel). */
  items: readonly CartLimitLineInput[];
};

const STATUS_BADGE: Record<CartLimitStatus, { label: string; className: string }> = {
  ok: { label: "OK", className: "bg-[var(--greenway)]/15 text-[var(--greenway)]" },
  near: { label: "NEAR", className: "bg-amber-400/15 text-amber-300" },
  over: { label: "OVER", className: "bg-red-500/15 text-red-300" },
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function CartLimitMeter({ items }: CartLimitMeterProps) {
  const evaluation = useMemo(() => evaluateCartMeter(items), [items]);
  const status = meterStatus(evaluation);
  const buckets = activeBuckets(evaluation);
  const tracked = hasTrackedWeight(evaluation);
  const badge = STATUS_BADGE[status];

  return (
    <section
      className="grid gap-2.5 rounded-[1.15rem] border border-white/10 bg-white/5 p-4"
      aria-label="Washington legal purchase limit"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-zinc-400">
          Legal limit (WAC 314-55-095)
        </span>
        {tracked ? (
          <span
            className={`rounded-full px-2 py-0.5 text-[0.62rem] font-black uppercase tracking-[0.08em] ${badge.className}`}
          >
            {badge.label}
          </span>
        ) : null}
      </div>

      {tracked ? (
        <div className="grid gap-2">
          {buckets.map((b) => {
            const pct = Math.min(100, Math.round(b.ratio * 100));
            const barColor = b.exceeded
              ? "bg-red-500"
              : b.ratio > 0.8
                ? "bg-amber-400"
                : "bg-[var(--greenway)]";
            return (
              <div key={b.bucket} className="text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-bold text-zinc-300">{b.label}</span>
                  <span className={`font-black ${b.exceeded ? "text-red-300" : "text-zinc-200"}`}>
                    {round1(b.usedGrams)}g / {round1(b.maxGrams)}g
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-black/50">
                  <div
                    className={`h-full rounded-full ${barColor}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs leading-5 text-zinc-500">
          Add cannabis products and this meter fills toward Washington&apos;s per-visit purchase
          limit.
        </p>
      )}

      {status === "over" ? (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-semibold leading-5 text-red-200">
          This exceeds Washington&apos;s legal purchase and possession limit for the highlighted
          category. Please remove items to continue — Washington law (RCW 69.50.360 &amp;
          69.50.4013) caps how much you may buy and carry in a single visit.
        </p>
      ) : status === "near" ? (
        <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-semibold leading-5 text-amber-200">
          You&apos;re close to Washington&apos;s per-visit limit on one category. You can still
          check out — final limits are confirmed in store.
        </p>
      ) : null}
    </section>
  );
}
