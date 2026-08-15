/**
 * src/lib/discovery/ccrs-extract/aggregate.ts
 *
 * PURE, dependency-free aggregation engine for the CCRS monthly statewide
 * extract. Consumes the typed rows produced by parse.ts in a SINGLE pass per
 * table (in dependency order) and folds them into the small rollups the three
 * consuming surfaces need:
 *
 *   1. STATEWIDE benchmarks (CCRS Benchmarks page): retail/wholesale unit-price
 *      percentiles + $/g + units/revenue by inventory type, brand, strain.
 *   2. COMPETITOR stats (Reports → Local Benchmarks): per tracked retail
 *      license — retail price distribution, units, revenue, top products, and
 *      (S7) wholesale sourcing: who the competitor BOUGHT from this month
 *      (wholesale SaleHeaders carry seller LicenseeId → buyer
 *      SoldToLicenseeId), with per-supplier line counts and spend.
 *   3. MARKET SIGNALS (Leads page): statewide fast-movers and what competitors
 *      are selling a lot of, with price bands the AI can use to undercut.
 *
 * Scale strategy (validated against the REAL May 2026 file: 14.05M inventory
 * rows, 10.74M sale headers, 10.82M sale details): we NEVER hold raw rows, and
 * the giant id→id lookups use typed-array open-addressing hash maps (U53Map)
 * instead of JS Maps — a JS Map with string keys OOMs a 4 GB heap on this
 * dataset; U53Map holds the same joins in a few hundred MB. Sale headers fold
 * to ONE packed number each (sale class + tracked-seller slot + tracked-buyer
 * slot + supplier licensee id — see the packing doc above CLASS_RETAIL). Price
 * percentiles use exact-cents histograms (bounded by distinct price points).
 * The statewide product-mover map is bounded by streaming heavy-hitters
 * pruning (see MOVER_MAP_CAP below).
 *
 * Product attribution: SalesDetail.InventoryId → Inventory.ProductId →
 * Product(inventoryType, name, weight). The monthly file only carries
 * inventory/product rows TOUCHED that month, so a share of details won't
 * resolve — those fold into type "(unattributed)" and we report the join rate
 * honestly (never guess). Accumulating datasets month over month raises
 * attribution over time.
 *
 * STANDING RULES honored:
 *   - NEVER GUESS / NEVER FABRICATE: unresolvable joins are counted and
 *     surfaced; percentile summaries with zero samples are omitted; the one
 *     deliberate approximation (mover-map pruning) is documented and counted
 *     in totals.moverMapPrunes.
 *   - Money in MINOR UNITS end to end.
 *   - Pure: no server-only, no DB, no DOM — fully unit-testable and safe to
 *     run inside the browser on the dragged-in zip.
 */

import { extractBrand, normalizeBrandKey } from "../brand-core";
import type {
  LicenseeRow,
  SaleHeaderRow,
  SaleDetailRow,
  ProductRow,
  InventoryRow,
  StrainRow,
  ManifestHeaderRow,
  TransportedItemRow,
} from "./parse";

// ---------------------------------------------------------------------------
// U53Map — typed-array open-addressing hash map for integer ids (≤ 2^53).
// ---------------------------------------------------------------------------

/**
 * All CCRS surrogate keys (LicenseeId, ProductId, InventoryId, SaleHeaderId,
 * StrainId) are positive integers, so we can join tens of millions of rows in
 * flat Float64Arrays instead of pointer-heavy JS Maps. Linear probing, power-
 * of-two capacity, ≤ 0.7 load. Keys are stored as (key + 1) so 0 marks an
 * empty slot; value lanes are Float64Arrays (lane value 0 = "absent" by
 * convention for id lanes — CCRS ids start at 1).
 */
export class U53Map {
  private keys: Float64Array;
  private lanes: Float64Array[];
  private laneCount: number;
  private cap: number;
  private _size = 0;

  constructor(laneCount = 1, initialCapacity = 4096) {
    this.laneCount = Math.max(1, laneCount);
    let cap = 64;
    while (cap < initialCapacity) cap *= 2;
    this.cap = cap;
    this.keys = new Float64Array(cap);
    this.lanes = [];
    for (let i = 0; i < this.laneCount; i += 1) this.lanes.push(new Float64Array(cap));
  }

  get size(): number {
    return this._size;
  }

  /** Pre-size for an expected entry count (avoids doubling spikes mid-stream). */
  reserve(expectedEntries: number): void {
    let cap = this.cap;
    while (expectedEntries / cap > 0.7) cap *= 2;
    if (cap > this.cap) this.rehash(cap);
  }

  set(key: number, ...values: number[]): void {
    if (!Number.isFinite(key) || key < 0 || !Number.isInteger(key)) return;
    if ((this._size + 1) / this.cap > 0.7) this.rehash(this.cap * 2);
    const k = key + 1;
    let i = k % this.cap;
    for (;;) {
      const cur = this.keys[i];
      if (cur === 0 || cur === k) {
        if (cur === 0) {
          this.keys[i] = k;
          this._size += 1;
        }
        for (let l = 0; l < this.laneCount; l += 1) this.lanes[l][i] = values[l] ?? 0;
        return;
      }
      i = i + 1 === this.cap ? 0 : i + 1;
    }
  }

  /** Returns the lane value, or undefined when the key was never set. */
  get(key: number, lane = 0): number | undefined {
    if (!Number.isFinite(key) || key < 0 || !Number.isInteger(key)) return undefined;
    const k = key + 1;
    let i = k % this.cap;
    for (;;) {
      const cur = this.keys[i];
      if (cur === 0) return undefined;
      if (cur === k) return this.lanes[lane][i];
      i = i + 1 === this.cap ? 0 : i + 1;
    }
  }

  has(key: number): boolean {
    return this.get(key, 0) !== undefined;
  }

  private rehash(newCap: number): void {
    const oldKeys = this.keys;
    const oldLanes = this.lanes;
    this.cap = newCap;
    this.keys = new Float64Array(newCap);
    this.lanes = [];
    for (let l = 0; l < this.laneCount; l += 1) this.lanes.push(new Float64Array(newCap));
    for (let i = 0; i < oldKeys.length; i += 1) {
      const k = oldKeys[i];
      if (k === 0) continue;
      let j = k % this.cap;
      while (this.keys[j] !== 0) j = j + 1 === this.cap ? 0 : j + 1;
      this.keys[j] = k;
      for (let l = 0; l < this.laneCount; l += 1) this.lanes[l][j] = oldLanes[l][i];
    }
  }
}

// ---------------------------------------------------------------------------
// Bounded-memory price histogram (exact cents up to a cap)
// ---------------------------------------------------------------------------

/** Prices ≥ this cap (in cents) clamp into the top bucket. $10,000/unit. */
export const PRICE_CAP_MINOR = 1_000_000;

/**
 * Exact-to-the-cent histogram over [0, PRICE_CAP_MINOR]. Uses a Map so sparse
 * price points stay cheap (real extracts hit only thousands of distinct
 * prices). Supports count/sum/min/max and interpolation-free percentiles
 * (nearest-rank, the standard for price benchmarking at this sample size).
 */
export class PriceHistogram {
  private buckets = new Map<number, number>();
  private _count = 0;
  private _sum = 0;
  private _min: number | null = null;
  private _max: number | null = null;

  add(minor: number): void {
    if (!Number.isFinite(minor) || minor < 0) return;
    const v = Math.min(Math.round(minor), PRICE_CAP_MINOR);
    this.buckets.set(v, (this.buckets.get(v) ?? 0) + 1);
    this._count += 1;
    this._sum += v;
    if (this._min == null || v < this._min) this._min = v;
    if (this._max == null || v > this._max) this._max = v;
  }

  get count(): number {
    return this._count;
  }

  /** Nearest-rank percentile (p in 0..1). Null when empty. */
  percentile(p: number): number | null {
    if (this._count === 0) return null;
    const target = Math.max(1, Math.ceil(Math.min(1, Math.max(0, p)) * this._count));
    const keys = [...this.buckets.keys()].sort((a, b) => a - b);
    let seen = 0;
    for (const k of keys) {
      seen += this.buckets.get(k) ?? 0;
      if (seen >= target) return k;
    }
    return keys[keys.length - 1] ?? null;
  }

  summary(): PriceSummary | null {
    if (this._count === 0) return null;
    return {
      sampleSize: this._count,
      minMinor: this._min ?? 0,
      p25Minor: this.percentile(0.25) ?? 0,
      medianMinor: this.percentile(0.5) ?? 0,
      p75Minor: this.percentile(0.75) ?? 0,
      maxMinor: this._max ?? 0,
      avgMinor: Math.round(this._sum / this._count),
    };
  }
}

export type PriceSummary = {
  sampleSize: number;
  minMinor: number;
  p25Minor: number;
  medianMinor: number;
  p75Minor: number;
  maxMinor: number;
  avgMinor: number;
};

// ---------------------------------------------------------------------------
// Output shapes (what the server layer persists)
// ---------------------------------------------------------------------------

/**
 * Sale classes emitted by the aggregator.
 *
 * "medical" is a SUBSET of "retail", not a sibling: a RecreationalMedical sale
 * is still a retail sale and is still counted in every "retail" row. The extra
 * "medical" rows let the medical slice be read on its own WITHOUT changing what
 * "retail" has always meant, so existing months stay comparable to new ones.
 * Consumers that want non-medical retail compute retail − medical.
 */
export type BenchmarkSaleClass = "retail" | "wholesale" | "medical";

export type StatewideBenchmark = {
  scope: "type" | "brand" | "strain" | "overall";
  scopeKey: string;
  saleClass: BenchmarkSaleClass;
  unitPrice: PriceSummary | null;
  pricePerGram: PriceSummary | null;
  units: number;
  revenueMinor: number;
};

export type CompetitorProductStat = {
  productName: string;
  inventoryType: string | null;
  units: number;
  revenueMinor: number;
  medianUnitPriceMinor: number | null;
};

/**
 * One wholesale supplier of a tracked competitor (S7). Derived from wholesale
 * SaleHeaders where the BUYER (SoldToLicenseeId) is a tracked license and the
 * SELLER (LicenseeId) is the supplier. Identity comes from the monthly
 * licensee table (included whole every month); unresolvable identity fields
 * stay null — never guessed.
 */
export type CompetitorSupplierStat = {
  /** CCRS surrogate LicenseeId of the supplier (per-extract, always present). */
  licenseeId: string;
  licenseNumber: string | null;
  name: string | null;
  dba: string | null;
  lineCount: number;
  /** What the competitor spent with this supplier (qty × unit − discount), cents. */
  spendMinor: number;
};

/**
 * S10 (suggestion #2): one STATEWIDE wholesale supplier — every licensee that
 * SOLD wholesale this month, with observed transfer volume, revenue, unit-price
 * distribution, and buyer reach. Sources:
 *  - lines/revenue/prices: wholesale SaleDetail lines whose header carried a
 *    packable seller LicenseeId (ids ≥ 2^36 are not packed — counted in
 *    wholesaleLines but absent here, never guessed);
 *  - buyer reach: DISTINCT buyer licensees on wholesale sale HEADERS (a header
 *    with no surviving detail lines still proves the relationship);
 *  - identity: the monthly licensee table (whole every month); missing rows
 *    leave identity fields null.
 */
export type StatewideSupplierStat = {
  licenseeId: string;
  licenseNumber: string | null;
  name: string | null;
  dba: string | null;
  lineCount: number;
  /** Observed wholesale revenue for this supplier (qty × unit − discount), cents. */
  revenueMinor: number;
  /** Per-line wholesale unit-price distribution (minor units). */
  unitPrice: PriceSummary | null;
  /** Distinct buyer licensees on this supplier's wholesale headers. */
  distinctBuyers: number;
  /** How many of those buyers are tracked roster competitors. */
  trackedBuyers: number;
};

export type CompetitorStat = {
  licenseNumber: string;
  licenseeId: string;
  name: string | null;
  dba: string | null;
  city: string | null;
  retail: {
    units: number;
    revenueMinor: number;
    lineCount: number;
    unitPrice: PriceSummary | null;
    byType: Array<{ inventoryType: string; units: number; revenueMinor: number }>;
    topProducts: CompetitorProductStat[];
  };
  /** S7: what this competitor BOUGHT wholesale this month, and from whom. */
  wholesale: {
    lineCount: number;
    spendMinor: number;
    /** Top suppliers by spend (≤ TOP_SUPPLIERS_PER_COMPETITOR). */
    topSuppliers: CompetitorSupplierStat[];
  };
};

export type MarketSignal = {
  kind: "statewide_mover" | "competitor_mover" | "type_mover";
  /** For competitor_mover: which tracked license this signal came from. */
  licenseNumber: string | null;
  inventoryType: string | null;
  productName: string | null;
  brand: string | null;
  strainName: string | null;
  units: number;
  revenueMinor: number;
  medianUnitPriceMinor: number | null;
  /** p25 — the aggressive-but-real "undercut" reference point. */
  p25UnitPriceMinor: number | null;
  /**
   * Task I (I4): the SHIPPING VENDOR (producer/processor) behind the product,
   * from manifest lot joins (dominant origin on the sold lots) with a
   * conservative brand→vendor bridge fallback. Null when unresolvable —
   * never guessed.
   */
  vendorName: string | null;
  vendorLicense: string | null;
};

export type AggregationResult = {
  /**
   * The delivery's REAL period: the full span of the DOMINANT SaleHeader
   * month (first → last day). Monthly deliveries include headers UPDATED in
   * the month whose original SaleDates reach years back, so min/max would
   * mislabel the drop (verified: the May-2026 zip spans 54 distinct months).
   */
  periodStart: string | null;
  periodEnd: string | null;
  /** Honest observed SaleDate span across ALL headers (metadata, not the label). */
  observedMinDate?: string | null;
  observedMaxDate?: string | null;
  totals: {
    licenseeRows: number;
    productRows: number;
    inventoryRows: number;
    saleHeaderRows: number;
    saleDetailRows: number;
    strainRows: number;
    retailLines: number;
    wholesaleLines: number;
    /** Retail lines whose InventoryId resolved through to a Product. */
    attributedRetailLines: number;
    /**
     * Retail lines from RecreationalMedical sale headers. A SUBSET of
     * retailLines (never added to it). Optional so payloads persisted before
     * the medical split still parse.
     */
    medicalLines?: number;
    /** How many times the statewide-mover map hit its cap and was pruned. */
    moverMapPrunes: number;
    /** Task I (I4): manifest rows read (vendor attribution inputs). Optional
     * so older persisted payloads (pre-I4) still parse. */
    manifestRows?: number;
    transportedItemRows?: number;
  };
  statewide: StatewideBenchmark[];
  competitors: CompetitorStat[];
  signals: MarketSignal[];
  /** S10: statewide wholesale supplier benchmarks (top by revenue). */
  suppliers: StatewideSupplierStat[];
};

// ---------------------------------------------------------------------------
// Brand extraction — shared v2 heuristic (Task I, I3): junk-token blocklist +
// "… by <brand>" support, verified against 300k real May-2026 product names.
// Re-exported so existing imports (tests, downstream consumers) keep working.
// ---------------------------------------------------------------------------

export { extractBrand } from "../brand-core";

// ---------------------------------------------------------------------------
// The aggregator
// ---------------------------------------------------------------------------

const UNATTRIBUTED = "(unattributed)";
const TOP_PRODUCTS_PER_COMPETITOR = 25;
/** S7: wholesale suppliers persisted per competitor (top by spend). */
export const TOP_SUPPLIERS_PER_COMPETITOR = 10;
const TOP_SIGNALS_STATEWIDE = 100;
const TOP_SIGNALS_PER_COMPETITOR = 15;
/** Task I (I4): per-inventory-type product leaders persisted per month. */
export const TOP_TYPE_MOVERS_PER_TYPE = 10;
/**
 * Task I (I4): brand→vendor bridge thresholds, verified on the real May-2026
 * delivery (2,698 of 4,855 transported brands resolve at these bounds with
 * near-unanimous origins). A brand maps to a vendor only when one origin
 * license shipped ≥ 80% of that brand's manifests and ≥ 3 manifests exist —
 * below that the vendor stays null, never guessed.
 */
export const BRAND_BRIDGE_MIN_MANIFESTS = 3;
export const BRAND_BRIDGE_MIN_SHARE = 0.8;
/** S10: statewide wholesale suppliers persisted per month (top by revenue). */
export const TOP_SUPPLIERS_STATEWIDE = 100;
/** Persisted brand/strain benchmark rows per sale class (top by revenue). */
const TOP_BENCH_PER_SCOPE = 500;
/**
 * Streaming heavy-hitters bound for the statewide product-mover map. When the
 * map exceeds MOVER_MAP_CAP distinct product names we keep the MOVER_KEEP
 * highest-revenue entries and drop the rest. The final output only needs the
 * top TOP_SIGNALS_STATEWIDE (100), and top movers accumulate revenue
 * throughout the month-long stream, so a 30k floor cannot realistically evict
 * a true top-100 product; prune count is reported in totals for honesty.
 */
const MOVER_MAP_CAP = 150_000;
const MOVER_KEEP = 30_000;

type ProductInfo = {
  inventoryType: string | null;
  name: string | null;
  weightGrams: number | null;
  brand: string | null;
};
type MoverAcc = {
  units: number;
  revenueMinor: number;
  price: PriceHistogram;
  inventoryType: string | null;
  brand: string | null;
  strainName: string | null;
  /**
   * Task I (I4): manifest ORIGIN sightings for the lots this product sold
   * from — vendorLicense → line count. Dominant origin wins at result() time;
   * null/empty = no manifest join (vendor may still resolve via brand bridge).
   * Lazily created so movers without joins cost nothing.
   */
  vendorCounts: Map<string, number> | null;
};

type BenchAcc = {
  unitPrice: PriceHistogram;
  pricePerGram: PriceHistogram;
  units: number;
  revenueMinor: number;
};

type TrackedInfo = {
  licenseNumber: string;
  licenseeId: string;
  name: string | null;
  dba: string | null;
  city: string | null;
};

type CompetitorAcc = TrackedInfo & {
  units: number;
  revenueMinor: number;
  lineCount: number;
  unitPrice: PriceHistogram;
  byType: Map<string, { units: number; revenueMinor: number }>;
  byProduct: Map<string, MoverAcc & { productName: string }>;
  /** S7: wholesale purchases (this competitor as BUYER). */
  wsLineCount: number;
  wsSpendMinor: number;
  /** supplier LicenseeId(number) → accumulated lines + spend. */
  suppliers: Map<number, { lineCount: number; spendMinor: number }>;
};

/** Compact identity kept for EVERY licensee (supplier naming; ~1.7k/month). */
type LicenseeIdentity = {
  licenseNumber: string | null;
  name: string | null;
  dba: string | null;
};

/**
 * Packed sale-header value (lane 0 of headerMap, exact-integer safe):
 *   bit 0        — saleClass code (0 retail, 1 wholesale)
 *   bits 1..8    — tracked SELLER slot (0 = untracked; 1-based, ≤ SLOT_LIMIT)
 *   bits 9..16   — tracked BUYER slot  (0 = untracked; wholesale sourcing, S7)
 *   bits 17..52  — supplier (seller) LicenseeId, packed ONLY for wholesale
 *                  headers whose buyer is tracked (0 = none/unpackable)
 * Max packed value = 1 + 2·255 + 512·255 + 131072·(2^36 − 1) = 2^53 − 1,
 * which a Float64 represents exactly. Ids ≥ 2^36 are NOT packed (the line is
 * still counted; its supplier folds into "unattributed" — never guessed).
 *
 * MEDICAL FLAG (lane 1). Lane 0 above saturates 2^53 − 1 EXACTLY — there is no
 * spare bit — so the medical marker rides in a SECOND lane rather than being
 * squeezed in (which would silently overflow and corrupt supplier ids).
 * Lane 1 is 1 when SaleHeader.SaleType is RecreationalMedical, else 0.
 *
 * WHY SaleType and not Inventory.IsMedical: both exist in the real extract and
 * they mean DIFFERENT things.
 *   - SaleHeader.SaleType = 'RecreationalMedical' → the SALE was a medical sale
 *     (medically-endorsed store, qualifying patient, excise-exempt).
 *   - Inventory.IsMedical = True → the PRODUCT is DOH-compliant medical-grade,
 *     which says nothing about who bought it or how it was taxed.
 * Michael asked to break out medical vs non-medical SALES, so the class split
 * keys on SaleType. IsMedical is a product attribute and is NOT conflated here.
 * (Verified against the real December 2025 extract: SaleHeader carries
 * SaleType; Inventory carries IsMedical at column 9.)
 */
const CLASS_RETAIL = 0;
const CLASS_WHOLESALE = 1;
/** Lane-1 marker: this header was a RecreationalMedical sale. */
const MEDICAL_YES = 1;
const SLOT_LIMIT = 255;
const BUYER_FACTOR = 512; // 2 · 256
const SUPPLIER_FACTOR = 131072; // 2 · 256 · 256
const MAX_PACKED_SUPPLIER_ID = 2 ** 36;

export class CcrsAggregator {
  private trackedLicenses: Set<string>;
  private selfLicense: string;

  // Giant id joins live in typed-array maps (see U53Map docs).
  /** inventoryId → [productId, strainId] (0 = absent). */
  private invMap = new U53Map(2);
  /** saleHeaderId → packed(class + sellerSlot + buyerSlot + supplierId). */
  // Lane 0 = packed class/slots/supplier (see doc above CLASS_RETAIL).
  // Lane 1 = medical marker (1 = RecreationalMedical sale, 0 = not).
  private headerMap = new U53Map(2);
  /**
   * Task I (I4): inventoryId → manifest ORIGIN license number (the shipping
   * vendor). Sparse — only lots whose ExternalIdentifier matched a live
   * transported item get an entry (~2% of inventory rows in the real May-2026
   * delivery), so this stays far smaller than invMap.
   */
  private invVendor = new U53Map(1);

  // Bounded reference lookups (numeric keys keep these compact).
  private productById = new Map<number, ProductInfo>();
  private strainNameById = new Map<number, string>();
  /** licenseeId(number) → tracked slot (1-based index into trackedByIdx). */
  private trackedSlotByLicenseeId = new Map<number, number>();
  private trackedByIdx: TrackedInfo[] = [];
  /**
   * S7: identity for EVERY licensee in the file (suppliers are arbitrary
   * statewide licensees). The monthly licensee table is included whole
   * (~1.7k rows), so this map stays tiny.
   */
  private licenseeInfoById = new Map<number, LicenseeIdentity>();
  /**
   * Task I (I4): licensee identity by LICENSE NUMBER — manifests carry the
   * origin's license number (not its LicenseeId), so vendor naming resolves
   * through this map first (DBA preferred), manifest origin name second.
   */
  private licenseeByLicenseNumber = new Map<string, LicenseeIdentity>();
  /** Interned inventory-type strings (small closed set in the real data). */
  private typeIntern = new Map<string, string>();

  // Task I (I4): manifest-based vendor attribution (verified route — retail
  // Product.LicenseeId is the RETAILER 99.7% of the time, so manifests are
  // the only honest vendor source in the delivery).
  /** Live manifest ext-id → origin (shipping vendor) license + name. */
  private manifestOrigin = new Map<string, { license: string; name: string | null }>();
  /** Vendor license → best display name (manifest origin name; licensee table wins later). */
  private vendorNameByLicense = new Map<string, string | null>();
  /** Lot ExternalIdentifier (lowercased) → origin license. Conflicts tombstoned (never guessed). */
  private lotVendor = new Map<string, string>();
  private lotVendorConflicts = new Set<string>();
  /** Brand key → (origin license → distinct-manifest count) for the bridge fallback. */
  private brandBridge = new Map<string, Map<string, number>>();
  /** Dedupe: `${brandKey}\u0001${manifestExtId}` pairs already counted. */
  private brandBridgeSeen = new Set<string>();

  // Accumulators.
  private statewide = new Map<string, BenchAcc>(); // `${class}\u0001${scope}\u0001${key}`
  private competitors = new Map<string, CompetitorAcc>(); // licenseNumber
  private statewideMovers = new Map<string, MoverAcc>(); // product name
  /**
   * S10: statewide wholesale supplier accumulators. Bounded by the licensee
   * table (~1.7k/month): line stats keyed by seller LicenseeId; buyer reach
   * keyed the same, deduped via Sets of buyer LicenseeIds (≤ distinct
   * seller→buyer pairs, far below header count).
   */
  private supplierStats = new Map<
    number,
    { lineCount: number; revenueMinor: number; price: PriceHistogram }
  >();
  private supplierBuyers = new Map<number, Set<number>>();
  private minDate: string | null = null;
  private maxDate: string | null = null;
  /**
   * Task I (I1): yyyy-mm histogram of SaleHeader dates. A monthly delivery
   * contains every header UPDATED that month, whose original SaleDates span
   * YEARS (verified on the real May-2026 zip: 54 distinct months, dominant
   * month = 53.2% of headers, stale tail back to 2021). min/max therefore
   * mislabels the drop; the DOMINANT month is the delivery's real period.
   */
  private monthCounts = new Map<string, number>();
  private totals = {
    licenseeRows: 0,
    productRows: 0,
    inventoryRows: 0,
    saleHeaderRows: 0,
    saleDetailRows: 0,
    strainRows: 0,
    retailLines: 0,
    wholesaleLines: 0,
    attributedRetailLines: 0,
    medicalLines: 0,
    moverMapPrunes: 0,
    // Task I (I4): manifest tables (vendor attribution inputs).
    manifestRows: 0,
    transportedItemRows: 0,
  };

  constructor(opts: { selfLicenseNumber: string; trackedLicenseNumbers: string[] }) {
    this.selfLicense = opts.selfLicenseNumber;
    this.trackedLicenses = new Set(
      opts.trackedLicenseNumbers.filter((l) => l !== opts.selfLicenseNumber),
    );
  }

  /**
   * Optional pre-sizing from the zip's central directory (chunked tables carry
   * ≤ 1M rows per file, so chunkCount × 1M is a safe upper bound). Avoids
   * rehash doubling spikes while streaming tens of millions of rows.
   */
  reserve(hints: { inventoryRows?: number; saleHeaderRows?: number }): void {
    if (hints.inventoryRows) this.invMap.reserve(hints.inventoryRows);
    if (hints.saleHeaderRows) this.headerMap.reserve(hints.saleHeaderRows);
  }

  // ---- reference tables (feed BEFORE sale tables) -------------------------

  addLicensee(row: LicenseeRow): void {
    this.totals.licenseeRows += 1;
    const idNum = Number(row.licenseeId);
    if (!Number.isFinite(idNum)) return;
    // S7: keep identity for every licensee so wholesale suppliers get real
    // names (the monthly licensee table is included whole — small).
    this.licenseeInfoById.set(idNum, {
      licenseNumber: row.licenseNumber,
      name: row.name,
      dba: row.dba,
    });
    // Task I (I4): manifests reference vendors by license number.
    if (row.licenseNumber) {
      this.licenseeByLicenseNumber.set(row.licenseNumber.trim(), {
        licenseNumber: row.licenseNumber,
        name: row.name,
        dba: row.dba,
      });
    }
    if (row.licenseNumber && this.trackedLicenses.has(row.licenseNumber)) {
      if (this.trackedByIdx.length >= SLOT_LIMIT) return; // packing bound (roster ≪ 255)
      this.trackedByIdx.push({
        licenseNumber: row.licenseNumber,
        licenseeId: row.licenseeId,
        name: row.name,
        dba: row.dba,
        city: row.city,
      });
      this.trackedSlotByLicenseeId.set(idNum, this.trackedByIdx.length); // 1-based
    }
  }

  addProduct(row: ProductRow): void {
    this.totals.productRows += 1;
    const idNum = Number(row.productId);
    if (!Number.isFinite(idNum)) return;
    this.productById.set(idNum, {
      inventoryType: this.intern(row.inventoryType),
      name: row.name,
      weightGrams:
        row.unitWeightGrams != null && row.unitWeightGrams > 0 ? row.unitWeightGrams : null,
      brand: extractBrand(row.name),
    });
  }

  /**
   * Task I (I4): manifest headers name the SHIPPING VENDOR (origin) for the
   * lots they moved. Deleted manifests are skipped whole — a cancelled
   * shipment proves nothing. Must be fed BEFORE transported items.
   */
  addManifestHeader(row: ManifestHeaderRow): void {
    this.totals.manifestRows += 1;
    if (row.isDeleted === true) return;
    const license = row.originLicenseNumber?.trim() ?? "";
    if (!license) return;
    this.manifestOrigin.set(row.externalManifestIdentifier, {
      license,
      name: row.originLicenseName,
    });
    if (!this.vendorNameByLicense.has(license)) {
      this.vendorNameByLicense.set(license, row.originLicenseName);
    }
  }

  /**
   * Task I (I4): a transported item ties a lot's ExternalIdentifier (and its
   * product description's brand) to the manifest's origin vendor. Two joins
   * are built here:
   *  - lotVendor: exact lot-level attribution (conflicting origins for the
   *    same lot id are tombstoned — never guessed);
   *  - brandBridge: brand → origin manifest counts (fallback when a sold lot
   *    never appears in this month's manifests).
   */
  addTransportedItem(row: TransportedItemRow): void {
    this.totals.transportedItemRows += 1;
    if (row.isDeleted === true) return;
    const ext = row.externalManifestIdentifier;
    if (!ext) return;
    const origin = this.manifestOrigin.get(ext);
    if (!origin) return; // deleted or unknown manifest — no attribution
    const lot = row.inventoryExternalIdentifier?.trim().toLowerCase() ?? "";
    if (lot && !this.lotVendorConflicts.has(lot)) {
      const prev = this.lotVendor.get(lot);
      if (prev === undefined) {
        this.lotVendor.set(lot, origin.license);
      } else if (prev !== origin.license) {
        this.lotVendor.delete(lot); // ambiguous lot — tombstone, never guess
        this.lotVendorConflicts.add(lot);
      }
    }
    const brandKey = normalizeBrandKey(extractBrand(row.description));
    if (brandKey) {
      const seenKey = `${brandKey}\u0001${ext}`;
      if (!this.brandBridgeSeen.has(seenKey)) {
        this.brandBridgeSeen.add(seenKey);
        let counts = this.brandBridge.get(brandKey);
        if (!counts) {
          counts = new Map();
          this.brandBridge.set(brandKey, counts);
        }
        counts.set(origin.license, (counts.get(origin.license) ?? 0) + 1);
      }
    }
  }

  addInventory(row: InventoryRow): void {
    this.totals.inventoryRows += 1;
    const idNum = Number(row.inventoryId);
    if (!Number.isFinite(idNum)) return;
    // Task I (I4): lot-level vendor join — the retailer's inventory
    // ExternalIdentifier equals TransportedItems.InventoryExternalIdentifier
    // on the manifest that delivered it (verified on the real May-2026 zip).
    if (row.externalIdentifier) {
      const vendorLicense = this.lotVendor.get(row.externalIdentifier.trim().toLowerCase());
      if (vendorLicense !== undefined) {
        const licNum = Number(vendorLicense);
        if (Number.isFinite(licNum) && Number.isInteger(licNum) && licNum > 0) {
          this.invVendor.set(idNum, licNum);
        }
      }
    }
    const productId = row.productId ? Number(row.productId) : 0;
    const strainId = row.strainId ? Number(row.strainId) : 0;
    if (!productId && !strainId) return;
    this.invMap.set(idNum, Number.isFinite(productId) ? productId : 0, Number.isFinite(strainId) ? strainId : 0);
  }

  addStrain(row: StrainRow): void {
    this.totals.strainRows += 1;
    const idNum = Number(row.strainId);
    if (!Number.isFinite(idNum) || !row.name) return;
    this.strainNameById.set(idNum, row.name);
  }

  addSaleHeader(row: SaleHeaderRow): void {
    this.totals.saleHeaderRows += 1;
    // Track period from headers. min/max record the honest observed span;
    // the yyyy-mm histogram finds the DOMINANT month (the drop's real period),
    // because monthly deliveries carry updated headers with stale SaleDates.
    if (row.saleDate) {
      if (this.minDate == null || row.saleDate < this.minDate) this.minDate = row.saleDate;
      if (this.maxDate == null || row.saleDate > this.maxDate) this.maxDate = row.saleDate;
      const month = row.saleDate.slice(0, 7); // ISO yyyy-mm (parse.ts normalizes)
      if (month.length === 7) {
        this.monthCounts.set(month, (this.monthCounts.get(month) ?? 0) + 1);
      }
    }
    // Only headers that can produce classified lines are worth remembering.
    if (row.saleType === "other") return;
    const idNum = Number(row.saleHeaderId);
    if (!Number.isFinite(idNum)) return;
    const classCode = row.saleType === "wholesale" ? CLASS_WHOLESALE : CLASS_RETAIL;
    const sellerNum = row.sellerLicenseeId ? Number(row.sellerLicenseeId) : Number.NaN;
    const sellerSlot = Number.isFinite(sellerNum)
      ? (this.trackedSlotByLicenseeId.get(sellerNum) ?? 0)
      : 0;
    // S7: on WHOLESALE headers the buyer (SoldToLicenseeId) may be a tracked
    // competitor — pack the buyer slot plus the supplier (seller) licensee id
    // so sale details can attribute the spend to that competitor's suppliers.
    let buyerSlot = 0;
    let supplierId = 0;
    if (classCode === CLASS_WHOLESALE) {
      // S10: pack the seller licensee id for EVERY wholesale header (not just
      // tracked-buyer ones) so sale details can also feed the STATEWIDE
      // supplier benchmarks. Packing bound is unchanged: the id occupies the
      // same bits whether or not a buyer slot is set (max = 2^53 − 1 exactly).
      if (
        Number.isFinite(sellerNum) &&
        Number.isInteger(sellerNum) &&
        sellerNum > 0 &&
        sellerNum < MAX_PACKED_SUPPLIER_ID
      ) {
        supplierId = sellerNum;
      }
      if (row.buyerLicenseeId) {
        const buyerNum = Number(row.buyerLicenseeId);
        if (Number.isFinite(buyerNum)) {
          buyerSlot = this.trackedSlotByLicenseeId.get(buyerNum) ?? 0;
          // S10: buyer reach from HEADERS (a header with no surviving detail
          // lines still proves the seller→buyer relationship).
          if (supplierId > 0 && Number.isInteger(buyerNum) && buyerNum > 0) {
            let set = this.supplierBuyers.get(supplierId);
            if (!set) {
              set = new Set();
              this.supplierBuyers.set(supplierId, set);
            }
            set.add(buyerNum);
          }
        }
      }
    }
    // Lane 1 carries the medical marker. normalizeSaleType already maps
    // "RecreationalMedical" → "medical" (verified enum: RecreationalRetail,
    // RecreationalMedical, Wholesale). Medical sales ARE retail sales, so
    // classCode stays CLASS_RETAIL and the marker rides alongside it — that
    // keeps every existing retail rollup whole while letting the medical
    // subset be reported separately.
    this.headerMap.set(
      idNum,
      classCode + sellerSlot * 2 + buyerSlot * BUYER_FACTOR + supplierId * SUPPLIER_FACTOR,
      row.saleType === "medical" ? MEDICAL_YES : 0,
    );
  }

  // ---- the big one: sale details ------------------------------------------

  addSaleDetail(row: SaleDetailRow): void {
    this.totals.saleDetailRows += 1;
    if (row.isDeleted === true) return;
    if (!row.saleHeaderId || row.unitPriceMinor == null || row.unitPriceMinor < 0) return;
    const headerKey = Number(row.saleHeaderId);
    const packed = this.headerMap.get(headerKey, 0);
    if (packed === undefined) return;
    const isMedicalSale = this.headerMap.get(headerKey, 1) === MEDICAL_YES;
    // Unpack (see the packing doc above CLASS_RETAIL). All ops are exact:
    // packed < 2^53.
    const classCode = packed % 2;
    const rest = (packed - classCode) / 2; // sellerSlot + buyerSlot·256 + supplierId·65536
    const trackedSlot = rest % 256; // tracked SELLER slot (retail attribution)
    const buyerRest = (rest - trackedSlot) / 256;
    const buyerSlot = buyerRest % 256; // tracked BUYER slot (wholesale sourcing, S7)
    const supplierLicenseeId = (buyerRest - buyerSlot) / 256;

    const qty = row.quantity != null && row.quantity > 0 ? row.quantity : 1;
    const unitMinor = row.unitPriceMinor;
    // Line revenue = qty × per-unit price − line discount (verified semantics).
    const lineMinor = Math.max(0, Math.round(unitMinor * qty) - (row.discountMinor ?? 0));

    const saleClass: "retail" | "wholesale" =
      classCode === CLASS_WHOLESALE ? "wholesale" : "retail";
    if (saleClass === "retail") this.totals.retailLines += 1;
    else this.totals.wholesaleLines += 1;

    // Resolve product context (may fail on out-of-month lots — counted honestly).
    const invNum = row.inventoryId ? Number(row.inventoryId) : Number.NaN;
    const productId = Number.isFinite(invNum) ? (this.invMap.get(invNum, 0) ?? 0) : 0;
    const strainId = Number.isFinite(invNum) ? (this.invMap.get(invNum, 1) ?? 0) : 0;
    const product = productId ? this.productById.get(productId) : undefined;
    const strainName = strainId ? (this.strainNameById.get(strainId) ?? null) : null;
    const attributed = product != null;
    if (attributed && saleClass === "retail") this.totals.attributedRetailLines += 1;

    const invType = product?.inventoryType ?? UNATTRIBUTED;
    const brand = product?.brand ?? null;
    const ppgMinor =
      product?.weightGrams != null ? Math.round(unitMinor / product.weightGrams) : null;

    // -- statewide benchmarks --
    this.bench(saleClass, "overall", "all", unitMinor, ppgMinor, qty, lineMinor);
    this.bench(saleClass, "type", invType, unitMinor, ppgMinor, qty, lineMinor);
    if (brand) this.bench(saleClass, "brand", brand, unitMinor, ppgMinor, qty, lineMinor);
    if (strainName) this.bench(saleClass, "strain", strainName, unitMinor, ppgMinor, qty, lineMinor);

    // -- medical breakout (ADDITIVE: these lines are ALSO counted above as
    //    retail, so "retail" keeps its historical meaning and stays comparable
    //    across months; non-medical retail = retail − medical) --
    if (isMedicalSale && saleClass === "retail") {
      this.totals.medicalLines += 1;
      this.bench("medical", "overall", "all", unitMinor, ppgMinor, qty, lineMinor);
      this.bench("medical", "type", invType, unitMinor, ppgMinor, qty, lineMinor);
      if (brand) this.bench("medical", "brand", brand, unitMinor, ppgMinor, qty, lineMinor);
      if (strainName) this.bench("medical", "strain", strainName, unitMinor, ppgMinor, qty, lineMinor);
    }

    // -- statewide movers (retail only; that's the sell-through signal) --
    if (saleClass === "retail" && product?.name) {
      let mover = this.statewideMovers.get(product.name);
      if (!mover) {
        if (this.statewideMovers.size >= MOVER_MAP_CAP) this.pruneMovers();
        mover = {
          inventoryType: invType,
          brand,
          strainName,
          units: 0,
          revenueMinor: 0,
          price: new PriceHistogram(),
          vendorCounts: null,
        };
        this.statewideMovers.set(product.name, mover);
      }
      mover.units += qty;
      mover.revenueMinor += lineMinor;
      mover.price.add(unitMinor);
      // Task I (I4): lot-level vendor sighting — the manifest that delivered
      // THIS lot named its shipping vendor. Dominant vendor wins at result().
      if (Number.isFinite(invNum)) {
        const vendorLicNum = this.invVendor.get(invNum);
        if (vendorLicNum !== undefined && vendorLicNum > 0) {
          const lic = String(vendorLicNum);
          if (!mover.vendorCounts) mover.vendorCounts = new Map();
          mover.vendorCounts.set(lic, (mover.vendorCounts.get(lic) ?? 0) + 1);
        }
      }
    }

    // -- statewide supplier benchmarks (S10: every wholesale line with a
    //    packable seller id feeds the seller's supplier stats) --
    if (saleClass === "wholesale" && supplierLicenseeId > 0) {
      let sup = this.supplierStats.get(supplierLicenseeId);
      if (!sup) {
        sup = { lineCount: 0, revenueMinor: 0, price: new PriceHistogram() };
        this.supplierStats.set(supplierLicenseeId, sup);
      }
      sup.lineCount += 1;
      sup.revenueMinor += lineMinor;
      sup.price.add(unitMinor);
    }

    // -- competitor sourcing (S7: wholesale lines BOUGHT by a tracked license) --
    if (saleClass === "wholesale" && buyerSlot > 0) {
      const info = this.trackedByIdx[buyerSlot - 1];
      if (info) {
        const comp = this.competitorAcc(info);
        comp.wsLineCount += 1;
        comp.wsSpendMinor += lineMinor;
        if (supplierLicenseeId > 0) {
          const sup = comp.suppliers.get(supplierLicenseeId) ?? { lineCount: 0, spendMinor: 0 };
          sup.lineCount += 1;
          sup.spendMinor += lineMinor;
          comp.suppliers.set(supplierLicenseeId, sup);
        }
      }
    }

    // -- competitor stats (retail lines sold BY a tracked license) --
    if (saleClass === "retail" && trackedSlot > 0) {
      const info = this.trackedByIdx[trackedSlot - 1];
      if (info) {
        const comp = this.competitorAcc(info);
        comp.units += qty;
        comp.revenueMinor += lineMinor;
        comp.lineCount += 1;
        comp.unitPrice.add(unitMinor);

        const t = comp.byType.get(invType) ?? { units: 0, revenueMinor: 0 };
        t.units += qty;
        t.revenueMinor += lineMinor;
        comp.byType.set(invType, t);

        if (product?.name) {
          let p = comp.byProduct.get(product.name);
          if (!p) {
            p = {
              productName: product.name,
              inventoryType: invType,
              brand,
              strainName,
              units: 0,
              revenueMinor: 0,
              price: new PriceHistogram(),
              vendorCounts: null,
            };
            comp.byProduct.set(product.name, p);
          }
          p.units += qty;
          p.revenueMinor += lineMinor;
          p.price.add(unitMinor);
          if (Number.isFinite(invNum)) {
            const vendorLicNum = this.invVendor.get(invNum);
            if (vendorLicNum !== undefined && vendorLicNum > 0) {
              const lic = String(vendorLicNum);
              if (!p.vendorCounts) p.vendorCounts = new Map();
              p.vendorCounts.set(lic, (p.vendorCounts.get(lic) ?? 0) + 1);
            }
          }
        }
      }
    }
  }

  /** Get-or-create a competitor accumulator (shared by retail + wholesale, S7). */
  private competitorAcc(info: TrackedInfo): CompetitorAcc {
    let comp = this.competitors.get(info.licenseNumber);
    if (!comp) {
      comp = {
        ...info,
        units: 0,
        revenueMinor: 0,
        lineCount: 0,
        unitPrice: new PriceHistogram(),
        byType: new Map(),
        byProduct: new Map(),
        wsLineCount: 0,
        wsSpendMinor: 0,
        suppliers: new Map(),
      };
      this.competitors.set(info.licenseNumber, comp);
    }
    return comp;
  }

  private intern(s: string | null): string | null {
    if (s == null) return null;
    const hit = this.typeIntern.get(s);
    if (hit !== undefined) return hit;
    this.typeIntern.set(s, s);
    return s;
  }

  /**
   * Task I (I4): resolve a mover's SHIPPING VENDOR — dominant manifest origin
   * on its sold lots first (exact), brand→vendor bridge second (conservative
   * thresholds verified on the real May-2026 delivery), null otherwise.
   * Display name: licensee-table DBA → licensee name → manifest origin name.
   */
  private resolveVendor(m: MoverAcc): { vendorName: string | null; vendorLicense: string | null } {
    let license: string | null = null;
    if (m.vendorCounts && m.vendorCounts.size > 0) {
      let bestCount = -1;
      for (const [lic, count] of m.vendorCounts) {
        if (count > bestCount || (count === bestCount && (license === null || lic < license))) {
          license = lic;
          bestCount = count;
        }
      }
    }
    if (!license) {
      const brandKey = normalizeBrandKey(m.brand);
      const counts = brandKey ? this.brandBridge.get(brandKey) : undefined;
      if (counts) {
        let total = 0;
        let top: string | null = null;
        let topCount = -1;
        for (const [lic, count] of counts) {
          total += count;
          if (count > topCount || (count === topCount && (top === null || lic < top))) {
            top = lic;
            topCount = count;
          }
        }
        if (top && total >= BRAND_BRIDGE_MIN_MANIFESTS && topCount / total >= BRAND_BRIDGE_MIN_SHARE) {
          license = top;
        }
      }
    }
    if (!license) return { vendorName: null, vendorLicense: null };
    const id = this.licenseeByLicenseNumber.get(license);
    const name = id?.dba ?? id?.name ?? this.vendorNameByLicense.get(license) ?? null;
    return { vendorName: name, vendorLicense: license };
  }

  private pruneMovers(): void {
    this.totals.moverMapPrunes += 1;
    const keep = [...this.statewideMovers.entries()]
      .sort((a, b) => b[1].revenueMinor - a[1].revenueMinor)
      .slice(0, MOVER_KEEP);
    this.statewideMovers = new Map(keep);
  }

  private bench(
    saleClass: BenchmarkSaleClass,
    scope: StatewideBenchmark["scope"],
    key: string,
    unitMinor: number,
    ppgMinor: number | null,
    qty: number,
    lineMinor: number,
  ): void {
    const k = `${saleClass}\u0001${scope}\u0001${key}`;
    let acc = this.statewide.get(k);
    if (!acc) {
      acc = {
        unitPrice: new PriceHistogram(),
        pricePerGram: new PriceHistogram(),
        units: 0,
        revenueMinor: 0,
      };
      this.statewide.set(k, acc);
    }
    acc.unitPrice.add(unitMinor);
    if (ppgMinor != null) acc.pricePerGram.add(ppgMinor);
    acc.units += qty;
    acc.revenueMinor += lineMinor;
  }

  // ---- finish --------------------------------------------------------------

  result(): AggregationResult {
    let statewide: StatewideBenchmark[] = [];
    for (const [k, acc] of this.statewide.entries()) {
      const [saleClass, scope, scopeKey] = k.split("\u0001") as [
        BenchmarkSaleClass,
        StatewideBenchmark["scope"],
        string,
      ];
      statewide.push({
        scope,
        scopeKey,
        saleClass,
        unitPrice: acc.unitPrice.summary(),
        pricePerGram: acc.pricePerGram.summary(),
        units: round2(acc.units),
        revenueMinor: acc.revenueMinor,
      });
    }
    // Brand/strain scopes can run to hundreds of thousands of buckets
    // statewide; the pages need the leaders, so persist the top slice per
    // (class, scope) by revenue. Type + overall scopes are small and kept
    // whole.
    statewide = capScopes(statewide, TOP_BENCH_PER_SCOPE);
    // Stable, deterministic order: class, scope, then revenue desc.
    statewide.sort(
      (a, b) =>
        a.saleClass.localeCompare(b.saleClass) ||
        a.scope.localeCompare(b.scope) ||
        b.revenueMinor - a.revenueMinor ||
        a.scopeKey.localeCompare(b.scopeKey),
    );

    const competitors: CompetitorStat[] = [...this.competitors.values()]
      .map((c) => ({
        licenseNumber: c.licenseNumber,
        licenseeId: c.licenseeId,
        name: c.name,
        dba: c.dba,
        city: c.city,
        retail: {
          units: round2(c.units),
          revenueMinor: c.revenueMinor,
          lineCount: c.lineCount,
          unitPrice: c.unitPrice.summary(),
          byType: [...c.byType.entries()]
            .map(([inventoryType, v]) => ({
              inventoryType,
              units: round2(v.units),
              revenueMinor: v.revenueMinor,
            }))
            .sort((a, b) => b.revenueMinor - a.revenueMinor),
          topProducts: [...c.byProduct.values()]
            .sort((a, b) => b.revenueMinor - a.revenueMinor)
            .slice(0, TOP_PRODUCTS_PER_COMPETITOR)
            .map((p) => ({
              productName: p.productName,
              inventoryType: p.inventoryType,
              units: round2(p.units),
              revenueMinor: p.revenueMinor,
              medianUnitPriceMinor: p.price.percentile(0.5),
            })),
        },
        wholesale: {
          lineCount: c.wsLineCount,
          spendMinor: c.wsSpendMinor,
          topSuppliers: [...c.suppliers.entries()]
            .sort(
              (a, b) =>
                b[1].spendMinor - a[1].spendMinor ||
                b[1].lineCount - a[1].lineCount ||
                a[0] - b[0],
            )
            .slice(0, TOP_SUPPLIERS_PER_COMPETITOR)
            .map(([supplierId, s]) => {
              // Identity from the monthly licensee table (included whole every
              // month). If a supplier id somehow has no licensee row, its
              // identity fields stay null — never guessed.
              const id = this.licenseeInfoById.get(supplierId);
              return {
                licenseeId: String(supplierId),
                licenseNumber: id?.licenseNumber ?? null,
                name: id?.name ?? null,
                dba: id?.dba ?? null,
                lineCount: s.lineCount,
                spendMinor: s.spendMinor,
              };
            }),
        },
      }))
      .sort(
        (a, b) =>
          b.retail.revenueMinor - a.retail.revenueMinor ||
          b.wholesale.spendMinor - a.wholesale.spendMinor ||
          a.licenseNumber.localeCompare(b.licenseNumber),
      );

    const signals: MarketSignal[] = [];
    const moverSignal = (
      kind: MarketSignal["kind"],
      licenseNumber: string | null,
      productName: string,
      m: MoverAcc,
    ): MarketSignal => {
      const vendor = this.resolveVendor(m);
      return {
        kind,
        licenseNumber,
        inventoryType: m.inventoryType,
        productName,
        brand: m.brand,
        strainName: m.strainName,
        units: round2(m.units),
        revenueMinor: m.revenueMinor,
        medianUnitPriceMinor: m.price.percentile(0.5),
        p25UnitPriceMinor: m.price.percentile(0.25),
        vendorName: vendor.vendorName,
        vendorLicense: vendor.vendorLicense,
      };
    };

    const movers = [...this.statewideMovers.entries()]
      .sort((a, b) => b[1].revenueMinor - a[1].revenueMinor)
      .slice(0, TOP_SIGNALS_STATEWIDE);
    for (const [productName, m] of movers) {
      signals.push(moverSignal("statewide_mover", null, productName, m));
    }
    // Task I (I4): per-inventory-type product leaders ("top 10 products from
    // every single type"). Grouped over the FULL mover map (not just the
    // statewide top-100) so small-revenue types still get their leaders.
    {
      const byType = new Map<string, Array<[string, MoverAcc]>>();
      for (const [productName, m] of this.statewideMovers.entries()) {
        const t = m.inventoryType ?? UNATTRIBUTED;
        const list = byType.get(t);
        if (list) list.push([productName, m]);
        else byType.set(t, [[productName, m]]);
      }
      for (const list of byType.values()) {
        list.sort((a, b) => b[1].revenueMinor - a[1].revenueMinor || a[0].localeCompare(b[0]));
        for (const [productName, m] of list.slice(0, TOP_TYPE_MOVERS_PER_TYPE)) {
          signals.push(moverSignal("type_mover", null, productName, m));
        }
      }
    }
    for (const c of this.competitors.values()) {
      const top = [...c.byProduct.values()]
        .sort((a, b) => b.revenueMinor - a.revenueMinor)
        .slice(0, TOP_SIGNALS_PER_COMPETITOR);
      for (const p of top) {
        signals.push(moverSignal("competitor_mover", c.licenseNumber, p.productName, p));
      }
    }

    // S10: statewide wholesale supplier benchmarks — top by observed revenue.
    const suppliers: StatewideSupplierStat[] = [...this.supplierStats.entries()]
      .sort(
        (a, b) =>
          b[1].revenueMinor - a[1].revenueMinor ||
          b[1].lineCount - a[1].lineCount ||
          a[0] - b[0],
      )
      .slice(0, TOP_SUPPLIERS_STATEWIDE)
      .map(([supplierId, s]) => {
        const id = this.licenseeInfoById.get(supplierId);
        const buyers = this.supplierBuyers.get(supplierId);
        let trackedBuyers = 0;
        if (buyers) {
          for (const b of buyers) {
            if (this.trackedSlotByLicenseeId.has(b)) trackedBuyers += 1;
          }
        }
        return {
          licenseeId: String(supplierId),
          licenseNumber: id?.licenseNumber ?? null,
          name: id?.name ?? null,
          dba: id?.dba ?? null,
          lineCount: s.lineCount,
          revenueMinor: s.revenueMinor,
          unitPrice: s.price.summary(),
          distinctBuyers: buyers?.size ?? 0,
          trackedBuyers,
        };
      });

    // Task I (I1): period = the DOMINANT SaleHeader month's full span. The
    // histogram is never guessed — no dated headers means a null period. Ties
    // break toward the NEWEST month (a delivery is named for its newest data).
    let periodStart: string | null = null;
    let periodEnd: string | null = null;
    let bestMonth = "";
    let bestCount = -1;
    for (const [month, count] of this.monthCounts) {
      if (count > bestCount || (count === bestCount && month > bestMonth)) {
        bestMonth = month;
        bestCount = count;
      }
    }
    if (bestMonth) {
      const year = Number(bestMonth.slice(0, 4));
      const monthNum = Number(bestMonth.slice(5, 7));
      if (Number.isFinite(year) && monthNum >= 1 && monthNum <= 12) {
        const lastDay = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
        periodStart = `${bestMonth}-01`;
        periodEnd = `${bestMonth}-${String(lastDay).padStart(2, "0")}`;
      }
    }

    return {
      periodStart,
      periodEnd,
      observedMinDate: this.minDate,
      observedMaxDate: this.maxDate,
      totals: { ...this.totals },
      statewide,
      competitors,
      signals,
      suppliers,
    };
  }
}

/** Keeps every type/overall row; caps brand/strain rows per (class, scope). */
function capScopes(rows: StatewideBenchmark[], cap: number): StatewideBenchmark[] {
  const out: StatewideBenchmark[] = [];
  const grouped = new Map<string, StatewideBenchmark[]>();
  for (const row of rows) {
    if (row.scope === "type" || row.scope === "overall") {
      out.push(row);
      continue;
    }
    const key = `${row.saleClass}/${row.scope}`;
    const list = grouped.get(key);
    if (list) list.push(row);
    else grouped.set(key, [row]);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => b.revenueMinor - a.revenueMinor);
    out.push(...list.slice(0, cap));
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
