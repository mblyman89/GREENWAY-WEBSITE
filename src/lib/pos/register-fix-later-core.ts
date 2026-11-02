/**
 * src/lib/pos/register-fix-later-core.ts  (register-sell-everything-fix-later)
 *
 * The owner, verbatim: "Are all others sellable, not just the ones in the
 * screenshots? Some of them wouldn't let me sell them because we could get
 * the coa from Cultivera. I need to sell these products too. Please give me
 * more peace of mind this will work. I need ways of fixing a lot from the
 * register, let the system fix it for me so it can be sold, then set that
 * item aside so I can fix it properly. Everything must sell. No exceptions.
 * We will fix it all later. We need to sell everything we have stock of. No
 * matter what."
 *
 * THE RULE THIS FILE OWNS: a lot with stock on the shelf sells at the
 * register. When the paperwork behind it is incomplete (no COA, still in
 * Quarantine from intake, no menu product, no price) the register sells it
 * anyway, using what the LOT itself knows, and the lot goes on the back
 * office "Fix later" list so it can be put right afterwards.
 *
 * Only two things still keep stock off the register, and both are about the
 * product itself rather than missing paperwork:
 *   - a RECALL hold (the product may hurt someone; a recall is a legal stop);
 *   - a FAILED lab result (it tested as contaminated / over limits).
 * Units already scheduled for destruction are not "stock we have" either.
 * Each of these is listed on the Fix later page with its reason, so nothing
 * is ever silently missing.
 *
 * PURE: no I/O, no server-only imports. tsx-testable via
 * __runRegisterFixLaterCoreTests().
 */
import { resolveWebsiteCategory } from "@/lib/inventory/website-category-resolver";
import { computePriceFloorMinor } from "@/lib/inventory/price-explain-core";
import { isSellableCannabisCategory } from "@/lib/pos/register-coverage-core";
import { gramsFromVariantLabel } from "@/lib/pos/variant-grams-core";
import { ONBOARDED_VARIANT_SUFFIX } from "@/lib/pos/variant-lot-core";
import type { PosMenuBundle, PosMenuProduct } from "@/lib/pos/sale-flow-core";
import { normalizeBarcode } from "@/lib/pos/scan-to-cart-core";

/** Lot statuses whose stock the register sells. Quarantine sells too (owner, "no exceptions"). */
export const REGISTER_FIX_LATER_LOT_STATUSES: ReadonlySet<string> = new Set(["quarantine"]);

/** Audit action written when the register fixes a lot so it can be sold. */
export const REGISTER_FIX_AND_SELL_AUDIT_ACTION = "register.fix_and_sell";

/**
 * Category used when a lot's own facts cannot name one. Concentrate carries
 * the TIGHTEST purchase limit (7 g), so a guess can only ever under-sell the
 * limit, never let a customer leave with more than the law allows.
 */
export const FALLBACK_REGISTER_CATEGORY = "concentrate";

/** Price used only when a lot has no cost on record. The budtender can override it at the register. */
export const FALLBACK_REGISTER_PRICE_MINOR = 2000;

/** The markup the store's auto price uses (pricing.ts DEFAULT_PRICING.min_markup_multiple). */
export const REGISTER_AUTO_MARKUP = 2;

export type FixLaterReason =
  | "quarantine"
  | "no_menu_product"
  | "no_coa"
  | "category_guessed"
  | "price_from_cost"
  | "price_guessed"
  | "fixed_at_register";

export const FIX_LATER_REASON_LABELS: Record<FixLaterReason, string> = {
  quarantine: "Still in Quarantine from intake. It sells anyway; set it to Active once it is checked.",
  no_menu_product: "No menu product uses this lot, so the register sells it from the lot itself. Approve it in Product Onboarding.",
  no_coa: "No COA (lab result) attached. Attach the COA from Cultivera or the vendor.",
  category_guessed: "The category could not be read from the lot, so it rings as Concentrate (the strictest purchase limit). Set its category.",
  price_from_cost: "Priced automatically at 2x cost, tax included. Set its real price.",
  price_guessed: "No cost on record, so it rings at $20.00. Set its cost and price.",
  fixed_at_register: "A budtender fixed this lot at the register so it could be sold.",
};

/** Why a stocked lot is still kept off the register (never paperwork). */
export type RegisterStopReason = "recalled" | "failed_lab" | "scheduled_for_destruction" | "destroyed" | "sample";

export const REGISTER_STOP_LABELS: Record<RegisterStopReason, string> = {
  recalled: "Recall hold. A recalled product is a legal stop; release the recall to sell it.",
  failed_lab: "The lab result FAILED. Failed product may not be sold; return or destroy it.",
  scheduled_for_destruction: "Scheduled for destruction. Cancel the destruction to sell it.",
  destroyed: "Destroyed.",
  sample: "Trade sample. Samples are never sold.",
};

export type FixLaterLot = {
  id: string;
  posProductKey: string | null;
  lotCode: string | null;
  ccrsExternalId?: string | null;
  productName: string | null;
  status: string | null;
  onHandQty: number;
  category?: string | null;
  inventoryType?: string | null;
  unitCostMinor?: number | null;
  unitWeight?: number | string | null;
  unitWeightUom?: string | null;
  hasLabResult?: boolean | null;
  labPassed?: boolean | null;
  isSample?: boolean | null;
  recalled?: boolean;
  scheduledForDestruction?: boolean;
  /** True when a published menu product already sells this lot's key. */
  hasMenuProduct?: boolean;
  /** True when a budtender used "Fix & sell" on this lot. */
  fixedAtRegister?: boolean;
};

function clean(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function statusOf(lot: Pick<FixLaterLot, "status">): string {
  return clean(lot.status).toLowerCase();
}

/** Does the register sell this lot status? Active, Sold out and Quarantine do. */
export function isRegisterServableStatus(status: string | null | undefined): boolean {
  const s = clean(status).toLowerCase();
  return s === "active" || s === "sold_out" || REGISTER_FIX_LATER_LOT_STATUSES.has(s);
}

/**
 * The status the register reads for a lot that is in Quarantine only because
 * a DESTRUCTION is scheduled for it (disposition.ts moves an Active lot to
 * Quarantine when a destruction is scheduled). Not a real lot status: it is
 * a read-time label so a destruction hold can never be mistaken for an
 * intake Quarantine and sold.
 */
export const DESTRUCTION_HOLD_STATUS = "scheduled_destruction";

/**
 * Relabel every Quarantine lot that has an OPEN destruction event as
 * `scheduled_destruction`, so the register never sells product waiting to be
 * destroyed. Other lots (and other statuses) pass through untouched; an
 * Active lot with a partial destruction keeps selling its other units.
 */
export function withDestructionHolds<T extends { id: string; status: string | null }>(
  lots: readonly T[],
  openDestructionLotIds: ReadonlySet<string>,
): T[] {
  if (openDestructionLotIds.size === 0) return [...lots];
  return lots.map((l) =>
    openDestructionLotIds.has(l.id) && clean(l.status).toLowerCase() === "quarantine"
      ? { ...l, status: DESTRUCTION_HOLD_STATUS }
      : l,
  );
}

/** The one reason (if any) a lot is kept off the register. Paperwork is never a reason. */
export function registerStopReason(lot: FixLaterLot): RegisterStopReason | null {
  const s = statusOf(lot);
  if (lot.isSample === true) return "sample";
  if (s === "destroyed") return "destroyed";
  if (s === DESTRUCTION_HOLD_STATUS) return "scheduled_for_destruction";
  if (s === "recalled" || lot.recalled === true) return "recalled";
  if (lot.labPassed === false) return "failed_lab";
  if (lot.scheduledForDestruction === true) return "scheduled_for_destruction";
  return null;
}

/** The lot's size token from its name: "HTE HONEY - Mimosa - .7g" -> "0.7g". */
export function sizeLabelFromName(name: string | null | undefined): string | null {
  const s = clean(name);
  const re = /(\d*\.?\d+)\s*(g|gram|grams|mg|ml|oz)\b/gi;
  let m: RegExpExecArray | null;
  let last: string | null = null;
  while ((m = re.exec(s)) !== null) {
    const num = m[1].startsWith(".") ? `0${m[1]}` : m[1];
    const unit = m[2].toLowerCase().startsWith("gram") ? "g" : m[2].toLowerCase();
    last = `${num}${unit}`;
  }
  return last;
}

/** The size label for a lot: its stored unit weight first, then its name. */
export function lotSizeLabel(lot: Pick<FixLaterLot, "unitWeight" | "unitWeightUom" | "productName">): string | null {
  const w = Number(lot.unitWeight);
  const uom = clean(lot.unitWeightUom).toLowerCase();
  if (Number.isFinite(w) && w > 0 && (uom === "g" || uom === "gram" || uom === "grams")) return `${w}g`;
  return sizeLabelFromName(lot.productName);
}

export type RegisterCategory = { category: string; guessed: boolean };

/** The register category for a lot with no menu product. Never non-cannabis, never unlimited. */
export function registerCategoryForLot(
  lot: Pick<FixLaterLot, "posProductKey" | "productName" | "inventoryType" | "category">,
): RegisterCategory {
  const tryOne = (inventoryType: string | null | undefined) =>
    resolveWebsiteCategory({
      posProductKey: lot.posProductKey,
      productName: lot.productName,
      inventoryType: inventoryType ?? null,
      category: lot.category ?? null,
    }).websiteCategory;
  for (const candidate of [lot.inventoryType, lot.category]) {
    const c = tryOne(candidate);
    if (c && isSellableCannabisCategory(c)) return { category: c, guessed: false };
  }
  return { category: FALLBACK_REGISTER_CATEGORY, guessed: true };
}

export type RegisterPrice = { priceMinor: number; source: "cost" | "guessed" };

/** 2x cost, tax included, rounded up to the whole dollar (the store's own auto price). */
export function registerPriceForLot(unitCostMinor: number | null | undefined, category: string): RegisterPrice {
  const floor = computePriceFloorMinor(unitCostMinor ?? null, REGISTER_AUTO_MARKUP, category);
  if (floor != null && Number.isSafeInteger(floor) && floor > 0) return { priceMinor: floor, source: "cost" };
  return { priceMinor: FALLBACK_REGISTER_PRICE_MINOR, source: "guessed" };
}

/** Register-only variant id for a lot card: the lot key + the onboarded suffix, so the sale draws THIS lot. */
export function fixLaterVariantId(lotKey: string): string {
  return `${lotKey}${ONBOARDED_VARIANT_SUFFIX}`;
}

/**
 * Build the register line for a stocked lot that no menu product sells.
 * Null only when the lot has no product key (there is nothing for the sale
 * to draw against) or a real stop applies.
 */
export function synthesizeLotRegisterProduct(lot: FixLaterLot): PosMenuProduct | null {
  const key = clean(lot.posProductKey);
  if (!key) return null;
  if (registerStopReason(lot)) return null;
  const { category } = registerCategoryForLot(lot);
  const { priceMinor } = registerPriceForLot(lot.unitCostMinor ?? null, category);
  const size = lotSizeLabel(lot);
  const name = clean(lot.productName) || clean(lot.lotCode) || key;
  const units = Math.max(0, Number(lot.onHandQty) || 0);
  const search = [clean(lot.lotCode), clean(lot.ccrsExternalId)].filter(Boolean).join(" | ");
  return {
    productId: key,
    variantId: fixLaterVariantId(key),
    name,
    brand: null,
    category,
    categories: [category],
    variantLabel: size,
    regularPriceMinor: priceMinor,
    costMinorUnits: typeof lot.unitCostMinor === "number" && lot.unitCostMinor > 0 ? lot.unitCostMinor : null,
    unitGrams: gramsFromVariantLabel(size),
    unitVolumeMl: null,
    inventoryStatus: units > 0 ? (units <= 5 ? "low-stock" : "in-stock") : "low-stock",
    unitsLeft: units > 0 ? units : null,
    ...(search ? { searchText: search } : {}),
    thc: "",
    cbd: "",
    fixLater: true,
  };
}

/** Every reason this lot belongs on the Fix later list (empty = nothing to fix). */
export function fixLaterReasons(lot: FixLaterLot): FixLaterReason[] {
  const out: FixLaterReason[] = [];
  if (REGISTER_FIX_LATER_LOT_STATUSES.has(statusOf(lot))) out.push("quarantine");
  if (lot.hasMenuProduct === false) {
    out.push("no_menu_product");
    const cat = registerCategoryForLot(lot);
    if (cat.guessed) out.push("category_guessed");
    out.push(registerPriceForLot(lot.unitCostMinor ?? null, cat.category).source === "cost" ? "price_from_cost" : "price_guessed");
  }
  if (lot.hasLabResult === false) out.push("no_coa");
  if (lot.fixedAtRegister === true) out.push("fixed_at_register");
  return out;
}

export type CoverageRow = {
  lotId: string;
  label: string;
  units: number;
  sells: boolean;
  stop: RegisterStopReason | null;
  fixLater: FixLaterReason[];
};

export type StockCoverage = {
  stockedLots: number;
  stockedUnits: number;
  sellingLots: number;
  sellingUnits: number;
  stoppedLots: number;
  stoppedUnits: number;
  fixLaterLots: number;
  byStop: Partial<Record<RegisterStopReason, number>>;
  byFixLater: Partial<Record<FixLaterReason, number>>;
  rows: CoverageRow[];
};

/**
 * THE PEACE-OF-MIND CHECK: walk every lot with stock and say whether the
 * register sells it. A lot sells unless a real stop applies; paperwork only
 * ever adds it to the Fix later list.
 */
export function stockCoverage(lots: readonly FixLaterLot[]): StockCoverage {
  const cov: StockCoverage = {
    stockedLots: 0,
    stockedUnits: 0,
    sellingLots: 0,
    sellingUnits: 0,
    stoppedLots: 0,
    stoppedUnits: 0,
    fixLaterLots: 0,
    byStop: {},
    byFixLater: {},
    rows: [],
  };
  for (const lot of lots) {
    const units = Math.max(0, Number(lot.onHandQty) || 0);
    if (units <= 0 || lot.isSample === true) continue;
    cov.stockedLots += 1;
    cov.stockedUnits += units;
    const stop = registerStopReason(lot) ?? (clean(lot.posProductKey) ? null : null);
    const sells = !stop && !!clean(lot.posProductKey) && (isRegisterServableStatus(lot.status) || !clean(lot.status));
    const reasons = fixLaterReasons(lot);
    if (sells) {
      cov.sellingLots += 1;
      cov.sellingUnits += units;
    } else {
      cov.stoppedLots += 1;
      cov.stoppedUnits += units;
      if (stop) cov.byStop[stop] = (cov.byStop[stop] ?? 0) + 1;
    }
    if (reasons.length > 0) {
      cov.fixLaterLots += 1;
      for (const r of reasons) cov.byFixLater[r] = (cov.byFixLater[r] ?? 0) + 1;
    }
    cov.rows.push({
      lotId: lot.id,
      label: clean(lot.productName) || clean(lot.lotCode) || lot.id,
      units,
      sells,
      stop,
      fixLater: reasons,
    });
  }
  return cov;
}

/** Plain-English one-liner for the owner. */
export function coverageSentence(c: StockCoverage): string {
  if (c.stockedLots === 0) return "No lots have stock on hand.";
  const all = c.sellingLots === c.stockedLots;
  const head = all
    ? `All ${c.stockedLots.toLocaleString("en-US")} lots with stock (${c.stockedUnits.toLocaleString("en-US")} units) sell at the register.`
    : `${c.sellingLots.toLocaleString("en-US")} of ${c.stockedLots.toLocaleString("en-US")} lots with stock sell at the register; ${c.stoppedLots} are stopped for safety (recall, failed lab or destruction).`;
  return c.fixLaterLots > 0 ? `${head} ${c.fixLaterLots.toLocaleString("en-US")} need fixing later.` : head;
}

/** Does a typed / scanned string look like a package barcode (not a product search)? */
export function looksLikePackageCode(raw: string | null | undefined): boolean {
  const s = clean(raw);
  return s.length >= 6 && s.length <= 64 && !/\s/.test(s) && /\d/.test(s);
}

// ---------------------------------------------------------------------------
// FIX & SELL — the register button on a scan that matched nothing
// ---------------------------------------------------------------------------

/** What the register sends: the scanned / typed package code. */
export type FixAndSellRequest = { code: string; employeeName: string | null };

export function parseFixAndSellRequest(body: unknown): { ok: true; request: FixAndSellRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Send the scanned code." };
  const b = body as Record<string, unknown>;
  const code = clean(typeof b.code === "string" ? b.code : "");
  if (!code) return { ok: false, error: "Scan or type the package code first." };
  if (code.length > 64) return { ok: false, error: "That code is too long to be a package code." };
  const employeeName = clean(typeof b.employeeName === "string" ? b.employeeName : "").slice(0, 120) || null;
  return { ok: true, request: { code, employeeName } };
}

export type FixAndSellDecision =
  | { ok: true; product: PosMenuProduct; lotId: string; reasons: FixLaterReason[] }
  | { ok: false; stop: RegisterStopReason | "not_found" | "no_product_key" | "expired_edible"; message: string };

/**
 * Pick the lot for a scanned code and decide whether the register may sell
 * it right now. Several lots can share a code (re-receipts): a sellable one
 * with stock is preferred, then any sellable one. The only refusals are the
 * real stops; missing paperwork never refuses.
 */
export function decideFixAndSell(
  lots: readonly (FixLaterLot & { expiredHardBlock?: boolean })[],
  code: string,
): FixAndSellDecision {
  if (lots.length === 0) {
    return {
      ok: false,
      stop: "not_found",
      message: `No lot in the back office has the code "${clean(code)}". Check the label, or receive the product first.`,
    };
  }
  const usable = lots.filter((l) => !registerStopReason(l) && !l.expiredHardBlock && clean(l.posProductKey));
  const pick =
    usable.find((l) => (Number(l.onHandQty) || 0) > 0) ??
    usable[0] ??
    null;
  if (!pick) {
    const first = lots[0];
    if (first.expiredHardBlock) {
      return {
        ok: false,
        stop: "expired_edible",
        message: "This package is an expired edible, tincture, capsule or RSO. It cannot be sold (owner decisions D36, D44).",
      };
    }
    const stop = registerStopReason(first);
    if (stop) return { ok: false, stop, message: REGISTER_STOP_LABELS[stop] };
    return {
      ok: false,
      stop: "no_product_key",
      message: "This lot has no product key, so the sale has nothing to draw from. Open the lot in the back office and link it.",
    };
  }
  const product = synthesizeLotRegisterProduct({ ...pick, hasMenuProduct: false });
  if (!product) {
    return { ok: false, stop: "no_product_key", message: "This lot cannot be rung up. Open it in the back office." };
  }
  const reasons = Array.from(new Set<FixLaterReason>([...fixLaterReasons({ ...pick, hasMenuProduct: false }), "fixed_at_register"]));
  return { ok: true, product, lotId: pick.id, reasons };
}

/**
 * Add a Fix & sell line to the register's cached menu so the NEXT scan of
 * the same package adds straight away (even offline, until the next menu
 * download, which serves the same line from the lot). Replaces an older line
 * with the same variant id; maps the scanned code to the line's product.
 */
export function addFixLaterProduct(bundle: PosMenuBundle, product: PosMenuProduct, code: string): PosMenuBundle {
  const products = [...bundle.products.filter((p) => p.variantId !== product.variantId), product];
  const barcodes = { ...(bundle.barcodes ?? {}) };
  const norm = normalizeBarcode(code);
  if (norm.length >= 4) barcodes[norm] = product.productId;
  return { ...bundle, products, barcodes };
}

/** The register's plain-English confirmation after Fix & sell. */
export function fixAndSellMessage(product: PosMenuProduct): string {
  const price = `$${(product.regularPriceMinor / 100).toFixed(2)}`;
  return `Fixed: ${product.name}${product.variantLabel ? ` · ${product.variantLabel}` : ""} rings at ${price}. It is on the back office Fix later list.`;
}

// ---------------------------------------------------------------------------
// Self-tests (PURE). Run: npx tsx -e "require('./src/lib/pos/register-fix-later-core').__runRegisterFixLaterCoreTests()"
// ---------------------------------------------------------------------------

export function __runRegisterFixLaterCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`register-fix-later-core FAIL: ${msg}`);
    }
  };
  const base: FixLaterLot = {
    id: "L1",
    posProductKey: "GF41918905566984",
    lotCode: "GF41918905566984",
    productName: "HTE HONEY - Mimosa - Mimosa - .7g",
    status: "active",
    onHandQty: 50,
    category: "Cannabis Mix Infused",
    inventoryType: null,
    unitCostMinor: 226,
    hasLabResult: true,
    labPassed: null,
    hasMenuProduct: false,
  };

  // Statuses
  ok(isRegisterServableStatus("active"), "active sells");
  ok(isRegisterServableStatus("sold_out"), "sold out sells");
  ok(isRegisterServableStatus(" Quarantine "), "quarantine sells");
  ok(!isRegisterServableStatus("recalled"), "recalled does not");
  ok(!isRegisterServableStatus("destroyed"), "destroyed does not");

  // Stops (never paperwork)
  ok(registerStopReason(base) === null, "no COA / no card is not a stop");
  ok(registerStopReason({ ...base, hasLabResult: false }) === null, "missing COA is not a stop");
  ok(registerStopReason({ ...base, status: "quarantine" }) === null, "quarantine is not a stop");
  ok(registerStopReason({ ...base, status: "recalled" }) === "recalled", "recalled stops");
  ok(registerStopReason({ ...base, recalled: true }) === "recalled", "recall hold on the key stops");
  ok(registerStopReason({ ...base, labPassed: false }) === "failed_lab", "failed lab stops");
  ok(registerStopReason({ ...base, scheduledForDestruction: true }) === "scheduled_for_destruction", "destruction stops");
  ok(registerStopReason({ ...base, isSample: true }) === "sample", "samples stop");

  // Size
  ok(sizeLabelFromName("HTE HONEY - Mimosa - .7g") === "0.7g", ".7g -> 0.7g");
  ok(sizeLabelFromName("3.5g - DOH / Lemon OG (IH)") === "3.5g", "3.5g");
  ok(sizeLabelFromName("Thunder Stix-Tilted-DOH-Glass Tip PreRoll 3-Pack (3.6g) / Toad Venom (I)") === "3.6g", "pack weight");
  ok(sizeLabelFromName("Gummies") === null, "no size -> null");
  ok(lotSizeLabel({ unitWeight: 1, unitWeightUom: "g", productName: "x .7g" }) === "1g", "stored weight wins");

  // Category
  const cat = registerCategoryForLot({ ...base, productName: "Tilted Cured Resin Dab - 1g / Blue Jam", inventoryType: "Concentrate For Inhalation", category: "EndProduct" });
  ok(cat.category === "concentrate" && !cat.guessed, "concentrate for inhalation -> concentrate");
  const pre = registerCategoryForLot({ ...base, productName: "DOH-Full Flower Glass Tip Preroll (1.2g) / Blue Jam- (IH)", inventoryType: "Usable Cannabis", category: "EndProduct" });
  ok(isSellableCannabisCategory(pre.category), "usable cannabis preroll maps to a cannabis category");
  const unknown = registerCategoryForLot({ posProductKey: "K", productName: "Mystery", inventoryType: null, category: null });
  ok(unknown.category === FALLBACK_REGISTER_CATEGORY && unknown.guessed, "unknown -> strictest-limit fallback, flagged");

  // Price
  const p = registerPriceForLot(226, "concentrate");
  ok(p.source === "cost" && p.priceMinor >= 226 * 2 && p.priceMinor % 100 === 0, "2x cost tax-inclusive whole dollar");
  ok(registerPriceForLot(400, "preroll").priceMinor === 1200, "$4 cost -> $8 x 1.463 = $11.70 -> $12");
  ok(registerPriceForLot(null, "flower").source === "guessed", "no cost -> guessed");
  ok(registerPriceForLot(0, "flower").priceMinor === FALLBACK_REGISTER_PRICE_MINOR, "zero cost -> fallback price");

  // Synthesized product
  const prod = synthesizeLotRegisterProduct(base);
  ok(prod !== null, "lot with no card becomes a register line");
  ok(prod?.productId === "GF41918905566984", "product id = lot key (the sale draws this lot)");
  ok(prod?.variantId === "GF41918905566984-onboarded", "variant encodes the lot key");
  ok((prod?.regularPriceMinor ?? 0) > 0, "always a positive price (never free cannabis)");
  ok(prod?.unitGrams === 0.7, "grams for the purchase limit");
  ok(prod?.category !== "merch" && prod?.category !== "accessories", "always rung as cannabis (excise + limits)");
  ok(synthesizeLotRegisterProduct({ ...base, posProductKey: "" }) === null, "no key -> nothing to draw");
  ok(synthesizeLotRegisterProduct({ ...base, status: "recalled" }) === null, "recalled never synthesized");
  ok(synthesizeLotRegisterProduct({ ...base, status: "quarantine" }) !== null, "quarantine lot synthesized");
  ok(synthesizeLotRegisterProduct({ ...base, onHandQty: 0 })?.unitsLeft === null, "zero count -> unknown units, still sells");

  // Fix later reasons
  const r = fixLaterReasons({ ...base, status: "quarantine", hasLabResult: false });
  ok(r.includes("quarantine") && r.includes("no_menu_product") && r.includes("no_coa") && r.includes("price_from_cost"), "all reasons listed");
  ok(fixLaterReasons({ ...base, hasMenuProduct: true }).length === 0, "clean lot -> nothing to fix");
  ok(fixLaterReasons({ ...base, hasMenuProduct: true, fixedAtRegister: true }).includes("fixed_at_register"), "register fix listed");

  // Coverage
  const cov = stockCoverage([
    { ...base, id: "a", hasMenuProduct: true },
    { ...base, id: "b", status: "quarantine" },
    { ...base, id: "c", status: "sold_out", hasMenuProduct: true },
    { ...base, id: "d", status: "recalled" },
    { ...base, id: "e", labPassed: false },
    { ...base, id: "f", onHandQty: 0 },
    { ...base, id: "g", isSample: true },
  ]);
  ok(cov.stockedLots === 5, "only lots with stock, no samples");
  ok(cov.sellingLots === 3, "active, quarantine, sold out sell");
  ok(cov.stoppedLots === 2 && cov.byStop.recalled === 1 && cov.byStop.failed_lab === 1, "only safety stops");
  ok(cov.fixLaterLots >= 1, "quarantine lot on the fix later list");
  ok(coverageSentence(cov).includes("3 of 5"), "sentence states the numbers");
  ok(coverageSentence(stockCoverage([{ ...base, hasMenuProduct: true }])).startsWith("All 1 lots"), "all sell sentence");

  // Destruction holds
  const held = withDestructionHolds(
    [
      { id: "q1", status: "quarantine" },
      { id: "q2", status: "quarantine" },
      { id: "a1", status: "active" },
    ],
    new Set(["q1", "a1"]),
  );
  ok(held[0].status === DESTRUCTION_HOLD_STATUS, "quarantine + open destruction -> destruction hold");
  ok(held[1].status === "quarantine", "intake quarantine stays quarantine (sells)");
  ok(held[2].status === "active", "an active lot with a partial destruction keeps selling");
  ok(!isRegisterServableStatus(DESTRUCTION_HOLD_STATUS), "destruction hold never sells");
  ok(registerStopReason({ ...base, status: DESTRUCTION_HOLD_STATUS }) === "scheduled_for_destruction", "destruction hold is a stop");
  ok(withDestructionHolds([{ id: "x", status: "quarantine" }], new Set()).length === 1, "no holds -> passthrough");

  // Fix & sell
  ok(!parseFixAndSellRequest(null).ok && !parseFixAndSellRequest({ code: "  " }).ok, "empty request refused");
  const pr = parseFixAndSellRequest({ code: " GF41918905566984 ", employeeName: "Sam" });
  ok(pr.ok && pr.request.code === "GF41918905566984" && pr.request.employeeName === "Sam", "request parsed and trimmed");
  ok(!parseFixAndSellRequest({ code: "x".repeat(65) }).ok, "over-long code refused");
  const nf = decideFixAndSell([], "ABC123");
  ok(!nf.ok && nf.stop === "not_found", "unknown code -> not found");
  const fx = decideFixAndSell([{ ...base, status: "quarantine", hasLabResult: false }], "GF41918905566984");
  ok(fx.ok && fx.product.variantId === "GF41918905566984-onboarded", "quarantine, no COA -> sells");
  ok(fx.ok && fx.reasons.includes("fixed_at_register") && fx.reasons.includes("no_coa"), "fix & sell lists every reason");
  ok(fx.ok && fixAndSellMessage(fx.product).includes("Fix later"), "confirmation names the Fix later list");
  const rc = decideFixAndSell([{ ...base, status: "recalled" }], "x1");
  ok(!rc.ok && rc.stop === "recalled", "recalled lot refused");
  const fl = decideFixAndSell([{ ...base, labPassed: false }], "x1");
  ok(!fl.ok && fl.stop === "failed_lab", "failed lab refused");
  const ex = decideFixAndSell([{ ...base, expiredHardBlock: true }], "x1");
  ok(!ex.ok && ex.stop === "expired_edible", "expired edible refused");
  const two = decideFixAndSell([{ ...base, id: "old", onHandQty: 0 }, { ...base, id: "new", onHandQty: 4 }], "x1");
  ok(two.ok && two.lotId === "new", "prefers the lot with stock");
  const mix = decideFixAndSell([{ ...base, id: "r", status: "recalled" }, { ...base, id: "s", status: "sold_out", onHandQty: 0 }], "x1");
  ok(mix.ok && mix.lotId === "s", "a zero-count Sold out lot still sells when the other is recalled");

  // Cached-menu merge
  if (fx.ok) {
    const b0 = { products: [prod!], barcodes: { other: "X" } } as unknown as PosMenuBundle;
    const b1 = addFixLaterProduct(b0, fx.product, " GF41918905566984 ");
    ok(b1.products.length === 1, "same variant replaced, not duplicated");
    ok(b1.barcodes?.["gf41918905566984"] === "GF41918905566984" && b1.barcodes?.other === "X", "scanned code now maps to the line");
  }

  // Barcode shape
  ok(looksLikePackageCode("GF41918905566984"), "package code");
  ok(looksLikePackageCode("01M6ABC123"), "alnum code");
  ok(!looksLikePackageCode("blue dream"), "search text is not a code");
  ok(!looksLikePackageCode("abc"), "too short");

  return { passed, failed };
}
