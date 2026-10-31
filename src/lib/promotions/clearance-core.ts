/**
 * src/lib/promotions/clearance-core.ts   (Fix Phase 4.5b · F-06-17 · owner D57)
 *
 * PURE rules for the Clearance screen (Promotions → Clearance markdowns). No
 * I/O, no clock: the caller passes the store's Pacific day.
 *
 * THE OWNER, VERBATIM
 *   "The only other sale we do that is not specific to the day is a 50% off
 *    products we have been sitting on for too long and things about to
 *    expire. ... Those items are excluded from any and all other sales/ daily
 *    deals" (markdown-lock-core.ts L8-11), and D57: "making sure products get
 *    heavily discounted before expiring".
 *
 * WHAT THIS DOES
 *   1. Finds the candidates, one row per PRODUCT (a markdown targets a product
 *      key, never a single lot; the register cannot tell lots apart at the
 *      line, recall-hold-core.ts):
 *        - "expiring": a sellable lot expiring within `expiringDays` (30, the
 *          same window as Plan a count → Expiring soon, count-generators-core
 *          EXPIRING_WINDOW_DAYS), or already expired but only WARNED at the
 *          register (flower, vapes, ...: expired-stock-core "warn");
 *        - "sitting": the oldest lot with stock was received `sittingDays` or
 *          more ago (default 90: the "90+" aging bucket on Inventory →
 *          Insights; the owner gave no number, so the screen lets him change
 *          it for the visit and stores nothing).
 *   2. Says why each one CANNOT be marked down, instead of hiding it:
 *        - an expired edible / liquid edible / tincture / capsule / RSO is
 *          HARD-BLOCKED at the register (D36, D44): it is destroyed, not sold;
 *        - not linked to a register product (no pos_product_key);
 *        - not on the published menu (nothing to discount);
 *        - on the never-discount list (that list wins over every deal,
 *          markdown included: markdown-lock-core).
 *   3. Notes a product that is already on a markdown promotion.
 *   4. Builds the DRAFT promotion: percent off (50 by default), product
 *      targets, `config.markdownOnly = true` (the lock, 4.5a). It is saved as
 *      a draft and goes through the normal Publish (below-cost guard) on the
 *      promotion page. Nothing here publishes.
 *
 * Money is integer cents throughout.
 */

export const CLEARANCE_DEFAULT_PERCENT = 50;
export const CLEARANCE_MIN_PERCENT = 5;
export const CLEARANCE_MAX_PERCENT = 90;
export const CLEARANCE_EXPIRING_DAYS = 30;
export const CLEARANCE_DEFAULT_SITTING_DAYS = 90;
export const CLEARANCE_MIN_SITTING_DAYS = 30;
export const CLEARANCE_MAX_SITTING_DAYS = 730;
/** Cap per draft so one promotion stays readable and the guard stays fast. */
export const CLEARANCE_MAX_PRODUCTS = 200;
/** Badge priority for a clearance markdown (higher shows first on cards). */
export const CLEARANCE_PRIORITY = 100;

export const CLEARANCE_OWNER_QUOTE =
  "a 50% off products we have been sitting on for too long and things about to expire. ... Those items are excluded from any and all other sales/ daily deals";

/** Same hard-block set as expired-stock-core (D36, D44); kept local so this stays pure. */
export type ExpiryKind = "block" | "warn";

export type ClearanceLot = {
  lotId: string;
  lotCode: string | null;
  posProductKey: string | null;
  productName: string | null;
  onHandQty: number;
  /** Cents per unit, or null when unknown (never treated as zero). */
  unitCostMinorUnits: number | null;
  /** YYYY-MM-DD or null. */
  expiresOn: string | null;
  /** YYYY-MM-DD: the true receipt day, or the row's creation day when unknown. */
  receivedOn: string | null;
  /** True when receivedOn is the creation day, not a recorded receipt. */
  receivedIsGuess: boolean;
  /** Block or warn when expired (expired-stock-core expiryKindFor). */
  expiredKind: ExpiryKind;
};

export type ClearanceMenuItem = { name: string; brand: string; priceMinorUnits: number };

export type ExistingMarkdown = { promotionId: string; title: string; status: string; percent: number };

export type ClearanceReason =
  | { kind: "expired"; days: number; on: string }
  | { kind: "expiring"; days: number; on: string }
  | { kind: "sitting"; days: number; since: string; guess: boolean };

export type ClearanceBlock = "hard_block_expired" | "no_product_key" | "not_on_menu" | "never_discount";

export type ClearanceCandidate = {
  /** The register product key, or `lot:<id>` when the lot has none. */
  key: string;
  productName: string;
  brand: string | null;
  lots: ClearanceLot[];
  onHandQty: number;
  reasons: ClearanceReason[];
  /** Soonest expiry in days (negative = expired), or null. Sort key. */
  soonestDays: number | null;
  /** Oldest receipt age in days, or null. */
  oldestDays: number | null;
  priceMinorUnits: number | null;
  /** Price at the chosen percent, or null when not on the menu. */
  markdownPriceMinorUnits: number | null;
  /** Highest known unit cost among the lots, or null. */
  maxUnitCostMinorUnits: number | null;
  /** True when the markdown price is under a known unit cost. The publish guard decides. */
  belowCost: boolean;
  blocked: ClearanceBlock | null;
  existing: ExistingMarkdown[];
};

export type ClearanceSettings = { percent: number; sittingDays: number; expiringDays?: number };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function dayNumber(ymd: string): number | null {
  if (!YMD.test(ymd)) return null;
  const t = Date.parse(`${ymd}T00:00:00Z`);
  return Number.isNaN(t) ? null : Math.round(t / 86_400_000);
}

/** Whole-number percent inside the allowed band, or the default. */
export function clampPercent(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return CLEARANCE_DEFAULT_PERCENT;
  return Math.min(CLEARANCE_MAX_PERCENT, Math.max(CLEARANCE_MIN_PERCENT, Math.round(n)));
}

/** Whole days inside the allowed band, or the default. */
export function clampSittingDays(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return CLEARANCE_DEFAULT_SITTING_DAYS;
  return Math.min(CLEARANCE_MAX_SITTING_DAYS, Math.max(CLEARANCE_MIN_SITTING_DAYS, Math.round(n)));
}

/** Price after `percent` off, rounded to the cent (the engine rounds per line too). */
export function markdownPrice(priceMinorUnits: number, percent: number): number {
  return Math.round((priceMinorUnits * (100 - percent)) / 100);
}

export function reasonText(r: ClearanceReason): string {
  if (r.kind === "expired") return `Expired ${r.days} day${r.days === 1 ? "" : "s"} ago (${r.on}); the register warns, so it can still be sold.`;
  if (r.kind === "expiring") return r.days === 0 ? `Expires today (${r.on}).` : `Expires in ${r.days} day${r.days === 1 ? "" : "s"} (${r.on}).`;
  return `On the shelf ${r.days} days (since ${r.since}${r.guess ? ", the day it was entered; no receipt day recorded" : ""}).`;
}

export const CLEARANCE_BLOCK_TEXT: Record<ClearanceBlock, string> = {
  hard_block_expired:
    "Expired edible, liquid edible, tincture, capsule or RSO: the register refuses the sale (owner decisions D36, D44). Quarantine and destroy it; do not mark it down.",
  no_product_key: "Not linked to a register product, so a markdown cannot reach it. Link the lot on its lot page first.",
  not_on_menu: "Not on the published menu, so there is no price to mark down.",
  never_discount: "On the never-discount list. That list wins over every deal, a markdown included; take it off the list first if you mean to clear it.",
};

/**
 * The candidates, one per product, soonest expiry first, then longest on the
 * shelf. Lots with nothing on hand are ignored.
 */
export function findClearanceCandidates(input: {
  lots: readonly ClearanceLot[];
  menu: ReadonlyMap<string, ClearanceMenuItem>;
  neverDiscount: ReadonlySet<string>;
  existing: ReadonlyMap<string, ExistingMarkdown[]>;
  today: string;
  settings: ClearanceSettings;
}): ClearanceCandidate[] {
  const today = dayNumber(input.today);
  if (today === null) return [];
  const percent = clampPercent(input.settings.percent);
  const sitting = clampSittingDays(input.settings.sittingDays);
  const window = input.settings.expiringDays ?? CLEARANCE_EXPIRING_DAYS;

  type Acc = { lots: ClearanceLot[]; reasons: ClearanceReason[]; hardBlocked: boolean; soonest: number | null; oldest: number | null };
  const byKey = new Map<string, Acc>();
  const allByKey = new Map<string, ClearanceLot[]>();
  for (const l of input.lots) {
    if (!Number.isFinite(l.onHandQty) || l.onHandQty <= 0) continue;
    const key = l.posProductKey?.trim() ? l.posProductKey.trim() : `lot:${l.lotId}`;
    const all = allByKey.get(key) ?? [];
    all.push(l);
    allByKey.set(key, all);

    const reasons: ClearanceReason[] = [];
    let hard = false;
    let expDays: number | null = null;
    if (l.expiresOn) {
      const e = dayNumber(l.expiresOn.slice(0, 10));
      if (e !== null) {
        const d = e - today;
        if (d < 0) {
          if (l.expiredKind === "block") hard = true;
          else reasons.push({ kind: "expired", days: -d, on: l.expiresOn.slice(0, 10) });
          expDays = d;
        } else if (d <= window) {
          reasons.push({ kind: "expiring", days: d, on: l.expiresOn.slice(0, 10) });
          expDays = d;
        }
      }
    }
    let age: number | null = null;
    if (l.receivedOn) {
      const r = dayNumber(l.receivedOn.slice(0, 10));
      if (r !== null && today - r >= sitting) {
        age = today - r;
        reasons.push({ kind: "sitting", days: age, since: l.receivedOn.slice(0, 10), guess: l.receivedIsGuess });
      }
    }
    if (reasons.length === 0 && !hard) continue;
    const acc = byKey.get(key) ?? { lots: [], reasons: [], hardBlocked: false, soonest: null, oldest: null };
    acc.lots.push(l);
    acc.reasons.push(...reasons);
    if (hard) acc.hardBlocked = true;
    if (expDays !== null) acc.soonest = acc.soonest === null ? expDays : Math.min(acc.soonest, expDays);
    if (age !== null) acc.oldest = acc.oldest === null ? age : Math.max(acc.oldest, age);
    byKey.set(key, acc);
  }

  const out: ClearanceCandidate[] = [];
  for (const [key, acc] of byKey) {
    const isLotOnly = key.startsWith("lot:");
    const menuItem = isLotOnly ? undefined : input.menu.get(key);
    // Every lot of the product with stock rides along: the markdown reaches them all.
    const lots = allByKey.get(key) ?? acc.lots;
    const onHand = lots.reduce((s, l) => s + l.onHandQty, 0);
    let maxCost: number | null = null;
    for (const l of lots) {
      if (l.unitCostMinorUnits !== null && Number.isInteger(l.unitCostMinorUnits)) {
        maxCost = maxCost === null ? l.unitCostMinorUnits : Math.max(maxCost, l.unitCostMinorUnits);
      }
    }
    const blocked: ClearanceBlock | null = acc.hardBlocked
      ? "hard_block_expired"
      : isLotOnly
        ? "no_product_key"
        : !menuItem
          ? "not_on_menu"
          : input.neverDiscount.has(key)
            ? "never_discount"
            : null;
    const price = menuItem ? menuItem.priceMinorUnits : null;
    const mdPrice = price === null ? null : markdownPrice(price, percent);
    out.push({
      key,
      productName: menuItem?.name || lots[0]?.productName || "Unnamed product",
      brand: menuItem?.brand || null,
      lots,
      onHandQty: onHand,
      reasons: acc.reasons,
      soonestDays: acc.soonest,
      oldestDays: acc.oldest,
      priceMinorUnits: price,
      markdownPriceMinorUnits: mdPrice,
      maxUnitCostMinorUnits: maxCost,
      belowCost: mdPrice !== null && maxCost !== null && mdPrice < maxCost,
      blocked,
      existing: isLotOnly ? [] : (input.existing.get(key) ?? []),
    });
  }
  out.sort((a, b) => {
    const sa = a.soonestDays ?? Number.MAX_SAFE_INTEGER;
    const sb = b.soonestDays ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    const oa = a.oldestDays ?? -1;
    const ob = b.oldestDays ?? -1;
    if (oa !== ob) return ob - oa;
    return a.productName.localeCompare(b.productName);
  });
  return out;
}

/** True when the candidate should be ticked when the page opens. */
export function preselected(c: ClearanceCandidate): boolean {
  return c.blocked === null && c.existing.length === 0;
}

export type ClearanceDraft = {
  title: string;
  description: string;
  discount_type: "percent";
  discount_percent: number;
  discount_fixed: 0;
  multi_item_percent: null;
  config: { markdownOnly: true };
  per_item_sale: true;
  bonus_note: string;
  weekday: null;
  priority: number;
  targets: { scope: "product"; value: string }[];
};

export type ClearanceDraftResult = { ok: true; draft: ClearanceDraft } | { ok: false; error: string };

/**
 * The draft promotion for the ticked products. Only keys that are eligible
 * candidates RIGHT NOW are accepted (a crafted post cannot add a blocked or
 * unknown product). Nothing is published here.
 */
export function buildClearanceDraft(input: {
  keys: readonly string[];
  candidates: readonly ClearanceCandidate[];
  percent: unknown;
  title?: string | null;
  today: string;
}): ClearanceDraftResult {
  const percent = clampPercent(input.percent);
  const eligible = new Map(input.candidates.filter((c) => c.blocked === null).map((c) => [c.key, c]));
  const keys: string[] = [];
  const refused: string[] = [];
  for (const raw of input.keys) {
    const k = String(raw ?? "").trim();
    if (!k || keys.includes(k)) continue;
    if (eligible.has(k)) keys.push(k);
    else refused.push(k);
  }
  if (refused.length > 0) {
    return { ok: false, error: `Nothing was created: ${refused.length} product${refused.length === 1 ? " is" : "s are"} no longer eligible for a markdown. Reload the page and pick again.` };
  }
  if (keys.length === 0) return { ok: false, error: "Nothing was created: tick at least one product." };
  if (keys.length > CLEARANCE_MAX_PRODUCTS) {
    return { ok: false, error: `Nothing was created: ${keys.length} products is more than ${CLEARANCE_MAX_PRODUCTS} in one markdown. Split it in two.` };
  }
  const chosen = keys.map((k) => eligible.get(k)!);
  const expiring = chosen.filter((c) => c.reasons.some((r) => r.kind !== "sitting")).length;
  const sitting = chosen.filter((c) => c.reasons.some((r) => r.kind === "sitting")).length;
  const title = (input.title ?? "").trim() || `Clearance ${percent}% off \u2014 ${input.today}`;
  const lines = chosen.map((c) => `${c.productName}: ${c.reasons.map(reasonText).join(" ")}`);
  const description =
    `Clearance markdown, ${percent}% off, built on Promotions \u2192 Clearance markdowns on ${input.today}. ` +
    `${expiring} expiring or expired, ${sitting} on the shelf too long. ` +
    `Excluded from every other deal (markdownOnly). Owner: "${CLEARANCE_OWNER_QUOTE}".\n` +
    lines.join("\n");
  return {
    ok: true,
    draft: {
      title: title.slice(0, 160),
      description: description.slice(0, 8000),
      discount_type: "percent",
      discount_percent: percent,
      discount_fixed: 0,
      multi_item_percent: null,
      config: { markdownOnly: true },
      per_item_sale: true,
      bonus_note: "Clearance \u2014 no other deal applies",
      weekday: null,
      priority: CLEARANCE_PRIORITY,
      targets: keys.map((k) => ({ scope: "product" as const, value: k })),
    },
  };
}

// ---------------------------------------------------------------------------
// Self-tests (pure)
// ---------------------------------------------------------------------------

export function __runClearanceTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, name: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.log(`FAIL clearance-core: ${name}`);
    }
  };
  const lot = (id: string, o: Partial<ClearanceLot> = {}): ClearanceLot => ({
    lotId: id,
    lotCode: `L-${id}`,
    posProductKey: `k-${id}`,
    productName: `P ${id}`,
    onHandQty: 5,
    unitCostMinorUnits: 800,
    expiresOn: null,
    receivedOn: "2026-10-01",
    receivedIsGuess: false,
    expiredKind: "warn",
    ...o,
  });
  const menu = new Map<string, ClearanceMenuItem>([
    ["k-a", { name: "Alpha", brand: "B1", priceMinorUnits: 2000 }],
    ["k-b", { name: "Beta", brand: "B2", priceMinorUnits: 2000 }],
    ["k-c", { name: "Gamma", brand: "B3", priceMinorUnits: 1000 }],
    ["k-d", { name: "Delta", brand: "B4", priceMinorUnits: 3000 }],
    ["k-e", { name: "Edible", brand: "B5", priceMinorUnits: 1500 }],
  ]);
  const today = "2026-10-30";
  const run = (lots: ClearanceLot[], extra: Partial<{ never: Set<string>; existing: Map<string, ExistingMarkdown[]>; percent: number; sitting: number }> = {}) =>
    findClearanceCandidates({
      lots,
      menu,
      neverDiscount: extra.never ?? new Set(),
      existing: extra.existing ?? new Map(),
      today,
      settings: { percent: extra.percent ?? 50, sittingDays: extra.sitting ?? 90 },
    });

  const c1 = run([
    lot("a", { expiresOn: "2026-11-05" }),
    lot("b", { receivedOn: "2026-06-01" }),
    lot("c"),
    lot("d", { expiresOn: "2026-10-20" }),
    lot("e", { expiresOn: "2026-10-20", expiredKind: "block" }),
    lot("z", { expiresOn: "2027-06-01" }),
  ]);
  ok(c1.map((c) => c.key).join(",") === "k-d,k-e,k-a,k-b", "expired, expiring, sitting; fresh and far left out; soonest first");
  ok(c1[0]!.blocked === null && c1[0]!.reasons[0]!.kind === "expired", "expired flower is a warning: can be marked down");
  ok(c1[1]!.blocked === "hard_block_expired", "expired edible is hard-blocked: never a markdown (D36, D44)");
  ok(c1[2]!.markdownPriceMinorUnits === 1000 && c1[2]!.priceMinorUnits === 2000, "50% of $20.00 is $10.00, in cents");
  ok(c1[3]!.reasons[0]!.kind === "sitting" && c1[3]!.oldestDays === 151, "on the shelf 151 days");
  ok(reasonText(c1[2]!.reasons[0]!) === "Expires in 6 days (2026-11-05).", "expiring reason text");

  const c2 = run([lot("a", { expiresOn: "2026-11-01" }), lot("b", { expiresOn: "2026-11-01" })], { never: new Set(["k-b"]) });
  ok(c2.find((c) => c.key === "k-b")!.blocked === "never_discount", "never-discount wins");
  const c3 = run([lot("x", { posProductKey: null, expiresOn: "2026-11-01" }), lot("q", { expiresOn: "2026-11-01" })]);
  ok(c3.some((c) => c.key === "lot:x" && c.blocked === "no_product_key"), "no product key is named, not hidden");
  ok(c3.some((c) => c.key === "k-q" && c.blocked === "not_on_menu"), "not on menu is named");

  const c4 = run([lot("a", { expiresOn: "2026-11-01" }), lot("a2", { posProductKey: "k-a", expiresOn: "2027-09-01", onHandQty: 3 })]);
  ok(c4.length === 1 && c4[0]!.lots.length === 2 && c4[0]!.onHandQty === 8, "every lot of the product rides along");
  ok(run([lot("a", { expiresOn: "2026-11-01", onHandQty: 0 })]).length === 0, "nothing on hand, nothing to clear");

  const c5 = run([lot("c", { expiresOn: "2026-11-01", unitCostMinorUnits: 600 })]);
  ok(c5[0]!.belowCost === true && c5[0]!.markdownPriceMinorUnits === 500, "$5.00 under a $6.00 cost is flagged");
  const c6 = run([lot("c", { expiresOn: "2026-11-01", unitCostMinorUnits: null })]);
  ok(c6[0]!.belowCost === false && c6[0]!.maxUnitCostMinorUnits === null, "unknown cost is not invented");

  const ex = new Map([["k-a", [{ promotionId: "p1", title: "Old clearance", status: "published", percent: 40 }]]]);
  const c7 = run([lot("a", { expiresOn: "2026-11-01" })], { existing: ex });
  ok(c7[0]!.existing.length === 1 && !preselected(c7[0]!), "already marked down: shown, not pre-ticked");
  ok(run([lot("b", { receivedOn: "2026-06-01" })], { sitting: 200 }).length === 0, "sitting threshold respected");
  const g = run([lot("b", { receivedOn: "2026-06-01", receivedIsGuess: true })]);
  ok(reasonText(g[0]!.reasons[0]!).includes("no receipt day recorded"), "a guessed receipt day says so");

  ok(clampPercent("") === 50 && clampPercent(99) === 90 && clampPercent(2) === 5 && clampPercent("35") === 35, "percent band");
  ok(clampSittingDays("abc") === 90 && clampSittingDays(5) === 30 && clampSittingDays(1000) === 730, "sitting band");

  const d = buildClearanceDraft({ keys: ["k-a", "k-d", "k-a"], candidates: c1, percent: "", today });
  ok(d.ok && d.draft.config.markdownOnly === true && d.draft.discount_percent === 50, "draft is a 50% markdown with the lock");
  ok(d.ok && d.draft.targets.map((t) => t.value).join(",") === "k-a,k-d" && d.draft.targets.every((t) => t.scope === "product"), "product targets, deduped");
  ok(d.ok && d.draft.title === "Clearance 50% off \u2014 2026-10-30" && d.draft.weekday === null, "default title, not a weekday deal");
  ok(d.ok && d.draft.description.includes("2 expiring or expired, 0 on the shelf too long"), "both picks counted as expiring or expired, none as sitting");
  const bad = buildClearanceDraft({ keys: ["k-e"], candidates: c1, percent: 50, today });
  ok(!bad.ok && bad.error.includes("no longer eligible"), "a blocked product cannot be posted in");
  const none = buildClearanceDraft({ keys: [], candidates: c1, percent: 50, today });
  ok(!none.ok && none.error.includes("tick at least one"), "empty refused");
  return { passed, failed };
}
