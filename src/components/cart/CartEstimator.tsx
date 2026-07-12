"use client";

/**
 * src/components/cart/CartEstimator.tsx  (Task T / PR 2 — Cart Estimator)
 *
 * "Estimate my register total" panel for the cart drawer + checkout review.
 * Three register-final estimates, all driven by the SAME live back-office
 * config the register uses (fetched from /api/estimator):
 *
 *  1. TIER NUDGES — "add 3.5g to unlock 20%" from the active published rules
 *     (the same snapshots pricing the cart), computed by tierNudges().
 *  2. LOYALTY — enter a points balance → estimated $ off (live earn rate,
 *     point value, minimum-to-redeem from loyalty_config) + points this order
 *     would earn.
 *  3. MEDICAL — "I have a WA medical card" toggle → HONEST best-case
 *     tax-savings range (verified DOH-registry lines set the floor;
 *     unverified cannabis lines only raise the ceiling), grounded in
 *     RCW 82.08.9998 + WAC 314-55-090 via estimator-core.ts.
 *
 * Every figure is labeled an estimate; the register is always final.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useActiveDealRules } from "@/components/promotions/PublishedRulesProvider";
import { formatMinorCurrency } from "@/lib/leafly/format";
import type { GreenwayCategory } from "@/lib/leafly/types";
import type { EngineCartLine } from "@/lib/promotions/discount-engine-core";
import {
  estimateEarnPoints,
  estimateLoyaltyRedemption,
  estimateMedicalSavings,
  tierNudges,
  type EstimatorContext,
  type EstimatorLine,
} from "@/lib/checkout/estimator-core";
/**
 * The cart-item fields the estimator needs — a structural subset of the
 * provider's PricedCartItem, passed as props to avoid a circular import
 * between CartProvider (which renders the estimator) and this component.
 */
export type EstimatorCartItem = {
  lineId: string;
  productId: string;
  productName: string;
  brand: string;
  category: string;
  filterCategories?: GreenwayCategory[];
  variantLabel: string;
  quantity: number;
  regularPriceMinorUnits: number;
  effectivePriceMinorUnits: number;
};

export function CartEstimator({
  items,
  subtotalMinorUnits,
  totalMinorUnits,
  variant = "drawer",
}: {
  items: EstimatorCartItem[];
  /** Pre-tax subtotal (minor units) — the loyalty EARN basis, like the register. */
  subtotalMinorUnits: number;
  /** Out-the-door total (minor units). */
  totalMinorUnits: number;
  variant?: "drawer" | "checkout";
}) {
  const activeRules = useActiveDealRules();

  const [expanded, setExpanded] = useState(false);
  const [context, setContext] = useState<EstimatorContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [pointsInput, setPointsInput] = useState("");
  const [medicalToggle, setMedicalToggle] = useState(false);
  const fetchedKeyRef = useRef<string>("");

  // Product keys drive the DOH-registry lookup; refetch when the set changes.
  const productKey = useMemo(
    () => [...new Set(items.map((i) => i.productId))].sort().join("|"),
    [items],
  );

  const loadContext = useCallback(async () => {
    if (fetchedKeyRef.current === productKey && context) return;
    setLoading(true);
    try {
      const res = await fetch("/api/estimator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: [...new Set(items.map((i) => i.productId))] }),
      });
      if (res.ok) {
        const data = (await res.json()) as { ok?: boolean; context?: EstimatorContext };
        if (data.ok && data.context) {
          setContext(data.context);
          fetchedKeyRef.current = productKey;
        }
      }
    } catch {
      // Leave context null — the panel shows only the nudges (pure client math).
    } finally {
      setLoading(false);
    }
  }, [productKey, context, items]);

  // Deferred to a microtask so the effect body never sets state synchronously
  // (react-hooks/set-state-in-effect) — same pattern as CartProvider hydration.
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) void loadContext();
    });
    return () => {
      cancelled = true;
    };
  }, [expanded, loadContext]);

  // ---- Estimator lines from the engine-priced cart items ----
  const estimatorLines = useMemo<EstimatorLine[]>(
    () =>
      items.map((item) => ({
        lineId: item.lineId,
        productId: item.productId || null,
        productName: item.productName,
        category: item.category,
        quantity: item.quantity,
        unitPriceMinorUnits: item.effectivePriceMinorUnits,
      })),
    [items],
  );

  // Engine lines (regular prices) for nudges — same mapping CartProvider uses.
  const engineLines = useMemo<EngineCartLine[]>(
    () =>
      items.map((item) => {
        const cats = item.filterCategories?.length
          ? item.filterCategories
          : [item.category as GreenwayCategory];
        return {
          lineId: item.lineId,
          regularPriceMinorUnits: item.regularPriceMinorUnits,
          quantity: item.quantity,
          categories: cats.map((c) => String(c).toLowerCase()),
          brand: item.brand || null,
          productKey: item.productId,
          variantLabel: item.variantLabel,
          costMinorUnits: null,
        };
      }),
    [items],
  );

  const nudges = useMemo(
    () => (activeRules ? tierNudges(engineLines, activeRules).slice(0, 2) : []),
    [engineLines, activeRules],
  );

  // ---- Loyalty ----
  const loyaltyCfg = context?.loyalty ?? null;
  const earn = useMemo(
    () => (loyaltyCfg ? estimateEarnPoints(subtotalMinorUnits, loyaltyCfg) : null),
    [loyaltyCfg, subtotalMinorUnits],
  );
  const redeem = useMemo(() => {
    if (!loyaltyCfg) return null;
    const parsed = Number.parseInt(pointsInput.trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return estimateLoyaltyRedemption(parsed, loyaltyCfg, estimatorLines);
  }, [loyaltyCfg, pointsInput, estimatorLines]);

  // ---- Medical ----
  const medical = useMemo(() => {
    if (!context || !medicalToggle) return null;
    return estimateMedicalSavings(estimatorLines, context.registry, context.medical);
  }, [context, medicalToggle, estimatorLines]);

  // Estimated best-case totals after each adjustment (never below $0.01/unit;
  // the simple subtraction here is display-only — the register recomputes).
  const loyaltyAdjustedTotal =
    redeem?.status === "ok" ? Math.max(0, totalMinorUnits - redeem.valueMinor) : null;

  if (items.length === 0) return null;

  const shellClass =
    variant === "drawer"
      ? "rounded-[1.15rem] border border-white/10 bg-white/5"
      : "rounded-2xl border border-white/10 bg-white/5";

  return (
    <section className={shellClass} aria-label="Register total estimator">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
        aria-expanded={expanded}
      >
        <span className="text-xs font-black uppercase tracking-[0.14em] text-white">
          Estimate my register total
        </span>
        <span
          className={`text-lg font-black leading-none text-[var(--greenway)] transition-transform ${expanded ? "rotate-45" : ""}`}
          aria-hidden="true"
        >
          +
        </span>
      </button>

      {expanded ? (
        <div className="grid gap-4 border-t border-white/10 px-4 pb-4 pt-4">
          {/* 1 — Tier nudges from the live published rules */}
          {nudges.length > 0 ? (
            <div className="grid gap-2">
              {nudges.map((nudge) => (
                <p
                  key={`${nudge.ruleId}-${nudge.kind}`}
                  className="rounded-xl bg-[var(--greenway)]/10 px-3 py-2.5 text-xs font-bold leading-5 text-[var(--greenway)]"
                >
                  {nudge.ruleTitle}: add {nudge.addLabel} to unlock {nudge.unlockLabel}
                  {nudge.estAdditionalSavingsMinor > 0 ? (
                    <span className="text-white/70">
                      {" "}
                      — save about {formatMinorCurrency(nudge.estAdditionalSavingsMinor)} more
                    </span>
                  ) : null}
                </p>
              ))}
            </div>
          ) : null}

          {loading && !context ? (
            <p className="text-xs font-bold text-zinc-500">Loading live program terms…</p>
          ) : null}

          {/* 2 — Loyalty points */}
          {loyaltyCfg ? (
            <div className="grid gap-2">
              <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-zinc-400">
                Greenway Points
              </p>
              <label className="grid gap-1.5">
                <span className="text-xs font-bold text-zinc-300">
                  Your points balance (optional)
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={pointsInput}
                  onChange={(e) => setPointsInput(e.target.value)}
                  placeholder="e.g. 450"
                  className="w-full rounded-xl border border-white/15 bg-black/40 px-3.5 py-2.5 text-sm font-bold text-white placeholder:text-zinc-600 focus:border-[var(--greenway)] focus:outline-none"
                />
              </label>
              {redeem?.status === "below_min" ? (
                <p className="text-xs font-bold leading-5 text-zinc-400">
                  {redeem.shortfallPoints} more point{redeem.shortfallPoints === 1 ? "" : "s"} to
                  reach the {loyaltyCfg.minRedeemPoints}-point redemption minimum.
                </p>
              ) : null}
              {redeem?.status === "ok" ? (
                <div className="rounded-xl bg-black/40 px-3 py-2.5">
                  <p className="text-xs font-bold leading-5 text-white">
                    Estimated points value:{" "}
                    <span className="text-[var(--greenway)]">
                      −{formatMinorCurrency(redeem.valueMinor)}
                    </span>
                    {redeem.cappedByCart ? (
                      <span className="text-zinc-500"> (capped by this cart)</span>
                    ) : null}
                  </p>
                  {loyaltyAdjustedTotal != null ? (
                    <p className="mt-1 text-xs font-bold leading-5 text-zinc-400">
                      Best-case total: {formatMinorCurrency(loyaltyAdjustedTotal)}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {earn ? (
                <p className="text-xs font-bold leading-5 text-zinc-400">
                  This order earns about {earn.points.toLocaleString("en-US")} point
                  {earn.points === 1 ? "" : "s"}
                  {earn.valueMinor > 0 ? ` (≈ ${formatMinorCurrency(earn.valueMinor)})` : ""} —
                  members earn on every pretax dollar.
                </p>
              ) : null}
            </div>
          ) : null}

          {/* 3 — Medical card toggle */}
          {context ? (
            <div className="grid gap-2">
              <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-zinc-400">
                Medical Patients
              </p>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={medicalToggle}
                  onChange={(e) => setMedicalToggle(e.target.checked)}
                  className="h-4 w-4 accent-[var(--greenway)]"
                />
                <span className="text-xs font-bold text-zinc-300">
                  I have a WA medical recognition card
                </span>
              </label>
              {medical ? (
                medical.endorsed ? (
                  <div className="rounded-xl bg-black/40 px-3 py-2.5">
                    {medical.maxMinor > 0 ? (
                      <>
                        <p className="text-xs font-bold leading-5 text-white">
                          Estimated tax savings:{" "}
                          <span className="text-[var(--greenway)]">
                            {medical.minMinor === medical.maxMinor
                              ? formatMinorCurrency(medical.maxMinor)
                              : `${formatMinorCurrency(medical.minMinor)} – ${formatMinorCurrency(medical.maxMinor)}`}
                          </span>
                        </p>
                        <p className="mt-1 text-[0.68rem] font-bold leading-4 text-zinc-500">
                          {medical.verifiedLineCount > 0
                            ? `${medical.verifiedLineCount} item${medical.verifiedLineCount === 1 ? "" : "s"} verified DOH-compliant. `
                            : ""}
                          {medical.unverifiedCannabisLineCount > 0
                            ? `Best case assumes ${medical.unverifiedCannabisLineCount} more item${medical.unverifiedCannabisLineCount === 1 ? " qualifies" : "s qualify"} — staff verify DOH compliance at pickup.`
                            : "Exemptions apply only to DOH-compliant (chapter 246-70 WAC) products with a valid card."}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs font-bold leading-5 text-zinc-400">
                        No items in this cart qualify for medical tax exemptions yet — only
                        DOH-compliant (chapter 246-70 WAC) cannabis products qualify, verified at
                        pickup.
                      </p>
                    )}
                    {medical.highThcNames.length > 0 ? (
                      <p className="mt-1.5 text-[0.68rem] font-bold leading-4 text-[#ffd700]">
                        Note: {medical.highThcNames.join(", ")}{" "}
                        {medical.highThcNames.length === 1 ? "is a" : "are"} High-THC product
                        {medical.highThcNames.length === 1 ? "" : "s"} — sold only to valid
                        recognition-card holders.
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs font-bold leading-5 text-zinc-400">
                    Medical tax exemptions are not currently available at this store.
                  </p>
                )
              ) : null}
            </div>
          ) : null}

          <p className="text-[0.62rem] leading-4 text-zinc-600">
            All figures are estimates — final pricing, taxes, discounts, and exemptions are
            confirmed at the register. Discounts never stack; the register applies whichever
            single deal saves you the most per item.
          </p>
        </div>
      ) : null}
    </section>
  );
}
