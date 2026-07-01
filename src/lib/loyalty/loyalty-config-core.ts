/**
 * src/lib/loyalty/loyalty-config-core.ts
 *
 * PURE, dependency-free logic for the Loyalty customizer (Slice 67, item 2).
 * Parsing/validation of owner-entered program settings and a live "what a
 * customer earns" preview. No I/O, no server-only imports — unit-testable via
 * tsx.
 *
 * Money is in MINOR UNITS (cents). Discounts in basis points (bps).
 */

export type ConfigDraft = {
  pointsPerDollar: number;
  pointValueMinor: number;
  minRedeemPoints: number;
  signupBonusPoints: number;
  codeExpiryDays: number | null;
};

export type TierDraft = {
  name: string;
  minPoints: number;
  discountBps: number;
};

export type PromoKind = "signup" | "happy_hour" | "promo" | "custom";

export type PromoDraft = {
  name: string;
  kind: PromoKind;
  multiplierBps: number;
  flatBonusPoints: number;
  hourStart: number | null;
  hourEnd: number | null;
  isActive: boolean;
};

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

// ---------------------------------------------------------------------------
// Small parse helpers
// ---------------------------------------------------------------------------
/** Parse a decimal from a form string; returns NaN if blank/invalid. */
export function parseDecimal(raw: unknown): number {
  const s = String(raw ?? "").trim();
  if (s === "") return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Parse a non-negative integer from a form string; NaN if blank/invalid. */
export function parseInt0(raw: unknown): number {
  const s = String(raw ?? "").trim();
  if (s === "") return NaN;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : NaN;
}

/** Convert a whole/decimal percent (e.g. "10" or "12.5") into basis points. */
export function percentToBps(raw: unknown): number {
  const pct = parseDecimal(raw);
  if (!Number.isFinite(pct)) return NaN;
  return Math.round(pct * 100);
}

/** Convert a dollar string (e.g. "0.01") into minor units (cents). */
export function dollarsToMinor(raw: unknown): number {
  const d = parseDecimal(raw);
  if (!Number.isFinite(d)) return NaN;
  return Math.round(d * 100);
}

export function bpsToPercentLabel(bps: number): string {
  const pct = bps / 100;
  return `${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(2)}%`;
}

export function minorToDollarsLabel(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------
export function parseConfigDraft(input: {
  pointsPerDollar: unknown;
  pointValueMinor: unknown; // already in cents
  minRedeemPoints: unknown;
  signupBonusPoints: unknown;
  codeExpiryDays: unknown; // "" => never (null)
}): ParseResult<ConfigDraft> {
  const errors: string[] = [];

  const ppd = parseDecimal(input.pointsPerDollar);
  if (!Number.isFinite(ppd) || ppd < 0) errors.push("Earn rate must be 0 or more points per dollar.");
  else if (ppd > 100) errors.push("Earn rate looks too high (max 100 pt/$1).");

  const pvm = parseInt0(input.pointValueMinor);
  if (!Number.isFinite(pvm) || pvm < 1) errors.push("Point value must be at least $0.01 per point.");
  else if (pvm > 10000) errors.push("Point value looks too high (max $100.00 per point).");

  const mrp = parseInt0(input.minRedeemPoints);
  if (!Number.isFinite(mrp) || mrp < 0) errors.push("Minimum to redeem must be 0 or more points.");

  const sbp = parseInt0(input.signupBonusPoints);
  if (!Number.isFinite(sbp) || sbp < 0) errors.push("Signup bonus must be 0 or more points.");
  else if (sbp > 100000) errors.push("Signup bonus looks too high (max 100,000 points).");

  let ced: number | null = null;
  const cedRaw = String(input.codeExpiryDays ?? "").trim();
  if (cedRaw !== "") {
    const n = parseInt0(cedRaw);
    if (!Number.isFinite(n) || n < 1) errors.push("Code expiry must be blank (never) or 1+ days.");
    else if (n > 3650) errors.push("Code expiry looks too high (max 3650 days).");
    else ced = n;
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      pointsPerDollar: ppd,
      pointValueMinor: pvm,
      minRedeemPoints: mrp,
      signupBonusPoints: sbp,
      codeExpiryDays: ced,
    },
  };
}

// ---------------------------------------------------------------------------
// Tier validation
// ---------------------------------------------------------------------------
export function parseTierDraft(input: {
  name: unknown;
  minPoints: unknown;
  discountBps: unknown; // already bps
}): ParseResult<TierDraft> {
  const errors: string[] = [];
  const name = String(input.name ?? "").trim();
  if (name === "") errors.push("Tier name is required.");
  else if (name.length > 40) errors.push("Tier name is too long (max 40 characters).");

  const minPoints = parseInt0(input.minPoints);
  if (!Number.isFinite(minPoints) || minPoints < 0) errors.push("Tier threshold must be 0 or more points.");

  const discountBps = parseInt0(input.discountBps);
  if (!Number.isFinite(discountBps) || discountBps < 0) errors.push("Tier discount must be 0% or more.");
  else if (discountBps > 10000) errors.push("Tier discount cannot exceed 100%.");

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { name, minPoints, discountBps } };
}

/** Warn if two tiers share a threshold or a lower tier gives a bigger discount. */
export function tierWarnings(tiers: TierDraft[]): string[] {
  const warnings: string[] = [];
  const sorted = [...tiers].sort((a, b) => a.minPoints - b.minPoints);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].minPoints === sorted[i - 1].minPoints) {
      warnings.push(`Two tiers share the same ${sorted[i].minPoints}-point threshold.`);
    }
    if (sorted[i].discountBps < sorted[i - 1].discountBps) {
      warnings.push(
        `"${sorted[i].name}" needs more points than "${sorted[i - 1].name}" but gives a smaller discount.`,
      );
    }
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Promotion validation
// ---------------------------------------------------------------------------
const PROMO_KINDS: PromoKind[] = ["signup", "happy_hour", "promo", "custom"];

export function parsePromoDraft(input: {
  name: unknown;
  kind: unknown;
  multiplierBps: unknown; // already bps (10000 = 1.0x)
  flatBonusPoints: unknown;
  hourStart: unknown;
  hourEnd: unknown;
  isActive: unknown;
}): ParseResult<PromoDraft> {
  const errors: string[] = [];
  const name = String(input.name ?? "").trim();
  if (name === "") errors.push("Promotion name is required.");
  else if (name.length > 60) errors.push("Promotion name is too long (max 60 characters).");

  const kindRaw = String(input.kind ?? "").trim();
  const kind = (PROMO_KINDS.includes(kindRaw as PromoKind) ? kindRaw : "promo") as PromoKind;

  const multiplierBps = parseInt0(input.multiplierBps);
  if (!Number.isFinite(multiplierBps) || multiplierBps < 10000) {
    errors.push("Multiplier must be at least 1.0x (no reduction).");
  } else if (multiplierBps > 100000) {
    errors.push("Multiplier looks too high (max 10x).");
  }

  const flatBonusPoints = parseInt0(input.flatBonusPoints);
  if (!Number.isFinite(flatBonusPoints) || flatBonusPoints < 0) {
    errors.push("Flat bonus points must be 0 or more.");
  }

  let hourStart: number | null = null;
  let hourEnd: number | null = null;
  if (kind === "happy_hour") {
    hourStart = parseInt0(input.hourStart);
    hourEnd = parseInt0(input.hourEnd);
    if (!Number.isFinite(hourStart) || hourStart < 0 || hourStart > 23) {
      errors.push("Happy-hour start must be an hour 0–23.");
    }
    if (!Number.isFinite(hourEnd) || hourEnd < 0 || hourEnd > 23) {
      errors.push("Happy-hour end must be an hour 0–23.");
    }
  } else {
    const hs = String(input.hourStart ?? "").trim();
    const he = String(input.hourEnd ?? "").trim();
    hourStart = hs === "" ? null : parseInt0(hs);
    hourEnd = he === "" ? null : parseInt0(he);
  }

  const isActive = input.isActive === true || input.isActive === "true" || input.isActive === "on";

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: { name, kind, multiplierBps, flatBonusPoints, hourStart, hourEnd, isActive },
  };
}

// ---------------------------------------------------------------------------
// Live earn preview
// ---------------------------------------------------------------------------
/**
 * Preview points a customer would earn on a given PRETAX subtotal (minor
 * units), optionally applying a promotion's multiplier + flat bonus. Mirrors
 * the flooring rules in engine.ts.
 */
export function previewEarn(opts: {
  subtotalMinor: number;
  cfg: ConfigDraft;
  multiplierBps?: number;
  flatBonusPoints?: number;
}): { base: number; total: number; valueMinor: number } {
  const { subtotalMinor, cfg } = opts;
  if (subtotalMinor <= 0) return { base: 0, total: 0, valueMinor: 0 };
  const dollars = subtotalMinor / 100;
  const base = Math.floor(dollars * cfg.pointsPerDollar);
  const mult = opts.multiplierBps ?? 10000;
  const boosted = Math.floor((base * mult) / 10000);
  const total = boosted + (opts.flatBonusPoints ?? 0);
  return { base, total, valueMinor: total * cfg.pointValueMinor };
}

// ---------------------------------------------------------------------------
// Tests (run via tsx; see _zt.ts pattern)
// ---------------------------------------------------------------------------
export function __runLoyaltyConfigTests(): void {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  };

  // percent/dollar conversions
  assert(percentToBps("10") === 1000, "10% => 1000 bps");
  assert(percentToBps("12.5") === 1250, "12.5% => 1250 bps");
  assert(dollarsToMinor("0.01") === 1, "$0.01 => 1 cent");
  assert(dollarsToMinor("1") === 100, "$1 => 100 cents");
  assert(bpsToPercentLabel(2500) === "25%", "2500 bps => 25%");
  assert(minorToDollarsLabel(1) === "$0.01", "1 cent => $0.01");

  // config validation
  const okCfg = parseConfigDraft({
    pointsPerDollar: "1",
    pointValueMinor: "1",
    minRedeemPoints: "100",
    signupBonusPoints: "0",
    codeExpiryDays: "",
  });
  assert(okCfg.ok && okCfg.value.codeExpiryDays === null, "blank expiry => never");
  const badCfg = parseConfigDraft({
    pointsPerDollar: "-1",
    pointValueMinor: "0",
    minRedeemPoints: "x",
    signupBonusPoints: "-5",
    codeExpiryDays: "0",
  });
  assert(!badCfg.ok, "bad config rejected");

  // tier validation + warnings
  const okTier = parseTierDraft({ name: "Gold", minPoints: "300", discountBps: "2500" });
  assert(okTier.ok && okTier.value.discountBps === 2500, "gold tier ok");
  const badTier = parseTierDraft({ name: "", minPoints: "-1", discountBps: "20000" });
  assert(!badTier.ok, "bad tier rejected");
  const warns = tierWarnings([
    { name: "A", minPoints: 100, discountBps: 2000 },
    { name: "B", minPoints: 200, discountBps: 1000 },
  ]);
  assert(warns.some((w) => w.includes("smaller discount")), "detects inverted discount");

  // promo validation
  const okPromo = parsePromoDraft({
    name: "Double Tuesday",
    kind: "promo",
    multiplierBps: "20000",
    flatBonusPoints: "0",
    hourStart: "",
    hourEnd: "",
    isActive: "on",
  });
  assert(okPromo.ok && okPromo.value.multiplierBps === 20000, "2x promo ok");
  const happy = parsePromoDraft({
    name: "Happy Hour",
    kind: "happy_hour",
    multiplierBps: "15000",
    flatBonusPoints: "0",
    hourStart: "16",
    hourEnd: "18",
    isActive: true,
  });
  assert(happy.ok && happy.value.hourStart === 16 && happy.value.hourEnd === 18, "happy hour window");
  const badHappy = parsePromoDraft({
    name: "X",
    kind: "happy_hour",
    multiplierBps: "5000",
    flatBonusPoints: "0",
    hourStart: "30",
    hourEnd: "40",
    isActive: true,
  });
  assert(!badHappy.ok, "bad happy hour rejected (multiplier<1x + bad hours)");

  // earn preview
  const cfg: ConfigDraft = {
    pointsPerDollar: 1,
    pointValueMinor: 1,
    minRedeemPoints: 100,
    signupBonusPoints: 0,
    codeExpiryDays: null,
  };
  const p1 = previewEarn({ subtotalMinor: 5000, cfg });
  assert(p1.base === 50 && p1.total === 50, "$50 => 50 pts");
  const p2 = previewEarn({ subtotalMinor: 5000, cfg, multiplierBps: 20000, flatBonusPoints: 10 });
  assert(p2.total === 110, "$50 @2x +10 => 110 pts");
  const p3 = previewEarn({ subtotalMinor: 0, cfg });
  assert(p3.total === 0, "$0 => 0 pts");

  console.log("loyalty-config-core: ALL TESTS PASSED");
}
