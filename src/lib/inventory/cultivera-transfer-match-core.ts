/**
 * src/lib/inventory/cultivera-transfer-match-core.ts — R50 S1b (PURE).
 *
 * The owner: "The pos import used to make one big manifest essentially, but I
 * want to break it up into their existing manifests when they came in."
 *
 * S1 rebuilt deliveries from timestamps alone. The read-only harvest of the
 * store's own Cultivera back office (bible §1.8) gives us the REAL manifests:
 * every inbound transfer Cultivera recorded (GET transfers/incoming/{id}/detail),
 * with its number, vendor, acceptance instant and the barcode + accepted
 * quantity of every line. This core marries each imported lot to the transfer
 * it actually arrived on, using evidence and nothing else:
 *
 *   A "receipt" of a lot = a transfer line with that barcode, AcceptedQuantity > 0,
 *   on a transfer with a readable acceptance instant.
 *
 *   1. exactly one receipt                   → that transfer   (evidence "only_receipt")
 *   2. several receipts (the same CCRS barcode re-delivered later, or a
 *      transfer that was re-sent): the FIRST receipt accepted at or after the
 *      lot's earliest Received time (− 60 s clock tolerance)
 *                                            → that transfer   (evidence "first_receipt_after_received")
 *        * the lot's received time is day-only / missing → AMBIGUOUS (never guess)
 *        * no receipt at/after it, or two receipts at the very same instant → AMBIGUOUS
 *   3. no receipt                            → no transfer     (falls back to S1's time grouping)
 *   Whatever the rule picked, the transfer's vendor must equal the lot's vendor
 *   (normalized) or the lot is refused (vendor_mismatch → S1 fallback). Never
 *   merge vendors (bible §2.3).
 *
 * Measured on the 2026-10-12 harvest (bible §1.9): 3,738 lots have one receipt,
 * 249 several, 269 none; the forward rule agreed with S1's same-session
 * consensus on 183 of 183 lots where both could answer; a Received time was
 * never after its transfer's acceptance on any single-receipt lot (0 of 3,755
 * rows), which is why the rule looks forward only.
 *
 * Rows the rule cannot place go through planCultiveraManifests (S1), so every
 * lot still lands on exactly one manifest. Nothing here reads or writes the DB.
 *
 * Rule v2 (R50 S10, bible §3b.4) adds Cultivera's own link (the list API's
 * IncomingTransferId per lot), passed as `opts.links` (barcode → transfer ids):
 *   * vendor alias by link: a lot whose ONLY receipt is on another vendor's
 *     transfer is accepted when Cultivera links the lot to exactly that transfer
 *     (the barcode is on its lines AND Cultivera says so). Measured 2026-10-12:
 *     all 24 such lots are a brand ("Dope Synergy") delivered by its distributor
 *     ("R&B GROUP"). The manifest keeps the transfer's vendor (who shipped it);
 *     the lot keeps its own. Without a link the refusal stands (never guess).
 *   * alsoOn: a re-received barcode is filed under its FIRST receipt after the
 *     received time; every other receipt is recorded, so no manifest loses a line.
 *   * link agreement: each matched lot is compared with Cultivera's link
 *     (agree / differ / none). "differ" is expected on re-received barcodes (the
 *     link points at the LATEST top-up in 142 of 144 cases) and is reported, not an error.
 * Without `opts.links` the v1 answers are unchanged (pinned by the S1b test).
 */
import {
  buildCultiveraLots,
  cultiveraVendorKey,
  planCultiveraManifests,
  wallTimeToUtcIso,
  RECONSTRUCTED_MANIFEST_KIND,
  type CultiveraGroupRow,
  type CultiveraLot,
  type ReconstructedGroup,
} from "./cultivera-manifest-group-core";

/* ------------------------------------------------------------------ *
 * Constants + input shapes
 * ------------------------------------------------------------------ */

/** Version of the transfer-match rule, recorded in lineage. Bump when the rule changes. */
export const TRANSFER_MATCH_RULE_VERSION = 2;
/** A Received stamp may run this far ahead of the acceptance stamp (two clocks on two servers). */
export const RECEIVED_CLOCK_TOLERANCE_MS = 60_000;

/** One line of a harvested transfer: [barcode, acceptedQuantity, quantity, isSample]. */
export type TransferIndexLine = [string, number, number, boolean];

/** One inbound transfer from a transfer index (scripts/cultivera/build-transfer-index.py). */
export type TransferIndexEntry = {
  id: number;
  number: string;
  vendor: string;
  vendorNo?: string;
  transferDate?: string | null;
  /** UTC ISO with Z, e.g. "2024-08-30T18:56:03.507Z". null for a pending transfer. */
  acceptedAt: string | null;
  status: string;
  manual?: boolean;
  internal?: boolean;
  lines: TransferIndexLine[];
};

export type TransferEvidence = "only_receipt" | "first_receipt_after_received";

export type UnmatchedReason =
  | "no_receipt"
  | "ambiguous_no_time"
  | "ambiguous_none_after"
  | "ambiguous_tie"
  | "vendor_mismatch";

/** How a matched lot compares with Cultivera's own link (IncomingTransferId). */
export type LinkAgreement = "agree" | "differ" | "none";

export type LotTransferDecision =
  | {
      barcode: string;
      matched: true;
      transferId: number;
      evidence: TransferEvidence;
      receipts: number;
      /** Other transfers that also carried this barcode (accepted qty > 0), ascending by acceptance. */
      alsoOn: number[];
      /** True when the vendors differ and Cultivera's link to this very transfer settled it (rule v2). */
      vendorByLink: boolean;
      link: LinkAgreement;
    }
  | { barcode: string; matched: false; reason: UnmatchedReason; receipts: number; link: LinkAgreement };

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const UTC_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?Z$/;

/**
 * Parse the harvest's acceptance stamp ("2024-08-30T18:56:03.507Z", ".01Z",
 * no fraction). Strict: anything else → null (the transfer then cannot be a
 * receipt; never guess). Fraction truncated to ms. Calendar-checked.
 */
export function parseAcceptedAtMs(raw: string | null | undefined): number | null {
  if (typeof raw !== "string") return null;
  const m = UTC_ISO_RE.exec(raw.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [1, 2, 3, 4, 5, 6].map((i) => Number(m[i]));
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null;
  if (d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null;
  const ms = m[7] === undefined ? 0 : Number(m[7].padEnd(3, "0").slice(0, 3));
  return Date.UTC(y, mo - 1, d, h, mi, s, ms);
}

type Receipt = { transferId: number; acceptedMs: number };

/** barcode → receipts (sorted by acceptance, then id). Lines with AcceptedQuantity ≤ 0 are not receipts. */
export function indexReceipts(transfers: readonly TransferIndexEntry[]): Map<string, Receipt[]> {
  const out = new Map<string, Receipt[]>();
  for (const t of transfers) {
    const ms = parseAcceptedAtMs(t.acceptedAt);
    if (ms === null) continue;
    const seen = new Set<string>();
    for (const line of t.lines ?? []) {
      const bc = (line?.[0] ?? "").trim();
      const qty = Number(line?.[1]);
      if (!bc || !(qty > 0) || seen.has(bc)) continue; // one receipt per transfer per barcode
      seen.add(bc);
      const list = out.get(bc) ?? [];
      list.push({ transferId: t.id, acceptedMs: ms });
      out.set(bc, list);
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.acceptedMs - b.acceptedMs || a.transferId - b.transferId);
  return out;
}

/** Decide ONE lot. PURE. */
export function decideLotTransfer(
  lot: CultiveraLot,
  receipts: readonly Receipt[] | undefined,
  byId: ReadonlyMap<number, TransferIndexEntry>,
  linkIds?: readonly number[],
): LotTransferDecision {
  const list = receipts ?? [];
  const n = list.length;
  const links = linkIds ?? [];
  const refuse = (reason: UnmatchedReason): LotTransferDecision => ({
    barcode: lot.barcode,
    matched: false,
    reason,
    receipts: n,
    link: links.length > 0 ? "differ" : "none",
  });
  if (n === 0) return refuse("no_receipt");
  let pick: Receipt;
  let evidence: TransferEvidence;
  if (n === 1) {
    pick = list[0];
    evidence = "only_receipt";
  } else {
    if (!lot.t || lot.t.precision !== "time") return refuse("ambiguous_no_time");
    const receivedMs = Date.parse(wallTimeToUtcIso(lot.t));
    const after = list.filter((r) => r.acceptedMs >= receivedMs - RECEIVED_CLOCK_TOLERANCE_MS);
    if (after.length === 0) return refuse("ambiguous_none_after");
    if (after.length > 1 && after[0].acceptedMs === after[1].acceptedMs) return refuse("ambiguous_tie");
    pick = after[0];
    evidence = "first_receipt_after_received";
  }
  const t = byId.get(pick.transferId);
  if (!t) return refuse("vendor_mismatch");
  let vendorByLink = false;
  if (cultiveraVendorKey(t.vendor) !== lot.vendorKey) {
    // Rule v2: only the single-receipt case, and only when Cultivera links the lot to exactly this transfer.
    if (evidence !== "only_receipt" || links.length !== 1 || links[0] !== pick.transferId) return refuse("vendor_mismatch");
    vendorByLink = true;
  }
  return {
    barcode: lot.barcode,
    matched: true,
    transferId: pick.transferId,
    evidence,
    receipts: n,
    alsoOn: list.filter((r) => r.transferId !== pick.transferId).map((r) => r.transferId),
    vendorByLink,
    link: links.length === 0 ? "none" : links.includes(pick.transferId) ? "agree" : "differ",
  };
}

/* ------------------------------------------------------------------ *
 * Plan
 * ------------------------------------------------------------------ */

export type TransferGroup = {
  /** Stable identity "transfer|<id>". */
  key: string;
  transferId: number;
  /** The vendor's REAL manifest number, as Cultivera recorded it (trimmed). */
  manifestNumber: string;
  vendorKey: string;
  vendorLabel: string;
  acceptedAt: string;
  transferDate: string | null;
  status: string;
  /** Barcodes on this transfer that are imported lots (sorted). */
  barcodes: string[];
  /** Lines on the transfer that are NOT imported lots (sold out / depleted before the export). */
  otherLines: number;
  evidence: Record<TransferEvidence, number>;
  sampleProducts: string[];
  /** barcode → the OTHER transfers that also carried it (only barcodes that have any). */
  alsoOn: Record<string, number[]>;
  /** Barcodes accepted by the link-confirmed vendor alias (sorted). */
  vendorByLink: string[];
};

export type TransferMatchPlan = {
  transferGroups: TransferGroup[];
  /** S1 groups for the lots no transfer could claim (same rules as R50 S1). */
  fallbackGroups: ReconstructedGroup[];
  decisions: LotTransferDecision[];
  summary: {
    lots: number;
    matched: number;
    matchedOnlyReceipt: number;
    matchedFirstAfter: number;
    unmatched: Record<UnmatchedReason, number>;
    transfersUsed: number;
    transfersInIndex: number;
    fallbackGroups: number;
    largestTransferGroup: number;
    /** Matched lots accepted through the link-confirmed vendor alias (rule v2). */
    matchedVendorByLink: number;
    /** Matched lots whose barcode was also on other transfers. */
    lotsAlsoOn: number;
    /** Cultivera's link vs this plan. unmatchedLinked = unmatched lots Cultivera did link (should be 0). */
    link: { agree: number; differ: number; none: number; unmatchedLinked: number };
  };
  /** Non-empty ⇒ the plan must be refused (two groups would share a number for one vendor). */
  numberCollisions: string[];
};

function emptyUnmatched(): Record<UnmatchedReason, number> {
  return { no_receipt: 0, ambiguous_no_time: 0, ambiguous_none_after: 0, ambiguous_tie: 0, vendor_mismatch: 0 };
}

/**
 * Marry every imported lot to its real transfer; the rest fall back to S1.
 * PURE and deterministic (input order of rows only matters, as in S1, for
 * which row of a shared barcode labels the lot).
 */
export function planTransferManifests(
  rows: readonly CultiveraGroupRow[],
  transfers: readonly TransferIndexEntry[],
  opts: { pacificToday: string; gapMinutes?: number; links?: ReadonlyMap<string, readonly number[]> },
): TransferMatchPlan {
  const { lots } = buildCultiveraLots(rows, opts.pacificToday);
  const byId = new Map<number, TransferIndexEntry>();
  for (const t of transfers) byId.set(t.id, t);
  const receipts = indexReceipts(transfers);

  const decisions: LotTransferDecision[] = [];
  const lotByBarcode = new Map<string, CultiveraLot>();
  for (const lot of lots) {
    lotByBarcode.set(lot.barcode, lot);
    decisions.push(decideLotTransfer(lot, receipts.get(lot.barcode), byId, opts.links?.get(lot.barcode)));
  }

  const groupsById = new Map<number, TransferGroup>();
  for (const d of decisions) {
    if (!d.matched) continue;
    const t = byId.get(d.transferId)!;
    let g = groupsById.get(t.id);
    if (!g) {
      g = {
        key: `transfer|${t.id}`,
        transferId: t.id,
        manifestNumber: t.number.trim(),
        vendorKey: cultiveraVendorKey(t.vendor),
        vendorLabel: t.vendor.replace(/\s+/g, " ").trim(),
        acceptedAt: t.acceptedAt!,
        transferDate: t.transferDate ?? null,
        status: t.status,
        barcodes: [],
        otherLines: 0,
        evidence: { only_receipt: 0, first_receipt_after_received: 0 },
        sampleProducts: [],
        alsoOn: {},
        vendorByLink: [],
      };
      groupsById.set(t.id, g);
    }
    g.barcodes.push(d.barcode);
    g.evidence[d.evidence] += 1;
    if (d.alsoOn.length > 0) g.alsoOn[d.barcode] = [...d.alsoOn];
    if (d.vendorByLink) g.vendorByLink.push(d.barcode);
  }
  for (const g of groupsById.values()) {
    g.barcodes.sort();
    g.vendorByLink.sort();
    g.alsoOn = Object.fromEntries(Object.entries(g.alsoOn).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    const mine = new Set(g.barcodes);
    const lineBarcodes = new Set((byId.get(g.transferId)!.lines ?? []).map((l) => (l?.[0] ?? "").trim()).filter(Boolean));
    g.otherLines = [...lineBarcodes].filter((b) => !mine.has(b)).length;
    for (const b of g.barcodes) {
      const p = lotByBarcode.get(b)?.product;
      if (p && !g.sampleProducts.includes(p) && g.sampleProducts.length < 3) g.sampleProducts.push(p);
    }
  }
  const transferGroups = [...groupsById.values()].sort(
    (a, b) => a.acceptedAt.localeCompare(b.acceptedAt) || a.transferId - b.transferId,
  );

  // Unmatched lots → S1, fed the SAME rows (all rows of those barcodes, original order).
  const unmatchedSet = new Set(decisions.filter((d) => !d.matched).map((d) => d.barcode));
  const fallbackRows = rows.filter((r) => unmatchedSet.has((r.barcode ?? "").trim()));
  const fallback = planCultiveraManifests(fallbackRows, { pacificToday: opts.pacificToday, gapMinutes: opts.gapMinutes });

  // Collisions: same number + same vendor twice (real numbers are unique per vendor in Cultivera;
  // a CV- fallback number must never equal a real one).
  const seen = new Set<string>();
  const collisions: string[] = [];
  for (const [num, vk] of [
    ...transferGroups.map((g) => [g.manifestNumber, g.vendorKey] as const),
    ...fallback.groups.map((g) => [g.manifestNumber, g.vendorKey] as const),
  ]) {
    const k = `${num.toUpperCase()}|${vk}`;
    if (seen.has(k)) collisions.push(num);
    seen.add(k);
  }
  for (const c of fallback.numberCollisions) collisions.push(c);

  const unmatched = emptyUnmatched();
  for (const d of decisions) if (!d.matched) unmatched[d.reason] += 1;
  const matched = decisions.filter((d) => d.matched) as Extract<LotTransferDecision, { matched: true }>[];
  return {
    transferGroups,
    fallbackGroups: fallback.groups,
    decisions,
    summary: {
      lots: lots.length,
      matched: matched.length,
      matchedOnlyReceipt: matched.filter((d) => d.evidence === "only_receipt").length,
      matchedFirstAfter: matched.filter((d) => d.evidence === "first_receipt_after_received").length,
      unmatched,
      transfersUsed: transferGroups.length,
      transfersInIndex: transfers.length,
      fallbackGroups: fallback.groups.length,
      largestTransferGroup: transferGroups.reduce((m, g) => Math.max(m, g.barcodes.length), 0),
      matchedVendorByLink: matched.filter((d) => d.vendorByLink).length,
      lotsAlsoOn: matched.filter((d) => d.alsoOn.length > 0).length,
      link: {
        agree: matched.filter((d) => d.link === "agree").length,
        differ: matched.filter((d) => d.link === "differ").length,
        none: matched.filter((d) => d.link === "none").length,
        unmatchedLinked: decisions.filter((d) => !d.matched && d.link !== "none").length,
      },
    },
    numberCollisions: [...new Set(collisions)],
  };
}

/* ------------------------------------------------------------------ *
 * Lineage + keys
 * ------------------------------------------------------------------ */

/**
 * Idempotency key for inbound_manifests.dedupe_key. Distinct from a live
 * intake's "<NUMBER>|<VENDOR>" (manifest-dedupe-core) by the IMPORT suffix, so
 * the rebuilt manifest never blocks or is blocked by the unique index, while
 * findBlockingDuplicate (number + vendor + live status) still flags a later
 * re-upload of the same historic WCIA file as a duplicate — correct, it came in.
 */
export function transferDedupeKey(importId: string, g: Pick<TransferGroup, "manifestNumber" | "vendorKey">): string {
  return `${g.manifestNumber.toUpperCase()}|${g.vendorKey}|IMPORT-${importId}`;
}

export type TransferLineage = {
  kind: typeof RECONSTRUCTED_MANIFEST_KIND;
  import_id: string;
  source_manifest_id: string;
  source_manifest_number: string;
  group_key: string;
  group_kind: "transfer";
  rule: "cultivera-transfer";
  rule_version: number;
  cultivera_transfer_id: number;
  cultivera_transfer_number: string;
  cultivera_status: string;
  accepted_at_utc: string;
  transfer_date: string | null;
  lot_count: number;
  barcodes: string[];
  other_lines: number;
  evidence: Record<TransferEvidence, number>;
  /** barcode → other transfers that also carried it (rule v2; empty when none). */
  also_on: Record<string, number[]>;
  /** Barcodes filed here by the link-confirmed vendor alias (rule v2). */
  vendor_by_link: string[];
};

/** raw_payload of a manifest rebuilt from a real transfer. Same `kind` as S1 so every accounting exclusion applies. */
export function buildTransferLineage(args: {
  importId: string;
  sourceManifestId: string;
  sourceManifestNumber: string;
  group: TransferGroup;
}): TransferLineage {
  const g = args.group;
  return {
    kind: RECONSTRUCTED_MANIFEST_KIND,
    import_id: args.importId,
    source_manifest_id: args.sourceManifestId,
    source_manifest_number: args.sourceManifestNumber,
    group_key: g.key,
    group_kind: "transfer",
    rule: "cultivera-transfer",
    rule_version: TRANSFER_MATCH_RULE_VERSION,
    cultivera_transfer_id: g.transferId,
    cultivera_transfer_number: g.manifestNumber,
    cultivera_status: g.status,
    accepted_at_utc: g.acceptedAt,
    transfer_date: g.transferDate,
    lot_count: g.barcodes.length,
    barcodes: [...g.barcodes],
    other_lines: g.otherLines,
    evidence: { ...g.evidence },
    also_on: Object.fromEntries(Object.entries(g.alsoOn).map(([b, ids]) => [b, [...ids]])),
    vendor_by_link: [...g.vendorByLink],
  };
}

/* ------------------------------------------------------------------ *
 * Adapters for the Fetch It All run (R50 S10): raw harvest → index + links
 * ------------------------------------------------------------------ */

/** The fields of GET transfers/incoming/{id}/detail this rule reads (the rest is ignored, never stored). */
export type RawTransferDetail = {
  Id?: unknown;
  TransferNumber?: unknown;
  FromVendor?: unknown;
  VendorNo?: unknown;
  TransferDate?: unknown;
  DateAccepted?: unknown;
  StatusDisplay?: unknown;
  IsManualCreated?: unknown;
  IsInternalTransfer?: unknown;
  Details?: unknown;
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const collapse = (v: unknown): string => str(v).split(/\s+/).filter(Boolean).join(" ");
const num0 = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : 0;
  return Number.isFinite(n) ? n : 0;
};

/**
 * Same output as scripts/cultivera/build-transfer-index.py, in TypeScript, so
 * the button's run feeds the matcher with no Python step. A record without a
 * positive integer Id is skipped and counted (never invented). Duplicate Ids:
 * the last wins and is counted. Sorted by id; lines sorted like Python's
 * list.sort() on [barcode, accepted, quantity, sample].
 */
export function transferIndexFromDetails(details: readonly unknown[]): {
  transfers: TransferIndexEntry[];
  skipped: number;
  duplicates: number;
} {
  const byId = new Map<number, TransferIndexEntry>();
  let skipped = 0;
  let duplicates = 0;
  for (const raw of details) {
    const d = (raw && typeof raw === "object" ? raw : {}) as RawTransferDetail;
    const id = typeof d.Id === "number" ? d.Id : NaN;
    if (!Number.isInteger(id) || id <= 0) {
      skipped += 1;
      continue;
    }
    const lines: TransferIndexLine[] = [];
    for (const it of Array.isArray(d.Details) ? d.Details : []) {
      const o = (it && typeof it === "object" ? it : {}) as Record<string, unknown>;
      const bc = str(o.Barcode).trim();
      if (!bc) continue;
      lines.push([bc, num0(o.AcceptedQuantity), num0(o.Quantity), o.IsSample === true]);
    }
    lines.sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1] || a[2] - b[2] || Number(a[3]) - Number(b[3]),
    );
    if (byId.has(id)) duplicates += 1;
    byId.set(id, {
      id,
      number: str(d.TransferNumber),
      vendor: collapse(d.FromVendor),
      vendorNo: str(d.VendorNo),
      transferDate: typeof d.TransferDate === "string" ? d.TransferDate : null,
      acceptedAt: typeof d.DateAccepted === "string" ? d.DateAccepted : null,
      status: str(d.StatusDisplay),
      manual: d.IsManualCreated === true,
      internal: d.IsInternalTransfer === true,
      lines,
    });
  }
  return { transfers: [...byId.values()].sort((a, b) => a.id - b.id), skipped, duplicates };
}

/**
 * Cultivera's own link, per barcode: the distinct IncomingTransferId of every
 * list-API lot with that barcode (twin lots of a re-received barcode can link
 * to different transfers). Ids sorted ascending. Lots without a positive
 * integer link contribute nothing.
 */
export function linksFromListLots(
  lots: readonly { Barcode?: unknown; IncomingTransferId?: unknown }[],
): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const l of lots) {
    const bc = typeof l?.Barcode === "string" ? l.Barcode.trim() : typeof l?.Barcode === "number" ? String(l.Barcode) : "";
    const id = l?.IncomingTransferId;
    if (!bc || typeof id !== "number" || !Number.isInteger(id) || id <= 0) continue;
    const list = out.get(bc) ?? [];
    if (!list.includes(id)) list.push(id);
    out.set(bc, list);
  }
  for (const list of out.values()) list.sort((a, b) => a - b);
  return out;
}

/* ------------------------------------------------------------------ *
 * Go / no-go for the plan (bible \u00a73b.6 "Manifest plan")
 * ------------------------------------------------------------------ */

export type ManifestPlanGate = {
  pass: boolean;
  detail: string;
  /** Each failed condition, in words a manager can act on. Empty when pass. */
  problems: string[];
  /** Re-received barcodes filed on a different transfer than Cultivera's link (printed, not an error). */
  multiReceiptDiffers: { barcode: string; transferId: number; linkIds: number[] }[];
};

/**
 * \u00a73b.6: every lot on exactly one manifest; vendors never mixed (except the
 * named link-confirmed aliases); no number collisions; every single-receipt
 * lot agrees with Cultivera's link; no lot Cultivera linked is left unmatched.
 * Multi-receipt differences are listed, never failed. `vendorOf` = each lot's
 * normalized vendor (cultiveraVendorKey of its first row). `linksPresent`
 * false (no list links at all) fails: the agreement check would be vacuous.
 */
export function manifestPlanGate(
  plan: TransferMatchPlan,
  vendorOf: ReadonlyMap<string, string>,
  links: ReadonlyMap<string, readonly number[]>,
): ManifestPlanGate {
  const problems: string[] = [];
  const all = [...plan.transferGroups.flatMap((g) => g.barcodes), ...plan.fallbackGroups.flatMap((g) => g.barcodes)];
  const distinct = new Set(all);
  if (all.length !== plan.summary.lots || distinct.size !== plan.summary.lots)
    problems.push(`${plan.summary.lots} lots but ${all.length} placements (${distinct.size} distinct)`);
  let mixed = 0;
  for (const g of plan.transferGroups) {
    const alias = new Set(g.vendorByLink);
    for (const b of g.barcodes) if (!alias.has(b) && vendorOf.get(b) !== g.vendorKey) mixed += 1;
  }
  for (const g of plan.fallbackGroups) for (const b of g.barcodes) if (vendorOf.get(b) !== g.vendorKey) mixed += 1;
  if (mixed > 0) problems.push(`${mixed} lots on another vendor's manifest`);
  if (plan.numberCollisions.length > 0) problems.push(`manifest number collisions: ${plan.numberCollisions.slice(0, 5).join(", ")}`);
  const singleDiffer = plan.decisions.filter((d) => d.matched && d.evidence === "only_receipt" && d.link === "differ").length;
  if (singleDiffer > 0) problems.push(`${singleDiffer} single-receipt lots disagree with Cultivera's link`);
  if (plan.summary.link.unmatchedLinked > 0) problems.push(`${plan.summary.link.unmatchedLinked} lots Cultivera linked to a transfer were not placed on one`);
  if (links.size === 0 && plan.summary.lots > 0) problems.push("no Cultivera links were read (IncomingTransferId), so nothing could be cross-checked");
  const multiReceiptDiffers = plan.decisions
    .filter((d): d is Extract<LotTransferDecision, { matched: true }> => d.matched && d.evidence === "first_receipt_after_received" && d.link === "differ")
    .map((d) => ({ barcode: d.barcode, transferId: d.transferId, linkIds: [...(links.get(d.barcode) ?? [])] }))
    .sort((a, b) => (a.barcode < b.barcode ? -1 : a.barcode > b.barcode ? 1 : 0));
  const s = plan.summary;
  const detail =
    `${s.lots} lots: ${s.matched} on ${s.transfersUsed} real manifests (${s.matchedVendorByLink} by Cultivera's link to the distributor), ` +
    `${s.lots - s.matched} on ${s.fallbackGroups} rebuilt; link agrees ${s.link.agree}, re-received filed on first receipt ${multiReceiptDiffers.length}` +
    (problems.length ? `; ${problems.join("; ")}` : "");
  return { pass: problems.length === 0, detail, problems, multiReceiptDiffers };
}

/* ------------------------------------------------------------------ *
 * Self-tests
 * ------------------------------------------------------------------ */

export function __runCultiveraTransferMatchCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL cultivera-transfer-match-core: " + msg);
    passed += 1;
  };

  // --- parseAcceptedAtMs ---
  ok(parseAcceptedAtMs("2024-08-30T18:56:03.507Z") === Date.UTC(2024, 7, 30, 18, 56, 3, 507), "3-digit fraction");
  ok(parseAcceptedAtMs("2024-08-30T18:56:03.01Z") === Date.UTC(2024, 7, 30, 18, 56, 3, 10), "2-digit fraction = 10 ms");
  ok(parseAcceptedAtMs("2024-08-30T18:56:03.5Z") === Date.UTC(2024, 7, 30, 18, 56, 3, 500), "1-digit fraction = 500 ms");
  ok(parseAcceptedAtMs("2024-08-30T18:56:03Z") === Date.UTC(2024, 7, 30, 18, 56, 3, 0), "no fraction");
  ok(parseAcceptedAtMs("2024-08-30T18:56:03.9999999Z") === Date.UTC(2024, 7, 30, 18, 56, 3, 999), "7-digit truncated");
  ok(parseAcceptedAtMs(" 2024-08-30T18:56:03Z ") !== null, "trimmed");
  ok(parseAcceptedAtMs("2024-08-30T18:56:03") === null, "no Z → refused (zone unknown)");
  ok(parseAcceptedAtMs("2024-08-30T18:56:03+00:00") === null, "offset form refused (not the harvest shape)");
  ok(parseAcceptedAtMs("2024-08-30 18:56:03Z") === null, "space separator refused");
  ok(parseAcceptedAtMs("2025-02-29T10:00:00Z") === null, "non-leap Feb 29");
  ok(parseAcceptedAtMs("2024-02-29T10:00:00Z") !== null, "leap day");
  ok(parseAcceptedAtMs("2024-13-01T10:00:00Z") === null, "month 13");
  ok(parseAcceptedAtMs("2024-00-01T10:00:00Z") === null, "month 0");
  ok(parseAcceptedAtMs("2024-04-00T10:00:00Z") === null, "day 0");
  ok(parseAcceptedAtMs("2024-04-31T10:00:00Z") === null, "Apr 31");
  ok(parseAcceptedAtMs("2024-04-30T24:00:00Z") === null, "hour 24");
  ok(parseAcceptedAtMs("2024-04-30T23:60:00Z") === null, "minute 60");
  ok(parseAcceptedAtMs("2024-04-30T23:59:60Z") === null, "second 60");
  ok(parseAcceptedAtMs(null) === null && parseAcceptedAtMs(undefined) === null && parseAcceptedAtMs("") === null, "blank");

  // --- fixtures ---
  const T = (id: number, number: string, vendor: string, acceptedAt: string | null, lines: TransferIndexLine[], status = "Accepted"): TransferIndexEntry => ({
    id,
    number,
    vendor,
    acceptedAt,
    status,
    lines,
  });
  const L = (bc: string, acc = 1): TransferIndexLine => [bc, acc, acc, false];
  const row = (barcode: string, vendor: string, receivedDateRaw: string | null, productName = "P " + barcode): CultiveraGroupRow => ({
    barcode,
    vendor,
    receivedDateRaw,
    productName,
  });
  const TODAY = "2026-10-12";

  // --- indexReceipts ---
  const idx = indexReceipts([
    T(2, "B", "V", "2026-07-02T20:00:00Z", [L("x"), L("y", 0)]),
    T(1, "A", "V", "2026-07-01T20:00:00Z", [L("x"), L("x")]),
    T(3, "C", "V", null, [L("x")], "Pending"),
    T(4, "D", "V", "garbage", [L("x")]),
    T(5, "E", "V", "2026-07-03T20:00:00Z", [L(" z "), L("", 5)]),
  ]);
  ok(idx.get("x")!.length === 2, "pending + unreadable acceptance are not receipts; duplicate line counted once");
  ok(idx.get("x")![0].transferId === 1 && idx.get("x")![1].transferId === 2, "receipts sorted by acceptance");
  ok(!idx.has("y"), "AcceptedQuantity 0 is not a receipt");
  ok(idx.has("z") && !idx.has(""), "barcode trimmed; blank barcode ignored");
  const tieIdx = indexReceipts([T(9, "N", "V", "2026-07-02T20:00:00Z", [L("q")]), T(8, "M", "V", "2026-07-02T20:00:00Z", [L("q")])]);
  ok(tieIdx.get("q")![0].transferId === 8, "equal instants ordered by id (deterministic)");
  const negIdx = indexReceipts([T(1, "A", "V", "2026-07-02T20:00:00Z", [L("n", -2), ["nan", NaN, 1, false]])]);
  ok(!negIdx.has("n") && !negIdx.has("nan"), "negative / NaN accepted quantity is not a receipt");

  // --- planTransferManifests: the ladder ---
  // Pacific PDT in July = UTC−7. Received 09:32 PT = 16:32Z.
  const transfers: TransferIndexEntry[] = [
    T(10, " M-100 ", "GROW  OP", "2026-07-02T17:00:00Z", [L("a1"), L("a2"), L("gone1"), L("r1")]),
    T(11, "M-101", "GROW OP", "2026-08-20T16:00:00Z", [L("r1"), L("a2", 0)]),
    T(12, "M-102", "OTHER CO", "2026-07-02T18:00:00Z", [L("vm")]),
    T(13, "M-103", "GROW OP", "2026-07-02T16:31:30Z", [L("tol"), L("late")]),
    T(14, "M-104", "GROW OP", "2026-07-05T16:31:30Z", [L("tol"), L("late")]),
    T(15, "M-105", "GROW OP", "2026-07-01T10:00:00Z", [L("old")]),
    T(16, "M-106", "GROW OP", "2026-07-01T11:00:00Z", [L("old")]),
    T(17, "M-107", "GROW OP", "2026-07-03T10:00:00Z", [L("tie")]),
    T(18, "M-108", "GROW OP", "2026-07-03T10:00:00Z", [L("tie")]),
    T(19, "M-109", "GROW OP", "2026-07-03T10:00:00Z", [L("nt")]),
    T(20, "M-110", "GROW OP", "2026-07-04T10:00:00Z", [L("nt")]),
  ];
  const rows = [
    row("a1", "Grow Op", "2026-07-02 09:32:07.787000"),
    row("a2", "GROW OP", "2026-07-02 09:33:00"),
    row("r1", "GROW OP", "2026-07-02 09:34:00"), // re-delivered on 11 later: first after received = 10
    row("vm", "GROW OP", "2026-07-02 10:00:00"), // only receipt is another vendor's
    row("tol", "GROW OP", "2026-07-02 09:32:00"), // 13 accepted 30 s BEFORE received: within tolerance
    row("late", "GROW OP", "2026-07-02 09:33:00"), // 13 is 90 s before → skip to 14
    row("old", "GROW OP", "2026-07-02 09:00:00"), // all receipts before received → ambiguous
    row("tie", "GROW OP", "2026-07-02 09:00:00"), // two receipts at the same instant → ambiguous
    row("nt", "GROW OP", "2026-07-02"), // several receipts but day-only time → ambiguous
    row("none", "GROW OP", "2026-07-02 09:35:00"), // no line anywhere
    row("blank", "GROW OP", null),
  ];
  const plan = planTransferManifests(rows, transfers, { pacificToday: TODAY });
  const dec = new Map(plan.decisions.map((d) => [d.barcode, d]));
  const m = (b: string) => dec.get(b) as Extract<LotTransferDecision, { matched: true }>;
  const u = (b: string) => dec.get(b) as Extract<LotTransferDecision, { matched: false }>;
  ok(m("a1").matched && m("a1").transferId === 10 && m("a1").evidence === "only_receipt", "a1: only receipt");
  ok(m("a2").transferId === 10 && m("a2").evidence === "only_receipt" && m("a2").receipts === 1, "a2: the 0-qty line on 11 is not a receipt");
  ok(m("r1").transferId === 10 && m("r1").evidence === "first_receipt_after_received" && m("r1").receipts === 2, "r1: first receipt after received");
  ok(!u("vm").matched && u("vm").reason === "vendor_mismatch", "vm: vendor mismatch refused");
  ok(m("tol").transferId === 13, "tol: 30 s clock skew tolerated");
  ok(m("late").transferId === 14, "late: 90 s before is outside tolerance → next receipt");
  ok(u("old").reason === "ambiguous_none_after", "old: nothing after received");
  ok(u("tie").reason === "ambiguous_tie", "tie: same instant refused");
  ok(u("nt").reason === "ambiguous_no_time", "nt: day-only time with several receipts refused");
  ok(u("none").reason === "no_receipt" && u("blank").reason === "no_receipt", "no line → no_receipt");
  ok(plan.summary.lots === 11 && plan.summary.matched === 5, "summary counts");
  ok(plan.summary.matchedOnlyReceipt === 2 && plan.summary.matchedFirstAfter === 3, "evidence split");
  ok(
    plan.summary.unmatched.no_receipt === 2 &&
      plan.summary.unmatched.vendor_mismatch === 1 &&
      plan.summary.unmatched.ambiguous_none_after === 1 &&
      plan.summary.unmatched.ambiguous_tie === 1 &&
      plan.summary.unmatched.ambiguous_no_time === 1,
    "unmatched reasons",
  );
  ok(plan.summary.transfersUsed === 3 && plan.summary.transfersInIndex === 11, "transfers used / indexed");
  const g10 = plan.transferGroups.find((g) => g.transferId === 10)!;
  ok(g10.manifestNumber === "M-100" && g10.vendorKey === "GROW OP" && g10.vendorLabel === "GROW OP", "real number trimmed; vendor normalized");
  ok(JSON.stringify(g10.barcodes) === JSON.stringify(["a1", "a2", "r1"]), "group barcodes sorted");
  ok(g10.otherLines === 1, "the line not imported (gone1) is counted, not invented");
  ok(g10.evidence.only_receipt === 2 && g10.evidence.first_receipt_after_received === 1, "group evidence");
  ok(g10.sampleProducts.length === 3 && g10.sampleProducts[0] === "P a1", "sample products");
  ok(plan.transferGroups.map((g) => g.transferId).join(",") === "13,10,14", "groups ordered by acceptance");
  ok(plan.summary.largestTransferGroup === 3, "largest group");
  const fbBarcodes = plan.fallbackGroups.flatMap((g) => g.barcodes).sort();
  ok(JSON.stringify(fbBarcodes) === JSON.stringify(["blank", "none", "nt", "old", "tie", "vm"]), "every unmatched lot is in a fallback group");
  ok(plan.fallbackGroups.length === 3 && plan.summary.fallbackGroups === 3, "fallback = session + day + undated");
  ok(plan.fallbackGroups.every((g) => g.manifestNumber.startsWith("CV-")), "fallback numbers are CV-");
  const all = [...plan.transferGroups.flatMap((g) => g.barcodes), ...fbBarcodes];
  ok(all.length === 11 && new Set(all).size === 11, "partition: every lot exactly once");
  ok(plan.numberCollisions.length === 0, "no collisions");

  const plan2 = planTransferManifests([...rows].reverse(), [...transfers].reverse(), { pacificToday: TODAY });
  ok(JSON.stringify(plan2.transferGroups) === JSON.stringify(plan.transferGroups), "reorder-invariant transfer groups");
  ok(JSON.stringify(plan2.fallbackGroups) === JSON.stringify(plan.fallbackGroups), "reorder-invariant fallback groups");

  const sh = planTransferManifests(
    [row("s", "GROW OP", "2026-07-02 12:00:00"), row("s", "GROW OP", "2026-07-02 09:00:00")],
    [T(30, "X1", "GROW OP", "2026-07-02T16:30:00Z", [L("s")]), T(31, "X2", "GROW OP", "2026-07-02T19:30:00Z", [L("s")])],
    { pacificToday: TODAY },
  );
  ok((sh.decisions[0] as { transferId: number }).transferId === 30, "earliest received (09:00 PT = 16:00Z) used → 30");
  const sh2 = planTransferManifests(
    [row("s", "OTHER CO", "2026-07-02 09:00:00"), row("s", "GROW OP", "2026-07-02 09:00:00")],
    [T(30, "X1", "GROW OP", "2026-07-02T16:30:00Z", [L("s")])],
    { pacificToday: TODAY },
  );
  ok(!sh2.decisions[0].matched && (sh2.decisions[0] as { reason: string }).reason === "vendor_mismatch", "first row's vendor decides; mismatch refused");

  const zu = planTransferManifests([{ ...row("z", "GROW OP", "2026-07-02 09:00:00"), units: 0 }], [T(1, "A", "GROW OP", "2026-07-02T17:00:00Z", [L("z")])], {
    pacificToday: TODAY,
  });
  ok(zu.summary.lots === 0 && zu.transferGroups.length === 0, "zero-unit rows planned nowhere");

  const dst = planTransferManifests(
    [row("w", "GROW OP", "2026-01-15 09:00:00")],
    [T(40, "W1", "GROW OP", "2026-01-15T16:30:00Z", [L("w")]), T(41, "W2", "GROW OP", "2026-01-15T17:30:00Z", [L("w")])],
    { pacificToday: TODAY },
  );
  ok((dst.decisions[0] as { transferId: number }).transferId === 41, "winter offset (PST) applied");
  const dst2 = planTransferManifests(
    [row("w", "GROW OP", "2026-07-15 09:00:00")],
    [T(40, "W1", "GROW OP", "2026-07-15T16:30:00Z", [L("w")]), T(41, "W2", "GROW OP", "2026-07-15T17:30:00Z", [L("w")])],
    { pacificToday: TODAY },
  );
  ok((dst2.decisions[0] as { transferId: number }).transferId === 40, "summer offset (PDT) applied");

  const edge = (acc: string) =>
    planTransferManifests(
      [row("e", "GROW OP", "2026-07-02 09:32:00")],
      [T(50, "E1", "GROW OP", acc, [L("e")]), T(51, "E2", "GROW OP", "2026-07-09T00:00:00Z", [L("e")])],
      { pacificToday: TODAY },
    ).decisions[0] as { transferId: number };
  ok(edge("2026-07-02T16:31:00Z").transferId === 50, "exactly 60 s before → accepted");
  ok(edge("2026-07-02T16:30:59.999Z").transferId === 51, "60.001 s before → next receipt");

  const col = planTransferManifests(
    [row("c1", "GROW OP", "2026-07-02 09:00:00"), row("c2", "GROW OP", "2026-07-03 09:00:00")],
    [T(60, "DUP", "GROW OP", "2026-07-02T17:00:00Z", [L("c1")]), T(61, "dup", "GROW OP", "2026-07-03T17:00:00Z", [L("c2")])],
    { pacificToday: TODAY },
  );
  ok(col.numberCollisions.length === 1, "same number + vendor twice is a collision (case-insensitive)");
  const col2 = planTransferManifests(
    [row("c1", "GROW OP", "2026-07-02 09:00:00"), row("c2", "OTHER CO", "2026-07-03 09:00:00")],
    [T(60, "DUP", "GROW OP", "2026-07-02T17:00:00Z", [L("c1")]), T(61, "DUP", "OTHER CO", "2026-07-03T17:00:00Z", [L("c2")])],
    { pacificToday: TODAY },
  );
  ok(col2.numberCollisions.length === 0, "same number, different vendor is fine");

  const empty = planTransferManifests([], [], { pacificToday: TODAY });
  ok(empty.summary.lots === 0 && empty.transferGroups.length === 0 && empty.fallbackGroups.length === 0, "empty in, empty out");
  const noIdx = planTransferManifests(rows, [], { pacificToday: TODAY });
  ok(noIdx.summary.matched === 0 && noIdx.summary.unmatched.no_receipt === 11, "no index → everything falls back to S1");
  ok(noIdx.fallbackGroups.flatMap((g) => g.barcodes).length === 11, "…and S1 still places every lot");

  // --- keys + lineage ---
  ok(transferDedupeKey("imp1", { manifestNumber: "m-100", vendorKey: "GROW OP" }) === "M-100|GROW OP|IMPORT-imp1", "dedupe key");
  ok(transferDedupeKey("imp1", g10) !== `${g10.manifestNumber}|${g10.vendorKey}`, "never equals a live intake's key");
  const lin = buildTransferLineage({ importId: "imp1", sourceManifestId: "src", sourceManifestNumber: "POS-IMPORT-abcd1234", group: g10 });
  ok(lin.kind === RECONSTRUCTED_MANIFEST_KIND, "lineage kind = reconstructed (accounting exclusion applies)");
  ok(lin.cultivera_transfer_id === 10 && lin.cultivera_transfer_number === "M-100" && lin.rule === "cultivera-transfer", "lineage transfer");
  ok(lin.lot_count === 3 && lin.barcodes.length === 3 && lin.other_lines === 1, "lineage counts");
  lin.barcodes.push("mut");
  lin.evidence.only_receipt = 99;
  ok(g10.barcodes.length === 3 && g10.evidence.only_receipt === 2, "lineage copies, never aliases");
  ok(lin.rule_version === TRANSFER_MATCH_RULE_VERSION && lin.group_kind === "transfer", "lineage rule version");

  // --- rule v2: Cultivera's link (R50 S10) ---
  const v2T: TransferIndexEntry[] = [
    T(70, "D-70", "R&B GROUP", "2026-07-02T17:00:00Z", [L("brand1"), L("brand2"), L("brand3"), L("brand4")]),
    T(71, "D-71", "R&B GROUP", "2026-07-03T17:00:00Z", [L("brand4")]),
    T(72, "D-72", "DOPE SYNERGY", "2026-07-02T17:00:00Z", [L("own")]),
    T(73, "D-73", "DOPE SYNERGY", "2026-07-10T17:00:00Z", [L("own"), L("mix")]),
    T(74, "D-74", "DOPE SYNERGY", "2026-07-01T17:00:00Z", [L("mix")]),
  ];
  const v2Rows = [
    row("brand1", "Dope Synergy", "2026-07-02 09:00:00"), // only receipt on the distributor's transfer, linked there → accepted
    row("brand2", "Dope Synergy", "2026-07-02 09:00:00"), // same, but NO link → refused (never guess)
    row("brand3", "Dope Synergy", "2026-07-02 09:00:00"), // linked to ANOTHER transfer → refused
    row("brand4", "Dope Synergy", "2026-07-02 09:00:00"), // two receipts, both the distributor's → alias not allowed
    row("own", "DOPE SYNERGY", "2026-07-02 09:00:00"), // re-received on 73: filed on 72, alsoOn [73]; link says 73 → differ
    row("mix", "DOPE SYNERGY", "2026-06-30 09:00:00"), // first after received = 74; link 74 + 73 → agree; alsoOn [73]
    row("solo", "DOPE SYNERGY", "2026-07-02 09:00:00"), // no receipt, but Cultivera linked it → unmatchedLinked
  ];
  const v2Links = new Map<string, number[]>([
    ["brand1", [70]],
    ["brand3", [72]],
    ["brand4", [71]],
    ["own", [73]],
    ["mix", [73, 74]],
    ["solo", [72]],
  ]);
  const v2 = planTransferManifests(v2Rows, v2T, { pacificToday: TODAY, links: v2Links });
  const v2d = new Map(v2.decisions.map((d) => [d.barcode, d]));
  const vm2 = (b: string) => v2d.get(b) as Extract<LotTransferDecision, { matched: true }>;
  const vu2 = (b: string) => v2d.get(b) as Extract<LotTransferDecision, { matched: false }>;
  ok(vm2("brand1").matched && vm2("brand1").transferId === 70 && vm2("brand1").vendorByLink && vm2("brand1").link === "agree", "v2: link-confirmed vendor alias");
  ok(!vu2("brand2").matched && vu2("brand2").reason === "vendor_mismatch" && vu2("brand2").link === "none", "v2: alias without a link refused");
  ok(!vu2("brand3").matched && vu2("brand3").reason === "vendor_mismatch" && vu2("brand3").link === "differ", "v2: link to another transfer refused");
  ok(!vu2("brand4").matched && vu2("brand4").reason === "vendor_mismatch", "v2: alias only for a single receipt");
  ok(vm2("own").transferId === 72 && !vm2("own").vendorByLink && vm2("own").link === "differ", "v2: first receipt wins over the link");
  ok(JSON.stringify(vm2("own").alsoOn) === "[73]", "v2: alsoOn records the other receipt");
  ok(vm2("mix").transferId === 74 && vm2("mix").link === "agree" && JSON.stringify(vm2("mix").alsoOn) === "[73]", "v2: multi-link agree");
  ok(!vu2("solo").matched && vu2("solo").link === "differ", "v2: unmatched but linked is flagged");
  ok(JSON.stringify(vm2("brand1").alsoOn) === "[]", "v2: single receipt has no alsoOn");
  ok(v2.summary.matchedVendorByLink === 1 && v2.summary.lotsAlsoOn === 2, "v2: summary alias + alsoOn");
  ok(JSON.stringify(v2.summary.link) === JSON.stringify({ agree: 2, differ: 1, none: 0, unmatchedLinked: 3 }), "v2: link agreement summary");
  const g70 = v2.transferGroups.find((g) => g.transferId === 70)!;
  ok(g70.vendorKey === "R&B GROUP" && JSON.stringify(g70.vendorByLink) === JSON.stringify(["brand1"]), "v2: manifest keeps the shipper's vendor");
  const g72 = v2.transferGroups.find((g) => g.transferId === 72)!;
  ok(JSON.stringify(g72.alsoOn) === JSON.stringify({ own: [73] }), "v2: group alsoOn");
  const lin72 = buildTransferLineage({ importId: "i", sourceManifestId: "s", sourceManifestNumber: "n", group: g72 });
  ok(JSON.stringify(lin72.also_on) === JSON.stringify({ own: [73] }) && JSON.stringify(lin72.vendor_by_link) === "[]", "v2: lineage also_on");
  lin72.also_on.own.push(999);
  ok(g72.alsoOn.own.length === 1, "v2: lineage also_on is a deep copy");
  const lin70 = buildTransferLineage({ importId: "i", sourceManifestId: "s", sourceManifestNumber: "n", group: g70 });
  lin70.vendor_by_link.push("x");
  ok(g70.vendorByLink.length === 1, "v2: lineage vendor_by_link is a copy");
  const noLinks = planTransferManifests(v2Rows, v2T, { pacificToday: TODAY });
  ok(noLinks.summary.matchedVendorByLink === 0 && (noLinks.decisions.find((d) => d.barcode === "brand1") as { reason?: string }).reason === "vendor_mismatch", "v2: no links → v1 answers");
  ok(JSON.stringify(noLinks.summary.link) === JSON.stringify({ agree: 0, differ: 0, none: 2, unmatchedLinked: 0 }), "v2: no links → all none");
  const v2r = planTransferManifests([...v2Rows].reverse(), [...v2T].reverse(), { pacificToday: TODAY, links: v2Links });
  ok(JSON.stringify(v2r.transferGroups) === JSON.stringify(v2.transferGroups), "v2: reorder-invariant");

  // --- adapters ---
  const ti = transferIndexFromDetails([
    {
      Id: 5,
      TransferNumber: "N5",
      FromVendor: "  GROW   OP ",
      VendorNo: "601",
      TransferDate: "2026-07-01T15:00:00Z",
      DateAccepted: "2026-07-02T17:00:00.5Z",
      StatusDisplay: "Accepted",
      IsManualCreated: true,
      Details: [
        { Barcode: " b2 ", AcceptedQuantity: 3, Quantity: 4, IsSample: false },
        { Barcode: "b1", AcceptedQuantity: "2", Quantity: null, IsSample: true },
        { Barcode: "", AcceptedQuantity: 9 },
        { Barcode: null, AcceptedQuantity: 9 },
        { Barcode: "b1", AcceptedQuantity: 1, Quantity: 1 },
        null,
      ],
    },
    { Id: 3, TransferNumber: null, FromVendor: null, DateAccepted: null, Details: null },
    { Id: "7" },
    { Id: 0 },
    { Id: 2.5 },
    null,
    { Id: 3, TransferNumber: "N3b", FromVendor: "X", DateAccepted: null, StatusDisplay: "Pending", Details: [] },
  ]);
  ok(ti.skipped === 4 && ti.duplicates === 1, "adapter: bad ids skipped, duplicate counted");
  ok(ti.transfers.map((t) => t.id).join(",") === "3,5", "adapter: sorted by id");
  ok(ti.transfers[0].number === "N3b" && ti.transfers[0].status === "Pending" && ti.transfers[0].acceptedAt === null, "adapter: last duplicate wins");
  const t5 = ti.transfers[1];
  ok(t5.vendor === "GROW OP" && t5.number === "N5" && t5.vendorNo === "601" && t5.manual === true && t5.internal === false, "adapter: header fields");
  ok(t5.acceptedAt === "2026-07-02T17:00:00.5Z" && t5.transferDate === "2026-07-01T15:00:00Z", "adapter: stamps verbatim");
  ok(JSON.stringify(t5.lines) === JSON.stringify([["b1", 1, 1, false], ["b1", 2, 0, true], ["b2", 3, 4, false]]), "adapter: lines trimmed, blank dropped, sorted");
  const tiBad = transferIndexFromDetails([{ Id: 1, Details: [{ Barcode: "q", AcceptedQuantity: "abc", Quantity: Infinity }] }]);
  ok(JSON.stringify(tiBad.transfers[0].lines[0]) === JSON.stringify(["q", 0, 0, false]), "adapter: junk quantities → 0 (not a receipt)");
  ok(tiBad.transfers[0].vendor === "" && tiBad.transfers[0].acceptedAt === null, "adapter: missing fields blank/null");

  const lk = linksFromListLots([
    { Barcode: "a", IncomingTransferId: 9 },
    { Barcode: " a ", IncomingTransferId: 4 },
    { Barcode: "a", IncomingTransferId: 9 },
    { Barcode: "b", IncomingTransferId: null },
    { Barcode: "c", IncomingTransferId: 0 },
    { Barcode: "d", IncomingTransferId: "5" },
    { Barcode: "", IncomingTransferId: 5 },
    { Barcode: 123, IncomingTransferId: 6 },
    { Barcode: "e", IncomingTransferId: 1.5 },
  ]);
  ok(JSON.stringify([...lk]) === JSON.stringify([["a", [4, 9]], ["123", [6]]]), "links: distinct, sorted, junk ignored");

  // --- manifestPlanGate ---
  const vOf = (rs: CultiveraGroupRow[]) => {
    const m = new Map<string, string>();
    for (const r of rs) if (!m.has(String(r.barcode).trim())) m.set(String(r.barcode).trim(), cultiveraVendorKey(r.vendor));
    return m;
  };
  const gOk = manifestPlanGate(v2, vOf(v2Rows), v2Links);
  ok(!gOk.pass && gOk.problems.length === 1 && gOk.problems[0].startsWith("3 lots Cultivera linked"), "gate: unmatched-but-linked fails");
  ok(JSON.stringify(gOk.multiReceiptDiffers) === JSON.stringify([{ barcode: "own", transferId: 72, linkIds: [73] }]), "gate: multi-receipt differ listed");
  const cleanLinks = new Map<string, number[]>([["brand1", [70]], ["own", [73]], ["mix", [73, 74]]]);
  const cleanRows = v2Rows.filter((r) => ["brand1", "own", "mix", "brand2"].includes(String(r.barcode)));
  const cleanPlan = planTransferManifests(cleanRows, v2T, { pacificToday: TODAY, links: cleanLinks });
  const gClean = manifestPlanGate(cleanPlan, vOf(cleanRows), cleanLinks);
  ok(gClean.pass && gClean.problems.length === 0, "gate: clean plan passes (alias + multi differ are not errors)");
  ok(gClean.detail.includes("1 by Cultivera's link") && gClean.detail.includes("filed on first receipt 1"), "gate: detail names alias + differ");
  ok(!manifestPlanGate(cleanPlan, vOf(cleanRows), new Map()).pass, "gate: no links at all fails");
  ok(manifestPlanGate(planTransferManifests([], [], { pacificToday: TODAY }), new Map(), new Map()).pass, "gate: empty plan with no links passes");
  const badV = new Map(vOf(cleanRows));
  badV.set("own", "SOMEONE ELSE");
  ok(manifestPlanGate(cleanPlan, badV, cleanLinks).problems.some((x) => x.includes("1 lots on another vendor")), "gate: vendor mixing fails");
  const badFbV = new Map(vOf(cleanRows));
  badFbV.set("brand2", "SOMEONE ELSE");
  ok(manifestPlanGate(cleanPlan, badFbV, cleanLinks).problems.some((x) => x.includes("another vendor")), "gate: fallback vendor mixing fails");
  const sdLinks = new Map(cleanLinks);
  sdLinks.set("brand1", [72]);
  const sdPlan = planTransferManifests(cleanRows.filter((r) => r.barcode !== "brand1").concat([row("brand1", "R&B GROUP", "2026-07-02 09:00:00")]), v2T, { pacificToday: TODAY, links: sdLinks });
  ok(manifestPlanGate(sdPlan, vOf(cleanRows.filter((r) => r.barcode !== "brand1").concat([row("brand1", "R&B GROUP", "2026-07-02 09:00:00")])), sdLinks).problems.some((x) => x.includes("1 single-receipt lots disagree")), "gate: single-receipt link disagreement fails");
  const dupPlan = { ...cleanPlan, transferGroups: [...cleanPlan.transferGroups, cleanPlan.transferGroups[0]] };
  ok(manifestPlanGate(dupPlan, vOf(cleanRows), cleanLinks).problems.some((x) => x.includes("placements")), "gate: double placement fails");
  const colPlan = { ...cleanPlan, numberCollisions: ["X"] };
  ok(manifestPlanGate(colPlan, vOf(cleanRows), cleanLinks).problems.some((x) => x.includes("collisions: X")), "gate: collision fails");

  return { passed, failed: 0 };
}
