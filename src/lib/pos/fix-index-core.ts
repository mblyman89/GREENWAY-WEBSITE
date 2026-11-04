/**
 * src/lib/pos/fix-index-core.ts — D170 O9 (owner 2026-11-04: "finish all
 * remaining offline mode tasks ... I want to make sure we are fully hardened
 * and prepared for any situation").
 *
 * PURE. Fix & sell with no internet.
 *
 * Online, "Fix & sell" asks /api/pos/fix-and-sell to read the lot and decide.
 * Offline there is no server, so the register keeps a compact LOT INDEX,
 * downloaded while online (/api/pos/fix-index) and saved in the encrypted
 * store: every sellable lot with the SAME facts the route reads (status,
 * stock, cost, size, lab passed, recalled, scheduled for destruction, expired
 * edible). The iPad then runs the SAME pure decideFixAndSell the route runs,
 * so offline can never sell what online refuses as of the index's age.
 *
 * The back office still hears about it: the fix is queued in the send-later
 * outbox to /api/pos/fix-and-sell, which writes the audit row that puts the
 * lot on the Fix later page (and re-decides with live facts; a refusal then
 * shows on the register's failed list). The sale itself is re-checked by the
 * completion gate at sync, as always.
 */
import type { FixLaterLot } from "./register-fix-later-core";

export const FIX_INDEX_VERSION = 1;
/** Refresh while online at most this often. */
export const FIX_INDEX_REFRESH_MS = 30 * 60_000;
/** Older than this, the cashier is told the index is old. */
export const FIX_INDEX_STALE_MS = 24 * 3600_000;
/** Hard ceiling so a bad response can never fill the iPad. */
export const FIX_INDEX_MAX_ROWS = 20_000;

/** One lot, compact keys (the index is about 2,800 lots today). */
export type FixIndexRow = {
  i: string; // lot id
  k: string | null; // pos product key
  c: string | null; // lot code
  x: string | null; // CCRS inventory external id
  n: string | null; // product name
  s: string | null; // status
  q: number; // sellable on hand
  g: string | null; // category
  t: string | null; // inventory type
  u: number | null; // unit cost (minor)
  w: number | string | null; // unit weight
  wu: string | null; // unit weight uom
  hl: boolean; // has a lab result
  lp: boolean | null; // lab passed
  sm: boolean; // trade sample
  r: boolean; // recalled
  d: boolean; // scheduled for destruction
  e: boolean; // expired edible (hard block)
};

export type FixIndex = { v: number; at: number; rows: FixIndexRow[] };

function str(v: unknown, max = 200): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

export function parseFixIndexRow(raw: unknown): FixIndexRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const i = str(r.i, 64);
  if (!i) return null;
  const q = typeof r.q === "number" && Number.isFinite(r.q) ? r.q : 0;
  const u = typeof r.u === "number" && Number.isInteger(r.u) && r.u >= 0 ? r.u : null;
  const w = typeof r.w === "number" || typeof r.w === "string" ? r.w : null;
  return {
    i,
    k: str(r.k, 120),
    c: str(r.c, 120),
    x: str(r.x, 120),
    n: str(r.n, 300),
    s: str(r.s, 40),
    q,
    g: str(r.g, 80),
    t: str(r.t, 80),
    u,
    w,
    wu: str(r.wu, 20),
    hl: r.hl === true,
    lp: r.lp === true ? true : r.lp === false ? false : null,
    sm: r.sm === true,
    r: r.r === true,
    d: r.d === true,
    e: r.e === true,
  };
}

/** Parse the saved index defensively; a bad copy degrades to null (online only). */
export function parseFixIndex(raw: string | null | undefined): FixIndex | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o?.v !== FIX_INDEX_VERSION || typeof o.at !== "number" || !Array.isArray(o.rows)) return null;
    const rows: FixIndexRow[] = [];
    for (const x of o.rows) {
      const row = parseFixIndexRow(x);
      if (row) rows.push(row);
      if (rows.length >= FIX_INDEX_MAX_ROWS) break;
    }
    return { v: FIX_INDEX_VERSION, at: o.at, rows };
  } catch {
    return null;
  }
}

/** Parse the endpoint's body into an index stamped `nowMs`. */
export function fixIndexFromResponse(body: unknown, nowMs: number): FixIndex | null {
  if (!body || typeof body !== "object") return null;
  const rows = (body as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return null;
  const out: FixIndexRow[] = [];
  for (const x of rows) {
    const row = parseFixIndexRow(x);
    if (row) out.push(row);
    if (out.length >= FIX_INDEX_MAX_ROWS) break;
  }
  return { v: FIX_INDEX_VERSION, at: nowMs, rows: out };
}

export function fixIndexDue(idx: FixIndex | null, nowMs: number): boolean {
  return !idx || nowMs - idx.at >= FIX_INDEX_REFRESH_MS || idx.at > nowMs + 5 * 60_000;
}

/** The facts decideFixAndSell takes, from one index row. */
export function fixLotFromRow(r: FixIndexRow): FixLaterLot & { expiredHardBlock?: boolean } {
  return {
    id: r.i,
    posProductKey: r.k,
    lotCode: r.c,
    ccrsExternalId: r.x,
    productName: r.n,
    status: r.s,
    onHandQty: r.q,
    category: r.g,
    inventoryType: r.t,
    unitCostMinor: r.u,
    unitWeight: r.w,
    unitWeightUom: r.wu,
    hasLabResult: r.hl,
    labPassed: r.lp,
    isSample: r.sm,
    recalled: r.r,
    scheduledForDestruction: r.d,
    expiredHardBlock: r.e,
  };
}

/**
 * The lots a scanned code matches, in the route's order: lot code first,
 * then CCRS id, then product key (the first column with a hit wins).
 * Case-insensitive, like the route's code variants.
 */
export function findFixLots(idx: FixIndex | null, code: string): FixIndexRow[] {
  if (!idx) return [];
  const want = code.trim().toLowerCase();
  if (!want) return [];
  for (const col of ["c", "x", "k"] as const) {
    const hits = idx.rows.filter((r) => (r[col] ?? "").toLowerCase() === want);
    if (hits.length > 0) return hits.slice(0, 50);
  }
  return [];
}

/** One line for the cashier about the saved index's age. */
export function fixIndexAgeNote(idx: FixIndex | null, nowMs: number): string {
  if (!idx) return "";
  const mins = Math.max(0, Math.round((nowMs - idx.at) / 60_000));
  const words = mins < 60 ? `${mins} min` : mins < 2880 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} days`;
  const old = nowMs - idx.at >= FIX_INDEX_STALE_MS ? " (old — recalls since then are checked when the internet is back)" : "";
  return `Offline: decided from the lot list saved ${words} ago${old}. The back office gets it as soon as this iPad is back online.`;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runFixIndexCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error("fix-index-core FAIL:", m);
    }
  };
  const row = { i: "L1", k: "GF1", c: "LOT-A", x: "WA123", n: "Blue Dream 3.5g", s: "active", q: 4, g: "Flower", t: "Usable Marijuana", u: 900, w: 3.5, wu: "g", hl: true, lp: true, sm: false, r: false, d: false, e: false };
  const p = parseFixIndexRow(row);
  ok(!!p && p.k === "GF1" && p.q === 4 && p.lp === true, "row parses");
  ok(parseFixIndexRow({ k: "x" }) === null, "row without id refused");
  ok(parseFixIndexRow(null) === null, "null row refused");
  ok(parseFixIndexRow({ ...row, u: -5 })!.u === null, "negative cost dropped");
  ok(parseFixIndexRow({ ...row, lp: "yes" })!.lp === null, "junk lab flag = unknown");
  const idx = fixIndexFromResponse({ rows: [row, { i: "L2", k: "GF2", c: "lot-b", s: "quarantine", q: 0 }, "junk"] }, 1000);
  ok(!!idx && idx.rows.length === 2 && idx.at === 1000, "response parses, junk dropped");
  ok(fixIndexFromResponse({}, 1) === null && fixIndexFromResponse(null, 1) === null, "bad body refused");
  const round = parseFixIndex(JSON.stringify(idx));
  ok(!!round && round.rows.length === 2, "round trip");
  ok(parseFixIndex("{bad") === null && parseFixIndex(null) === null, "bad saved copy degrades");
  ok(parseFixIndex(JSON.stringify({ ...idx, v: 99 })) === null, "wrong version refused");
  ok(findFixLots(idx, "lot-a")[0]?.i === "L1", "lot code match, case-insensitive");
  ok(findFixLots(idx, "LOT-B")[0]?.i === "L2", "second lot by code");
  ok(findFixLots(idx, "wa123")[0]?.i === "L1", "CCRS id match");
  ok(findFixLots(idx, "gf2")[0]?.i === "L2", "product key match");
  ok(findFixLots(idx, "nope").length === 0 && findFixLots(null, "x").length === 0 && findFixLots(idx, " ").length === 0, "no match");
  const f = fixLotFromRow(p!);
  ok(f.posProductKey === "GF1" && f.labPassed === true && f.expiredHardBlock === false && f.onHandQty === 4, "facts mapped");
  ok(fixLotFromRow({ ...p!, r: true }).recalled === true && fixLotFromRow({ ...p!, d: true }).scheduledForDestruction === true, "stops mapped");
  ok(fixIndexDue(null, 0) && !fixIndexDue(idx, 1000 + 60_000) && fixIndexDue(idx, 1000 + FIX_INDEX_REFRESH_MS), "refresh due");
  ok(fixIndexDue({ ...idx!, at: 10 * 3600_000 }, 0), "future-dated index is due (clock moved)");
  ok(fixIndexAgeNote(idx, 1000 + 5 * 60_000).includes("5 min"), "age note minutes");
  ok(fixIndexAgeNote(idx, 1000 + FIX_INDEX_STALE_MS).includes("old"), "stale warning");
  ok(fixIndexAgeNote(null, 0) === "", "no index no note");
  return { passed, failed };
}
