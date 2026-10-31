/**
 * src/lib/inventory/count-generators-core.ts   (Fix Phase 4.4c · G-40 · owner D58)
 *
 * The owner, verbatim (D58):
 *   "My plan for cycle counts is to issue small counts the employees can do
 *    everyday to keep inventory accurate. Something like a vendor per day,
 *    broken into chunks if a large vendor, or if small enough, to do on their
 *    own."  ·  "I also want options for initiating intelligent cycle counts."
 *
 * Gap G-40 (05-GAP-REGISTER.md): generators Vendor of the day (rotates every
 * vendor with open lots, splits a large vendor into chunks of an owner-set size,
 * remembers the next chunk), High value / ABC, Exceptions, Expiring soon,
 * Cultivera-import flags (exists), Never counted / overdue; each lot shows why
 * it was picked; every generator only PROPOSES (the owner names, writes why,
 * creates and releases, D50, D54); one open count per lot (NetSuite).
 *
 * PURE. No database. The store (count-generators-store.ts) loads the lots and
 * the exception inputs and hands them here. A product is always taken WHOLE:
 * a picked lot pulls in every other open lot of the same product (the planner's
 * cohesion rule, inventory-audit-core.ts buildAuditPlan).
 */
import {
  assessRisk,
  groupLotsByProduct,
  stratifyLots,
  type AuditLot,
} from "./inventory-audit-core";

export const COUNT_GENERATORS = ["due", "vendor", "abc", "exceptions", "expiring"] as const;
export type CountGenerator = (typeof COUNT_GENERATORS)[number];

export function isCountGenerator(v: unknown): v is CountGenerator {
  return typeof v === "string" && (COUNT_GENERATORS as readonly string[]).includes(v);
}

export const GENERATOR_LABELS: Record<CountGenerator, string> = {
  due: "Never counted / overdue",
  vendor: "Vendor of the day",
  abc: "High value (A lots)",
  exceptions: "Exceptions",
  expiring: "Expiring soon",
};

export const GENERATOR_HELP: Record<CountGenerator, string> = {
  due: "Lots never counted or past their A 30 / B 60 / C 90 day date, ranked by risk. The usual daily list.",
  vendor: "The next vendor in the rotation, split into counts of the size you set. Small daily counts cover the whole store.",
  abc: "The A lots: the few products that hold most of the money on the shelves (80% of value).",
  exceptions: "Where the books are already doubtful: sold past the count, adjusted in the last 30 days, marked unavailable while stock shows, or showing zero while still open.",
  expiring: "Lots expired or expiring within 30 days. Confirms what is on the shelf before the markdown.",
};

/** Default lots per vendor chunk, and the owner's allowed range. */
export const DEFAULT_CHUNK_LOTS = 25;
export const MIN_CHUNK_LOTS = 5;
export const MAX_CHUNK_LOTS = 200;
/** Budget for the ranked generators (abc / exceptions / expiring), as Plan a count's default. */
export const GENERATOR_MAX_LOTS = 40;
export const EXPIRING_WINDOW_DAYS = 30;
export const RECENT_ADJUSTMENT_DAYS = 30;

export function checkChunkLots(raw: unknown): { ok: true; value: number } | { ok: false; message: string } {
  const n = Number(typeof raw === "string" ? raw.trim() : raw);
  if (!Number.isInteger(n) || n < MIN_CHUNK_LOTS || n > MAX_CHUNK_LOTS) {
    return { ok: false, message: `Lots per vendor count is a whole number from ${MIN_CHUNK_LOTS} to ${MAX_CHUNK_LOTS}. Nothing was saved.` };
  }
  return { ok: true, value: n };
}

// ── Picking: lot ids + why ──────────────────────────────────────────────────

export type Picked = {
  /** Every lot to put on the count (whole products). */
  lotIds: string[];
  /** Why each lot was picked, in plain sentences. */
  why: Record<string, string[]>;
  /** Lots left out because they are already on an open count (one open count per lot). */
  skippedOpen: number;
  /** Products that qualified but did not fit the budget (they stay for next time). */
  deferredProducts: number;
};

export const WHOLE_PRODUCT_REASON = "Same product as a picked lot, so it is counted with it.";

function productKeyOf(l: AuditLot): string {
  return l.posProductKey ?? `\u0000lot:${l.lotId}`;
}

/**
 * Turn per-lot reasons into a whole-product pick within a budget.
 * `ranked` is the order products are considered in (first = most important).
 */
function pickWholeProducts(
  lots: readonly AuditLot[],
  reasons: Map<string, string[]>,
  openLotIds: ReadonlySet<string>,
  maxLots: number,
): Picked {
  const free = lots.filter((l) => !openLotIds.has(l.lotId));
  const skippedOpen = lots.length - free.length;
  const groups = groupLotsByProduct(free);
  const order: string[] = [];
  const seen = new Set<string>();
  for (const l of free) {
    if (!reasons.has(l.lotId)) continue;
    const k = productKeyOf(l);
    if (!seen.has(k)) {
      seen.add(k);
      order.push(k);
    }
  }
  const lotIds: string[] = [];
  const why: Record<string, string[]> = {};
  let deferred = 0;
  for (const k of order) {
    const members = groups.get(k) ?? [];
    if (lotIds.length > 0 && lotIds.length + members.length > maxLots) {
      deferred += 1;
      continue;
    }
    for (const m of members) {
      lotIds.push(m.lotId);
      why[m.lotId] = reasons.get(m.lotId) ?? [WHOLE_PRODUCT_REASON];
    }
  }
  return { lotIds, why, skippedOpen, deferredProducts: deferred };
}

/** High value: A-class lots (80% of shelf value), biggest first. */
export function pickAbc(lots: readonly AuditLot[], openLotIds: ReadonlySet<string>, maxLots = GENERATOR_MAX_LOTS): Picked {
  const strat = stratifyLots(lots).filter((s) => s.abc === "A");
  const reasons = new Map<string, string[]>();
  for (const s of strat) {
    reasons.set(s.lot.lotId, ["A lot: part of the 80% of shelf value (high value, counted most often)."]);
  }
  // stratifyLots returns valued lots biggest first, so order by that.
  const ordered = [...strat.map((s) => s.lot), ...lots.filter((l) => !reasons.has(l.lotId))];
  return pickWholeProducts(ordered, reasons, openLotIds, maxLots);
}

/** Expiring soon: expired or expiring within 30 days, soonest first. */
export function pickExpiring(
  lots: readonly AuditLot[],
  openLotIds: ReadonlySet<string>,
  pacificDay: string,
  maxLots = GENERATOR_MAX_LOTS,
): Picked {
  const today = Date.parse(`${pacificDay}T00:00:00Z`);
  const reasons = new Map<string, string[]>();
  const hits: Array<{ lot: AuditLot; days: number }> = [];
  for (const l of lots) {
    if (!l.expiresOn) continue;
    const t = Date.parse(`${l.expiresOn}T00:00:00Z`);
    if (Number.isNaN(t)) continue;
    const days = Math.round((t - today) / 86_400_000);
    if (days > EXPIRING_WINDOW_DAYS) continue;
    hits.push({ lot: l, days });
    reasons.set(
      l.lotId,
      [days < 0 ? `Expired ${-days} day${days === -1 ? "" : "s"} ago (${l.expiresOn}).` : days === 0 ? `Expires today (${l.expiresOn}).` : `Expires in ${days} day${days === 1 ? "" : "s"} (${l.expiresOn}).`],
    );
  }
  hits.sort((a, b) => a.days - b.days || a.lot.lotId.localeCompare(b.lot.lotId));
  const ordered = [...hits.map((h) => h.lot), ...lots.filter((l) => !reasons.has(l.lotId))];
  return pickWholeProducts(ordered, reasons, openLotIds, maxLots);
}

export type ExceptionInputs = {
  /** Product names the register sold past their tracked count (Stock needing recount). */
  oversoldProductNames: readonly string[];
  /** Lot id -> adjustment reasons (not receive / count / sale / void) in the last 30 days. */
  recentAdjustments: ReadonlyMap<string, readonly string[]>;
  /** pos_product_key of products marked unavailable (86) while stock shows. */
  unavailableWithStockKeys: readonly string[];
};

/** Exceptions: where the books are already doubtful. Most reasons first. */
export function pickExceptions(
  lots: readonly AuditLot[],
  openLotIds: ReadonlySet<string>,
  inputs: ExceptionInputs,
  maxLots = GENERATOR_MAX_LOTS,
): Picked {
  const oversold = new Set(inputs.oversoldProductNames.map((n) => n.trim().toLowerCase()).filter(Boolean));
  const unavailable = new Set(inputs.unavailableWithStockKeys);
  const reasons = new Map<string, string[]>();
  for (const l of lots) {
    const r: string[] = [];
    if (l.productName && oversold.has(l.productName.trim().toLowerCase())) {
      r.push("Sold past its count at the register (on Stock needing recount).");
    }
    const adj = inputs.recentAdjustments.get(l.lotId);
    if (adj && adj.length > 0) {
      const kinds = [...new Set(adj)].sort();
      r.push(`Adjusted in the last ${RECENT_ADJUSTMENT_DAYS} days (${kinds.join(", ")}).`);
    }
    if (l.posProductKey && unavailable.has(l.posProductKey)) {
      r.push("Marked unavailable on the menu while the books show stock.");
    }
    if (l.onHandQty <= 0) {
      r.push("The books show none on hand, but the lot is still open.");
    }
    if (r.length > 0) reasons.set(l.lotId, r);
  }
  const ordered = [...lots]
    .filter((l) => reasons.has(l.lotId))
    .sort((a, b) => (reasons.get(b.lotId)!.length - reasons.get(a.lotId)!.length) || a.lotId.localeCompare(b.lotId));
  return pickWholeProducts([...ordered, ...lots.filter((l) => !reasons.has(l.lotId))], reasons, openLotIds, maxLots);
}

/** Never counted / overdue: the planner's own risk reasons, as sentences. */
export function dueReasons(lots: readonly AuditLot[], asOf: Date): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of assessRisk(lots, asOf)) {
    const s: string[] = [];
    if (r.daysSinceCount === null) s.push("Never counted.");
    else if (r.isOverdue) s.push(`Last counted ${r.daysSinceCount} days ago; ${r.abc === "U" ? "unvalued" : r.abc} lots are due every ${r.daysSinceCount - (r.dueInDays ?? 0)} days.`);
    if (s.length) out[r.lot.lotId] = s;
  }
  return out;
}

// ── Vendor of the day ────────────────────────────────────────────────────────

export type RotationState = {
  /** The vendor to propose next ("none" = lots with no vendor recorded). */
  vendorId: string | null;
  /** Sort key of that vendor, so the rotation continues if it disappears. */
  vendorKey: string | null;
  vendorName: string | null;
  /** The chunk of that vendor to propose next (0-based). */
  chunk: number;
  /** Owner-set lots per count. */
  chunkLots: number;
  /** Pacific day the last vendor count was created (for the cockpit reminder). */
  lastPlannedOn: string | null;
  lastPlannedLabel: string | null;
};

export const EMPTY_ROTATION: RotationState = {
  vendorId: null,
  vendorKey: null,
  vendorName: null,
  chunk: 0,
  chunkLots: DEFAULT_CHUNK_LOTS,
  lastPlannedOn: null,
  lastPlannedLabel: null,
};

const NO_VENDOR = "none";

export function rotationFromSetting(v: unknown): RotationState {
  if (!v || typeof v !== "object") return { ...EMPTY_ROTATION };
  const o = v as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" && x.length > 0 && x.length <= 300 ? x : null);
  const chunk = Number(o.chunk);
  const lots = checkChunkLots(o.chunkLots);
  return {
    vendorId: str(o.vendorId),
    vendorKey: str(o.vendorKey),
    vendorName: str(o.vendorName),
    chunk: Number.isInteger(chunk) && chunk >= 0 && chunk < 10_000 ? chunk : 0,
    chunkLots: lots.ok ? lots.value : DEFAULT_CHUNK_LOTS,
    lastPlannedOn: str(o.lastPlannedOn) && /^\d{4}-\d{2}-\d{2}$/.test(String(o.lastPlannedOn)) ? String(o.lastPlannedOn) : null,
    lastPlannedLabel: str(o.lastPlannedLabel),
  };
}

export type VendorBucket = {
  vendorId: string; // NO_VENDOR for lots without one
  vendorKey: string;
  vendorName: string;
  /** Whole-product chunks, each a list of lot ids, each <= chunkLots unless one product is bigger. */
  chunks: string[][];
  lotCount: number;
};

/** Every vendor with open lots, in rotation order, split into whole-product chunks. */
export function vendorBuckets(lots: readonly AuditLot[], chunkLots: number): VendorBucket[] {
  const size = Math.max(1, Math.trunc(chunkLots));
  const byVendor = new Map<string, AuditLot[]>();
  for (const l of lots) {
    const id = l.vendorId ?? NO_VENDOR;
    const arr = byVendor.get(id);
    if (arr) arr.push(l);
    else byVendor.set(id, [l]);
  }
  const out: VendorBucket[] = [];
  for (const [id, arr] of byVendor) {
    const name = id === NO_VENDOR ? "Vendor not recorded" : arr.find((l) => l.vendorName)?.vendorName ?? "Unnamed vendor";
    // Lots with no vendor sort last.
    const key = `${id === NO_VENDOR ? "\uffff" : ""}${name.toLowerCase()}\u0000${id}`;
    const groups = [...groupLotsByProduct(arr).entries()].sort(
      (a, b) => (a[1][0]?.productName ?? "").localeCompare(b[1][0]?.productName ?? "") || a[0].localeCompare(b[0]),
    );
    const chunks: string[][] = [];
    let cur: string[] = [];
    for (const [, members] of groups) {
      if (cur.length > 0 && cur.length + members.length > size) {
        chunks.push(cur);
        cur = [];
      }
      cur.push(...members.map((m) => m.lotId).sort());
    }
    if (cur.length > 0) chunks.push(cur);
    out.push({ vendorId: id, vendorKey: key, vendorName: name, chunks, lotCount: arr.length });
  }
  out.sort((a, b) => a.vendorKey.localeCompare(b.vendorKey));
  return out;
}

export type VendorProposal = {
  vendorId: string;
  vendorName: string;
  chunkIndex: number;
  chunkCount: number;
  lotIds: string[];
  /** The pointer to save once this count is created (or skipped). */
  next: Pick<RotationState, "vendorId" | "vendorKey" | "vendorName" | "chunk">;
  /** The vendors after this one, for "next week's vendors listed" (form 8.8). */
  upcoming: Array<{ vendorName: string; chunkLabel: string }>;
};

function chunkLabel(i: number, n: number): string {
  return n === 1 ? "whole vendor" : `part ${i + 1} of ${n}`;
}

/**
 * Today's proposal from the saved pointer. Lots already on an open count are
 * left out first (one open count per lot). Returns null when no vendor has
 * free open lots.
 */
export function proposeVendorOfDay(
  lots: readonly AuditLot[],
  state: RotationState,
  openLotIds: ReadonlySet<string>,
  upcomingCount = 7,
): VendorProposal | null {
  const free = lots.filter((l) => !openLotIds.has(l.lotId));
  const buckets = vendorBuckets(free, state.chunkLots);
  if (buckets.length === 0) return null;

  // Where are we? The saved vendor if it still has lots; otherwise the first
  // vendor that sorts after it (the rotation continues), wrapping round.
  let vi = state.vendorId ? buckets.findIndex((b) => b.vendorId === state.vendorId) : -1;
  let ci = state.chunk;
  if (vi === -1) {
    ci = 0;
    vi = state.vendorKey ? buckets.findIndex((b) => b.vendorKey > state.vendorKey!) : 0;
    if (vi === -1) vi = 0;
  }
  if (ci >= buckets[vi]!.chunks.length) {
    vi = (vi + 1) % buckets.length;
    ci = 0;
  }
  const b = buckets[vi]!;
  const step = (v: number, c: number): [number, number] =>
    c + 1 < buckets[v]!.chunks.length ? [v, c + 1] : [(v + 1) % buckets.length, 0];
  const [nv, nc] = step(vi, ci);
  const upcoming: VendorProposal["upcoming"] = [];
  let [uv, uc] = [nv, nc];
  for (let i = 0; i < upcomingCount && !(uv === vi && uc === ci); i++) {
    const ub = buckets[uv]!;
    upcoming.push({ vendorName: ub.vendorName, chunkLabel: chunkLabel(uc, ub.chunks.length) });
    [uv, uc] = step(uv, uc);
  }
  return {
    vendorId: b.vendorId,
    vendorName: b.vendorName,
    chunkIndex: ci,
    chunkCount: b.chunks.length,
    lotIds: b.chunks[ci]!,
    next: { vendorId: buckets[nv]!.vendorId, vendorKey: buckets[nv]!.vendorKey, vendorName: buckets[nv]!.vendorName, chunk: nc },
    upcoming,
  };
}

export function vendorWhy(p: VendorProposal): string {
  return `Vendor of the day: ${p.vendorName}, ${chunkLabel(p.chunkIndex, p.chunkCount)}.`;
}

/** The pre-written count name and reason for each generator. */
export function generatorLabel(gen: CountGenerator, pacificDay: string, vendor?: VendorProposal | null): string {
  const d = pacificDay;
  if (gen === "vendor" && vendor) {
    return `${vendor.vendorName}${vendor.chunkCount > 1 ? ` (${vendor.chunkIndex + 1}/${vendor.chunkCount})` : ""} \u00b7 ${d}`;
  }
  return `${GENERATOR_LABELS[gen]} \u00b7 ${d}`;
}

export function generatorRationale(gen: CountGenerator, vendor?: VendorProposal | null): string | undefined {
  switch (gen) {
    case "vendor":
      return vendor
        ? `Vendor of the day (owner plan D58): every open lot of ${vendor.vendorName}${vendor.chunkCount > 1 ? `, ${chunkLabel(vendor.chunkIndex, vendor.chunkCount)}` : ""}, so the whole store is covered by small daily counts.`
        : undefined;
    case "abc":
      return "High-value A lots (80% of shelf value): the money is concentrated here, so these are counted most often.";
    case "exceptions":
      return "Exceptions: lots where the books are already doubtful (sold past the count, adjusted recently, marked unavailable while stock shows, or zero while still open).";
    case "expiring":
      return "Expiring soon: confirm what is really on the shelf before these lots are marked down or destroyed.";
    default:
      return undefined;
  }
}

// ── One open count per lot ───────────────────────────────────────────────────

/** Statuses in which an audit still holds its lots (posted approved audits are closed). */
export const OPEN_AUDIT_STATUSES = ["draft", "scope_approved", "counting", "review", "approved"] as const;

export function isOpenAudit(status: string, postedAt: string | null): boolean {
  if (status === "approved") return postedAt === null;
  return (OPEN_AUDIT_STATUSES as readonly string[]).includes(status);
}

export function openCountRefusal(conflicts: ReadonlyArray<{ lotCode: string | null; label: string }>): string {
  const first = conflicts.slice(0, 3).map((c) => `${c.lotCode ?? "a lot with no code"} (on \u201c${c.label}\u201d)`).join(", ");
  const more = conflicts.length > 3 ? ` and ${conflicts.length - 3} more` : "";
  return (
    `${conflicts.length} lot${conflicts.length === 1 ? " is" : "s are"} already on an open count: ${first}${more}. ` +
    `A lot is on one open count at a time. Finish, post or cancel that count first, or plan again (the planner leaves those lots out). Nothing was created.`
  );
}

// ── The daily reminder (cockpit) ────────────────────────────────────────────

/**
 * G-40 req 5 ("a daily proposal waiting"): once the owner has started the
 * vendor rotation (one vendor count created), the cockpit says so on any day
 * no vendor count has been planned yet. Before the rotation is started it says
 * nothing (no nagging about a routine the owner has not begun).
 */
export function vendorOfDayReminder(input: { started: boolean; plannedToday: boolean }): string | null {
  if (!input.started || input.plannedToday) return null;
  return "Today's vendor count is waiting to be planned (Plan a count \u2192 Vendor of the day).";
}

// ── Self-test ────────────────────────────────────────────────────────────────

export function __runCountGeneratorsCoreTests(): number {
  let n = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error(`count-generators-core: ${m}`);
    n++;
  };
  const lot = (id: string, o: Partial<AuditLot> = {}): AuditLot => ({
    lotId: id,
    lotCode: `L-${id}`,
    posProductKey: `p-${id}`,
    productName: `Product ${id}`,
    categorySlug: "flower",
    vendorId: "v1",
    vendorName: "Alpha Farms",
    onHandQty: 10,
    unitCostMinorUnits: 500,
    lastCountedAt: null,
    priorVarianceCount: 0,
    status: "active",
    expiresOn: null,
    ...o,
  });
  const none = new Set<string>();

  ok(isCountGenerator("vendor") && !isCountGenerator("full"), "generator names");
  ok(checkChunkLots("25").ok && !checkChunkLots("4").ok && !checkChunkLots("201").ok && !checkChunkLots("2.5").ok, "chunk size range");

  // Vendor buckets: whole products, chunks, no-vendor last.
  const vlots = [
    lot("a1", { posProductKey: "pa", productName: "A" }),
    lot("a2", { posProductKey: "pa", productName: "A" }),
    lot("b1", { posProductKey: "pb", productName: "B" }),
    lot("c1", { posProductKey: "pc", productName: "C" }),
    lot("z1", { vendorId: "v2", vendorName: "Zed Co" }),
    lot("n1", { vendorId: null, vendorName: null }),
  ];
  const bk = vendorBuckets(vlots, 2);
  ok(bk.map((b) => b.vendorName).join("|") === "Alpha Farms|Zed Co|Vendor not recorded", "rotation order, no vendor last");
  ok(JSON.stringify(bk[0]!.chunks) === JSON.stringify([["a1", "a2"], ["b1", "c1"]]), "whole-product chunks of 2");
  const big = vendorBuckets([lot("x1", { posProductKey: "px" }), lot("x2", { posProductKey: "px" }), lot("x3", { posProductKey: "px" })], 2);
  ok(big[0]!.chunks.length === 1 && big[0]!.chunks[0]!.length === 3, "a product bigger than the chunk stays whole");

  // Proposal walks the rotation and remembers the next chunk.
  const s0 = { ...EMPTY_ROTATION, chunkLots: 2 };
  const p1 = proposeVendorOfDay(vlots, s0, none)!;
  ok(p1.vendorName === "Alpha Farms" && p1.chunkIndex === 0 && p1.chunkCount === 2, "first proposal = first vendor part 1");
  ok(p1.next.vendorId === "v1" && p1.next.chunk === 1, "remembers the next chunk");
  const p2 = proposeVendorOfDay(vlots, { ...s0, ...p1.next }, none)!;
  ok(p2.chunkIndex === 1 && p2.next.vendorId === "v2" && p2.next.chunk === 0, "after the last chunk, the next vendor");
  const p3 = proposeVendorOfDay(vlots, { ...s0, ...p2.next }, none)!;
  const p4 = proposeVendorOfDay(vlots, { ...s0, ...p3.next }, none)!;
  ok(p3.vendorName === "Zed Co" && p4.vendorName === "Vendor not recorded" && p4.next.vendorId === "v1", "wraps round");
  ok(p1.upcoming.length === 3 && p1.upcoming[0]!.chunkLabel === "part 2 of 2", "upcoming list stops before repeating");
  // A vanished vendor: continue with the next one by sort key.
  const gone = proposeVendorOfDay(vlots, { ...s0, vendorId: "v-gone", vendorKey: "beta\u0000v-gone", chunk: 3 }, none)!;
  ok(gone.vendorName === "Zed Co" && gone.chunkIndex === 0, "vanished vendor -> next by name");
  // A lot on an open count is left out.
  const p5 = proposeVendorOfDay(vlots, s0, new Set(["a1", "a2"]))!;
  ok(p5.lotIds.join(",") === "b1,c1" && p5.chunkCount === 1, "open-count lots left out");
  ok(proposeVendorOfDay([], s0, none) === null, "nothing to rotate");

  // State parsing never trusts junk.
  const st = rotationFromSetting({ vendorId: "v1", chunk: -2, chunkLots: 9999, lastPlannedOn: "x" });
  ok(st.chunk === 0 && st.chunkLots === DEFAULT_CHUNK_LOTS && st.lastPlannedOn === null, "rotation state sanitised");

  // Expiring.
  const ex = pickExpiring(
    [lot("e1", { expiresOn: "2026-11-05" }), lot("e2", { expiresOn: "2026-10-01" }), lot("e3", { expiresOn: "2027-06-01" }), lot("e4")],
    none,
    "2026-10-30",
  );
  ok(ex.lotIds.join(",") === "e2,e1", "expired first, then soonest; far and none left out");
  ok(ex.why.e2![0] === "Expired 29 days ago (2026-10-01)." && ex.why.e1![0] === "Expires in 6 days (2026-11-05).", "expiry reasons");

  // Whole product pulled in with its reason.
  const wp = pickExpiring([lot("w1", { posProductKey: "pw", expiresOn: "2026-11-01" }), lot("w2", { posProductKey: "pw" })], none, "2026-10-30");
  ok(wp.lotIds.length === 2 && wp.why.w2![0] === WHOLE_PRODUCT_REASON, "sibling lot rides along, says why");

  // ABC.
  const abc = pickAbc([lot("big", { onHandQty: 100, unitCostMinorUnits: 10_000 }), lot("small", { onHandQty: 1, unitCostMinorUnits: 100 })], none);
  ok(abc.lotIds.join(",") === "big" && abc.why.big![0]!.startsWith("A lot"), "A lots only");

  // Exceptions.
  const exc = pickExceptions(
    [lot("o1", { productName: "Blue Dream 3.5g" }), lot("j1"), lot("u1", { posProductKey: "pu" }), lot("z0", { onHandQty: 0 }), lot("ok1")],
    new Set(["j1"]),
    {
      oversoldProductNames: ["blue dream 3.5G"],
      recentAdjustments: new Map([["j1", ["damage"]], ["u1", ["shrink", "damage"]]]),
      unavailableWithStockKeys: ["pu"],
    },
  );
  ok(!exc.lotIds.includes("j1") && exc.skippedOpen === 1, "lot on an open count skipped and counted");
  ok(exc.lotIds[0] === "u1" && exc.why.u1!.length === 2, "most reasons first");
  ok(exc.lotIds.includes("o1") && exc.lotIds.includes("z0") && !exc.lotIds.includes("ok1"), "oversold by name, zero on hand; clean lot left out");
  ok(exc.why.u1![0] === "Adjusted in the last 30 days (damage, shrink).", "adjustment kinds listed");

  // Budget defers whole products.
  const many = Array.from({ length: 5 }, (_, i) => lot(`m${i}`, { expiresOn: "2026-10-31" }));
  const budget = pickExpiring(many, none, "2026-10-30", 3);
  ok(budget.lotIds.length === 3 && budget.deferredProducts === 2, "budget defers, never splits");

  // Due reasons.
  const due = dueReasons([lot("d1"), lot("d2", { lastCountedAt: "2026-01-01T00:00:00Z" })], new Date("2026-10-30T12:00:00Z"));
  ok(due.d1![0] === "Never counted." && /^Last counted \d+ days ago/.test(due.d2![0]!), "due reasons");

  // One open count per lot.
  ok(isOpenAudit("counting", null) && isOpenAudit("approved", null) && !isOpenAudit("approved", "2026-10-01") && !isOpenAudit("cancelled", null), "open statuses");
  ok(openCountRefusal([{ lotCode: "L1", label: "Oct count" }]).startsWith("1 lot is already on an open count: L1 (on \u201cOct count\u201d)."), "refusal names the count");

  // Labels.
  ok(generatorLabel("vendor", "2026-10-30", p1) === "Alpha Farms (1/2) \u00b7 2026-10-30", "vendor label");
  ok(generatorRationale("vendor", p1)!.includes("part 1 of 2") && generatorRationale("due") === undefined, "rationales");
  ok(vendorOfDayReminder({ started: true, plannedToday: false })!.startsWith("Today's vendor count") && vendorOfDayReminder({ started: false, plannedToday: false }) === null && vendorOfDayReminder({ started: true, plannedToday: true }) === null, "cockpit reminder");
  ok(vendorWhy(p1) === "Vendor of the day: Alpha Farms, part 1 of 2.", "vendor why");
  return n;
}
