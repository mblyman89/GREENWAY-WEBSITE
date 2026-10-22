/**
 * R50 S2c — the re-home executor's PURE core.
 *
 * Turns the manifest plan (real Cultivera transfers + S1 fallback groups) and
 * the lots that the import actually created into:
 *   1. the inbound_manifests rows to create (one per group, idempotent by
 *      dedupe_key, full lineage in raw_payload, bible §1.3b date/vendor rules);
 *   2. which lot moves to which manifest (only lots still on the import's
 *      POS-IMPORT manifest ever move; the store guards that with
 *      `.eq("manifest_id", source)`);
 *   3. control totals (lots, on-hand units, received units, cost value) that
 *      must be identical before and after, plus "every lot on exactly one
 *      manifest" (enterprise migration practice: record counts + control
 *      totals + an exception log, repeatable rules, rehearsal).
 *
 * Nothing here talks to the database. Only `inventory_lots.manifest_id`
 * changes on Apply: no quantity, cost, status, date or vendor of a lot is
 * touched, so the menu and the register never lose an item.
 */
import {
  DEFAULT_GAP_MINUTES,
  RECONSTRUCTED_MANIFEST_KIND,
  buildReconstructedLineage,
  cultiveraVendorKey,
  reconstructedDedupeKey,
  reconstructedGroupTitle,
  type ReconstructedGroup,
} from "@/lib/inventory/cultivera-manifest-group-core";
import {
  buildTransferLineage,
  linksFromListLots,
  manifestPlanGate,
  planTransferManifests,
  transferDedupeKey,
  transferIndexFromDetails,
  type ManifestPlanGate,
  type TransferGroup,
  type TransferIndexEntry,
  type TransferMatchPlan,
} from "@/lib/inventory/cultivera-transfer-match-core";

export const REHOME_RULE_VERSION = 1;
/** Lots per guarded UPDATE: 150 uuids keep the PATCH URL under ~6 KB (same budget as LINEAGE_MANIFEST_CHUNK). */
export const REHOME_MOVE_BATCH = 150;
/** The manifest_events type written on each rebuilt manifest. */
export const REHOME_EVENT_TYPE = "accepted";

/** Cultivera transfer status → our manifest status. Anything else is refused (never guessed). */
const STATUS_MAP: Readonly<Record<string, "accepted" | "partially_accepted">> = {
  ACCEPTED: "accepted",
  "PARTIALLY ACCEPTED": "partially_accepted",
};

export function mapCultiveraStatus(raw: string | null | undefined): "accepted" | "partially_accepted" | null {
  const k = (raw ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  return STATUS_MAP[k] ?? null;
}

const UTC_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A valid UTC instant normalised to ISO (ms precision), or null. */
export function normalizeUtcInstant(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!UTC_INSTANT_RE.test(s)) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  // Reject calendar overflow (e.g. 2024-02-30 rolls into March).
  if (d.toISOString().slice(0, 10) !== s.slice(0, 10)) return null;
  return d.toISOString();
}

/** The Pacific calendar day (YYYY-MM-DD) of a UTC instant (DST-aware). */
export function pacificDayOfInstant(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/**
 * Cultivera's TransferDate → transfer_date. Cultivera sends an instant with Z
 * (e.g. "2024-08-30T15:00:00Z"); measured on all 1,158 accepted transfers the
 * PACIFIC day of it falls after the acceptance day 6 times, the raw UTC day 31
 * times, so the Pacific day is the store's calendar day. A bare day is kept.
 * Anything else → null (the raw value is still kept in raw_payload).
 */
export function transferDateDay(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (DAY_RE.test(s)) {
    const d = new Date(`${s}T12:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
  }
  const iso = normalizeUtcInstant(s);
  return iso ? pacificDayOfInstant(iso) : null;
}

/* ------------------------------------------------------------------ *
 * The plan, from the same sources the import used
 * ------------------------------------------------------------------ */

/** The lot-source fields the plan reads (transform.ts `lotSources`). */
export type PlanLotSource = { barcode: string; vendor: string; receivedDateRaw: string | null; units: number; productName: string };

/**
 * The plan's non-workbook inputs, persisted at import time so Apply can run
 * after the crawler prunes the run (it keeps 12). No prices: the transfer
 * index carries barcodes, quantities and dates only (same as TRANSFERS_INDEX).
 */
export type RehomePlanInputs = {
  version: 1;
  importId: string;
  runId: string;
  pacificToday: string;
  transfers: TransferIndexEntry[];
  /** [barcode, IncomingTransferId[]] from the list API. */
  links: [string, number[]][];
  indexSkipped: number;
  indexDuplicates: number;
};

export function buildPlanInputs(args: {
  importId: string;
  runId: string;
  pacificToday: string;
  transferDetails: readonly unknown[];
  listLots: readonly { Barcode?: unknown; IncomingTransferId?: unknown }[];
}): RehomePlanInputs {
  const idx = transferIndexFromDetails(args.transferDetails);
  const links = [...linksFromListLots(args.listLots).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    version: 1,
    importId: args.importId,
    runId: args.runId,
    pacificToday: args.pacificToday,
    transfers: idx.transfers,
    links,
    indexSkipped: idx.skipped,
    indexDuplicates: idx.duplicates,
  };
}

/** Problems with a persisted inputs file (empty = usable for this import). */
export function checkPlanInputs(raw: unknown, importId: string): string[] {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<RehomePlanInputs>;
  const out: string[] = [];
  if (o.version !== 1) out.push("unknown plan-inputs version");
  if (o.importId !== importId) out.push("the saved plan inputs belong to another import");
  if (typeof o.pacificToday !== "string" || !DAY_RE.test(o.pacificToday)) out.push("the saved plan inputs have no harvest day");
  if (!Array.isArray(o.transfers)) out.push("the saved plan inputs have no transfers");
  if (!Array.isArray(o.links)) out.push("the saved plan inputs have no links");
  return out;
}

export type PlanFromSources = { plan: TransferMatchPlan; gate: ManifestPlanGate };

/**
 * THE plan: planTransferManifests + manifestPlanGate over the transform's
 * lot sources. The Fetch It All preview (buildManifestPlanReport) and Apply
 * both call this, so what the manager approved is what runs.
 */
export function planFromSources(
  lotSources: readonly PlanLotSource[],
  transfers: readonly TransferIndexEntry[],
  links: ReadonlyMap<string, readonly number[]>,
  pacificToday: string,
  indexSkipped = 0,
): PlanFromSources {
  const rows = lotSources.map((s) => ({
    barcode: s.barcode,
    vendor: s.vendor,
    receivedDateRaw: s.receivedDateRaw,
    units: s.units,
    productName: s.productName,
  }));
  const plan = planTransferManifests(rows, transfers, { pacificToday, links });
  const vendorOf = new Map<string, string>();
  for (const r of rows) {
    const b = (r.barcode ?? "").trim();
    if (b && !vendorOf.has(b)) vendorOf.set(b, cultiveraVendorKey(r.vendor));
  }
  const gate = manifestPlanGate(plan, vendorOf, links);
  if (indexSkipped <= 0) return { plan, gate };
  const problems = [...gate.problems, `${indexSkipped} transfer records without an id`];
  return { plan, gate: { ...gate, pass: false, problems, detail: `${gate.detail}; ${indexSkipped} transfer records without an id` } };
}

/* ------------------------------------------------------------------ *
 * Inputs
 * ------------------------------------------------------------------ */

/** The inventory_lots columns the executor reads. */
export type RehomeLot = {
  id: string;
  manifest_id: string | null;
  ccrs_inventory_external_id: string | null;
  vendor_id: string | null;
  on_hand_qty: number | string | null;
  received_qty: number | string | null;
  unit_cost_minor_units: number | null;
  status: string | null;
};

export const REHOME_LOT_SELECT =
  "id, manifest_id, ccrs_inventory_external_id, vendor_id, on_hand_qty, received_qty, unit_cost_minor_units, status";

/** An inbound_manifests row that already carries one of our dedupe keys. */
export type ExistingManifest = {
  id: string;
  dedupe_key: string | null;
  payload_kind: string | null;
  payload_import_id: string | null;
  /** raw_payload.group_kind (transfer / session / day / undated / email / unmatched). */
  payload_group_kind?: string | null;
};

/**
 * R74 S10: group kinds written by the email step (cultivera-mail-apply). A lot sitting on one of
 * this import's manifests of these kinds was placed there by the email step on purpose; the
 * re-home leaves it alone (never moves it back, never refuses because of it).
 */
export const MAIL_STEP_GROUP_KINDS: readonly string[] = Object.freeze(["email", "unmatched"]);
/** The S1 fallback kinds (rebuilt from Received dates); the email step may move lots off these. */
export const FALLBACK_GROUP_KINDS: readonly string[] = Object.freeze(["session", "day", "undated"]);

/** This import's email-step manifest (kind + import id + group kind all exact). */
export function isMailStepManifest(m: Pick<ExistingManifest, "payload_kind" | "payload_import_id" | "payload_group_kind">, importId: string): boolean {
  return m.payload_kind === RECONSTRUCTED_MANIFEST_KIND && m.payload_import_id === importId && MAIL_STEP_GROUP_KINDS.includes(m.payload_group_kind ?? "");
}

/** Flat projection: never pulls the (large) raw_payload. */
/** PostgREST `.or()` keeping every manifest that is NOT rebuilt from Cultivera (null-safe: a bare `neq` drops kind-less rows). */
export const NOT_REBUILT_OR = `raw_payload->>kind.is.null,raw_payload->>kind.neq.${RECONSTRUCTED_MANIFEST_KIND}`;
export function isRebuiltKind(kind: unknown): boolean {
  return kind === RECONSTRUCTED_MANIFEST_KIND;
}
export const REHOME_EXISTING_SELECT =
  "id, dedupe_key, payload_kind:raw_payload->>kind, payload_import_id:raw_payload->>import_id, payload_group_kind:raw_payload->>group_kind";

export type RehomeInput = {
  importId: string;
  source: { id: string; manifestNumber: string };
  plan: TransferMatchPlan;
  /** Every lot currently on ANY manifest of this import (source + already-rebuilt). */
  lots: readonly RehomeLot[];
  /** Manifests found by the planned dedupe keys (from a previous, possibly interrupted, Apply). */
  existing: readonly ExistingManifest[];
  /** The gate verdict of the same plan (manifestPlanGate / buildManifestPlanReport). */
  gatePass: boolean;
  gateProblems?: readonly string[];
  gapMinutes?: number;
  actorId?: string | null;
};

/* ------------------------------------------------------------------ *
 * Outputs
 * ------------------------------------------------------------------ */

export type ManifestInsertRow = {
  manifest_number: string;
  vendor_id: string | null;
  vendor_label: string;
  transfer_date: string | null;
  status: "accepted" | "partially_accepted";
  accepted_at: string | null;
  received_at: string | null;
  accepted_lot_count: number;
  dedupe_key: string;
  raw_payload: Record<string, unknown>;
  notes: string;
  created_by: string | null;
  updated_by: string | null;
};

export type PlannedManifest = {
  dedupeKey: string;
  groupKey: string;
  source: "transfer" | "session" | "day" | "undated";
  title: string;
  /** The existing manifest id when a previous Apply already created it. */
  existingId: string | null;
  row: ManifestInsertRow;
  /** Lot ids that belong here (already here or to be moved). */
  lotIds: string[];
};

export type RehomeExceptionCode =
  | "planned_barcode_without_lot"
  | "lot_not_in_plan"
  | "lot_on_foreign_manifest"
  | "transfer_date_after_acceptance";

export type RehomeException = { code: RehomeExceptionCode; detail: string };

export type ControlTotals = {
  lots: number;
  onHandUnits: number;
  receivedUnits: number;
  /** Σ on_hand × unit cost (minor units), rounded per lot to whole cents. */
  costValueCents: number;
};

export type MoveBatch = { targetDedupeKey: string; lotIds: string[] };

export type RehomePlan = {
  ok: boolean;
  /** Why Apply is refused (empty when ok). */
  refusals: string[];
  manifests: PlannedManifest[];
  moves: MoveBatch[];
  exceptions: RehomeException[];
  totals: ControlTotals;
  summary: {
    manifestsPlanned: number;
    manifestsToCreate: number;
    manifestsAlreadyCreated: number;
    transferManifests: number;
    rebuiltManifests: number;
    lotsToMove: number;
    lotsAlreadyHome: number;
    lotsStayOnSource: number;
    /** R74 S10: lots the email step already placed (left alone). */
    lotsPlacedByEmail: number;
    vendorIdsSet: number;
    exceptionCounts: Record<RehomeExceptionCode, number>;
  };
};

function num(v: number | string | null | undefined): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Control totals over a set of lots (the same set before and after Apply). */
export function controlTotals(lots: readonly RehomeLot[]): ControlTotals {
  let onHand = 0;
  let received = 0;
  let cents = 0;
  for (const l of lots) {
    const oh = num(l.on_hand_qty);
    onHand += oh;
    received += num(l.received_qty);
    cents += Math.round(oh * num(l.unit_cost_minor_units));
  }
  // Quantities are numeric(…) in Postgres: round away float noise at 6 dp.
  const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
  return { lots: lots.length, onHandUnits: r6(onHand), receivedUnits: r6(received), costValueCents: cents };
}

export function compareTotals(before: ControlTotals, after: ControlTotals): string[] {
  const out: string[] = [];
  if (before.lots !== after.lots) out.push(`lot count ${before.lots} → ${after.lots}`);
  if (before.onHandUnits !== after.onHandUnits) out.push(`on-hand units ${before.onHandUnits} → ${after.onHandUnits}`);
  if (before.receivedUnits !== after.receivedUnits) out.push(`received units ${before.receivedUnits} → ${after.receivedUnits}`);
  if (before.costValueCents !== after.costValueCents) out.push(`cost value ${before.costValueCents}¢ → ${after.costValueCents}¢`);
  return out;
}

function emptyExceptionCounts(): Record<RehomeExceptionCode, number> {
  return { planned_barcode_without_lot: 0, lot_not_in_plan: 0, lot_on_foreign_manifest: 0, transfer_date_after_acceptance: 0 };
}

/** §1.3b vendor rule: one shared non-null vendor id and no vendor-by-link lot, else null. */
export function sharedVendorId(lots: readonly Pick<RehomeLot, "vendor_id">[], vendorByLinkCount: number): string | null {
  if (vendorByLinkCount > 0 || lots.length === 0) return null;
  const first = lots[0].vendor_id;
  if (!first) return null;
  return lots.every((l) => l.vendor_id === first) ? first : null;
}

function transferRow(
  input: RehomeInput,
  g: TransferGroup,
  status: "accepted" | "partially_accepted",
  acceptedAt: string,
  vendorId: string | null,
  lotCount: number,
): ManifestInsertRow {
  const lineage = buildTransferLineage({
    importId: input.importId,
    sourceManifestId: input.source.id,
    sourceManifestNumber: input.source.manifestNumber,
    group: g,
  });
  return {
    manifest_number: g.manifestNumber,
    vendor_id: vendorId,
    vendor_label: g.vendorLabel,
    transfer_date: transferDateDay(g.transferDate),
    status,
    accepted_at: acceptedAt,
    received_at: acceptedAt,
    accepted_lot_count: lotCount,
    dedupe_key: transferDedupeKey(input.importId, g),
    raw_payload: { ...lineage, executor_rule_version: REHOME_RULE_VERSION },
    notes:
      `Rebuilt from Cultivera transfer ${g.manifestNumber} (accepted ${acceptedAt}) during the one-time Cultivera migration. ` +
      `Opening inventory, not a purchase: payables, Sage and vendor bills skip it.`,
    created_by: input.actorId ?? null,
    updated_by: input.actorId ?? null,
  };
}

function fallbackRow(input: RehomeInput, g: ReconstructedGroup, vendorId: string | null, lotCount: number): ManifestInsertRow {
  const gap = input.gapMinutes ?? DEFAULT_GAP_MINUTES;
  const lineage = buildReconstructedLineage({
    importId: input.importId,
    sourceManifestId: input.source.id,
    sourceManifestNumber: input.source.manifestNumber,
    gapMinutes: gap,
    group: g,
  });
  const instant = g.kind === "session" ? normalizeUtcInstant(g.startUtcIso) : null;
  return {
    manifest_number: g.manifestNumber,
    vendor_id: vendorId,
    vendor_label: g.vendorLabel,
    transfer_date: g.kind === "undated" ? null : g.day,
    status: "accepted",
    accepted_at: instant,
    received_at: instant,
    accepted_lot_count: lotCount,
    dedupe_key: reconstructedDedupeKey(input.importId, g),
    raw_payload: { ...lineage, executor_rule_version: REHOME_RULE_VERSION },
    notes:
      `Rebuilt from the Cultivera export's Received dates (${g.kind}) during the one-time Cultivera migration; ` +
      `no Cultivera transfer could be matched. Opening inventory, not a purchase.`,
    created_by: input.actorId ?? null,
    updated_by: input.actorId ?? null,
  };
}

/** Every dedupe key the plan could create (to look up in the DB before Apply). */
export function plannedDedupeKeys(importId: string, plan: Pick<TransferMatchPlan, "transferGroups" | "fallbackGroups">): string[] {
  return [
    ...plan.transferGroups.map((g) => transferDedupeKey(importId, g)),
    ...plan.fallbackGroups.map((g) => reconstructedDedupeKey(importId, g)),
  ];
}

/**
 * Build the whole Apply from facts. PURE and deterministic. Re-running it after
 * a partial Apply yields only the remaining work (idempotent / resumable).
 */
export function planRehome(input: RehomeInput): RehomePlan {
  const refusals: string[] = [];
  const exceptions: RehomeException[] = [];
  const exceptionCounts = emptyExceptionCounts();
  const addEx = (code: RehomeExceptionCode, detail: string) => {
    exceptionCounts[code] += 1;
    if (exceptions.length < 500) exceptions.push({ code, detail });
  };

  if (!input.gatePass) refusals.push(`the manifest plan failed its checks: ${(input.gateProblems ?? []).join("; ") || "see the plan report"}`);
  if (input.plan.numberCollisions.length > 0) refusals.push(`manifest number collisions: ${input.plan.numberCollisions.slice(0, 5).join(", ")}`);
  if (!input.source.id) refusals.push("the import's POS-IMPORT manifest was not found");

  // Lots by barcode (= ccrs_inventory_external_id, trimmed, as createImportLots stored it).
  const lotsByBarcode = new Map<string, RehomeLot[]>();
  const lotIds = new Set<string>();
  for (const l of input.lots) {
    if (lotIds.has(l.id)) {
      refusals.push(`lot ${l.id} was read twice`);
      continue;
    }
    lotIds.add(l.id);
    const b = (l.ccrs_inventory_external_id ?? "").trim();
    if (!b) continue;
    const list = lotsByBarcode.get(b) ?? [];
    list.push(l);
    lotsByBarcode.set(b, list);
  }
  const dupBarcodes = [...lotsByBarcode.entries()].filter(([, ls]) => ls.length > 1).map(([b]) => b);
  if (dupBarcodes.length > 0) refusals.push(`${dupBarcodes.length} barcodes are on more than one lot (${dupBarcodes.slice(0, 5).join(", ")})`);

  const existingByKey = new Map<string, ExistingManifest>();
  for (const m of input.existing) if (m.dedupe_key) existingByKey.set(m.dedupe_key, m);
  // R74 S10: lots on this import's email-step manifests are home already (email or CV-UNMATCHED).
  const placedByEmail = new Set(input.existing.filter((m) => isMailStepManifest(m, input.importId)).map((m) => m.id));
  const onEmailStep = (l: RehomeLot) => l.manifest_id != null && placedByEmail.has(l.manifest_id);

  const manifests: PlannedManifest[] = [];
  const keys = new Set<string>();
  const homeOf = new Map<string, string>(); // lot id → dedupe key
  let vendorIdsSet = 0;

  const attach = (barcodes: readonly string[]): RehomeLot[] => {
    const out: RehomeLot[] = [];
    for (const b of barcodes) {
      const ls = lotsByBarcode.get(b);
      if (!ls || ls.length === 0) {
        addEx("planned_barcode_without_lot", b);
        continue;
      }
      if (onEmailStep(ls[0])) continue;
      out.push(ls[0]);
    }
    return out;
  };

  const register = (pm: Omit<PlannedManifest, "existingId">, lots: RehomeLot[]) => {
    if (keys.has(pm.dedupeKey)) {
      refusals.push(`two groups share the dedupe key ${pm.dedupeKey}`);
      return;
    }
    keys.add(pm.dedupeKey);
    const ex = existingByKey.get(pm.dedupeKey);
    let existingId: string | null = null;
    if (ex) {
      if (ex.payload_kind !== RECONSTRUCTED_MANIFEST_KIND || ex.payload_import_id !== input.importId) {
        refusals.push(`manifest ${ex.id} already holds the key ${pm.dedupeKey} but is not this import's rebuilt manifest`);
        return;
      }
      existingId = ex.id;
    }
    for (const l of lots) homeOf.set(l.id, pm.dedupeKey);
    if (pm.row.vendor_id) vendorIdsSet += 1;
    manifests.push({ ...pm, existingId });
  };

  for (const g of input.plan.transferGroups) {
    const lots = attach(g.barcodes);
    if (lots.length === 0) continue;
    const status = mapCultiveraStatus(g.status);
    const acceptedAt = normalizeUtcInstant(g.acceptedAt);
    if (!status) {
      refusals.push(`transfer ${g.transferId} has status "${g.status}", which has no Greenway equivalent`);
      continue;
    }
    if (!acceptedAt) {
      refusals.push(`transfer ${g.transferId} has no readable acceptance time ("${g.acceptedAt}")`);
      continue;
    }
    const day = transferDateDay(g.transferDate);
    if (day && day > pacificDayOfInstant(acceptedAt)) addEx("transfer_date_after_acceptance", `${g.manifestNumber} (${g.transferId})`);
    const row = transferRow(input, g, status, acceptedAt, sharedVendorId(lots, g.vendorByLink.length), lots.length);
    register(
      { dedupeKey: row.dedupe_key, groupKey: g.key, source: "transfer", title: `${g.vendorLabel} · ${g.manifestNumber} · ${lots.length} item${lots.length === 1 ? "" : "s"}`, row, lotIds: lots.map((l) => l.id) },
      lots,
    );
  }
  for (const g of input.plan.fallbackGroups) {
    const lots = attach(g.barcodes);
    if (lots.length === 0) continue;
    if (g.kind === "session" && !normalizeUtcInstant(g.startUtcIso)) {
      refusals.push(`rebuilt group ${g.key} has no readable start time`);
      continue;
    }
    const row = fallbackRow(input, g, sharedVendorId(lots, 0), lots.length);
    register({ dedupeKey: row.dedupe_key, groupKey: g.key, source: g.kind, title: reconstructedGroupTitle(g), row, lotIds: lots.map((l) => l.id) }, lots);
  }

  // Who moves. Only lots on the source manifest ever move.
  const idByKey = new Map<string, string | null>(manifests.map((m) => [m.dedupeKey, m.existingId]));
  const pending = new Map<string, string[]>();
  let lotsToMove = 0;
  let lotsAlreadyHome = 0;
  let lotsStayOnSource = 0;
  let lotsPlacedByEmail = 0;
  for (const l of input.lots) {
    if (onEmailStep(l)) {
      lotsPlacedByEmail += 1;
      continue;
    }
    const key = homeOf.get(l.id);
    if (!key) {
      if (l.manifest_id === input.source.id) {
        lotsStayOnSource += 1;
        addEx("lot_not_in_plan", (l.ccrs_inventory_external_id ?? "").trim() || l.id);
      } else {
        addEx("lot_on_foreign_manifest", `${(l.ccrs_inventory_external_id ?? "").trim() || l.id} is on ${l.manifest_id ?? "no manifest"}`);
      }
      continue;
    }
    const targetId = idByKey.get(key) ?? null;
    if (targetId && l.manifest_id === targetId) {
      lotsAlreadyHome += 1;
      continue;
    }
    if (l.manifest_id !== input.source.id) {
      addEx("lot_on_foreign_manifest", `${(l.ccrs_inventory_external_id ?? "").trim() || l.id} is on ${l.manifest_id ?? "no manifest"}`);
      continue;
    }
    lotsToMove += 1;
    const list = pending.get(key) ?? [];
    list.push(l.id);
    pending.set(key, list);
  }
  if (exceptionCounts.lot_on_foreign_manifest > 0)
    refusals.push(`${exceptionCounts.lot_on_foreign_manifest} lots sit on a manifest that is neither the import manifest nor their planned one`);

  const moves: MoveBatch[] = [];
  for (const m of manifests) {
    const ids = (pending.get(m.dedupeKey) ?? []).slice().sort();
    for (let i = 0; i < ids.length; i += REHOME_MOVE_BATCH) moves.push({ targetDedupeKey: m.dedupeKey, lotIds: ids.slice(i, i + REHOME_MOVE_BATCH) });
  }

  const toCreate = manifests.filter((m) => !m.existingId).length;
  return {
    ok: refusals.length === 0,
    refusals,
    manifests,
    moves,
    exceptions,
    totals: controlTotals(input.lots),
    summary: {
      manifestsPlanned: manifests.length,
      manifestsToCreate: toCreate,
      manifestsAlreadyCreated: manifests.length - toCreate,
      transferManifests: manifests.filter((m) => m.source === "transfer").length,
      rebuiltManifests: manifests.filter((m) => m.source !== "transfer").length,
      lotsToMove,
      lotsAlreadyHome,
      lotsStayOnSource,
      lotsPlacedByEmail,
      vendorIdsSet,
      exceptionCounts,
    },
  };
}

/**
 * After Apply: every lot is on exactly one manifest of this import, each
 * planned lot on its planned manifest, totals identical. Returns problems
 * (empty = verified).
 */
export function verifyRehome(args: {
  before: ControlTotals;
  afterLots: readonly RehomeLot[];
  manifestIdByKey: ReadonlyMap<string, string>;
  plan: Pick<RehomePlan, "manifests">;
  sourceId: string;
}): string[] {
  const problems = compareTotals(args.before, controlTotals(args.afterLots));
  const byId = new Map<string, RehomeLot>();
  for (const l of args.afterLots) {
    if (byId.has(l.id)) problems.push(`lot ${l.id} appears twice`);
    byId.set(l.id, l);
  }
  let misplaced = 0;
  let missing = 0;
  for (const m of args.plan.manifests) {
    const target = args.manifestIdByKey.get(m.dedupeKey);
    if (!target) {
      problems.push(`manifest for ${m.dedupeKey} was not created`);
      continue;
    }
    for (const id of m.lotIds) {
      const l = byId.get(id);
      if (!l) missing += 1;
      else if (l.manifest_id !== target) misplaced += 1;
    }
  }
  if (missing > 0) problems.push(`${missing} planned lots were not found after Apply`);
  if (misplaced > 0) problems.push(`${misplaced} lots are not on their planned manifest`);
  return problems;
}

/* ------------------------------------------------------------------ *
 * Self-tests
 * ------------------------------------------------------------------ */

export function __runCultiveraRehomeCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: unknown, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  ✗ cultivera-rehome-core: ${msg}`);
    }
  };

  // Status / dates
  ok(mapCultiveraStatus("Accepted") === "accepted", "Accepted → accepted");
  ok(mapCultiveraStatus(" partially  accepted ") === "partially_accepted", "Partially Accepted → partially_accepted");
  ok(mapCultiveraStatus("Pending") === null && mapCultiveraStatus(null) === null, "Pending / null refused");
  ok(normalizeUtcInstant("2024-08-30T19:52:47.36Z") === "2024-08-30T19:52:47.360Z", "instant normalised");
  ok(normalizeUtcInstant("2024-02-30T10:00:00Z") === null, "calendar overflow refused");
  ok(normalizeUtcInstant("2024-08-30 19:52:47") === null, "no Z refused");
  ok(transferDateDay("2024-08-30T15:00:00Z") === "2024-08-30", "15:00Z → same Pacific day");
  ok(transferDateDay("2024-08-31T00:00:00Z") === "2024-08-30", "00:00Z in PDT → previous Pacific day");
  ok(transferDateDay("2024-12-01T07:59:00Z") === "2024-11-30" && transferDateDay("2024-12-01T08:00:00Z") === "2024-12-01", "PST boundary at 08:00Z");
  ok(transferDateDay("2024-08-27") === "2024-08-27" && transferDateDay("2024-02-30") === null, "bare day kept; bad day refused");
  ok(transferDateDay(null) === null && transferDateDay("soon") === null, "unreadable → null");

  // Vendor rule
  ok(sharedVendorId([{ vendor_id: "v1" }, { vendor_id: "v1" }], 0) === "v1", "shared vendor set");
  ok(sharedVendorId([{ vendor_id: "v1" }, { vendor_id: "v2" }], 0) === null, "mixed vendor → null");
  ok(sharedVendorId([{ vendor_id: "v1" }], 1) === null, "vendor-by-link → null");
  ok(sharedVendorId([{ vendor_id: null }, { vendor_id: null }], 0) === null, "no vendor → null");

  // Planning fixture
  const lot = (id: string, bc: string, man: string, oh: number, cost: number, vendor: string | null = "v1"): RehomeLot => ({
    id,
    manifest_id: man,
    ccrs_inventory_external_id: bc,
    vendor_id: vendor,
    on_hand_qty: oh,
    received_qty: oh + 1,
    unit_cost_minor_units: cost,
    status: "active",
  });
  const tg = (over: Partial<TransferGroup>): TransferGroup => ({
    key: "transfer|11",
    transferId: 11,
    manifestNumber: "0001234567",
    vendorKey: "GROW CO",
    vendorLabel: "Grow Co",
    acceptedAt: "2024-08-30T18:56:03.507Z",
    transferDate: "2024-08-30T15:00:00Z",
    status: "Accepted",
    barcodes: ["A", "B"],
    otherLines: 0,
    evidence: { only_receipt: 2, first_receipt_after_received: 0 },
    sampleProducts: [],
    alsoOn: {},
    vendorByLink: [],
    ...over,
  });
  const fg = (over: Partial<ReconstructedGroup>): ReconstructedGroup => ({
    key: "LEAF|session|2024-07-02 09:32:07.787",
    kind: "session",
    vendorKey: "LEAF",
    vendorLabel: "Leaf",
    manifestNumber: "CV-20240702-0932-ABCDEF",
    day: "2024-07-02",
    firstWall: "2024-07-02 09:32:07.787",
    lastWall: "2024-07-02 09:40:00.000",
    startUtcIso: "2024-07-02T16:32:07.787Z",
    spanMinutes: 8,
    barcodes: ["C"],
    undatedReasons: { blank: 0, unreadable: 0, out_of_window: 0 },
    sampleProducts: [],
    ...over,
  });
  const plan = (t: TransferGroup[], f: ReconstructedGroup[], collisions: string[] = []): TransferMatchPlan =>
    ({ transferGroups: t, fallbackGroups: f, decisions: [], summary: {} as TransferMatchPlan["summary"], numberCollisions: collisions }) as TransferMatchPlan;
  const SRC = { id: "src", manifestNumber: "POS-IMPORT-abcdef12" };
  const base = (over: Partial<RehomeInput> = {}): RehomeInput => ({
    importId: "imp-1",
    source: SRC,
    plan: plan([tg({})], [fg({}), fg({ key: "LEAF|day|2024-07-03", kind: "day", day: "2024-07-03", manifestNumber: "CV-20240703-DAY-X", startUtcIso: "2024-07-03T19:00:00.000Z", barcodes: ["D"] }), fg({ key: "LEAF|undated", kind: "undated", day: null, firstWall: null, startUtcIso: null, manifestNumber: "CV-UNDATED-Y", barcodes: ["E"] })]),
    lots: [lot("1", "A", "src", 3, 250), lot("2", "B", "src", 2, 100), lot("3", "C", "src", 1, 999, "v2"), lot("4", "D", "src", 5, 0, null), lot("5", "E", "src", 0, 10), lot("6", "Z", "src", 4, 1)],
    existing: [],
    gatePass: true,
    actorId: "staff-1",
    ...over,
  });

  const p = planRehome(base());
  ok(p.ok && p.refusals.length === 0, "clean plan ok");
  ok(p.manifests.length === 4 && p.summary.transferManifests === 1 && p.summary.rebuiltManifests === 3, "4 manifests (1 transfer, 3 rebuilt)");
  const t = p.manifests[0].row;
  ok(t.manifest_number === "0001234567" && t.status === "accepted", "transfer number + status");
  ok(t.accepted_at === "2024-08-30T18:56:03.507Z" && t.received_at === t.accepted_at, "transfer accepted_at = received_at = DateAccepted");
  ok(t.transfer_date === "2024-08-30", "transfer_date = Pacific day of TransferDate");
  ok(t.vendor_id === "v1" && p.summary.vendorIdsSet === 3, "shared vendor id set (transfer, session, undated; not the vendorless day lot)");
  ok(t.dedupe_key === "0001234567|GROW CO|IMPORT-imp-1", "transfer dedupe key");
  ok(t.raw_payload.kind === RECONSTRUCTED_MANIFEST_KIND && t.raw_payload.import_id === "imp-1" && t.raw_payload.source_manifest_id === "src", "lineage kind/import/source");
  ok(t.raw_payload.executor_rule_version === REHOME_RULE_VERSION && t.raw_payload.cultivera_transfer_id === 11, "lineage transfer id + rule version");
  ok(t.accepted_lot_count === 2 && t.created_by === "staff-1" && t.updated_by === "staff-1", "lot count + actor");
  const s = p.manifests[1].row;
  ok(s.accepted_at === "2024-07-02T16:32:07.787Z" && s.received_at === s.accepted_at && s.transfer_date === "2024-07-02", "session dates");
  ok(s.vendor_id === "v2" && s.dedupe_key === "CV-20240702-0932-ABCDEF|LEAF|IMPORT-imp-1", "session vendor + key");
  const d = p.manifests[2].row;
  ok(d.accepted_at === null && d.received_at === null && d.transfer_date === "2024-07-03", "day-only: day kept, instants null");
  ok(d.vendor_id === null, "lot without vendor → null vendor");
  const u = p.manifests[3].row;
  ok(u.accepted_at === null && u.received_at === null && u.transfer_date === null && u.status === "accepted", "undated: all dates null");
  ok(p.summary.lotsToMove === 5 && p.summary.lotsStayOnSource === 1 && p.exceptions.some((e) => e.code === "lot_not_in_plan" && e.detail === "Z"), "unplanned lot stays (exception)");
  ok(p.moves.length === 4 && p.moves[0].lotIds.join(",") === "1,2", "moves grouped per manifest");
  ok(p.totals.lots === 6 && p.totals.onHandUnits === 15 && p.totals.receivedUnits === 21 && p.totals.costValueCents === 750 + 200 + 999 + 0 + 0 + 4, "control totals");

  // Refusals
  ok(!planRehome(base({ gatePass: false, gateProblems: ["x"] })).ok, "gate fail refuses");
  ok(!planRehome(base({ plan: plan([tg({})], [], ["N|V"]) })).ok, "number collision refuses");
  ok(!planRehome(base({ plan: plan([tg({ status: "Pending" })], []) })).ok, "unmapped status refuses");
  ok(!planRehome(base({ plan: plan([tg({ acceptedAt: "" })], []) })).ok, "missing acceptance refuses");
  ok(!planRehome(base({ lots: [lot("1", "A", "src", 1, 1), lot("9", "A", "src", 1, 1)] })).ok, "barcode on two lots refuses");
  ok(!planRehome(base({ lots: [lot("1", "A", "src", 1, 1), lot("1", "A", "src", 1, 1)] })).ok, "lot read twice refuses");
  ok(!planRehome(base({ source: { id: "", manifestNumber: "" } })).ok, "missing source refuses");
  ok(
    !planRehome(base({ plan: plan([tg({}), tg({ key: "transfer|12", transferId: 12, barcodes: ["C"] })], []) })).ok,
    "duplicate dedupe key refuses",
  );
  ok(!planRehome(base({ plan: plan([], [fg({ startUtcIso: "nope" })]) })).ok, "session without start refuses");
  ok(!planRehome(base({ lots: [lot("1", "A", "elsewhere", 1, 1)] })).ok, "lot on a foreign manifest refuses");
  ok(
    !planRehome(base({ existing: [{ id: "m-x", dedupe_key: "0001234567|GROW CO|IMPORT-imp-1", payload_kind: "other", payload_import_id: "imp-1" }] })).ok,
    "existing key owned by someone else refuses",
  );
  ok(
    !planRehome(base({ existing: [{ id: "m-x", dedupe_key: "0001234567|GROW CO|IMPORT-imp-1", payload_kind: RECONSTRUCTED_MANIFEST_KIND, payload_import_id: "imp-2" }] })).ok,
    "existing key from another import refuses",
  );

  ok(
    plannedDedupeKeys("imp-1", plan([tg({})], [fg({})])).join("~") === "0001234567|GROW CO|IMPORT-imp-1~CV-20240702-0932-ABCDEF|LEAF|IMPORT-imp-1",
    "planned dedupe keys (transfer then rebuilt)",
  );

  // Vendor-by-link and partially accepted
  const vbl = planRehome(base({ plan: plan([tg({ vendorByLink: ["B"], status: "Partially Accepted" })], []) }));
  ok(vbl.manifests[0].row.vendor_id === null && vbl.manifests[0].row.status === "partially_accepted", "vendor-by-link → null vendor; partial status");

  // Exceptions
  const miss = planRehome(base({ plan: plan([tg({ barcodes: ["A", "B", "Q"] })], []) }));
  ok(miss.ok && miss.summary.exceptionCounts.planned_barcode_without_lot === 1 && miss.manifests[0].row.accepted_lot_count === 2, "planned barcode without a lot is logged, not invented");
  const none = planRehome(base({ plan: plan([tg({ barcodes: ["Q"] })], []) }));
  ok(none.manifests.length === 0, "group with no lots creates no manifest");
  const late = planRehome(base({ plan: plan([tg({ transferDate: "2024-09-02T15:00:00Z" })], []) }));
  ok(late.summary.exceptionCounts.transfer_date_after_acceptance === 1 && late.manifests[0].row.transfer_date === "2024-09-02", "late transfer date logged, kept as recorded");

  // Resume: manifest already created, one lot already moved
  const existing = [{ id: "m-t", dedupe_key: "0001234567|GROW CO|IMPORT-imp-1", payload_kind: RECONSTRUCTED_MANIFEST_KIND, payload_import_id: "imp-1" }];
  const resumed = planRehome(base({ existing, lots: [lot("1", "A", "m-t", 3, 250), lot("2", "B", "src", 2, 100)], plan: plan([tg({})], []) }));
  ok(resumed.ok && resumed.summary.manifestsToCreate === 0 && resumed.summary.manifestsAlreadyCreated === 1, "resume: manifest reused");
  ok(resumed.summary.lotsAlreadyHome === 1 && resumed.summary.lotsToMove === 1 && resumed.moves[0].lotIds.join() === "2", "resume: only the remaining lot moves");
  const done = planRehome(base({ existing, lots: [lot("1", "A", "m-t", 3, 250), lot("2", "B", "m-t", 2, 100)], plan: plan([tg({})], []) }));
  ok(done.ok && done.moves.length === 0 && done.summary.lotsAlreadyHome === 2, "second Apply is a no-op");

  // Batching
  const many = Array.from({ length: 450 }, (_, i) => `B${String(i).padStart(4, "0")}`);
  const big = planRehome(base({ plan: plan([tg({ barcodes: many })], []), lots: many.map((b, i) => lot(`L${String(i).padStart(4, "0")}`, b, "src", 1, 1)) }));
  ok(big.moves.length === 3 && big.moves.every((m) => m.lotIds.length <= REHOME_MOVE_BATCH) && big.moves.reduce((n, m) => n + m.lotIds.length, 0) === 450, "batches ≤ 150 and complete");

  // Totals + verification
  ok(compareTotals(p.totals, { ...p.totals }).length === 0, "identical totals pass");
  ok(compareTotals(p.totals, { ...p.totals, costValueCents: p.totals.costValueCents + 1 }).length === 1, "one cent off fails");
  ok(controlTotals([lot("1", "A", "s", 0.1, 0), lot("2", "B", "s", 0.2, 0)]).onHandUnits === 0.3, "float noise rounded");
  const ids = new Map(p.manifests.map((m, i) => [m.dedupeKey, `m${i}`]));
  const after = base().lots.map((l) => {
    const m = p.manifests.find((x) => x.lotIds.includes(l.id));
    return { ...l, manifest_id: m ? ids.get(m.dedupeKey)! : l.manifest_id };
  });
  ok(verifyRehome({ before: p.totals, afterLots: after, manifestIdByKey: ids, plan: p, sourceId: "src" }).length === 0, "verify passes after a full move");
  ok(verifyRehome({ before: p.totals, afterLots: base().lots, manifestIdByKey: ids, plan: p, sourceId: "src" }).some((x) => x.includes("not on their planned")), "verify catches unmoved lots");
  ok(verifyRehome({ before: p.totals, afterLots: after.slice(1), manifestIdByKey: ids, plan: p, sourceId: "src" }).some((x) => x.includes("lot count")), "verify catches a lost lot");
  ok(verifyRehome({ before: p.totals, afterLots: after, manifestIdByKey: new Map(), plan: p, sourceId: "src" }).some((x) => x.includes("was not created")), "verify catches a missing manifest");

  // Plan inputs (persisted for Apply) + the shared planner
  const details = [
    { Id: 11, TransferNumber: "0001234567", FromVendor: "Grow  Co", TransferDate: "2024-08-30T15:00:00Z", DateAccepted: "2024-08-30T18:56:03.507Z", StatusDisplay: "Accepted", Details: [{ Barcode: "A", AcceptedQuantity: 5, Quantity: 5, UnitPrice: 9.99 }] },
    { TransferNumber: "no id" },
  ];
  const inputs = buildPlanInputs({ importId: "imp-1", runId: "r1", pacificToday: "2024-09-01", transferDetails: details, listLots: [{ Barcode: "A", IncomingTransferId: 11 }, { Barcode: "B" }] });
  ok(inputs.transfers.length === 1 && inputs.indexSkipped === 1 && inputs.links.length === 1 && inputs.links[0][0] === "A", "plan inputs: transfers, skipped, links");
  ok(!JSON.stringify(inputs).includes("9.99") && !JSON.stringify(inputs).includes("UnitPrice"), "plan inputs carry no prices");
  ok(checkPlanInputs(inputs, "imp-1").length === 0, "plan inputs valid for own import");
  ok(checkPlanInputs(inputs, "imp-2").length === 1 && checkPlanInputs(null, "imp-1").length === 5, "plan inputs refused for other import / garbage");
  const src = [{ barcode: "A", vendor: "Grow Co", receivedDateRaw: "2024-08-30 12:00:00.000", units: 5, productName: "Thing" }];
  const pf = planFromSources(src, inputs.transfers, new Map(inputs.links), inputs.pacificToday);
  ok(pf.plan.transferGroups.length === 1 && pf.plan.transferGroups[0].barcodes.join() === "A" && pf.gate.pass, "planFromSources matches the transfer and passes");
  const pfSkip = planFromSources(src, inputs.transfers, new Map(inputs.links), inputs.pacificToday, inputs.indexSkipped);
  ok(!pfSkip.gate.pass && pfSkip.gate.problems.some((x) => x.includes("without an id")), "skipped transfer records fail the gate");

  // R74 S10: lots the email step placed are left alone (no move, no refusal, no exception).
  const mailEx = [{ id: "m-mail", dedupe_key: "X|EMAIL", payload_kind: RECONSTRUCTED_MANIFEST_KIND, payload_import_id: "imp-1", payload_group_kind: "email" }];
  const em = planRehome(base({ existing: mailEx, lots: base().lots.map((l) => (l.id === "3" ? { ...l, manifest_id: "m-mail" } : l)) }));
  ok(em.ok && em.summary.lotsPlacedByEmail === 1 && em.summary.lotsToMove === 4, "email-placed lot left alone, rest still planned");
  ok(em.manifests.length === 3 && !em.manifests.some((m) => m.lotIds.includes("3")), "fallback group with only email-placed lots creates no manifest");
  ok(em.summary.exceptionCounts.lot_on_foreign_manifest === 0 && em.summary.exceptionCounts.planned_barcode_without_lot === 0, "no exception for email-placed lots");
  ok(em.totals.lots === 6, "control totals still count the email-placed lot");
  const otherImp = planRehome(base({ existing: [{ ...mailEx[0], payload_import_id: "imp-2" }], lots: base().lots.map((l) => (l.id === "3" ? { ...l, manifest_id: "m-mail" } : l)) }));
  ok(!otherImp.ok && otherImp.summary.exceptionCounts.lot_on_foreign_manifest === 1, "another import's email manifest is still foreign");
  const fbKind = planRehome(base({ existing: [{ ...mailEx[0], payload_group_kind: "session" }], lots: base().lots.map((l) => (l.id === "3" ? { ...l, manifest_id: "m-mail" } : l)) }));
  ok(!fbKind.ok, "a non-email rebuilt kind is not treated as placed");
  ok(isMailStepManifest({ payload_kind: RECONSTRUCTED_MANIFEST_KIND, payload_import_id: "i", payload_group_kind: "unmatched" }, "i") && !isMailStepManifest({ payload_kind: "pos-import-migration", payload_import_id: "i", payload_group_kind: "email" }, "i"), "mail-step kind is exact");

  ok(NOT_REBUILT_OR === "raw_payload->>kind.is.null,raw_payload->>kind.neq.cultivera-reconstructed", "null-safe rebuilt filter");
  ok(isRebuiltKind(RECONSTRUCTED_MANIFEST_KIND) && !isRebuiltKind("pos-import-migration") && !isRebuiltKind(null), "rebuilt kind only");
  return { passed, failed };
}
