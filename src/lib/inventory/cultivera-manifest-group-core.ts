/**
 * src/lib/inventory/cultivera-manifest-group-core.ts — R50 S1 (PURE).
 *
 * The owner: "upgrade the Cultivera upload to intelligently recognize and group
 * products based on when they came in, so we can recreate the manifest for
 * those grouped products and then send them through the onboarding process."
 *
 * The one-time Cultivera import hangs EVERY lot off a single synthetic manifest
 * `POS-IMPORT-<id8>`. This core rebuilds the deliveries those lots really came
 * in on, from evidence in the export and nothing else:
 *
 *   * A lot is one Barcode (planImportLots merges rows sharing a barcode). Its
 *     vendor is the FIRST row's vendor (the same row planImportLots keeps) and
 *     its moment is the EARLIEST readable `Received date` of its rows (the same
 *     earliest-date rule planImportLots uses), so a lot and its manifest agree.
 *   * A delivery ("session") is: same vendor (normalized: whitespace collapsed,
 *     upper-cased) AND same Pacific calendar day AND every consecutive pair of
 *     lots no more than `gapMinutes` apart (default 60).
 *     Measured on the real export (docs/roadmap/R50-…md §1.1): the grouping is
 *     identical from 60 min upward; the only same-day split is two genuine
 *     deliveries 8 h 48 min apart.
 *   * Rows whose time of day is NOT in the cell (a bare date) cannot be placed
 *     inside a session, so they form their own "vendor + day, time unknown"
 *     group — never merged into a timed session (never guess).
 *   * A blank, unreadable or out-of-window date goes to that vendor's UNDATED
 *     group. Never a neighbour's, never another vendor's.
 *   * Different vendors are NEVER merged (measured: no timestamp in the real
 *     export is shared by two vendors).
 *
 * Times in the export are store wall-clock (hours 07–22 only), i.e. Pacific.
 * They are converted to UTC with the shared DST-aware helper.
 *
 * Nothing here reads or writes the database. The executor (S2) re-reads the
 * stored workbook, calls planCultiveraManifests, and moves lots.
 */
import { pacificWallTimeToUtcISO } from "../reports/timezone";

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

/** raw_payload.kind of a reconstructed manifest. */
export const RECONSTRUCTED_MANIFEST_KIND = "cultivera-reconstructed" as const;
/** raw_payload.kind of the import's original synthetic manifest (import-service.ts). */
export const POS_IMPORT_MANIFEST_KIND = "pos-import-migration" as const;
/** Every reconstructed manifest number starts with this. */
export const RECONSTRUCTED_NUMBER_PREFIX = "CV-";
/** Version of the grouping rule, recorded in lineage. Bump when the rule changes. */
export const GROUPING_RULE_VERSION = 1;
export const DEFAULT_GAP_MINUTES = 60;
export const MIN_GAP_MINUTES = 1;
export const MAX_GAP_MINUTES = 24 * 60;
/** Washington's first legal retail sale; a "received" date before it is not real. */
export const EARLIEST_PLAUSIBLE_DAY = "2014-07-08";

/* ------------------------------------------------------------------ *
 * Timestamp parsing (Pacific wall clock)
 * ------------------------------------------------------------------ */

export type ParsedWallTime = {
  /** Pacific calendar day, YYYY-MM-DD. */
  day: string;
  /** "time" when the cell carried a time of day, "day" when only a date. */
  precision: "time" | "day";
  h: number;
  m: number;
  s: number;
  ms: number;
  /** Sortable wall-clock key: "YYYY-MM-DD HH:MM:SS.mmm" (00:00:00.000 for day precision). */
  wall: string;
};

const ISO_TS_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?)?$/;
const US_TS_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(?:\s*([AaPp])\.?[Mm]\.?)?)?$/;

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

/**
 * Parse a Cultivera `Received date` cell as Pacific wall time. PURE.
 *
 * Accepts exactly these shapes (anything else → null; the caller reports it):
 *   "2026-07-02 09:32:07.787000"   (the real export, 4,061 rows)
 *   "2026-07-01 20:46:18"           (the real export, 15 rows)
 *   "2026-07-02T09:32" / "2026-07-02 09:32"
 *   "2026-07-02"                    (day precision)
 *   "7/2/2026", "07/02/2026", "7/2/26" (day precision; 2-digit year = 20YY)
 *   "7/2/2026 9:32", "7/2/26 9:32:07 AM", "7/2/2026, 9:32 PM"
 * Calendar-checked (2026-02-30 → null) and clock-checked (24:00 → null).
 */
export function parseCultiveraTimestamp(raw: string | null | undefined): ParsedWallTime | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) return null;
  let y: number, mo: number, d: number;
  let hh: string | undefined, mm: string | undefined, ss: string | undefined, frac: string | undefined;
  let ampm: string | undefined;
  const iso = ISO_TS_RE.exec(s);
  const us = iso ? null : US_TS_RE.exec(s);
  if (iso) {
    y = Number(iso[1]);
    mo = Number(iso[2]);
    d = Number(iso[3]);
    [hh, mm, ss, frac] = [iso[4], iso[5], iso[6], iso[7]];
  } else if (us) {
    mo = Number(us[1]);
    d = Number(us[2]);
    y = us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
    [hh, mm, ss, frac, ampm] = [us[4], us[5], us[6], us[7], us[8]];
  } else {
    return null;
  }
  if (mo < 1 || mo > 12 || d < 1) return null;
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > dim) return null;
  const day = `${pad(y, 4)}-${pad(mo)}-${pad(d)}`;
  if (hh === undefined) {
    return { day, precision: "day", h: 0, m: 0, s: 0, ms: 0, wall: `${day} 00:00:00.000` };
  }
  let h = Number(hh);
  const m = Number(mm);
  const sec = ss === undefined ? 0 : Number(ss);
  if (ampm) {
    if (h < 1 || h > 12) return null;
    const pm = ampm.toLowerCase() === "p";
    h = (h % 12) + (pm ? 12 : 0);
  }
  if (h > 23 || m > 59 || sec > 59) return null;
  // Fraction: digits after the dot, truncated to milliseconds (never rounded up
  // into the next second).
  const ms = frac === undefined ? 0 : Number(frac.padEnd(3, "0").slice(0, 3));
  return {
    day,
    precision: "time",
    h,
    m,
    s: sec,
    ms,
    wall: `${day} ${pad(h)}:${pad(m)}:${pad(sec)}.${pad(ms, 3)}`,
  };
}

/** Milliseconds of wall-clock time since the epoch, treating the wall clock as UTC (ordering + gaps only). */
function wallMs(t: ParsedWallTime): number {
  const [y, mo, d] = t.day.split("-").map(Number);
  return Date.UTC(y, mo - 1, d, t.h, t.m, t.s, t.ms);
}

/** The true UTC instant of a Pacific wall time (DST-aware). */
export function wallTimeToUtcIso(t: ParsedWallTime): string {
  return pacificWallTimeToUtcISO(t.day, { h: t.h, m: t.m, s: t.s, ms: t.ms });
}

/* ------------------------------------------------------------------ *
 * Keys
 * ------------------------------------------------------------------ */

/** Normalized vendor identity: whitespace collapsed, trimmed, upper-cased (manifest-dedupe-core's norm). */
export function cultiveraVendorKey(label: string | null | undefined): string {
  return (label ?? "").replace(/\s+/g, " ").trim().toUpperCase();
}

/** FNV-1a 32-bit → 6 base-36 chars, upper-cased. Deterministic, dependency-free. */
export function shortHash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).toUpperCase().padStart(7, "0").slice(-6);
}

/* ------------------------------------------------------------------ *
 * Planning
 * ------------------------------------------------------------------ */

export type CultiveraGroupRow = {
  barcode: string | null | undefined;
  vendor: string | null | undefined;
  receivedDateRaw: string | null | undefined;
  /** Units Available For Sale. A row planImportLots skips (≤ 0) is skipped here too. Omit = counted. */
  units?: number | null;
  /** Optional, for previews only. */
  productName?: string | null;
};

export type UndatedReason = "blank" | "unreadable" | "out_of_window";

export type ReconstructedGroupKind = "session" | "day" | "undated";

export type ReconstructedGroup = {
  /** Stable identity: "<vendorKey>|<kind>|<first wall time or day or 'undated'>". */
  key: string;
  kind: ReconstructedGroupKind;
  vendorKey: string;
  /** Vendor label as written on the earliest lot's row (trimmed, whitespace collapsed). */
  vendorLabel: string;
  manifestNumber: string;
  /** Pacific day, or null for undated. */
  day: string | null;
  /** First / last wall time "YYYY-MM-DD HH:MM:SS.mmm" (sessions); day groups use 00:00. null for undated. */
  firstWall: string | null;
  lastWall: string | null;
  /** UTC instant of the first lot (sessions) / Pacific noon of the day (day groups); null for undated. */
  startUtcIso: string | null;
  /** Minutes between the first and last lot of a session (0 otherwise). */
  spanMinutes: number;
  /** Barcodes in arrival order (ties broken by barcode). */
  barcodes: string[];
  /** For undated groups: why each lot is undated (counts). */
  undatedReasons: Record<UndatedReason, number>;
  /** Up to 3 product names (preview). */
  sampleProducts: string[];
};

export type CultiveraManifestPlan = {
  gapMinutes: number;
  groups: ReconstructedGroup[];
  summary: {
    rowsRead: number;
    rowsSkippedZeroUnits: number;
    rowsSkippedNoBarcode: number;
    lots: number;
    lotsTimed: number;
    lotsDayOnly: number;
    lotsUndated: number;
    sessionGroups: number;
    dayGroups: number;
    undatedGroups: number;
    singletonSessions: number;
    largestGroup: number;
    vendors: number;
    vendorsWithUndated: number;
    undatedReasons: Record<UndatedReason, number>;
    /** Barcodes whose rows disagree on vendor (the first row's vendor was used). */
    vendorConflicts: number;
  };
  /** Up to 20 distinct unreadable `Received date` cells, verbatim. */
  unreadableSamples: string[];
  /** Non-empty only if two groups produced the same manifest number (the plan must then be refused). */
  numberCollisions: string[];
};

export type PlanOptions = {
  gapMinutes?: number;
  /** Today's Pacific day (YYYY-MM-DD). A received day after it is out of window. */
  pacificToday: string;
};

/** Clamp a requested gap to [MIN_GAP_MINUTES, MAX_GAP_MINUTES]; non-numbers → default. */
export function normalizeGapMinutes(value: unknown): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n)) return DEFAULT_GAP_MINUTES;
  return Math.min(MAX_GAP_MINUTES, Math.max(MIN_GAP_MINUTES, Math.round(n)));
}

export function reconstructedManifestNumber(
  kind: ReconstructedGroupKind,
  vendorKey: string,
  first: ParsedWallTime | null,
): string {
  const h = shortHash(vendorKey);
  if (kind === "undated" || !first) return `${RECONSTRUCTED_NUMBER_PREFIX}UNDATED-${h}`;
  const ymd = first.day.replace(/-/g, "");
  if (kind === "day") return `${RECONSTRUCTED_NUMBER_PREFIX}${ymd}-DAY-${h}`;
  return `${RECONSTRUCTED_NUMBER_PREFIX}${ymd}-${pad(first.h)}${pad(first.m)}-${h}`;
}

type Lot = {
  barcode: string;
  vendorKey: string;
  vendorLabel: string;
  product: string;
  t: ParsedWallTime | null;
  undatedReason: UndatedReason | null;
};

function emptyReasons(): Record<UndatedReason, number> {
  return { blank: 0, unreadable: 0, out_of_window: 0 };
}

/**
 * Group the export's lots into reconstructed deliveries. PURE and deterministic.
 * Order: rows may arrive in any order EXCEPT that, among rows sharing one
 * barcode, the first is the one whose vendor/product labels the lot (exactly
 * planImportLots' rule, so the lot's vendor_id and its manifest's vendor are
 * the same vendor). Reordering anything else never changes the plan.
 */
export function planCultiveraManifests(rows: readonly CultiveraGroupRow[], opts: PlanOptions): CultiveraManifestPlan {
  const gapMinutes = normalizeGapMinutes(opts.gapMinutes ?? DEFAULT_GAP_MINUTES);
  const gapMs = gapMinutes * 60_000;
  let rowsSkippedZeroUnits = 0;
  let rowsSkippedNoBarcode = 0;
  const unreadable = new Set<string>();

  // 1) Rows → lots (one per barcode; first row's vendor; earliest readable time).
  type Acc = { first: CultiveraGroupRow; vendors: Set<string>; times: ParsedWallTime[]; reasons: UndatedReason[] };
  const byBarcode = new Map<string, Acc>();
  for (const row of rows) {
    if (row.units !== undefined && row.units !== null) {
      const u = Math.max(0, Math.floor(Number(row.units) || 0));
      if (u <= 0) {
        rowsSkippedZeroUnits += 1;
        continue;
      }
    }
    const barcode = (row.barcode ?? "").trim();
    if (!barcode) {
      rowsSkippedNoBarcode += 1;
      continue;
    }
    const acc = byBarcode.get(barcode) ?? { first: row, vendors: new Set<string>(), times: [], reasons: [] };
    acc.vendors.add(cultiveraVendorKey(row.vendor));
    const raw = (row.receivedDateRaw ?? "").trim();
    if (!raw) {
      acc.reasons.push("blank");
    } else {
      const t = parseCultiveraTimestamp(raw);
      if (!t) {
        acc.reasons.push("unreadable");
        if (unreadable.size < 20) unreadable.add(raw);
      } else if (t.day < EARLIEST_PLAUSIBLE_DAY || t.day > opts.pacificToday) {
        acc.reasons.push("out_of_window");
      } else {
        acc.times.push(t);
      }
    }
    byBarcode.set(barcode, acc);
  }

  let vendorConflicts = 0;
  const lots: Lot[] = [];
  for (const [barcode, acc] of byBarcode) {
    if (acc.vendors.size > 1) vendorConflicts += 1;
    // Earliest DAY wins (planImportLots' rule, which is day-granular). Within
    // that day a timed reading beats a day-only one (more evidence; a bare date
    // sorts as 00:00 and would otherwise always win), then the earliest time.
    const best = [...acc.times].sort(
      (a, b) =>
        a.day.localeCompare(b.day) ||
        (a.precision === b.precision ? 0 : a.precision === "time" ? -1 : 1) ||
        a.wall.localeCompare(b.wall),
    )[0];
    // Most specific undated reason, for reporting: unreadable > out_of_window > blank.
    const reason: UndatedReason | null = best
      ? null
      : acc.reasons.includes("unreadable")
        ? "unreadable"
        : acc.reasons.includes("out_of_window")
          ? "out_of_window"
          : "blank";
    lots.push({
      barcode,
      vendorKey: cultiveraVendorKey(acc.first.vendor),
      vendorLabel: (acc.first.vendor ?? "").replace(/\s+/g, " ").trim(),
      product: (acc.first.productName ?? "").trim(),
      t: best ?? null,
      undatedReason: reason,
    });
  }

  // 2) Lots → groups, per vendor.
  const byVendor = new Map<string, Lot[]>();
  for (const lot of lots) {
    const list = byVendor.get(lot.vendorKey) ?? [];
    list.push(lot);
    byVendor.set(lot.vendorKey, list);
  }

  const groups: ReconstructedGroup[] = [];
  const makeGroup = (kind: ReconstructedGroupKind, members: Lot[]): ReconstructedGroup => {
    const vendorKey = members[0].vendorKey;
    // Label: the earliest member's spelling (members are already ordered).
    const vendorLabel = members[0].vendorLabel;
    const first = members[0].t;
    const last = members[members.length - 1].t;
    const reasons = emptyReasons();
    if (kind === "undated") for (const m of members) if (m.undatedReason) reasons[m.undatedReason] += 1;
    const keyTail = kind === "undated" ? "undated" : kind === "day" ? first!.day : first!.wall;
    let startUtcIso: string | null = null;
    if (kind === "session" && first) startUtcIso = wallTimeToUtcIso(first);
    if (kind === "day" && first) startUtcIso = pacificWallTimeToUtcISO(first.day, { h: 12, m: 0, s: 0, ms: 0 });
    const samples: string[] = [];
    for (const m of members) if (m.product && !samples.includes(m.product) && samples.length < 3) samples.push(m.product);
    return {
      key: `${vendorKey}|${kind}|${keyTail}`,
      kind,
      vendorKey,
      vendorLabel,
      manifestNumber: reconstructedManifestNumber(kind, vendorKey, first),
      day: kind === "undated" ? null : first!.day,
      firstWall: kind === "undated" ? null : first!.wall,
      lastWall: kind === "undated" ? null : last!.wall,
      startUtcIso,
      spanMinutes: kind === "session" ? Math.round((wallMs(last!) - wallMs(first!)) / 60_000) : 0,
      barcodes: members.map((m) => m.barcode),
      undatedReasons: reasons,
      sampleProducts: samples,
    };
  };

  for (const vendorKey of [...byVendor.keys()].sort()) {
    const vlots = byVendor.get(vendorKey)!;
    const timed = vlots
      .filter((l) => l.t && l.t.precision === "time")
      .sort((a, b) => a.t!.wall.localeCompare(b.t!.wall) || a.barcode.localeCompare(b.barcode));
    const dayOnly = vlots
      .filter((l) => l.t && l.t.precision === "day")
      .sort((a, b) => a.t!.day.localeCompare(b.t!.day) || a.barcode.localeCompare(b.barcode));
    const undated = vlots.filter((l) => !l.t).sort((a, b) => a.barcode.localeCompare(b.barcode));

    let cur: Lot[] = [];
    for (const lot of timed) {
      const prev = cur[cur.length - 1];
      if (prev && (prev.t!.day !== lot.t!.day || wallMs(lot.t!) - wallMs(prev.t!) > gapMs)) {
        groups.push(makeGroup("session", cur));
        cur = [];
      }
      cur.push(lot);
    }
    if (cur.length) groups.push(makeGroup("session", cur));

    let dcur: Lot[] = [];
    for (const lot of dayOnly) {
      const prev = dcur[dcur.length - 1];
      if (prev && prev.t!.day !== lot.t!.day) {
        groups.push(makeGroup("day", dcur));
        dcur = [];
      }
      dcur.push(lot);
    }
    if (dcur.length) groups.push(makeGroup("day", dcur));

    if (undated.length) groups.push(makeGroup("undated", undated));
  }

  // Global order: dated groups oldest first, undated last (by vendor).
  groups.sort((a, b) => {
    if (a.firstWall && b.firstWall) return a.firstWall.localeCompare(b.firstWall) || a.vendorKey.localeCompare(b.vendorKey);
    if (a.firstWall) return -1;
    if (b.firstWall) return 1;
    return a.vendorKey.localeCompare(b.vendorKey);
  });

  const seen = new Map<string, string>();
  const collisions: string[] = [];
  for (const g of groups) {
    const other = seen.get(g.manifestNumber);
    if (other !== undefined && other !== g.key) collisions.push(g.manifestNumber);
    seen.set(g.manifestNumber, g.key);
  }

  const undatedReasons = emptyReasons();
  for (const l of lots) if (l.undatedReason) undatedReasons[l.undatedReason] += 1;
  const sessions = groups.filter((g) => g.kind === "session");
  return {
    gapMinutes,
    groups,
    summary: {
      rowsRead: rows.length,
      rowsSkippedZeroUnits,
      rowsSkippedNoBarcode,
      lots: lots.length,
      lotsTimed: lots.filter((l) => l.t?.precision === "time").length,
      lotsDayOnly: lots.filter((l) => l.t?.precision === "day").length,
      lotsUndated: lots.filter((l) => !l.t).length,
      sessionGroups: sessions.length,
      dayGroups: groups.filter((g) => g.kind === "day").length,
      undatedGroups: groups.filter((g) => g.kind === "undated").length,
      singletonSessions: sessions.filter((g) => g.barcodes.length === 1).length,
      largestGroup: groups.reduce((m, g) => Math.max(m, g.barcodes.length), 0),
      vendors: byVendor.size,
      vendorsWithUndated: new Set(lots.filter((l) => !l.t).map((l) => l.vendorKey)).size,
      undatedReasons,
      vendorConflicts,
    },
    unreadableSamples: [...unreadable],
    numberCollisions: [...new Set(collisions)],
  };
}

/* ------------------------------------------------------------------ *
 * Manifest predicates + lineage (shared by every reader; R50 §1.3/§1.4)
 * ------------------------------------------------------------------ */

type ManifestLike = { manifest_number?: string | null; raw_payload?: unknown } | null | undefined;

function payloadKind(m: ManifestLike): string | null {
  const p = m?.raw_payload;
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const k = (p as Record<string, unknown>).kind;
  return typeof k === "string" ? k : null;
}

/**
 * A manifest R50 rebuilt from the Cultivera export. Decided by raw_payload.kind
 * ONLY: a real vendor manifest number could start with "CV-", and treating a
 * real delivery as "not a purchase" would hide money owed.
 */
export function isReconstructedManifest(m: ManifestLike): boolean {
  return payloadKind(m) === RECONSTRUCTED_MANIFEST_KIND;
}

/** The import's original synthetic manifest (POS-IMPORT-<id8>, kind pos-import-migration). */
export function isPosImportManifest(m: ManifestLike): boolean {
  return payloadKind(m) === POS_IMPORT_MANIFEST_KIND;
}

/**
 * Stock that came from the one-time Cultivera migration, on either manifest
 * shape. Such manifests are NEVER purchases: opening inventory is booked by the
 * cut-over opening balance, so payables / Sage purchases / vendor bills skip
 * them (R50 §2.6).
 */
export function isMigrationManifest(m: ManifestLike): boolean {
  return isReconstructedManifest(m) || isPosImportManifest(m);
}

/** The import a reconstructed manifest belongs to (raw_payload.import_id), or null. */
export function reconstructedImportId(m: ManifestLike): string | null {
  if (!isReconstructedManifest(m)) return null;
  const v = (m!.raw_payload as Record<string, unknown>).import_id;
  return typeof v === "string" && v ? v : null;
}

/** Idempotency key for inbound_manifests.dedupe_key (unique while live). One per import + group. */
export function reconstructedDedupeKey(importId: string, group: Pick<ReconstructedGroup, "manifestNumber" | "vendorKey">): string {
  return `${group.manifestNumber}|${group.vendorKey}|IMPORT-${importId}`;
}

export type ReconstructedLineage = {
  kind: typeof RECONSTRUCTED_MANIFEST_KIND;
  import_id: string;
  source_manifest_id: string;
  source_manifest_number: string;
  group_key: string;
  group_kind: ReconstructedGroupKind;
  rule_version: number;
  gap_minutes: number;
  first_wall_pacific: string | null;
  last_wall_pacific: string | null;
  span_minutes: number;
  lot_count: number;
  barcodes: string[];
  undated_reasons: Record<UndatedReason, number> | null;
};

/** raw_payload for a reconstructed manifest: every fact that formed it (R50 §2.5). */
export function buildReconstructedLineage(args: {
  importId: string;
  sourceManifestId: string;
  sourceManifestNumber: string;
  gapMinutes: number;
  group: ReconstructedGroup;
}): ReconstructedLineage {
  const g = args.group;
  return {
    kind: RECONSTRUCTED_MANIFEST_KIND,
    import_id: args.importId,
    source_manifest_id: args.sourceManifestId,
    source_manifest_number: args.sourceManifestNumber,
    group_key: g.key,
    group_kind: g.kind,
    rule_version: GROUPING_RULE_VERSION,
    gap_minutes: args.gapMinutes,
    first_wall_pacific: g.firstWall,
    last_wall_pacific: g.lastWall,
    span_minutes: g.spanMinutes,
    lot_count: g.barcodes.length,
    barcodes: [...g.barcodes],
    undated_reasons: g.kind === "undated" ? { ...g.undatedReasons } : null,
  };
}

/** Human title for the manifest list: "GROW OP FARMS · Jul 2, 2026 9:32 AM · 36 items". */
export function reconstructedGroupTitle(g: ReconstructedGroup): string {
  const n = g.barcodes.length;
  const items = `${n} item${n === 1 ? "" : "s"}`;
  if (g.kind === "undated" || !g.firstWall) return `${g.vendorLabel} · date unknown · ${items}`;
  const [y, mo, d] = g.firstWall.slice(0, 10).split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const date = `${months[mo - 1]} ${d}, ${y}`;
  if (g.kind === "day") return `${g.vendorLabel} · ${date} (time unknown) · ${items}`;
  const h = Number(g.firstWall.slice(11, 13));
  const m = g.firstWall.slice(14, 16);
  const time = `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "AM" : "PM"}`;
  return `${g.vendorLabel} · ${date} ${time} · ${items}`;
}

/* ------------------------------------------------------------------ *
 * Self-tests
 * ------------------------------------------------------------------ */

export function __runCultiveraManifestGroupCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL cultivera-manifest-group-core: " + msg);
    passed += 1;
  };
  const P = parseCultiveraTimestamp;

  // --- parser: the two real shapes ---
  const a = P("2026-07-02 09:32:07.787000");
  ok(!!a && a.day === "2026-07-02" && a.precision === "time", "real shape 1 parses");
  ok(!!a && a.h === 9 && a.m === 32 && a.s === 7 && a.ms === 787, "real shape 1 fields");
  ok(!!a && a.wall === "2026-07-02 09:32:07.787", "real shape 1 wall key");
  const b = P("2026-07-01 20:46:18");
  ok(!!b && b.h === 20 && b.ms === 0 && b.wall === "2026-07-01 20:46:18.000", "real shape 2 (no fraction)");
  ok(P("2026-07-02 09:32:07.9999")!.ms === 999, "fraction truncated, never rounded into next second");
  ok(P("2026-07-02 09:32:07.5")!.ms === 500, "1-digit fraction = 500 ms");
  ok(P("2026-07-02 09:32:07.9996")!.ms === 999 && P("2026-07-02 09:32:07.0006")!.ms === 0, "fraction truncation both ends");
  ok(P("2026-07-02 09:32:07.787000")!.ms === 787 && P("2026-07-02 09:32:07.12")!.ms === 120, "6- and 2-digit fractions");
  ok(P("2026-07-02T09:32")!.precision === "time", "ISO T separator, minutes only");
  ok(P("  2026-07-02   09:32:07  ")!.wall === "2026-07-02 09:32:07.000", "whitespace tolerated");
  // --- parser: day precision ---
  ok(P("2026-07-02")!.precision === "day", "ISO date only = day precision");
  ok(P("7/2/2026")!.day === "2026-07-02" && P("7/2/2026")!.precision === "day", "US date");
  ok(P("07/02/2026")!.day === "2026-07-02", "US date zero-padded");
  ok(P("7/2/26")!.day === "2026-07-02", "US 2-digit year = 20YY");
  // --- parser: US with time ---
  ok(P("7/2/2026 9:32")!.h === 9, "US date + 24h time");
  ok(P("7/2/26 9:32:07 PM")!.h === 21, "US + PM");
  ok(P("7/2/2026, 12:05 AM")!.h === 0, "12 AM = 0");
  ok(P("7/2/2026 12:05 PM")!.h === 12, "12 PM = 12");
  ok(P("7/2/2026 9:32 p.m.")!.h === 21, "p.m. dotted");
  ok(P("7/2/2026 13:05 PM") === null, "13 PM rejected");
  ok(P("7/2/2026 0:05 AM") === null, "0 AM rejected");
  // --- parser: rejections ---
  ok(P("2026-02-30 10:00:00") === null, "Feb 30 rejected");
  ok(P("2024-02-29 10:00:00") !== null, "leap day accepted");
  ok(P("2025-02-29") === null, "non-leap Feb 29 rejected");
  ok(P("2026-07-02 24:00:00") === null, "24:00 rejected");
  ok(P("2026-07-02 23:60:00") === null, "minute 60 rejected");
  ok(P("2026-07-02 23:59:60") === null, "second 60 rejected");
  ok(P("2026-13-02") === null, "month 13 rejected");
  ok(P("2026-00-02") === null, "month 0 rejected");
  ok(P("2026-07-00") === null, "day 0 rejected");
  ok(P("") === null && P("   ") === null && P(null) === null && P(undefined) === null, "blank → null");
  ok(P("Jul 2 2026") === null, "month names not guessed");
  ok(P("2026/07/02") === null, "slashes in ISO order not guessed");
  ok(P("46205.39") === null, "Excel serial not guessed");
  ok(P("2026-07-02 09:32:07.1234567") === null, "7-digit fraction rejected");
  ok(P("2026-07-02 9:32") === null, "ISO with 1-digit hour rejected (shape not seen)");

  // --- UTC conversion is Pacific + DST-aware ---
  ok(wallTimeToUtcIso(a!) === "2026-07-02T16:32:07.787Z", "PDT = UTC-7");
  ok(wallTimeToUtcIso(P("2026-01-15 09:00:00")!) === "2026-01-15T17:00:00.000Z", "PST = UTC-8");

  // --- keys/hash ---
  ok(cultiveraVendorKey("  Grow  Op farms ") === "GROW OP FARMS", "vendor key normalized");
  ok(shortHash("GROW OP FARMS") === shortHash("GROW OP FARMS"), "hash deterministic");
  ok(shortHash("A") !== shortHash("B"), "hash differs");
  ok(/^[0-9A-Z]{6}$/.test(shortHash("")), "hash shape on empty");
  ok(normalizeGapMinutes(undefined) === 60 && normalizeGapMinutes("x") === 60, "gap default");
  ok(normalizeGapMinutes(0) === 1 && normalizeGapMinutes(-5) === 1, "gap floor");
  ok(normalizeGapMinutes(99999) === 1440 && normalizeGapMinutes("30") === 30, "gap ceiling + string");
  ok(normalizeGapMinutes(30.6) === 31, "gap rounded");

  // --- planning ---
  const T = "2026-10-12";
  const r = (barcode: string, vendor: string, d: string, extra: Partial<CultiveraGroupRow> = {}): CultiveraGroupRow => ({
    barcode,
    vendor,
    receivedDateRaw: d,
    ...extra,
  });
  const p0 = planCultiveraManifests([], { pacificToday: T });
  ok(p0.groups.length === 0 && p0.summary.lots === 0 && p0.summary.largestGroup === 0, "empty");

  // One burst + one row 59 min later (same session) + one 61 min after THAT (new session).
  const p1 = planCultiveraManifests(
    [
      r("B1", "Acme", "2026-07-02 09:00:00.000"),
      r("B2", "Acme", "2026-07-02 09:00:00.100"),
      r("B3", "Acme", "2026-07-02 09:59:00.100"),
      r("B4", "Acme", "2026-07-02 11:00:00.200"),
    ],
    { pacificToday: T },
  );
  ok(p1.groups.length === 2, "gap chain: 59 min joins, 61 min splits");
  ok(p1.groups[0].barcodes.join() === "B1,B2,B3" && p1.groups[1].barcodes.join() === "B4", "split membership");
  ok(p1.groups[0].spanMinutes === 59, "span minutes");
  ok(p1.groups[0].manifestNumber === `CV-20260702-0900-${shortHash("ACME")}`, "session manifest number");
  ok(p1.groups[1].manifestNumber === `CV-20260702-1100-${shortHash("ACME")}`, "second session number");
  ok(p1.groups[0].startUtcIso === "2026-07-02T16:00:00.000Z", "session start UTC");
  ok(p1.summary.singletonSessions === 1 && p1.summary.largestGroup === 3, "singleton + largest");
  // Exactly G apart joins (≤ G), G + 1 ms splits.
  const pEq = planCultiveraManifests([r("X1", "V", "2026-07-02 09:00:00"), r("X2", "V", "2026-07-02 10:00:00")], { pacificToday: T });
  ok(pEq.groups.length === 1, "exactly 60 min apart joins");
  const pEq2 = planCultiveraManifests([r("X1", "V", "2026-07-02 09:00:00.000"), r("X2", "V", "2026-07-02 10:00:00.001")], { pacificToday: T });
  ok(pEq2.groups.length === 2, "60 min + 1 ms splits");
  ok(planCultiveraManifests([r("X1", "V", "2026-07-02 09:00:00"), r("X2", "V", "2026-07-02 10:00:00.001")], { pacificToday: T, gapMinutes: 120 }).groups.length === 1, "configurable gap");

  // Midnight never joins even if under the gap.
  const pMid = planCultiveraManifests([r("M1", "V", "2026-07-02 23:50:00"), r("M2", "V", "2026-07-03 00:05:00")], { pacificToday: T, gapMinutes: 120 });
  ok(pMid.groups.length === 2, "Pacific day boundary splits");

  // Vendors never merge, even at the same instant.
  const pV = planCultiveraManifests([r("V1", "Acme", "2026-07-02 09:00:00"), r("V2", "Beta", "2026-07-02 09:00:00")], { pacificToday: T });
  ok(pV.groups.length === 2 && pV.groups.every((g) => g.barcodes.length === 1), "different vendors never merge");
  // Same vendor spelled with extra spaces / case → same vendor.
  const pVs = planCultiveraManifests([r("V1", "Acme  Farms", "2026-07-02 09:00:00"), r("V2", "ACME FARMS", "2026-07-02 09:00:01")], { pacificToday: T });
  ok(pVs.groups.length === 1 && pVs.groups[0].vendorLabel === "Acme Farms", "vendor spelling normalized; earliest label kept");

  // Barcode merge: earliest time wins; first row's vendor wins.
  const pB = planCultiveraManifests(
    [r("D1", "Acme", "2026-07-05 10:00:00"), r("D1", "Acme", "2026-07-01 10:00:00"), r("Z9", "Acme", "2026-07-01 10:00:05")],
    { pacificToday: T },
  );
  ok(pB.summary.lots === 2, "duplicate barcode = one lot");
  ok(pB.groups.length === 1 && pB.groups[0].day === "2026-07-01", "duplicate barcode grouped by its EARLIEST row");
  const pBv = planCultiveraManifests([r("D1", "Acme", "2026-07-05 10:00:00"), r("D1", "Beta", "2026-07-01 10:00:00")], { pacificToday: T });
  ok(pBv.groups[0].vendorKey === "ACME" && pBv.summary.vendorConflicts === 1, "first row's vendor kept; conflict counted");
  // Same barcode read as a bare date AND a timed reading on the same day → timed wins.
  const pBt = planCultiveraManifests([r("F1", "Acme", "7/1/2026"), r("F1", "Acme", "2026-07-01 15:00:00")], { pacificToday: T });
  ok(pBt.groups.length === 1 && pBt.groups[0].kind === "session" && pBt.groups[0].firstWall === "2026-07-01 15:00:00.000", "same-day timed beats day-only");
  const pBt2 = planCultiveraManifests([r("F1", "Acme", "2026-07-01 15:00:00"), r("F1", "Acme", "7/1/2026")], { pacificToday: T });
  ok(pBt2.groups[0].kind === "session", "same-day timed beats day-only (either row order)");
  // …but an EARLIER bare date beats a later timed one (earliest day rule).
  const pBe = planCultiveraManifests([r("F2", "Acme", "6/30/2026"), r("F2", "Acme", "2026-07-01 15:00:00")], { pacificToday: T });
  ok(pBe.groups[0].kind === "day" && pBe.groups[0].day === "2026-06-30", "earlier day-only beats later timed");
  // A blank row + a dated row of the same barcode → dated.
  const pBd = planCultiveraManifests([r("E1", "Acme", ""), r("E1", "Acme", "2026-07-01 10:00:00")], { pacificToday: T });
  ok(pBd.summary.lotsUndated === 0 && pBd.groups[0].kind === "session", "one readable date is enough");

  // Undated bucket per vendor + reasons.
  const pU = planCultiveraManifests(
    [
      r("U1", "Acme", ""),
      r("U2", "Acme", "garbage"),
      r("U3", "Acme", "2013-01-01 10:00:00"),
      r("U4", "Acme", "2027-01-01 10:00:00"),
      r("U5", "Beta", ""),
      r("OK", "Acme", "2026-07-01 10:00:00"),
    ],
    { pacificToday: T },
  );
  const und = pU.groups.filter((g) => g.kind === "undated");
  ok(und.length === 2, "one undated group per vendor");
  const ua = und.find((g) => g.vendorKey === "ACME")!;
  ok(ua.barcodes.length === 4, "acme undated = 4");
  ok(ua.undatedReasons.blank === 1 && ua.undatedReasons.unreadable === 1 && ua.undatedReasons.out_of_window === 2, "reasons");
  ok(ua.manifestNumber === `CV-UNDATED-${shortHash("ACME")}` && ua.day === null && ua.startUtcIso === null, "undated number/fields");
  ok(pU.unreadableSamples.join() === "garbage", "unreadable sample kept verbatim");
  ok(pU.groups[pU.groups.length - 1].kind === "undated" && pU.groups[0].kind === "session", "dated first, undated last");
  ok(pU.summary.vendorsWithUndated === 2 && pU.summary.lotsUndated === 5, "undated summary");
  ok(planCultiveraManifests([r("W", "A", "2026-10-12 10:00:00")], { pacificToday: T }).summary.lotsUndated === 0, "today is in window");
  ok(planCultiveraManifests([r("W", "A", "2026-10-13 10:00:00")], { pacificToday: T }).summary.lotsUndated === 1, "tomorrow is out of window");
  ok(planCultiveraManifests([r("W", "A", "2014-07-08 10:00:00")], { pacificToday: T }).summary.lotsUndated === 0, "first legal day in window");

  // Day precision: its own group, never merged into a timed session.
  const pD = planCultiveraManifests(
    [r("T1", "Acme", "2026-07-01 10:00:00"), r("D1", "Acme", "7/1/2026"), r("D2", "Acme", "2026-07-01"), r("D3", "Acme", "7/2/2026")],
    { pacificToday: T },
  );
  ok(pD.groups.filter((g) => g.kind === "day").length === 2, "day groups per day");
  ok(pD.groups.filter((g) => g.kind === "session").length === 1, "timed session separate");
  const d1 = pD.groups.find((g) => g.kind === "day" && g.day === "2026-07-01")!;
  ok(d1.barcodes.join() === "D1,D2" && d1.manifestNumber === `CV-20260701-DAY-${shortHash("ACME")}`, "day group membership + number");
  ok(d1.startUtcIso === "2026-07-01T19:00:00.000Z", "day group anchored at Pacific noon");
  ok(pD.summary.lotsDayOnly === 3 && pD.summary.lotsTimed === 1, "precision counts");

  // Zero units / no barcode are skipped exactly like planImportLots.
  const pS = planCultiveraManifests(
    [r("Z", "A", "2026-07-01 10:00:00", { units: 0 }), r("", "A", "2026-07-01 10:00:00"), r("  ", "A", ""), r("Y", "A", "2026-07-01 10:00:00", { units: 3 })],
    { pacificToday: T },
  );
  ok(pS.summary.rowsSkippedZeroUnits === 1 && pS.summary.rowsSkippedNoBarcode === 2 && pS.summary.lots === 1, "skips");
  ok(pS.summary.rowsRead === 4, "rowsRead counts all");

  // Order independence: shuffle → identical plan.
  const rowsX = [
    r("B1", "Acme", "2026-07-02 09:00:00.000"),
    r("B2", "Acme", "2026-07-02 09:00:00.000"),
    r("C1", "Beta", "2026-07-03 14:00:00"),
    r("B3", "Acme", ""),
    r("B4", "Acme", "2026-07-02 11:00:00.200"),
  ];
  // Same barcode, different first row → the first row's product labels it (planImportLots' rule).
  const pFirst = planCultiveraManifests([r("P1", "A", "2026-07-01 10:00:00", { productName: "First" }), r("P1", "A", "2026-06-01 10:00:00", { productName: "Second" })], { pacificToday: T });
  ok(pFirst.groups[0].sampleProducts.join() === "First" && pFirst.groups[0].day === "2026-06-01", "first row labels; earliest row dates");
  const s1 = JSON.stringify(planCultiveraManifests(rowsX, { pacificToday: T }).groups);
  const s2 = JSON.stringify(planCultiveraManifests([...rowsX].reverse(), { pacificToday: T }).groups);
  ok(s1 === s2, "input order does not change the plan");
  ok(planCultiveraManifests(rowsX, { pacificToday: T }).numberCollisions.length === 0, "no collisions");
  const tie = planCultiveraManifests(rowsX, { pacificToday: T }).groups[0];
  ok(tie.barcodes.join() === "B1,B2", "ties broken by barcode");
  ok(tie.key === "ACME|session|2026-07-02 09:00:00.000", "stable group key");

  // --- predicates ---
  ok(isReconstructedManifest({ raw_payload: { kind: "cultivera-reconstructed" } }), "reconstructed by kind");
  ok(!isReconstructedManifest({ manifest_number: "CV-20260702-0900-ABCDEF", raw_payload: {} }), "number alone is NOT enough");
  ok(!isReconstructedManifest(null) && !isReconstructedManifest({ raw_payload: [] }) && !isReconstructedManifest({ raw_payload: "x" }), "junk payloads");
  ok(isPosImportManifest({ raw_payload: { kind: "pos-import-migration" } }), "pos import by kind");
  ok(isMigrationManifest({ raw_payload: { kind: "pos-import-migration" } }) && isMigrationManifest({ raw_payload: { kind: "cultivera-reconstructed" } }), "migration covers both");
  ok(!isMigrationManifest({ raw_payload: { kind: "wcia" } }) && !isMigrationManifest({ raw_payload: null }), "real manifests are not migration");
  ok(reconstructedImportId({ raw_payload: { kind: "cultivera-reconstructed", import_id: "imp-1" } }) === "imp-1", "import id");
  ok(reconstructedImportId({ raw_payload: { kind: "pos-import-migration", import_id: "imp-1" } }) === null, "import id only for reconstructed");
  ok(reconstructedImportId({ raw_payload: { kind: "cultivera-reconstructed", import_id: "" } }) === null, "blank import id → null");

  // --- lineage + dedupe + title ---
  const g0 = p1.groups[0];
  const lin = buildReconstructedLineage({ importId: "imp-1", sourceManifestId: "m-1", sourceManifestNumber: "POS-IMPORT-imp1", gapMinutes: 60, group: g0 });
  ok(lin.kind === RECONSTRUCTED_MANIFEST_KIND && lin.import_id === "imp-1" && lin.lot_count === 3, "lineage core fields");
  ok(lin.barcodes !== g0.barcodes && lin.barcodes.join() === g0.barcodes.join(), "lineage copies barcodes");
  ok(lin.undated_reasons === null && lin.rule_version === GROUPING_RULE_VERSION, "lineage reasons null for sessions");
  ok(isReconstructedManifest({ raw_payload: lin }) && reconstructedImportId({ raw_payload: lin }) === "imp-1", "lineage round-trips predicates");
  ok(reconstructedDedupeKey("imp-1", g0) === `${g0.manifestNumber}|ACME|IMPORT-imp-1`, "dedupe key");
  ok(reconstructedDedupeKey("imp-1", g0) !== reconstructedDedupeKey("imp-2", g0), "dedupe key per import");
  ok(reconstructedGroupTitle(g0) === "Acme · Jul 2, 2026 9:00 AM · 3 items", "session title");
  ok(reconstructedGroupTitle(p1.groups[1]) === "Acme · Jul 2, 2026 11:00 AM · 1 item", "singular title");
  ok(reconstructedGroupTitle(ua) === "Acme · date unknown · 4 items", "undated title");
  ok(reconstructedGroupTitle(d1) === "Acme · Jul 1, 2026 (time unknown) · 2 items", "day title");
  ok(reconstructedGroupTitle(planCultiveraManifests([r("Q", "A", "2026-07-02 12:30:00")], { pacificToday: T }).groups[0]).includes("12:30 PM"), "noon title");
  ok(reconstructedGroupTitle(planCultiveraManifests([r("Q", "A", "2026-07-02 00:30:00")], { pacificToday: T }).groups[0]).includes("12:30 AM"), "midnight title");

  return { passed, failed: 0 };
}
