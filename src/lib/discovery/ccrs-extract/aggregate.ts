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

import type {
  LicenseeRow,
  SaleHeaderRow,
  SaleDetailRow,
  ProductRow,
  InventoryRow,
  StrainRow,
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

export type StatewideBenchmark = {
  scope: "type" | "brand" | "strain" | "overall";
  scopeKey: string;
  saleClass: "retail" | "wholesale";
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
  kind: "statewide_mover" | "competitor_mover";
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
};

export type AggregationResult = {
  periodStart: string | null;
  periodEnd: string | null;
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
    /** How many times the statewide-mover map hit its cap and was pruned. */
    moverMapPrunes: number;
  };
  statewide: StatewideBenchmark[];
  competitors: CompetitorStat[];
  signals: MarketSignal[];
  /** S10: statewide wholesale supplier benchmarks (top by revenue). */
  suppliers: StatewideSupplierStat[];
};

// ---------------------------------------------------------------------------
// Brand extraction (same conservative heuristic as ccrs.ts — separator only)
// ---------------------------------------------------------------------------

export function extractBrand(name: string | null): string | null {
  if (!name) return null;
  const m = name.match(/^\s*([^|:–-]{2,40}?)\s*[|:–-]\s+/);
  if (m && m[1].trim().length >= 2) return m[1].trim();
  return null;
}

// ---------------------------------------------------------------------------
// The aggregator
// ---------------------------------------------------------------------------

const UNATTRIBUTED = "(unattributed)";
const TOP_PRODUCTS_PER_COMPETITOR = 25;
/** S7: wholesale suppliers persisted per competitor (top by spend). */
export const TOP_SUPPLIERS_PER_COMPETITOR = 10;
const TOP_SIGNALS_STATEWIDE = 100;
const TOP_SIGNALS_PER_COMPETITOR = 15;
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
 * Packed sale-header value (single Float64 lane, exact-integer safe):
 *   bit 0        — saleClass code (0 retail, 1 wholesale)
 *   bits 1..8    — tracked SELLER slot (0 = untracked; 1-based, ≤ SLOT_LIMIT)
 *   bits 9..16   — tracked BUYER slot  (0 = untracked; wholesale sourcing, S7)
 *   bits 17..52  — supplier (seller) LicenseeId, packed ONLY for wholesale
 *                  headers whose buyer is tracked (0 = none/unpackable)
 * Max packed value = 1 + 2·255 + 512·255 + 131072·(2^36 − 1) = 2^53 − 1,
 * which a Float64 represents exactly. Ids ≥ 2^36 are NOT packed (the line is
 * still counted; its supplier folds into "unattributed" — never guessed).
 */
const CLASS_RETAIL = 0;
const CLASS_WHOLESALE = 1;
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
  private headerMap = new U53Map(1);

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
  /** Interned inventory-type strings (small closed set in the real data). */
  private typeIntern = new Map<string, string>();

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
    moverMapPrunes: 0,
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

  addInventory(row: InventoryRow): void {
    this.totals.inventoryRows += 1;
    const idNum = Number(row.inventoryId);
    if (!Number.isFinite(idNum)) return;
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
    // Track period from headers (the dataset's real span).
    if (row.saleDate) {
      if (this.minDate == null || row.saleDate < this.minDate) this.minDate = row.saleDate;
      if (this.maxDate == null || row.saleDate > this.maxDate) this.maxDate = row.saleDate;
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
    this.headerMap.set(
      idNum,
      classCode + sellerSlot * 2 + buyerSlot * BUYER_FACTOR + supplierId * SUPPLIER_FACTOR,
    );
  }

  // ---- the big one: sale details ------------------------------------------

  addSaleDetail(row: SaleDetailRow): void {
    this.totals.saleDetailRows += 1;
    if (row.isDeleted === true) return;
    if (!row.saleHeaderId || row.unitPriceMinor == null || row.unitPriceMinor < 0) return;
    const packed = this.headerMap.get(Number(row.saleHeaderId));
    if (packed === undefined) return;
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
        };
        this.statewideMovers.set(product.name, mover);
      }
      mover.units += qty;
      mover.revenueMinor += lineMinor;
      mover.price.add(unitMinor);
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
            };
            comp.byProduct.set(product.name, p);
          }
          p.units += qty;
          p.revenueMinor += lineMinor;
          p.price.add(unitMinor);
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

  private pruneMovers(): void {
    this.totals.moverMapPrunes += 1;
    const keep = [...this.statewideMovers.entries()]
      .sort((a, b) => b[1].revenueMinor - a[1].revenueMinor)
      .slice(0, MOVER_KEEP);
    this.statewideMovers = new Map(keep);
  }

  private bench(
    saleClass: "retail" | "wholesale",
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
        "retail" | "wholesale",
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
    const movers = [...this.statewideMovers.entries()]
      .sort((a, b) => b[1].revenueMinor - a[1].revenueMinor)
      .slice(0, TOP_SIGNALS_STATEWIDE);
    for (const [productName, m] of movers) {
      signals.push({
        kind: "statewide_mover",
        licenseNumber: null,
        inventoryType: m.inventoryType,
        productName,
        brand: m.brand,
        strainName: m.strainName,
        units: round2(m.units),
        revenueMinor: m.revenueMinor,
        medianUnitPriceMinor: m.price.percentile(0.5),
        p25UnitPriceMinor: m.price.percentile(0.25),
      });
    }
    for (const c of this.competitors.values()) {
      const top = [...c.byProduct.values()]
        .sort((a, b) => b.revenueMinor - a.revenueMinor)
        .slice(0, TOP_SIGNALS_PER_COMPETITOR);
      for (const p of top) {
        signals.push({
          kind: "competitor_mover",
          licenseNumber: c.licenseNumber,
          inventoryType: p.inventoryType,
          productName: p.productName,
          brand: p.brand,
          strainName: p.strainName,
          units: round2(p.units),
          revenueMinor: p.revenueMinor,
          medianUnitPriceMinor: p.price.percentile(0.5),
          p25UnitPriceMinor: p.price.percentile(0.25),
        });
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

    return {
      periodStart: this.minDate,
      periodEnd: this.maxDate,
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
