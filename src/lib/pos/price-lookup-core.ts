/**
 * Register price lookup — pure core (lock screen, no PIN).
 *
 * Owner (verbatim): "I want to add a price lookup feature to the lock
 * screen. A button that opens the browse menu in full screen mode, with the
 * ability to scan a product to see its price."
 *
 * The lock screen hands the CACHED menu bundle to a read-only, full-screen
 * browse. Nothing here can start a sale: there is no cart, no employee and
 * no sync. A scan (wedge, Socket Mobile, or typed + Enter) resolves through
 * the SAME resolver the sale screen uses (scan-to-cart-core.resolveScan),
 * so a lookup never shows a different size or price than the register would
 * ring. The price shown is the shelf price AND today's price after the
 * promotions engine (priceCart — the exact function the sale uses), so a
 * customer asking "how much is this?" hears the number they will pay.
 *
 * Works fully offline (bundle only). Lot details on the info card are the
 * online extra (product-detail-view-core).
 */
import { priceCart, type PosMenuBundle, type PosMenuProduct } from "@/lib/pos/sale-flow-core";
import { resolveScan, scanPickPrompt } from "@/lib/pos/scan-to-cart-core";

/** Price lookup closes itself after this long with no touch or scan. */
export const PRICE_LOOKUP_IDLE_MS = 90_000;
/** The "how long until it closes" hint appears this long before closing. */
export const PRICE_LOOKUP_WARN_MS = 15_000;

export type LookupPrice = {
  /** Shelf (regular, tax-inclusive) unit price, cents. */
  regularMinor: number;
  /** What one unit rings at today after promotions + legal floors, cents. */
  todayMinor: number;
  /** Promotion name when today's price differs from the shelf price. */
  dealLabel: string | null;
  /** Cents saved per unit today (0 when no deal). */
  savingsMinor: number;
  /** Set when the register could not sell this unit at the computed price. */
  problem: string | null;
};

/** Price ONE unit exactly as the sale screen would ring it today. */
export function lookupPrice(product: PosMenuProduct, rules: PosMenuBundle["rules"]): LookupPrice {
  const regular = Math.max(0, Math.round(product.regularPriceMinor || 0));
  let priced: ReturnType<typeof priceCart>;
  try {
    priced = priceCart([{ product, quantity: 1 }], rules ?? []);
  } catch {
    return { regularMinor: regular, todayMinor: regular, dealLabel: null, savingsMinor: 0, problem: null };
  }
  const line = priced.lines[0];
  if (!line) {
    return {
      regularMinor: regular,
      todayMinor: regular,
      dealLabel: null,
      savingsMinor: 0,
      problem: priced.problems[0] ?? "This item cannot be rung at the register right now.",
    };
  }
  const today = line.unitPriceMinor;
  const savings = Math.max(0, regular - today);
  return {
    regularMinor: regular,
    todayMinor: today,
    dealLabel: savings > 0 && line.appliedLabel ? line.appliedLabel : null,
    savingsMinor: savings,
    problem: null,
  };
}

export type LookupScanOutcome =
  | { kind: "show"; product: PosMenuProduct; price: LookupPrice }
  | { kind: "pick"; prompt: string; candidates: PosMenuProduct[] }
  | { kind: "refused"; message: string }
  | { kind: "none"; message: string };

/** A scan or typed code -> what the lookup screen shows. */
export function resolveLookupScan(bundle: Pick<PosMenuBundle, "products" | "rules" | "barcodes" | "barcodeSizes" | "barcodeRefusals">, raw: string): LookupScanOutcome {
  const code = String(raw ?? "").trim();
  if (!code) return { kind: "none", message: "Nothing was scanned." };
  const r = resolveScan(bundle.products, bundle.barcodes ?? null, code, {
    sizes: bundle.barcodeSizes ?? null,
    refusals: bundle.barcodeRefusals ?? null,
  });
  switch (r.status) {
    case "add":
      return { kind: "show", product: r.product, price: lookupPrice(r.product, bundle.rules) };
    case "pick": {
      const name = r.candidates[0]?.name ?? "This product";
      return { kind: "pick", prompt: scanPickPrompt(name, r.reason), candidates: r.candidates };
    }
    case "refused":
      return { kind: "refused", message: r.message };
    default:
      return {
        kind: "none",
        message: `No product on this register matches “${code.slice(0, 40)}”. Try searching by name.`,
      };
  }
}

/** Plain stock line for the lookup card. */
export function lookupStockLine(product: Pick<PosMenuProduct, "inventoryStatus" | "unitsLeft">): { text: string; tone: "ok" | "warn" | "danger" } {
  const left = typeof product.unitsLeft === "number" && Number.isFinite(product.unitsLeft) ? Math.max(0, Math.floor(product.unitsLeft)) : null;
  if (product.inventoryStatus === "unavailable" || left === 0) return { text: "Out of stock", tone: "danger" };
  if (product.inventoryStatus === "low-stock") return { text: left !== null ? `Low stock · ${left} left` : "Low stock", tone: "warn" };
  return { text: left !== null ? `In stock · ${left} left` : "In stock", tone: "ok" };
}

/** Milliseconds until the lookup closes itself (0 = close now). */
export function lookupIdleRemaining(lastActivityMs: number, nowMs: number, idleMs: number = PRICE_LOOKUP_IDLE_MS): number {
  if (!Number.isFinite(lastActivityMs) || !Number.isFinite(nowMs)) return 0;
  return Math.max(0, idleMs - Math.max(0, nowMs - lastActivityMs));
}

/** Why the lock-screen button is disabled (null = enabled). */
export function priceLookupUnavailableReason(bundle: Pick<PosMenuBundle, "products"> | null | undefined): string | null {
  if (!bundle) return "The menu has not downloaded to this register yet — connect to the internet and wait for it to load.";
  if (!Array.isArray(bundle.products) || bundle.products.length === 0) return "The menu on this register is empty.";
  return null;
}

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runPriceLookupCoreTests(): void {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      failures.push(name);
    }
  };

  const p = (over: Partial<PosMenuProduct> = {}): PosMenuProduct => ({
    productId: "BD-0001",
    variantId: "BD-0001",
    name: "Blue Dream",
    brand: "Greenway",
    category: "flower",
    categories: ["flower"],
    variantLabel: "3.5g",
    regularPriceMinor: 2500,
    costMinorUnits: null,
    inventoryStatus: "in-stock",
    ...over,
  });

  // lookupPrice without promotions = shelf price
  const plain = lookupPrice(p(), []);
  ok(plain.regularMinor === 2500 && plain.todayMinor === 2500, "no deal: today = shelf");
  ok(plain.dealLabel === null && plain.savingsMinor === 0 && plain.problem === null, "no deal: no label/savings/problem");

  // A storewide 20% deal: today's price drops, the deal is named
  const deal = lookupPrice(p(), [
    {
      id: "r1",
      title: "Twenty off",
      discountType: "percent",
      discountPercent: 20,
      discountFixed: 0,
      priority: 1,
      storewide: true,
      targetCategories: [],
      targetBrands: [],
      targetProductKeys: [],
      excludeCategories: [],
      excludeBrands: [],
      excludeProductKeys: [],
      config: {},
    },
  ]);
  ok(deal.todayMinor === 2000 && deal.savingsMinor === 500, "20% deal: today's price + savings");
  ok(typeof deal.dealLabel === "string" && deal.dealLabel.length > 0, "deal is named");

  // rules=null tolerated
  ok(lookupPrice(p(), null as unknown as PosMenuBundle["rules"]).todayMinor === 2500, "null rules tolerated");

  // resolveLookupScan (codes under 4 chars are ignored by the shared resolver)
  ok(resolveLookupScan({ products: [p({ productId: "ab", variantId: "ab" })], rules: [] }, "ab").kind === "none", "short code ignored");
  const bundle = { products: [p(), p({ productId: "OG-0002", variantId: "OG-0002", name: "OG Kush" })], rules: [], barcodes: { "123456789012": "OG-0002" } };
  const byId = resolveLookupScan(bundle, "bd-0001");
  ok(byId.kind === "show" && byId.product.productId === "BD-0001", "product id scan shows the card");
  const byBarcode = resolveLookupScan(bundle, "123456789012");
  ok(byBarcode.kind === "show" && byBarcode.product.productId === "OG-0002", "barcode scan shows the card");
  const miss = resolveLookupScan(bundle, "99999999");
  ok(miss.kind === "none" && miss.message.includes("99999999"), "unknown scan explains");
  ok(resolveLookupScan(bundle, "  ").kind === "none", "blank scan");

  // multi-size card -> pick
  const sized = {
    products: [
      p({ productId: "GG-0003", variantId: "GG-0003-1g", name: "Gelato", variantLabel: "1g", regularPriceMinor: 1000 }),
      p({ productId: "GG-0003", variantId: "GG-0003-3.5g", name: "Gelato", variantLabel: "3.5g", regularPriceMinor: 3000 }),
    ],
    rules: [],
  };
  const pick = resolveLookupScan(sized, "GG-0003");
  ok(pick.kind === "pick" && pick.candidates.length === 2 && pick.prompt.includes("Gelato"), "multi-size card asks to pick");

  // stock line
  ok(lookupStockLine({ inventoryStatus: "in-stock", unitsLeft: 7 }).text === "In stock · 7 left", "stock with count");
  ok(lookupStockLine({ inventoryStatus: "in-stock" }).text === "In stock", "stock without count");
  ok(lookupStockLine({ inventoryStatus: "low-stock", unitsLeft: 2 }).tone === "warn", "low stock warn");
  ok(lookupStockLine({ inventoryStatus: "unavailable" }).tone === "danger", "unavailable danger");
  ok(lookupStockLine({ inventoryStatus: "in-stock", unitsLeft: 0 }).text === "Out of stock", "zero left = out");

  // idle timer
  ok(lookupIdleRemaining(1000, 1000) === PRICE_LOOKUP_IDLE_MS, "fresh = full window");
  ok(lookupIdleRemaining(0, PRICE_LOOKUP_IDLE_MS + 5) === 0, "expired = 0");
  ok(lookupIdleRemaining(5000, 1000) === PRICE_LOOKUP_IDLE_MS, "clock skew backwards does not extend");
  ok(lookupIdleRemaining(NaN, 1) === 0, "bad clock closes");

  // button availability
  ok(priceLookupUnavailableReason(null) !== null, "no bundle disables");
  ok(priceLookupUnavailableReason({ products: [] }) !== null, "empty bundle disables");
  ok(priceLookupUnavailableReason({ products: [p()] }) === null, "bundle enables");

  console.log(`price-lookup-core: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    throw new Error(`price-lookup-core self-tests failed: ${failures.join("; ")}`);
  }
}
