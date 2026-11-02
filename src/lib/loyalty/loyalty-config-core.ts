/**
 * src/lib/loyalty/loyalty-config-core.ts
 *
 * PURE, dependency-free logic for the Loyalty customizer (Slice 67, item 2).
 * Parsing/validation of owner-entered program settings and a live "what a
 * customer earns" preview. No I/O, no server-only imports — unit-testable via
 * tsx.
 *
 * Money is in MINOR UNITS (cents). Discounts in basis points (bps).
 *
 * D138 (owner, 2026-11-02): "the $0.10-per-point should be retired". Points
 * have NO cash value, so the point value and minimum-to-redeem settings are
 * gone from the customizer. Rewards are fixed (loyalty-reward-core.ts).
 * D139: member badges (tiers) are names only — the only thing the owner
 * edits about a badge is its name (parseTierName).
 */

export type ConfigDraft = {
  pointsPerDollar: number;
  signupBonusPoints: number;
  codeExpiryDays: number | null;
};

/** A member badge as the rename card sees it (names only — D139). */
export type BadgeNameDraft = {
  id: string;
  name: string;
  minPoints: number;
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
  signupBonusPoints: unknown;
  codeExpiryDays: unknown; // "" => never (null)
}): ParseResult<ConfigDraft> {
  const errors: string[] = [];

  const ppd = parseDecimal(input.pointsPerDollar);
  if (!Number.isFinite(ppd) || ppd < 0) errors.push("Earn rate must be 0 or more points per dollar.");
  else if (ppd > 100) errors.push("Earn rate looks too high (max 100 pt/$1).");

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
      signupBonusPoints: sbp,
      codeExpiryDays: ced,
    },
  };
}

// ---------------------------------------------------------------------------
// Member badge names (D139 — names only)
// ---------------------------------------------------------------------------
export const BADGE_NAME_MAX = 40;

/**
 * Validate a new badge name. Trims and collapses inner whitespace, refuses
 * blank / too long / control characters, and refuses a name another badge
 * already uses (case-insensitive) so the register never shows two "Gold"s.
 */
export function parseTierName(
  raw: unknown,
  opts?: { otherNames?: string[] },
): ParseResult<string> {
  const name = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const errors: string[] = [];
  if (name === "") errors.push("Badge name is required.");
  else if (name.length > BADGE_NAME_MAX) errors.push(`Badge name is too long (max ${BADGE_NAME_MAX} characters).`);
  else if (/[\u0000-\u001f<>]/.test(name)) errors.push("Badge name can only use letters, numbers, spaces and simple punctuation.");
  else if ((opts?.otherNames ?? []).some((n) => n.trim().toLowerCase() === name.toLowerCase())) {
    errors.push(`Another badge is already called "${name}".`);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: name };
}

/** Warn when two badges share a name or a threshold (display clarity only). */
export function badgeNameWarnings(badges: BadgeNameDraft[]): string[] {
  const warnings: string[] = [];
  const sorted = [...badges].sort((a, b) => a.minPoints - b.minPoints);
  const seen = new Set<string>();
  for (let i = 0; i < sorted.length; i += 1) {
    const key = sorted[i].name.trim().toLowerCase();
    if (seen.has(key)) warnings.push(`Two badges are both called "${sorted[i].name}".`);
    seen.add(key);
    if (i > 0 && sorted[i].minPoints === sorted[i - 1].minPoints) {
      warnings.push(`Two badges share the same ${sorted[i].minPoints}-point threshold.`);
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
}): { base: number; total: number } {
  const { subtotalMinor, cfg } = opts;
  if (subtotalMinor <= 0) return { base: 0, total: 0 };
  const dollars = subtotalMinor / 100;
  const base = Math.floor(dollars * cfg.pointsPerDollar);
  const mult = opts.multiplierBps ?? 10000;
  const boosted = Math.floor((base * mult) / 10000);
  const total = boosted + (opts.flatBonusPoints ?? 0);
  return { base, total };
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
    signupBonusPoints: "0",
    codeExpiryDays: "",
  });
  assert(okCfg.ok && okCfg.value.codeExpiryDays === null, "blank expiry => never");
  const badCfg = parseConfigDraft({
    pointsPerDollar: "-1",
    signupBonusPoints: "-5",
    codeExpiryDays: "0",
  });
  assert(!badCfg.ok, "bad config rejected");
  // D138: the retired point value can't sneak back in through the draft.
  assert(okCfg.ok && Object.keys(okCfg.value).sort().join(",") === "codeExpiryDays,pointsPerDollar,signupBonusPoints", "no point value in config (D138)");

  // badge names (D139)
  const n1 = parseTierName("  Green   Leaf ");
  assert(n1.ok && n1.value === "Green Leaf", "badge name trimmed + collapsed");
  assert(!parseTierName("").ok, "blank badge name refused");
  assert(!parseTierName("x".repeat(41)).ok, "41-char badge name refused");
  assert(parseTierName("x".repeat(40)).ok, "40-char badge name ok");
  assert(!parseTierName("<b>Gold</b>").ok, "markup refused");
  assert(!parseTierName("gold", { otherNames: ["Gold"] }).ok, "duplicate name refused (case-insensitive)");
  assert(parseTierName("Gold", { otherNames: ["Bronze"] }).ok, "distinct name ok");
  const warns = badgeNameWarnings([
    { id: "a", name: "Gold", minPoints: 150 },
    { id: "b", name: "gold", minPoints: 300 },
  ]);
  assert(warns.some((w) => w.includes("both called")), "detects duplicate badge names");

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
    signupBonusPoints: 0,
    codeExpiryDays: null,
  };
  const p1 = previewEarn({ subtotalMinor: 5000, cfg });
  assert(p1.base === 50 && p1.total === 50, "$50 => 50 pts");
  const p2 = previewEarn({ subtotalMinor: 5000, cfg, multiplierBps: 20000, flatBonusPoints: 10 });
  assert(p2.total === 110, "$50 @2x +10 => 110 pts");
  const p3 = previewEarn({ subtotalMinor: 0, cfg });
  assert(p3.total === 0, "$0 => 0 pts");
  assert(!("valueMinor" in p1), "earn preview carries no dollar value (D138)");

  console.log("loyalty-config-core: ALL TESTS PASSED");
}
