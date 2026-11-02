/**
 * src/lib/inventory/expired-stock-core.ts  (Fix Phase 1.6b, G-24)
 *
 * PURE rules for expired stock at the register. No I/O, no clock (the caller
 * passes the store's Pacific day as `today`, YYYY-MM-DD).
 *
 * OWNER DECISIONS (docs/sop-program/00-OWNER-REQUEST-VERBATIM.md):
 *   D36: "hard block edibles and liquid edibles, warnings for everything else."
 *   D44: "Q-05a-6- yes, same with rso too."  (Q-05a-6 asked about Tincture
 *        and Capsule; the answer adds RSO.)
 *
 * So an expired lot is one of two kinds:
 *   - "block": Solid Edible, Liquid Edible, Tincture, Capsule or RSO. The sale
 *     is refused; there is NO override. The nightly job moves these lots to
 *     Quarantine (planExpiredQuarantine).
 *   - "warn":  every other expired lot. The budtender must acknowledge a
 *     warning, and the acknowledgement is recorded on the sale.
 *
 * HOW A LOT IS RECOGNISED AS HARD-BLOCKED (any one is enough):
 *   1. Its CCRS inventory type (inventory_lots.inventory_type) is Solid
 *      Edible, Liquid Edible, Tincture or Capsule (ccrs-batch-core.ts
 *      CCRS_INVENTORY_TYPES, EndProduct), or the 2021 spellings "Solid
 *      Marijuana Infused Edible" / "Liquid Marijuana Infused Edible".
 *   2. Its raw store category (inventory_lots.category, the Cultivera
 *      Category) maps to edible-solid, edible-liquid, tincture or rso in the
 *      ledger's own measured map (ledger-category-map-core.ts
 *      LEDGER_CATEGORY_MAP, e.g. "RSO" -> "rso", "Capsule" -> "edible-solid").
 *   3. The order line's category snapshot is one of those slugs.
 *   4. The product name says RSO ("RSO" as a word, or "Rick Simpson").
 * RSO has no CCRS type of its own: it is filed as Concentrate for Inhalation
 * (fact-extraction-core.ts L890-894) and the website menu files it under
 * "concentrate" (transform.ts CATEGORY_MAP "RSO": "concentrate"). A rule keyed
 * only on the CCRS type or the website category would miss it (F-05a-20).
 * Every test above can only ADD a block, never remove one, so a wrong match
 * errs toward refusing the sale, the safe direction.
 *
 * WHY A WHOLE PRODUCT IS HELD: order lines carry no lot identity (the lot is
 * chosen after the sale, recall-hold-core.ts), and the draw is FEFO, so an
 * expired lot with stock is the FIRST lot a sale would take. While any Active
 * expired hard-block lot of a product still holds units, the product is held.
 * Moving that lot to Quarantine (the nightly job, or by hand on the lot page)
 * releases the fresh stock at once.
 */
import { resolveLedgerCategory } from "@/lib/accounting/ledger-category-map-core";

export const EXPIRED_HARD_BLOCK_CCRS_TYPES: readonly string[] = [
  "Solid Edible",
  "Liquid Edible",
  "Tincture",
  "Capsule",
] as const;

/** 2021 CCRS Data Model spellings still seen on manifests and in Cultivera. */
const LEGACY_HARD_BLOCK_TYPES: readonly string[] = [
  "Solid Marijuana Infused Edible",
  "Liquid Marijuana Infused Edible",
] as const;

/** Store category slugs that are hard-blocked when expired (D36, D44). */
export const EXPIRED_HARD_BLOCK_CATEGORIES: readonly string[] = [
  "edible-solid",
  "edible-liquid",
  "tincture",
  "capsule",
  "rso",
] as const;

export const EXPIRED_WARNING_AUDIT_ACTION = "order.expired_warning_acknowledged";
export const EXPIRED_QUARANTINE_AUDIT_ACTION = "inventory_lot.expired_quarantined";
/** The reason recorded on the audit row of a nightly quarantine. */
export const EXPIRED_QUARANTINE_REASON =
  "Expired edible, liquid edible, tincture, capsule or RSO moved to Quarantine by the nightly expiry job (owner decisions D36, D44).";
/** Prefix of the gate refusal that asks for the warning to be acknowledged. */
export const EXPIRED_WARNING_REFUSAL_PREFIX = "Expired product warning:";

function norm(s: string | null | undefined): string {
  return typeof s === "string" ? s.replace(/[\s\u00a0]+/g, " ").trim().toLowerCase() : "";
}

const HARD_TYPES = new Set([...EXPIRED_HARD_BLOCK_CCRS_TYPES, ...LEGACY_HARD_BLOCK_TYPES].map(norm));
const HARD_CATEGORIES = new Set(EXPIRED_HARD_BLOCK_CATEGORIES);

export type ExpiryLot = {
  id: string;
  posProductKey: string | null;
  productName: string | null;
  status: string | null;
  /** inventory_lots.expires_on, YYYY-MM-DD or null. */
  expiresOn: string | null;
  /** Sellable units (on hand less held). */
  sellableQty: number;
  /** inventory_lots.category (raw store / CCRS category). */
  category: string | null;
  /** inventory_lots.inventory_type (CCRS type). */
  inventoryType: string | null;
  isSample?: boolean | null;
};

export type ExpiryKind = "block" | "warn";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** True when the lot's expiry date is before `today` (both YYYY-MM-DD). */
export function isExpiredOn(expiresOn: string | null | undefined, today: string): boolean {
  if (typeof expiresOn !== "string") return false;
  const d = expiresOn.slice(0, 10);
  if (!YMD.test(d) || !YMD.test(today)) return false;
  return d < today;
}

/** True when the product name says RSO ("RSO" as a word, or "Rick Simpson"). */
export function nameSaysRso(name: string | null | undefined): boolean {
  if (typeof name !== "string") return false;
  return /(^|[^a-z0-9])rso([^a-z0-9]|$)/i.test(name) || /rick\s+simpson/i.test(name);
}

/**
 * Hard block (D36, D44) or warning, for an expired lot. `lineCategory` is the
 * order line's category snapshot when known.
 */
export function expiryKindFor(
  lot: Pick<ExpiryLot, "category" | "inventoryType" | "productName">,
  lineCategory?: string | null,
): ExpiryKind {
  if (HARD_TYPES.has(norm(lot.inventoryType))) return "block";
  if (lineCategory && HARD_CATEGORIES.has(norm(lineCategory))) return "block";
  if (lot.category) {
    if (HARD_CATEGORIES.has(norm(lot.category))) return "block";
    if (HARD_TYPES.has(norm(lot.category))) return "block";
    const r = resolveLedgerCategory(lot.category);
    if (r.ok && HARD_CATEGORIES.has(r.slug)) return "block";
  }
  if (nameSaysRso(lot.productName)) return "block";
  return "warn";
}

/**
 * An Active (or Sold out - register-sell-sold-out-stock: the register now
 * rings Sold out lots too, so the expiry hold must see them) non-sample lot
 * with sellable units whose expiry has passed.
 */
export function isSellableExpired(lot: ExpiryLot, today: string): boolean {
  return (
    // register-sell-everything-fix-later: Quarantine lots sell now too.
    (lot.status === "active" || lot.status === "sold_out" || lot.status === "quarantine") &&
    lot.isSample !== true &&
    Number.isFinite(lot.sellableQty) &&
    lot.sellableQty > 0 &&
    isExpiredOn(lot.expiresOn, today)
  );
}

export type ExpiredKeyIndex = {
  /** Product keys held: an expired hard-block lot still has sellable units. */
  blocked: Map<string, { expiresOn: string; productName: string | null }>;
  /** Product keys with an expired warn lot (earliest expiry kept). */
  warned: Map<string, { expiresOn: string; productName: string | null }>;
};

/** Index sellable expired lots by product key. Garbage rows are skipped. */
export function buildExpiredKeyIndex(
  lots: readonly ExpiryLot[],
  today: string,
  lineCategoryByKey?: ReadonlyMap<string, string | null>,
): ExpiredKeyIndex {
  const blocked = new Map<string, { expiresOn: string; productName: string | null }>();
  const warned = new Map<string, { expiresOn: string; productName: string | null }>();
  for (const lot of Array.isArray(lots) ? lots : []) {
    if (!lot || typeof lot.posProductKey !== "string") continue;
    const key = lot.posProductKey.trim();
    if (!key || !isSellableExpired(lot, today)) continue;
    const kind = expiryKindFor(lot, lineCategoryByKey?.get(key) ?? null);
    const target = kind === "block" ? blocked : warned;
    const d = (lot.expiresOn as string).slice(0, 10);
    const prev = target.get(key);
    if (!prev || d < prev.expiresOn) target.set(key, { expiresOn: d, productName: lot.productName });
  }
  // A key that is blocked is never only "warned".
  for (const k of blocked.keys()) warned.delete(k);
  return { blocked, warned };
}

export type ExpiryLine = {
  productId: string | null;
  /** The lot key the line's size encodes, when it has one. */
  variantLotKey?: string | null;
  productName: string;
  category?: string | null;
};

export type ExpiredLineVerdict = {
  blocked: { productName: string; expiresOn: string }[];
  warned: { productName: string; expiresOn: string }[];
};

/** Which of an order's lines are held, and which only need a warning. */
export function evaluateExpiredLines(lines: readonly ExpiryLine[], index: ExpiredKeyIndex): ExpiredLineVerdict {
  const blocked: { productName: string; expiresOn: string }[] = [];
  const warned: { productName: string; expiresOn: string }[] = [];
  const seenB = new Set<string>();
  const seenW = new Set<string>();
  for (const l of lines) {
    const keys = [l.variantLotKey, l.productId].filter((k): k is string => typeof k === "string" && k.trim() !== "");
    const b = keys.map((k) => index.blocked.get(k)).find(Boolean);
    if (b) {
      if (!seenB.has(l.productName)) {
        seenB.add(l.productName);
        blocked.push({ productName: l.productName, expiresOn: b.expiresOn });
      }
      continue;
    }
    const w = keys.map((k) => index.warned.get(k)).find(Boolean);
    if (w && !seenW.has(l.productName)) {
      seenW.add(l.productName);
      warned.push({ productName: l.productName, expiresOn: w.expiresOn });
    }
  }
  return { blocked, warned };
}

/** MM/DD/YYYY from YYYY-MM-DD (store display). */
export function usDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : ymd;
}

function list(items: { productName: string; expiresOn: string }[]): string {
  return items.map((i) => `"${i.productName}" (expired ${usDate(i.expiresOn)})`).join(", ");
}

/** The gate refusal for hard-blocked lines (no override), or null. */
export function expiredBlockRefusal(v: ExpiredLineVerdict): string | null {
  if (v.blocked.length === 0) return null;
  return `Sale blocked: ${list(v.blocked)} ${v.blocked.length === 1 ? "is" : "are"} past the expiry date. Expired edibles, liquid edibles, tinctures, capsules and RSO cannot be sold, and there is no override (owner decisions D36, D44). Remove the item. To sell the fresh stock of this product, open the expired lot and set it to Quarantine (the nightly job also does this).`;
}

/** The refusal asking for the warning to be acknowledged, or null. */
export function expiredWarningRefusal(v: ExpiredLineVerdict, acknowledged: boolean): string | null {
  if (v.warned.length === 0 || acknowledged) return null;
  return `${EXPIRED_WARNING_REFUSAL_PREFIX} ${list(v.warned)} ${v.warned.length === 1 ? "has" : "have"} stock past the expiry date. Tell the customer, then tick "I told the customer" and complete again (owner decision D36).`;
}

/** The note recorded on the order when a warned sale completes. */
export function expiredWarningNote(v: ExpiredLineVerdict, how: "register" | "back_office" | "not_acknowledged"): string | null {
  if (v.warned.length === 0) return null;
  const who =
    how === "register"
      ? "The budtender acknowledged the expiry warning at the register."
      : how === "back_office"
        ? "Staff acknowledged the expiry warning in the back office."
        : "The register's menu download was older than the expiry check, so no acknowledgement was asked for; review this sale.";
  return `Expired stock sold with a warning: ${list(v.warned)}. ${who} (owner decision D36)`;
}

/** Lots the nightly job moves to Quarantine: Active, expired, hard-block kind. */
export function planExpiredQuarantine(lots: readonly ExpiryLot[], today: string): ExpiryLot[] {
  return (Array.isArray(lots) ? lots : []).filter(
    (l) =>
      !!l &&
      l.status === "active" &&
      isExpiredOn(l.expiresOn, today) &&
      expiryKindFor(l) === "block",
  );
}

/* ------------------------------------------------------------------ *
 * Self-tests
 * ------------------------------------------------------------------ */
export function __runExpiredStockCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`expired-stock-core FAIL: ${m}`);
    }
  };
  const T = "2026-07-10";
  const lot = (o: Partial<ExpiryLot>): ExpiryLot => ({
    id: "l1",
    posProductKey: "k1",
    productName: "Thing",
    status: "active",
    expiresOn: "2026-07-01",
    sellableQty: 5,
    category: null,
    inventoryType: null,
    ...o,
  });

  ok(isExpiredOn("2026-07-09", T), "yesterday is expired");
  ok(!isExpiredOn("2026-07-10", T), "today is not expired yet");
  ok(!isExpiredOn(null, T) && !isExpiredOn("garbage", T), "no date is never expired");
  ok(isExpiredOn("2026-07-09T00:00:00Z", T), "timestamp form reads the date");

  for (const t of ["Solid Edible", "Liquid Edible", "Tincture", "Capsule", "solid  edible", "Solid Marijuana Infused Edible"]) {
    ok(expiryKindFor(lot({ inventoryType: t })) === "block", `CCRS type ${t} is hard-blocked`);
  }
  ok(
    expiryKindFor(lot({ inventoryType: "Concentrate for Inhalation", category: "RSO", productName: "CannaSol Aliens 1g" })) === "block",
    "RSO filed as Concentrate for Inhalation is blocked by its store category",
  );
  ok(
    expiryKindFor(lot({ inventoryType: "Concentrate for Inhalation", category: "EndProduct", productName: "CannaSol RSO Aliens on Moonshine 1g" })) === "block",
    "RSO from a manifest (EndProduct) is blocked by its name",
  );
  ok(
    expiryKindFor(lot({ inventoryType: "Concentrate for Inhalation", productName: "Hash" }), "rso") === "block",
    "RSO by the line's category snapshot",
  );
  ok(expiryKindFor(lot({ category: "Gummies" })) === "block", "Gummies (edible-solid) blocked by store category");
  ok(expiryKindFor(lot({ category: "Beverage" })) === "block", "Beverage (edible-liquid) blocked");
  ok(expiryKindFor(lot({ category: "Capsule" })) === "block", "Capsule category blocked");
  ok(expiryKindFor(lot({ category: "Tincture" })) === "block", "Tincture category blocked");
  ok(
    expiryKindFor(lot({ inventoryType: "Concentrate for Inhalation", category: "Wax", productName: "Live Resin Wax 1g" })) === "warn",
    "a non-RSO concentrate is a warning",
  );
  ok(expiryKindFor(lot({ inventoryType: "Usable Cannabis", category: "Flower", productName: "Gelato 3.5g" })) === "warn", "flower is a warning");
  ok(expiryKindFor(lot({ inventoryType: "Topical Ointment", productName: "Balm" })) === "warn", "topical is a warning");
  ok(!nameSaysRso("Crisp Prerolls") && !nameSaysRso("Torso Balm"), "RSO must be a whole word");
  ok(nameSaysRso("Rick Simpson Oil 1g") && nameSaysRso("RSO-1g"), "RSO name forms");

  const idx = buildExpiredKeyIndex(
    [
      lot({ id: "a", posProductKey: "gum", inventoryType: "Solid Edible", productName: "Gummies" }),
      lot({ id: "b", posProductKey: "wax", inventoryType: "Concentrate for Inhalation", productName: "Wax", expiresOn: "2026-07-05" }),
      lot({ id: "c", posProductKey: "wax", inventoryType: "Concentrate for Inhalation", productName: "Wax", expiresOn: "2026-07-02" }),
      lot({ id: "d", posProductKey: "gone", inventoryType: "Solid Edible", sellableQty: 0 }),
      lot({ id: "e", posProductKey: "q", inventoryType: "Solid Edible", status: "quarantine" }),
      lot({ id: "f", posProductKey: "fresh", inventoryType: "Solid Edible", expiresOn: "2027-01-01" }),
      lot({ id: "g", posProductKey: "smp", inventoryType: "Solid Edible", isSample: true }),
      lot({ id: "h", posProductKey: "mix", inventoryType: "Usable Cannabis", productName: "Mix" }),
      lot({ id: "i", posProductKey: "mix", category: "Gummies", productName: "Mix" }),
    ],
    T,
  );
  ok(idx.blocked.has("gum") && !idx.warned.has("gum"), "expired edible key is blocked");
  ok(idx.warned.get("wax")?.expiresOn === "2026-07-02", "warned key keeps the earliest expiry");
  ok(!idx.blocked.has("gone") && !idx.blocked.has("fresh") && !idx.blocked.has("smp"), "empty, fresh and sample lots never hold");
  // register-sell-everything-fix-later: a Quarantine lot sells, so an expired
  // edible in Quarantine is blocked exactly like an Active one.
  ok(idx.blocked.has("q"), "an expired Quarantine edible is blocked (it would otherwise sell)");
  ok(idx.blocked.has("mix") && !idx.warned.has("mix"), "a blocked key is never only warned");

  const v = evaluateExpiredLines(
    [
      { productId: "gum", productName: "Gummies" },
      { productId: "card", variantLotKey: "wax", productName: "Wax" },
      { productId: "other", productName: "Fine" },
      { productId: "gum", productName: "Gummies" },
    ],
    idx,
  );
  ok(v.blocked.length === 1 && v.blocked[0].productName === "Gummies", "blocked line found once");
  ok(v.warned.length === 1 && v.warned[0].productName === "Wax", "warned line found through its size's lot key");
  const r = expiredBlockRefusal(v) ?? "";
  ok(r.includes("no override") && r.includes("07/01/2026") && r.includes("Quarantine"), "block refusal names date, no override and the fix");
  ok(expiredBlockRefusal({ blocked: [], warned: [] }) === null, "no block, no refusal");
  ok((expiredWarningRefusal(v, false) ?? "").startsWith(EXPIRED_WARNING_REFUSAL_PREFIX), "warning needs acknowledgement");
  ok(expiredWarningRefusal(v, true) === null, "acknowledged warning passes");
  ok((expiredWarningNote(v, "register") ?? "").includes("at the register"), "note records the register acknowledgement");
  ok((expiredWarningNote(v, "not_acknowledged") ?? "").includes("review this sale"), "note flags an unacknowledged sale");
  ok(expiredWarningNote({ blocked: [], warned: [] }, "register") === null, "no warned lines, no note");

  const plan = planExpiredQuarantine(
    [
      lot({ id: "p1", inventoryType: "Solid Edible" }),
      lot({ id: "p2", inventoryType: "Concentrate for Inhalation", category: "RSO" }),
      lot({ id: "p3", inventoryType: "Usable Cannabis" }),
      lot({ id: "p4", inventoryType: "Tincture", status: "recalled" }),
      lot({ id: "p5", inventoryType: "Capsule", expiresOn: "2026-07-10" }),
      lot({ id: "p6", inventoryType: "Liquid Edible", sellableQty: 0 }),
    ],
    T,
  );
  ok(plan.map((p) => p.id).join() === "p1,p2,p6", "nightly plan: active expired hard-block lots only (empty ones too)");
  ok(usDate("2026-07-01") === "07/01/2026", "US date");
  return { passed, failed };
}
