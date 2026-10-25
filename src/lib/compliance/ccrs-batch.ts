/**
 * src/lib/compliance/ccrs-batch.ts  (Slice 54)
 *
 * Server-only CCRS BATCH generator for a WA RETAILER. Produces the full,
 * correctly-ordered set of files a retailer must report (Table 1 of the CCRS
 * Upload User Guide): Strain, Area, Product, Inventory, InventoryAdjustment,
 * InventoryTransfer, Sale — plus a data-integrity ("sync") analysis that flags
 * out-of-sync data BEFORE upload (since CCRS notifies of failures only by email).
 *
 * Everything factual about the file format lives in ccrs-batch-core.ts (pure,
 * unit-tested). This module only reads the database and maps real columns into
 * the spec. It reuses the mature Sale.csv and InventoryAdjustment.csv builders.
 *
 * DRAFTS-ONLY: this is generated output an employee validates before upload.
 * We never invent data — every row comes from a real DB column.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AVOIRDUPOIS_GRAMS_PER_OUNCE } from "@/lib/compliance/grams-per-ounce";
import {
  assembleCcrsFile,
  ccrsDate,
  ccrsFileName,
  CCRS_UPLOAD_ORDER,
  uploadGroupOf,
  normalizeStrainType,
  deriveCcrsClassificationFromType,
  clampText,
  classifyWarning,
  verifySaleNumericColumns,
  splitCsvLine,
  withholdUnencodableRows,
  unencodableMessage,
  freeTextRewriteMessage,
  CCRS_UNENCODABLE_CODE,
  CCRS_FREE_TEXT_COLUMNS,
  CCRS_COLUMNS,
  ccrsReaderSplit,
  verifyCcrsBatch,
  CCRS_PRODUCT_NAME_MAX,
  CCRS_PRODUCT_DESCRIPTION_MAX,
  type CcrsRetailerFileType,
} from "@/lib/compliance/ccrs-batch-core";
import {
  assignedInventoryExternalId,
  validatePassThroughExternalId,
  sanitizeExternalId,
} from "@/lib/compliance/ccrs-identifiers";
import {
  inventoryRowVerdict,
  productRowIssues,
  isReservedStrainName,
  specPinFor,
  type CcrsIssueCode,
  type CcrsIssueRow,
} from "@/lib/compliance/ccrs-preflight-core";
import { ccrsInventoryCreatedDate } from "@/lib/inventory/received-date-core";
import { chunkedIn, pagedAll } from "@/lib/supabase/chunked-in";
import {
  enrichLotWithholdReason,
  keysNeedingMenuLookup,
  lotsWithProductNotInMenu,
  lotsWithheldForMissingProduct,
  legacyLotsWithBlankProduct,
  e47Message,
  menuPresenceFromRows,
  type MenuPresence,
} from "@/lib/compliance/ccrs-lot-product-core";
import { ledgerSelfCheckIssues, planOutboxFiles, verifyOutboxAgainstLedger, type LedgerProblem } from "@/lib/compliance/ccrs-outbox-core";
import {
  applyIdentityHolds,
  buildIdentityProof,
  cultiveraLotsToHold,
  identityIssues,
  CULTIVERA_NOT_ON_RECORD_REASON,
  type IdentityLot,
  type IdentityProof,
} from "@/lib/compliance/ccrs-identity-guard-core";

/** S-17b: the export route's ledger self-check codes, carried with their own pins. */
type LedgerProblemCode = LedgerProblem["code"];
import { validateName, suggestName, type Cannabinoid } from "@/lib/naming/convention-core";
import { composeCcrsProductName, disambiguateCcrsName } from "@/lib/compliance/ccrs-product-name-core";
import { getCcrsLicenseSettings, buildCcrsSaleCsv } from "@/lib/compliance/ccrs-sales";
import { buildCcrsInventoryAdjustmentCsv } from "@/lib/compliance/ccrs-inventory-adjustment";
import { NO_PRODUCT_ID_REASON, applyProductPlan, buildLedgerView, planLedgerBatch, type LedgerEnv, type LedgerPlan, type LedgerView } from "@/lib/compliance/ccrs-ledger-core";
import { areaPlanFor, isHeldLotStatus, planAreaFile } from "@/lib/compliance/ccrs-area-core";
import { loadInventoryTold, loadLedgerForBatch, loadSaleSlice, loadTransferSlice } from "@/lib/compliance/ccrs-ledger-store";
import { lotsNamedByEventRows, planInventoryDelta } from "@/lib/compliance/ccrs-inventory-delta-core";
import {
  TRANSFER_BLOCKING,
  buildTransferRows,
  transferExternalId,
  transferLedgerEntries,
  transferSummaryText,
  type TransferIssueCode,
  type TransferLot,
} from "@/lib/compliance/ccrs-transfer-core";
import { getObligationContext } from "@/lib/compliance/obligation-waiver-store";
import { csvDataRows, dropEventRowsForHeldLots, heldEventRowsMessage, sendableLotIds } from "@/lib/compliance/ccrs-held-back-core";
import { pacificDayKey } from "@/lib/reports/timezone";
import {
  CCRS_CLEANUP_SETTING_KEY,
  CLEANUP_LOT_REASON,
  LEDGER_DUPLICATE_REASON,
  applyProductHolds,
  dropCsvDataRows,
  normalizeCleanup,
  rowNumbersOf,
  type CleanupProduct,
  type ProductHold,
} from "@/lib/compliance/ccrs-never-block-core";
import { CCRS_CHUNK_ROWS } from "@/lib/compliance/ccrs-chunk-core";
import { isMissingColumnError } from "@/lib/inventory/coa-extract-core";
import { LINEAGE_MANIFEST_SELECT, type LineageManifestRow } from "@/lib/inventory/import-lineage-core";
import { cultiveraManifestIdSet, lotFlaggedCultivera } from "@/lib/inventory/cultivera-received-flag-core";
import {
  correctionExportIds,
  eventLotRefs,
  planReturnCorrections,
  returnRecordFromRow,
  routeSaleInserts,
  saleLedgerEntries,
  type CorrectionNote,
  type CustomerReturnRowLike,
  type ReturnCorrectionPlan,
  type ReturnRecord,
} from "@/lib/compliance/ccrs-return-corrections-core";

export type CcrsFile = {
  type: CcrsRetailerFileType;
  group: number;
  fileName: string;
  csv: string;
  recordCount: number;
  skipped: number;
  warnings: string[];
  /** True when this file has zero data rows (nothing to report for the range). */
  empty: boolean;
};

export type CcrsSyncIssue = {
  severity: "error" | "warning";
  file: CcrsRetailerFileType | "General";
  message: string;
  count?: number;
  /**
   * S-02: stable machine id for the check that fired, e.g. "E7_TOTALCOST_ZERO".
   * Optional so the many legacy warnings keep compiling; every issue raised by
   * a bible-grounded check MUST set it (Part 08 §C).
   */
  code?: CcrsIssueCode | LedgerProblemCode;
  /** The verbatim LCB pin behind the check, e.g. "[G L0614]". */
  specPin?: string;
  /** Every offending row — NEVER capped; a capped list hides the blocker. */
  rows?: CcrsIssueRow[];
};

export type CcrsBatch = {
  licenseNumber: string;
  submittedBy: string;
  fromISO: string;
  toISO: string;
  files: CcrsFile[];
  syncIssues: CcrsSyncIssue[];
  totalRecords: number;
  generatedAt: string;
  /**
   * S-12b: what the rows were routed against. `view` null = legacy routing
   * (every row Insert, our ids) because the 0248 migration is not applied or
   * the production seed is not finalized yet (ccrs-ledger-store-core).
   */
  ledger: {
    env: LedgerEnv;
    view: LedgerView | null;
    /** why there is no view (null when loaded). */
    absentReason: "migration-not-applied" | "seed-not-finalized" | "not-configured" | null;
    /** greatest file stamp already stored in this env (ISO), null = none. */
    lastStamp: string | null;
    /**
     * Product keys withheld ONLY because no GWP- id is assigned yet (sorted).
     * The owner assigns them with one audited action (ccrs_assign_product_ids);
     * the export never assigns on its own (D-01a: ids are minted deliberately).
     */
    unassignedProductKeys: string[];
  };
  /**
   * R74 S25: what every lot and product is filed under (Cultivera lots on the
   * ids Cultivera filed vs our intake lots on our ids / GWP- products). Null
   * when no lots were read (not configured).
   */
  identity: IdentityProof | null;
  /**
   * R5-1: customer-return Sale corrections carried in this batch's Sale file.
   * `exportReturnIds` is filled ONLY for a production emission (preprod never
   * marks the shared correction_status); the route marks them after emit.
   */
  corrections: {
    exportReturnIds: string[];
    emitted: number;
    withheld: number;
    invalid: number;
    reflected: number;
  };
};

// ---------------------------------------------------------------------------
// Helpers to read the published menu snapshot + inventory lots
// ---------------------------------------------------------------------------

type Admin = ReturnType<typeof createSupabaseAdminClient>;

async function getPublishedVersionId(admin: Admin): Promise<string | null> {
  const { data } = await admin
    .from("menu_versions")
    .select("id")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

const LOT_COLUMNS =
  "id, lot_code, pos_product_key, product_name, ccrs_inventory_external_id, received_qty, on_hand_qty, unit_cost_minor_units, unit_weight, unit_weight_uom, status, created_at, received_on, is_sample, notes, manifest_id";

/**
 * R6-2: every ACCEPTED lot of a delivery received on or before `toDay` (live
 * or destroyed: a lot sold out or destroyed was still received), with the
 * delivery facts an InventoryTransfer row needs. The retailer is the
 * RECEIVING licensee and files the transfer [G L0124-L0128, G L0143-L0144].
 * `absent` = migration 0285 (the vendor-id columns) is not applied. Any other
 * read error THROWS: a silently missing lot is a missing weekly filing.
 */
const TRANSFER_LOT_COLUMNS =
  "id, lot_code, manifest_id, notes, vendor_id, ccrs_inventory_external_id, received_qty, received_on, disposition, vendor_inventory_external_id, vendor_inventory_external_id_source";
type TransferLotRow = {
  id: string;
  lot_code: string | null;
  manifest_id: string | null;
  notes: string | null;
  vendor_id: string | null;
  ccrs_inventory_external_id: string | null;
  received_qty: number | string | null;
  received_on: string | null;
  disposition: string | null;
  vendor_inventory_external_id: string | null;
  vendor_inventory_external_id_source: string | null;
};
type TransferManifestRow = LineageManifestRow & {
  vendor_id: string | null;
  from_license_number?: string | null;
  vendor_license?: string | null;
};
async function readTransferLots(admin: Admin, toDay: string): Promise<{ kind: "absent" } | { kind: "loaded"; lots: TransferLot[] }> {
  let missing = false;
  let failed: string | null = null;
  const rows = await pagedAll<TransferLotRow>(async (from, to) => {
    if (missing || failed) return [];
    const { data, error } = await admin
      .from("inventory_lots")
      .select(TRANSFER_LOT_COLUMNS)
      .not("manifest_id", "is", null)
      .eq("disposition", "accepted")
      .lte("received_on", toDay)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) {
      if (isMissingColumnError(error)) missing = true;
      else failed = error.message;
      return [];
    }
    return (data as TransferLotRow[] | null) ?? [];
  });
  if (missing) return { kind: "absent" };
  if (failed) throw new Error(`R6-2: reading received lots for InventoryTransfer failed: ${failed}`);
  const manifestIds = [...new Set(rows.map((r) => (r.manifest_id ?? "").trim()).filter(Boolean))];
  let mFailed: string | null = null;
  const manifests = await chunkedIn<string, TransferManifestRow>(manifestIds, async (chunk, from, to) => {
    const { data, error } = await admin
      .from("inbound_manifests")
      .select(`${LINEAGE_MANIFEST_SELECT}, vendor_id, from_license_number:raw_payload->>from_license_number, vendor_license:raw_payload->>vendor_license`)
      .in("id", chunk)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) mFailed = error.message;
    return (data as TransferManifestRow[] | null) ?? [];
  });
  if (mFailed) throw new Error(`R6-2: reading delivery manifests for InventoryTransfer failed: ${mFailed}`);
  const byManifest = new Map(manifests.map((m) => [m.id, m]));
  const vendorIds = [
    ...new Set([...rows.map((r) => r.vendor_id), ...manifests.map((m) => m.vendor_id)].filter((x): x is string => !!x)),
  ];
  let vFailed: string | null = null;
  const vendors = await chunkedIn<string, { id: string; license_number: string | null }>(vendorIds, async (chunk, from, to) => {
    const { data, error } = await admin.from("vendors").select("id, license_number").in("id", chunk).order("id", { ascending: true }).range(from, to);
    if (error) vFailed = error.message;
    return (data as { id: string; license_number: string | null }[] | null) ?? [];
  });
  if (vFailed) throw new Error(`R6-2: reading vendor licenses for InventoryTransfer failed: ${vFailed}`);
  const licenseByVendor = new Map(vendors.map((v) => [v.id, (v.license_number ?? "").trim()]));
  const migration = cultiveraManifestIdSet(manifests);
  const lots: TransferLot[] = rows.map((r) => {
    const m = r.manifest_id ? byManifest.get(r.manifest_id) : undefined;
    // The delivery's own sending license first (exact for THIS manifest),
    // then the vendor record's license.
    const fromDoc = (m?.from_license_number ?? m?.vendor_license ?? "").trim();
    const vendorRecord = licenseByVendor.get(m?.vendor_id ?? r.vendor_id ?? "") ?? "";
    const qty = r.received_qty === null ? null : Number(r.received_qty);
    return {
      lotId: r.id,
      manifestId: r.manifest_id,
      label: r.lot_code ?? r.id,
      ourId: assignedInventoryExternalId(r),
      vendorId: r.vendor_inventory_external_id,
      vendorIdSource: r.vendor_inventory_external_id_source,
      vendorLicense: fromDoc || vendorRecord || null,
      receivedQty: qty,
      receivedOn: r.received_on,
      disposition: r.disposition,
      isCultivera: lotFlaggedCultivera(r, migration),
    };
  });
  return { kind: "loaded", lots };
}

/**
 * R74 S25: ids of the migration manifests the batch's lots sit on (the shared
 * lineage predicate, cultiveraManifestIdSet). A read error THROWS: without it a
 * re-homed Cultivera lot whose notes lost the marker could pass as ours.
 */
/** R74 S42: true when the batch has a non-empty Sale file to check. */
function f_saleRowsChecked(files: readonly CcrsFile[]): boolean {
  const sf = files.find((f) => f.type === "Sale");
  return !!sf && sf.recordCount > 0;
}

/** R74 S42: the owner's CCRS clean-up list (relic products never reported). */
async function readCleanupList(admin: Admin): Promise<{ items: CleanupProduct[]; error: string | null }> {
  try {
    const { data, error } = await admin.from("site_settings").select("value_json").eq("key", CCRS_CLEANUP_SETTING_KEY).maybeSingle();
    if (error) return { items: [], error: error.message };
    return { items: normalizeCleanup((data as { value_json?: unknown } | null)?.value_json ?? null), error: null };
  } catch (e) {
    return { items: [], error: e instanceof Error ? e.message : String(e) };
  }
}

async function readMigrationManifestIds(admin: Admin, lots: readonly { manifest_id: string | null }[]): Promise<Set<string>> {
  const ids = [...new Set(lots.map((l) => (l.manifest_id ?? "").trim()).filter(Boolean))];
  let failed: string | null = null;
  const rows = await chunkedIn<string, LineageManifestRow>(ids, async (chunk, from, to) => {
    const { data, error } = await admin
      .from("inbound_manifests")
      .select(LINEAGE_MANIFEST_SELECT)
      .in("id", chunk)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) failed = error.message;
    return (data as LineageManifestRow[] | null) ?? [];
  });
  if (failed) throw new Error(`R74 S25: reading lot manifests for the CCRS identity guard failed: ${failed}`);
  return cultiveraManifestIdSet(rows);
}

const TRANSFER_ISSUE_TEXT: Record<TransferIssueCode, (n: number) => string> = {
  E14_TRANSFER_FIELD_MISSING: (n) => `${n} received lot(s) are missing a field InventoryTransfer.csv requires (vendor license, our lot id, or received date). Fix each delivery, then rebuild.`,
  E14_TRANSFER_VENDOR_ID_UNKNOWN: (n) =>
    `${n} received lot(s) have no confirmed vendor inventory id. CCRS needs "the original ... InventoryExternalIdentifier from the producer" [FAQ L0058-L0059]. Open the delivery and enter or confirm the vendor's id for each lot.`,
  E14_TRANSFER_SAME_LICENSE: (n) => `${n} received lot(s) name our own license as the vendor. A transfer to the same license is an error [G L1205]; fix the vendor on the delivery.`,
  E14_TRANSFER_QUANTITY: (n) => `${n} received lot(s) have a received quantity that is not positive ("No negative entries allowed" [G L1238]).`,
  E14_TRANSFER_LEDGER_WITHHELD: (n) => `${n} transfer(s) were left out because an earlier file naming them is not answered yet. Record that file's CCRS result, then rebuild.`,
  E14_TRANSFER_LOT_NOT_REPORTED: (n) =>
    `${n} transfer(s) were left out because their lot is not in Inventory.csv and CCRS does not hold it yet ("ensure the inventory has been reported through the inventory.CSV" [G L1207-L1209]). Fix the Inventory errors first.`,
};

/**
 * R5-1: the DESTROYED lots that this batch's event rows name (by CCRS id).
 * Live lots are read with `.neq("status", "destroyed")`; a lot destroyed to 0
 * still needs its Inventory row (QoH 0) in the emission that carries its
 * Destruction adjustment [G L1302-L1304, EXAM L0430]. A read error THROWS:
 * silently dropping the lot would send an adjustment CCRS rejects.
 */
async function readDestroyedLots(admin: Admin, refs: readonly string[]): Promise<LotRow[]> {
  if (refs.length === 0) return [];
  let failed: string | null = null;
  const rows = await chunkedIn<string, LotRow>(refs, async (chunk, from, to) => {
    const { data, error } = await admin
      .from("inventory_lots")
      .select(LOT_COLUMNS)
      .eq("status", "destroyed")
      .in("ccrs_inventory_external_id", chunk)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) failed = error.message;
    return (data as LotRow[] | null) ?? [];
  });
  if (failed) throw new Error(`R5-1: could not read destroyed lots named by this batch: ${failed}`);
  // The stored id may carry surrounding spaces; assignedInventoryExternalId
  // trims, so match on what the event row printed.
  const wanted = new Set(refs);
  const seen = new Set<string>();
  return rows.filter((l) => {
    const assigned = assignedInventoryExternalId(l);
    if (!assigned || !wanted.has(assigned) || seen.has(l.id)) return false;
    seen.add(l.id);
    return true;
  });
}

const RETURN_COLUMNS =
  "id, sale_external_id, sale_detail_external_id, inventory_external_id, sale_type, sale_date, unit_price_minor, discount_minor, sales_tax_minor, excise_minor, quantity, original_quantity, correction_status, created_at";

/** customer_returns missing (pre-0115) reads as "no returns"; any other error throws. */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return error.code === "42P01" || error.code === "PGRST205" || /relation .* does not exist|could not find the table/.test(msg);
}

/**
 * R5-1: the returns a batch must consider for Sale corrections: every PENDING
 * return, every return made (created_at) inside the batch range, and every
 * other return of those sale lines (the correction states the line after ALL
 * its returns: rule 1). Same rule in both envs.
 *   - `correction_status` is ONE flag that only a PROD emission sets
 *     (correctionExportIds), so it cannot say what PREprod has seen, nor
 *     whether CCRS accepted a prod correction. The env's own ledger decides
 *     that (reflected = already applied, in flight = wait).
 *   - The range part lets a correction whose file was rejected or abandoned
 *     be planned again by rebuilding that week; the ledger stops re-sends.
 */
async function readReturnsForCorrections(
  admin: Admin,
  fromISO: string,
  toISO: string,
): Promise<{ records: ReturnRecord[]; tableMissing: boolean }> {
  const seeds = await pagedAll<CustomerReturnRowLike>(async (from, to) => {
    const { data, error } = await admin
      .from("customer_returns")
      .select(RETURN_COLUMNS)
      .or(`correction_status.eq.pending,and(created_at.gte.${fromISO},created_at.lte.${toISO})`)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) {
      if (isMissingTable(error)) throw new MissingReturnsTable();
      throw new Error(`R5-1: could not read customer_returns: ${error.message}`);
    }
    return (data as CustomerReturnRowLike[] | null) ?? [];
  }).catch((e) => {
    if (e instanceof MissingReturnsTable) return null;
    throw e;
  });
  if (seeds === null) return { records: [], tableMissing: true };
  const lineIds = [...new Set(seeds.map((r) => (r.sale_detail_external_id ?? "").trim()).filter(Boolean))];
  let failed: string | null = null;
  const siblings = await chunkedIn<string, CustomerReturnRowLike>(lineIds, async (chunk, from, to) => {
    const { data, error } = await admin
      .from("customer_returns")
      .select(RETURN_COLUMNS)
      .in("sale_detail_external_id", chunk)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) failed = error.message;
    return (data as CustomerReturnRowLike[] | null) ?? [];
  });
  if (failed) throw new Error(`R5-1: could not read the other returns of these sale lines: ${failed}`);
  const byId = new Map<string, CustomerReturnRowLike>();
  for (const r of [...seeds, ...siblings]) byId.set(r.id, r);
  return { records: [...byId.values()].map(returnRecordFromRow), tableMissing: false };
}
class MissingReturnsTable extends Error {}

/**
 * S-17b: for product keys that lots name but the published menu does not show,
 * read whether each is HIDDEN in the published version (with its reason) or
 * present only in a STAGED version. Any read error → `readable: false` (the
 * lot is still withheld; only the explanation is lost, and that is said).
 */
async function readMenuPresence(
  admin: Admin,
  publishedVersionId: string | null,
  visiblePublishedKeys: Iterable<string>,
  keys: readonly string[],
): Promise<MenuPresence> {
  if (keys.length === 0 || !publishedVersionId) {
    return menuPresenceFromRows(!!publishedVersionId, visiblePublishedKeys, [], []);
  }
  try {
    let failed: string | null = null;
    const hidden = await chunkedIn<string, { source_item_id: string | null; hidden_reason: string | null }>(keys, async (chunk, from, to) => {
      const { data, error } = await admin
        .from("menu_items")
        .select("source_item_id, hidden_reason")
        .eq("menu_version_id", publishedVersionId)
        .eq("hidden", true)
        .in("source_item_id", chunk)
        .order("id", { ascending: true })
        .range(from, to);
      if (error) failed = error.message;
      return (data as { source_item_id: string | null; hidden_reason: string | null }[] | null) ?? [];
    });
    const { data: stagedVersions, error: sErr } = await admin.from("menu_versions").select("id").eq("status", "staged");
    if (sErr) failed = sErr.message;
    const stagedIds = ((stagedVersions as { id: string }[] | null) ?? []).map((v) => v.id);
    const staged =
      stagedIds.length === 0
        ? []
        : await chunkedIn<string, { source_item_id: string | null }>(keys, async (chunk, from, to) => {
            const { data, error } = await admin
              .from("menu_items")
              .select("source_item_id")
              .in("menu_version_id", stagedIds)
              .in("source_item_id", chunk)
              .order("id", { ascending: true })
              .range(from, to);
            if (error) failed = error.message;
            return (data as { source_item_id: string | null }[] | null) ?? [];
          });
    if (failed) return { readable: false, error: failed };
    return menuPresenceFromRows(true, visiblePublishedKeys, hidden, staged);
  } catch (e) {
    return { readable: false, error: e instanceof Error ? e.message : String(e) };
  }
}

type MenuItemRow = {
  source_item_id: string;
  name: string;
  strain_name: string | null;
  strain_type: string | null;
  pos_inventory_type: string | null;
  pos_inventory_category: string | null;
  description: string | null;
  // SLICE 53 (two-layer naming): fields the CCRS Product.Name composer uses.
  brand_name: string | null;
  vendor_name: string | null;
  category: string | null;
  total_thc_json: unknown;
  total_cbd_json: unknown;
  compounds_json: unknown;
};

/** Parse a stored cannabinoid JSON blob (same shape live-menu.ts reads). */
function jsonToCannabinoid(json: unknown): Cannabinoid | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (typeof o.type !== "string" || typeof o.unit !== "string") return null;
  return {
    type: o.type as Cannabinoid["type"],
    value: typeof o.value === "string" || typeof o.value === "number" ? o.value : null,
    unit: o.unit as Cannabinoid["unit"],
  };
}

function jsonToCompounds(json: unknown): Cannabinoid[] {
  if (!Array.isArray(json)) return [];
  return json.map(jsonToCannabinoid).filter((c): c is Cannabinoid => c != null);
}

type LotRow = {
  id: string;
  lot_code: string | null;
  pos_product_key: string | null;
  product_name: string | null;
  ccrs_inventory_external_id: string | null;
  received_qty: number;
  on_hand_qty: number;
  unit_cost_minor_units: number | null;
  unit_weight: number | null;
  unit_weight_uom: string | null;
  status: string;
  created_at: string;
  /**
   * SLICE 2 (migration 0214) — the evidenced day the lot was received.
   * NULL means unknown; see ccrsInventoryCreatedDate() for how that is
   * handled when filling Inventory.CreatedDate.
   */
  received_on: string | null;
  /**
   * S-02 / E7: a vendor TRADE SAMPLE (migration 0024 L32,
   * `is_sample boolean not null default false`). It has no purchase value, but
   * CCRS still requires a positive TotalCost and the FAQ dictates exactly
   * $0.01 [FAQ L0035]. Selected explicitly so the E7 check can tell a sample
   * apart from a lot whose cost was never entered.
   */
  is_sample: boolean | null;
  /**
   * R74 S25: the Cultivera flag (lotFlaggedCultivera) reads the notes marker
   * and the lot's manifest, so the identity guard can tell a migrated lot
   * (keeps the id Cultivera filed) from one we received (our id, GWP- product).
   */
  notes: string | null;
  manifest_id: string | null;
};

// ---------------------------------------------------------------------------
// Per-file generators for the master-data files (Strain / Area / Product /
// Inventory). Adjustment + Sale reuse the existing mature builders.
// ---------------------------------------------------------------------------

/** grams from a unit_weight + uom (g default). Returns "" when unknown. */
function toGrams(weight: number | null, uom: string | null): string {
  if (weight == null || !Number.isFinite(weight)) return "";
  const u = (uom ?? "g").toLowerCase();
  const g = u === "mg" ? weight / 1000 : u === "oz" ? weight * AVOIRDUPOIS_GRAMS_PER_OUNCE : weight;
  return (Math.round(g * 1000) / 1000).toString();
}

function buildStrainFile(
  items: MenuItemRow[],
  license: string,
  submittedBy: string,
  createdBy: string,
  createdDate: string,
  plan: LedgerPlan,
): { rows: string[][]; warnings: string[]; issues: CcrsSyncIssue[] } {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const rows: string[][] = [];
  const defaulted: string[] = [];
  const reserved: CcrsIssueRow[] = [];
  for (const it of items) {
    const raw = (it.strain_name ?? "").trim();
    if (!raw) continue;
    // S-11: the plan decides. A strain already on file in ANY casing is never
    // re-sent (Strain has no Operation [G L0319-L0320]); a case variant of a
    // filed or already-emitted strain is never sent at all [BRIAN A16].
    const strain = plan.strainCanonical.get(raw) ?? raw;
    if (!plan.strainEmit.has(strain)) continue;
    if (seen.has(strain)) continue;
    seen.add(strain);
    // E11 [G L0358] "Strain name is invalid, cannot be Unknown, THC, or Other."
    // Exact match only — "Other Kush" is a real strain and must still ship.
    if (isReservedStrainName(strain)) {
      reserved.push({
        id: (it.source_item_id ?? strain).trim(),
        label: strain,
        detail: `"${strain}" is a reserved CCRS strain name`,
      });
      continue;
    }
    // B2: StrainType MUST be one of Indica/Sativa/Hybrid. Normalize the POS
    // label; when it can't be resolved we default to Hybrid (safe superset) and
    // flag the strain so an employee can correct it (drafts-only).
    const st = normalizeStrainType(it.strain_type);
    if (st.defaulted) defaulted.push(strain);
    rows.push([license, strain, st.value, createdBy, createdDate]);
  }
  if (defaulted.length > 0) {
    warnings.push(
      `${defaulted.length} strain(s) had no recognizable Indica/Sativa/Hybrid type and were defaulted to "Hybrid" — set the correct StrainType before uploading: ${defaulted
        .slice(0, 15)
        .join(", ")}${defaulted.length > 15 ? "…" : ""}.`,
    );
  }
  if (rows.length === 0) warnings.push("No named strains found in the published menu.");
  const issues: CcrsSyncIssue[] = [];
  if (plan.strainCaseVariants.length > 0) {
    issues.push({
      severity: "warning",
      file: "Strain",
      code: "E39_STRAIN_CASE_VARIANT",
      specPin: specPinFor("E39_STRAIN_CASE_VARIANT"),
      count: plan.strainCaseVariants.length,
      rows: plan.strainCaseVariants.map((v) => ({
        id: v.ours,
        label: v.ours,
        detail: `written as "${v.value}" (${v.source === "ledger" ? "the spelling already filed in CCRS" : "the first spelling in this batch"})`,
      })),
      message: `${plan.strainCaseVariants.length} strain name(s) differ from another only by capital letters. CCRS must never receive the same strain with a different capitalization (LCB Service Desk: "Dutch Treat vs Dutch treat"), so each was written with one spelling everywhere and no extra Strain row was sent. Fix the spelling on the product to match, so this warning goes away.`,
    });
  }
  if (reserved.length > 0) {
    issues.push({
      severity: "error",
      file: "Strain",
      code: "E11_STRAIN_NAME_RESERVED",
      specPin: specPinFor("E11_STRAIN_NAME_RESERVED"),
      count: reserved.length,
      rows: reserved,
      message: `${reserved.length} product(s) use a strain name CCRS reserves — "Strain name is invalid, cannot be Unknown, THC, or Other." [G L0358]. HELD BACK, not blocking: the strain is not sent and the lots that would name it are left out of this upload. Open the product (links on each row), set the real strain name (or leave it blank for a non-strain product), and rebuild.`,
    });
  }
  return { rows, warnings, issues };
}

/**
 * Area.csv — S-13: planned over the CCRS ledger by the pure core
 * (ccrs-area-core.ts, D-03, [BRIAN A11] [BRIAN A12], [G L0298-L0299]). The
 * old literals (`AREA-SALES-FLOOR`, a `Quarantine`/TRUE area) are gone: a new
 * "Sales Floor" record would silently become every lot's join target (E23),
 * and IsQuarantine TRUE "only applies to imported CBD" [G L0298].
 */
function buildAreaFile(
  env: LedgerEnv,
  license: string,
  createdBy: string,
  createdDate: string,
  ledger: LedgerView | null,
): { rows: string[][]; warnings: string[]; issues: CcrsSyncIssue[]; inventoryAreaName: string } {
  const plan = planAreaFile({ view: ledger, config: areaPlanFor(env), license, by: createdBy, date: createdDate });
  const issues: CcrsSyncIssue[] = [];
  for (const severity of ["error", "warning"] as const) {
    const these = plan.problems.filter((p) => p.severity === severity);
    if (these.length === 0) continue;
    issues.push({
      severity,
      file: "Area",
      code: "E46_AREA_LEDGER",
      specPin: specPinFor("E46_AREA_LEDGER"),
      count: these.length,
      rows: these.map((p) => ({ id: p.id, label: p.id, detail: p.detail })),
      message:
        severity === "error"
          ? `${these.length} Area record(s) the plan (D-03) relies on are not provably held by CCRS. An Update or Delete of a record CCRS does not hold is an error [G L0246-L0248]; reconcile the ledger before exporting.`
          : `${these.length} Area name(s) are held by more than one CCRS record; CCRS uses the most recently ingested one [BRIAN A12]. Advisory.`,
    });
  }
  return { rows: plan.rows, warnings: [], issues, inventoryAreaName: plan.inventoryAreaName };
}

function buildProductFile(
  items: MenuItemRow[],
  lots: LotRow[],
  license: string,
  createdBy: string,
  createdDate: string,
): {
  rows: string[][];
  warnings: string[];
  nameByProductKey: Map<string, string>;
  /** S-11: the product key behind each row in `rows`, same order. */
  keys: string[];
  issues: CcrsSyncIssue[];
  /** R74 S42: product key -> why its Product row is held (E9 / E57). */
  holds: Map<string, ProductHold>;
} {
  const warnings: string[] = [];
  const holds = new Map<string, ProductHold>();
  const e57Rows: CcrsIssueRow[] = [];
  const e9Rows: CcrsIssueRow[] = [];
  const e10Rows: CcrsIssueRow[] = [];
  // CCRS joins Inventory.Product -> Product.Name by the EXACT name string. We
  // record the final (clamped) Name we wrote for each raw product key so the
  // Inventory file can reference the IDENTICAL string. See
  // docs/CCRS_PRODUCT_NAMING_RESEARCH.md (the Inventory.Product join bug).
  const nameByProductKey = new Map<string, string>();
  // Weight per product key from lots (first non-null wins).
  const weightByKey = new Map<string, string>();
  for (const l of lots) {
    const key = (l.pos_product_key ?? "").trim();
    if (!key) continue;
    if (!weightByKey.has(key)) {
      const g = toGrams(l.unit_weight, l.unit_weight_uom);
      if (g) weightByKey.set(key, g);
    }
  }
  const seen = new Set<string>();
  const usedNamesLower = new Set<string>();
  const rows: string[][] = [];
  const keys: string[] = [];
  for (const it of items) {
    const key = (it.source_item_id ?? "").trim();
    if (!key) continue;
    const ext = sanitizeExternalId(key);
    if (!ext || seen.has(ext)) continue;
    seen.add(ext);
    const rawCategory = (it.pos_inventory_category ?? "").trim();
    const rawType = (it.pos_inventory_type ?? "").trim();
    const grams = weightByKey.get(key) ?? "";

    // SLICE 53 (two-layer naming, owner-approved): the CCRS Product.Name is
    // AUTO-COMPOSED from stored fields — short vendor + brand + display name +
    // measured cannabinoid tag + type + size ("Downtown Space OG Flower 1g").
    // The human-facing menu_items.name is untouched; the composed name lives
    // only in these files. Falls back to the display name when composition is
    // impossible (never guesses).
    const composed = composeCcrsProductName({
      name: (it.name ?? "").trim(),
      vendor: it.vendor_name,
      brand: it.brand_name,
      posInventoryCategory: it.pos_inventory_category,
      category: it.category,
      unitWeightGrams: grams || null,
      totalThc: jsonToCannabinoid(it.total_thc_json),
      totalCbd: jsonToCannabinoid(it.total_cbd_json),
      compounds: jsonToCompounds(it.compounds_json),
    });
    // CCRS joins Inventory.Product -> Product.Name by EXACT string, so two
    // DIFFERENT products must never share one Name. Deterministic suffix from
    // the product's own external id on collision (stable batch after batch).
    const disamb = disambiguateCcrsName(composed.name, ext, usedNamesLower);
    if (disamb.disambiguated) {
      warnings.push(
        `Product "${composed.name.slice(0, 40)}…": composed CCRS name collided with another product — suffixed to "${disamb.name.slice(0, 60)}" to keep the Inventory→Product join unambiguous.`,
      );
    }
    const productName = disamb.name;

    // C1 (Slice 55, owner-confirmed): the CCRS (InventoryCategory, InventoryType)
    // is derived from the vendor-set LCB TYPE alone (pos_inventory_type). The
    // house/merchandising label (pos_inventory_category, e.g. "Pre-roll",
    // "Gummies") is a STOREFRONT concept and is NOT used as a CCRS category — it
    // only feeds the composed Name above. Deriving the category from the type
    // (an inversion of the CCRS enum) is deterministic and never guesses; a
    // blank/unknown type still raises the pre-existing ERROR safety net so a
    // human fixes the source. NEVER-INVENT policy preserved.
    const cls = deriveCcrsClassificationFromType(rawType);
    let category = rawCategory;
    let type = rawType;
    if (cls.ok) {
      category = cls.category;
      type = cls.type;
      // Advisory (never blocks): a legacy 2021-vocabulary value ("Usable
      // Marijuana", inhalation concentrate under IntermediateProduct) was
      // canonicalized to the current Table 2 spelling/category. Surface it so
      // staff see what was translated.
      if (cls.aliased && cls.aliasNote) {
        warnings.push(`Product "${productName || ext}": ${cls.aliasNote}`);
      }
    } else {
      // R74 S42: HELD, never blocking. The row is kept for planning only;
      // applyProductHolds withholds it and every lot that names it.
      e57Rows.push({ id: key, label: productName || ext, detail: `${cls.error} Set the product's LCB inventory type.` });
      holds.set(key, { reason: `its InventoryType is not a CCRS type (${cls.error})` });
    }

    // C2: clamp Name (75) and Description (250); flag truncation (don't silently cut).
    const nameClamp = clampText(productName, CCRS_PRODUCT_NAME_MAX);
    if (nameClamp.truncated) {
      warnings.push(`Product "${productName.slice(0, 40)}…": Name exceeds ${CCRS_PRODUCT_NAME_MAX} chars and was truncated — shorten it in the source.`);
    }
    // Naming-convention check (drafts-only, surfaced as a warning): if the Name
    // violates the house convention (leading symbol, disallowed char, casing),
    // flag it so staff fix the source. Does NOT alter the value written here.
    const nameCheck = validateName(nameClamp.value);
    if (!nameCheck.ok) {
      warnings.push(
        `Product "${nameClamp.value.slice(0, 40)}…": name convention issues — ${nameCheck.issues.map((i) => i.message).join(" ")} Suggested: "${suggestName(nameClamp.value)}".`,
      );
    }
    // Record the exact Name for the Inventory.Product join (keyed by raw key).
    nameByProductKey.set(key, nameClamp.value);
    const descClamp = clampText(it.description, CCRS_PRODUCT_DESCRIPTION_MAX);
    if (descClamp.truncated) {
      warnings.push(`Product "${productName || ext}": Description exceeds ${CCRS_PRODUCT_DESCRIPTION_MAX} chars and was truncated — shorten it in the source.`);
    }

    // E9 / E10 — for Usable Cannabis and Cannabis Mix Packaged ONLY, the guide
    // makes UnitWeightGrams and Description mandatory:
    //   [G L0489-L0490] "required when InventoryType = Useable cannabis, or
    //                    Cannabis Mix Packaged All other product types weight
    //                    can be reported as 0"
    //   [G L0482-L0483] the same note for Description
    //   [G L0434] "If Useable Cannabis is selected, Unit Weight Gram cannot be 0"
    // `type` is the CANONICAL Table 2 value resolved above, so we compare that
    // rather than the raw vendor string.
    for (const found of productRowIssues({
      id: ext,
      label: nameClamp.value || ext,
      inventoryType: type,
      unitWeightGrams: grams,
      description: descClamp.value,
    })) {
      if (found.code === "E9_UNITWEIGHT_ZERO_USABLE") {
        e9Rows.push({ ...found.row, id: key });
        if (!holds.has(key)) holds.set(key, { reason: `"${type}" needs a unit weight in grams and none is recorded [G L0434]` });
      } else e10Rows.push(found.row);
    }

    rows.push([
      license,
      category,
      type,
      nameClamp.value,
      descClamp.value,
      grams,
      ext,
      createdBy,
      createdDate,
      "",
      "",
      "Insert",
    ]);
    keys.push(key);
  }
  if (rows.length === 0) warnings.push("No products found in the published menu.");
  // Cap the warning noise (errors first so critical mapping issues aren't buried).
  const unique = [...new Set(warnings)];
  const errorsFirst = [
    ...unique.filter((w) => w.startsWith("ERROR")),
    ...unique.filter((w) => !w.startsWith("ERROR")),
  ];
  const dedupWarnings = errorsFirst.slice(0, 30);
  const issues: CcrsSyncIssue[] = [];
  if (e9Rows.length > 0) {
    // R74 S42: held back, NOT blocking. The product row and every lot naming
    // it are left out (CCRS would reject them: "If Useable Cannabis is
    // selected, Unit Weight Gram cannot be 0" [G L0434]); the rest uploads.
    issues.push({
      severity: "error",
      file: "Product",
      code: "E9_UNITWEIGHT_ZERO_USABLE",
      specPin: specPinFor("E9_UNITWEIGHT_ZERO_USABLE"),
      count: e9Rows.length,
      rows: e9Rows,
      message: `${e9Rows.length} Usable Cannabis / Cannabis Mix Packaged product(s) have no unit weight, so CCRS would reject them ("If Useable Cannabis is selected, Unit Weight Gram cannot be 0" [G L0434]). HELD BACK, not blocking: each product and its lots are left out of this upload and stay on the still-owed list. Open the product (links on each row), set the gram weight, and rebuild. If it is a relic of old Cultivera data, press "Add to CCRS clean-up list" instead.`,
    });
  }
  if (e57Rows.length > 0) {
    issues.push({
      severity: "error",
      file: "Product",
      code: "E57_PRODUCT_TYPE_UNKNOWN",
      specPin: specPinFor("E57_PRODUCT_TYPE_UNKNOWN"),
      count: e57Rows.length,
      rows: e57Rows,
      message: `${e57Rows.length} product(s) have an LCB inventory type that is not a CCRS type, so CCRS would reject them ("Invalid InventoryCategory/InventoryType combination" [G L0415-L0417]). HELD BACK, not blocking: each product and its lots are left out of this upload. Open the product (links on each row), set its inventory type, and rebuild, or add a relic to the CCRS clean-up list.`,
    });
  }
  if (e10Rows.length > 0) {
    // R5-3 (S-02b): a WARNING, never blocking, and the row is still filed.
    // The guide has only a Note [G L0482-L0483] and CCRS ACCEPTED an empty
    // Description in PREprod (T-19, 2026-09-17). Withholding the product would
    // make every Inventory row naming it fail "Invalid Product" [G L0579].
    issues.push({
      severity: "warning",
      file: "Product",
      code: "E10_DESCRIPTION_REQUIRED",
      specPin: specPinFor("E10_DESCRIPTION_REQUIRED"),
      count: e10Rows.length,
      rows: e10Rows,
      message: `${e10Rows.length} Usable Cannabis / Cannabis Mix Packaged product(s) have no Description. They are still filed: CCRS accepted an empty Description in PREprod (T-19), because the guide states it only as a Note [G L0482-L0483]. The examiner says "There is an expectation that a description is on file" [EXAM L0552], so add a short description (250 characters max) when you can.`,
    });
  }
  return { rows, warnings: dedupWarnings, nameByProductKey, keys, issues, holds };
}

function buildInventoryFile(
  lots: LotRow[],
  license: string,
  createdBy: string,
  plan: LedgerPlan,
  areaName: string,
  menuPresence: MenuPresence | null = null,
): { rows: string[][]; warnings: string[]; issues: CcrsSyncIssue[] } {
  const warnings: string[] = [];
  const rows: string[][] = [];
  // S-02 coded pre-flight errors. Rows are collected, never capped.
  const e45Rows: CcrsIssueRow[] = [];
  const e7Rows: CcrsIssueRow[] = [];
  const e8Rows: CcrsIssueRow[] = [];
  // S-10: a lot with NO assigned ccrs_inventory_external_id is withheld, never
  // given an id invented at export time (standing rule 3). Every receiving-
  // intake and Cultivera-import lot is assigned one when it is created, so this
  // only fires on an anomaly — exactly the lot an employee must look at.
  const e3Rows: CcrsIssueRow[] = [];
  // S-11: lots the ledger routing refuses (uncertain / deleted / unknown id, or
  // a filed lot whose filed product cannot be proven) — never guessed at.
  const e41Rows: CcrsIssueRow[] = [];
  for (const l of lots) {
    const ext = assignedInventoryExternalId(l);
    if (!ext) {
      e3Rows.push({
        id: l.id,
        label: l.lot_code ?? l.product_name ?? l.id,
        detail: "No CCRS inventory identifier is assigned to this lot.",
      });
      continue;
    }
    const key = (l.pos_product_key ?? "").trim();
    const planned = plan.lots.get(l.id);
    if (!planned) throw new Error(`S-11 invariant: lot ${l.id} has no ledger plan`);
    if (planned.action === "withhold") {
      // R74 S25: a held Cultivera lot is reported once, by E52 (identity guard).
      if (planned.reason === CULTIVERA_NOT_ON_RECORD_REASON) continue;
      // R74 S42: a clean-up-list product's lots are reported once, by E58.
      if (planned.reason === CLEANUP_LOT_REASON) continue;
      // S-17b: "its product is not in the published menu" says WHY (hidden
      // with its reason / staged only / no item / blank key).
      e41Rows.push({ id: l.id, label: l.lot_code ?? ext, detail: enrichLotWithholdReason(planned.reason, key, menuPresence) });
      continue;
    }
    // S-11: the Strain cell carries the ONE spelling the plan chose (the filed
    // casing when CCRS has it) — Valid Values: Strain.Strain [G L0552].
    const strain = planned.strain;
    // CCRS joins Inventory.Product -> Product.Name by the EXACT name string
    // (NOT by ExternalIdentifier) [G L0580-L0583]. For a lot CCRS already
    // holds, that is the name its FILED product carries; otherwise the Name
    // buildProductFile wrote. See docs/CCRS_PRODUCT_NAMING_RESEARCH.md.
    const productName = planned.productName;
    if (!productName) {
      warnings.push(
        `Lot ${l.id}: no matching Product.Name for key "${key}" — Inventory.Product would be blank/invalid. Ensure the product is in the published menu.`,
      );
    }
    // S-13: every lot sits in the one surviving Sales Floor. A held lot is NOT
    // moved to a quarantine Area: "IsQuarantine True only applies to imported
    // CBD" [G L0298-L0299]. How a hold is shown to CCRS is open (N-01, OD-3).
    const area = areaName;
    if (isHeldLotStatus(l.status)) e45Rows.push({ id: l.id, label: l.lot_code ?? ext, detail: `status "${l.status}" → Area "${areaName}"` });
    const totalCostMinor = (l.unit_cost_minor_units ?? 0) * (l.received_qty ?? 0);

    // E7 [G L0614] / E8 [G L0597]. The decision lives in the pure core so it is
    // unit-tested directly; a failing row is WITHHELD because CCRS rejects
    // that row, tells us only by email [FAQ L0102], and every later row that
    // references it fails too (CCRS accepts row-by-row: U-17 CLOSED FALSE,
    // PREprod P20261005A/P20261006A, Brian A24).
    const initialQty = l.received_qty ?? 0;
    const onHandQty = l.on_hand_qty ?? 0;
    const verdict = inventoryRowVerdict({
      id: l.id,
      label: l.lot_code ?? ext,
      initialQty,
      onHandQty,
      totalCostMinorUnits: totalCostMinor,
      isSample: l.is_sample === true,
    });
    if (!verdict.emit) {
      if (verdict.code === "E8_ONHAND_GT_INITIAL") e8Rows.push(verdict.row);
      else e7Rows.push(verdict.row);
      continue;
    }

    rows.push([
      license,
      strain,
      area,
      productName,
      String(l.received_qty ?? 0),
      String(l.on_hand_qty ?? 0),
      verdict.totalCost,
      "FALSE", // IsMedical — medical exemptions are tracked per-sale, not per-lot
      ext,
      createdBy,
      // SLICE 2 — report the day the lot was ACTUALLY received when we can
      // evidence it. This used to be `ccrsDate(l.created_at)` unconditionally;
      // for a lot whose POS export had a blank Received date, created_at is
      // the instant the migration ran, so the LCB was being told the lot was
      // created on import day. ccrsInventoryCreatedDate() prefers the
      // evidenced received_on and falls back to created_at only when the date
      // is genuinely unknown — and those lots are flagged for the owner rather
      // than quietly given a manufactured date.
      //
      // This is a no-op for the ~3,977 lots that DID carry a received date:
      // SLICE 1 already set their created_at to noon UTC on that same day, so
      // the emitted MM/DD/YYYY is byte-identical.
      ccrsDate(ccrsInventoryCreatedDate(l)),
      "",
      "",
      planned.op,
    ]);
    // S-10: filed ids carry dots (4,295 in the LCB delivery) and are legal
    // [G L0224]; only CSV-breaking characters and > 100 chars are flagged.
    const idErrs = validatePassThroughExternalId(ext);
    if (idErrs.length) warnings.push(`Inventory id "${ext}" ${idErrs.join(", ")}.`);
  }
  if (rows.length === 0) warnings.push("No inventory lots found to report.");
  const issues: CcrsSyncIssue[] = [];
  if (e3Rows.length > 0) {
    issues.push({
      severity: "error",
      file: "Inventory",
      code: "E3_EXTERNAL_ID_UNASSIGNED",
      specPin: specPinFor("E3_EXTERNAL_ID_UNASSIGNED"),
      count: e3Rows.length,
      rows: e3Rows,
      message: `${e3Rows.length} lot(s) have no CCRS inventory identifier assigned, so they were left out of Inventory.csv. ExternalIdentifier is required on every row [G L0224-L0225]. Open each lot and enter the identifier it was filed under in CCRS (for stock Cultivera reported, that is the barcode exactly as printed), then rebuild.`,
    });
  }
  if (e41Rows.length > 0) {
    issues.push({
      severity: "error",
      file: "Inventory",
      code: "E41_LEDGER_WITHHELD",
      specPin: specPinFor("E41_LEDGER_WITHHELD"),
      count: e41Rows.length,
      rows: e41Rows,
      message: `${e41Rows.length} lot(s) were left out of Inventory.csv because we cannot prove what CCRS holds for them. Insert creates a record and Update alters "an existing record indicated by external identifier" [G L0246-L0248], so sending either on a guess risks a rejected file. Each row says why; reconcile it, then rebuild.`,
    });
  }
  if (e8Rows.length > 0) {
    issues.push({
      severity: "error",
      file: "Inventory",
      code: "E8_ONHAND_GT_INITIAL",
      specPin: specPinFor("E8_ONHAND_GT_INITIAL"),
      count: e8Rows.length,
      rows: e8Rows,
      message: `${e8Rows.length} lot(s) report more on hand than were ever received. CCRS rejects the Inventory file with "QuanityOnHand is greater than InitialQuantity" [G L0597]. Recount the lot or correct the received quantity, then rebuild.`,
    });
  }
  if (e7Rows.length > 0) {
    issues.push({
      severity: "error",
      file: "Inventory",
      code: "E7_TOTALCOST_ZERO",
      specPin: specPinFor("E7_TOTALCOST_ZERO"),
      count: e7Rows.length,
      rows: e7Rows,
      message: `${e7Rows.length} lot(s) have no cost, so TotalCost would be 0 and CCRS rejects the Inventory file ("TotalCost cannot equal 0" [G L0614]). Enter the unit cost on each lot. A vendor TRADE SAMPLE should be marked as a sample instead — it reports $0.01 [FAQ L0035].`,
    });
  }
  if (e45Rows.length > 0) {
    issues.push({
      severity: "warning",
      file: "Inventory",
      code: "E45_HELD_LOT_NOT_AN_AREA",
      specPin: specPinFor("E45_HELD_LOT_NOT_AN_AREA"),
      count: e45Rows.length,
      rows: e45Rows,
      message: `${e45Rows.length} lot(s) are on hold (quarantine or recalled) in our system. They are reported in the "${areaName}" Area, not a quarantine Area: "IsQuarantine True only applies to imported CBD. There are no quarantine requirements for cannabis products and must have an entry as False." [G L0298-L0299]. Advisory; a held lot that is sold is still an error.`,
    });
  }
  return { rows, warnings: [...new Set(warnings)], issues };
}

// ---------------------------------------------------------------------------
// The full batch
// ---------------------------------------------------------------------------

export async function buildCcrsBatch(
  fromISO: string,
  toISO: string,
  opts: { env?: LedgerEnv } = {},
): Promise<CcrsBatch> {
  const env: LedgerEnv = opts.env ?? "prod";
  const license = await getCcrsLicenseSettings();
  const submittedBy = license.submittedBy || "Greenway";
  const createdBy = submittedBy;
  const now = new Date();
  const createdDate = ccrsDate(now);
  const syncIssues: CcrsSyncIssue[] = [];

  const emptyBatch = (): CcrsBatch => ({
    licenseNumber: license.licenseNumber,
    submittedBy,
    fromISO,
    toISO,
    files: [],
    syncIssues,
    totalRecords: 0,
    generatedAt: now.toISOString(),
    ledger: { env, view: null, absentReason: "not-configured", lastStamp: null, unassignedProductKeys: [] },
    identity: null,
    corrections: { exportReturnIds: [], emitted: 0, withheld: 0, invalid: 0, reflected: 0 },
  });

  if (!license.licenseNumber) {
    syncIssues.push({
      severity: "error",
      file: "General",
      message: "License number is not set, so no file can name the store. Add it on Reports → Compliance (/admin/reports/compliance, License settings), then rebuild. This is the only setting the upload cannot work without.",
    });
  }

  if (!isSupabaseServiceConfigured) {
    syncIssues.push({ severity: "error", file: "General", message: "Supabase is not configured." });
    return emptyBatch();
  }

  const admin = createSupabaseAdminClient();

  // --- Master data (published menu + inventory lots) ------------------------
  const versionId = await getPublishedVersionId(admin);
  let items: MenuItemRow[] = [];
  if (versionId) {
    // R74 S39: PAGED. The bare select hit the PostgREST 1,000-row cap, so a
    // menu of more than 1,000 visible items lost the rest: PREprod showed
    // exactly "1000 products" and 2,240 lots "product not in the published
    // menu" (their items were past row 1,000), and production lots of those
    // products could not be named either.
    items = await pagedAll<MenuItemRow>(async (from, to) => {
      const { data, error } = await admin
        .from("menu_items")
        .select(
          "source_item_id, name, strain_name, strain_type, pos_inventory_type, pos_inventory_category, description, brand_name, vendor_name, category, total_thc_json, total_cbd_json, compounds_json",
        )
        .eq("menu_version_id", versionId)
        .eq("hidden", false)
        .order("id", { ascending: true })
        .range(from, to);
      if (error) throw new Error(`R74 S39: reading the published menu for CCRS failed: ${error.message}`);
      return (data as MenuItemRow[] | null) ?? [];
    });
  } else {
    syncIssues.push({
      severity: "warning",
      file: "Product",
      message: "No published menu version — Strain/Product files will be empty.",
    });
  }
  const itemsByKey = new Map(items.map((i) => [i.source_item_id.trim(), i]));

  // SLICE 2: paged. `.limit(5000)` did NOT raise the PostgREST 1,000-row cap,
  // so with 4,179 lots the Inventory.csv filed with the WA LCB contained the
  // first 1,000 lots and silently omitted the rest. That is an incomplete
  // state traceability filing, which is why this is fixed in the same slice
  // as the received date. (Selecting `received_on` for CreatedDate.)
  const liveLots = await pagedAll<LotRow>(async (from, to) => {
    const { data } = await admin
      .from("inventory_lots")
      .select(LOT_COLUMNS)
      .neq("status", "destroyed")
      .order("id", { ascending: true })
      .range(from, to);
    return (data as LotRow[] | null) ?? [];
  });

  // --- Event files first (R5-1) ---------------------------------------------
  // Adjustment + Sale are built BEFORE the ledger slice so the lots their rows
  // name are known. A lot destroyed down to 0 has status "destroyed" and is not
  // in `liveLots`, yet its Destruction adjustment names it; without an
  // Inventory row in the same emission CCRS (and our self-check) reject it:
  // "Invalid InventoryExternalIdentifier ... ensure that you have already
  // reported the inventory in an inventory.CSV" [G L1302-L1304]. The examiner's
  // own method is an Inventory Update to zero plus the adjustment [EXAM L0430].
  // So every destroyed lot an event row of THIS batch names is reported too.
  const [adj, sale] = await Promise.all([
    buildCcrsInventoryAdjustmentCsv(fromISO, toISO),
    buildCcrsSaleCsv(fromISO, toISO),
  ]);
  // R5-1: the customer returns whose Sale corrections this batch may carry.
  // Read BEFORE the destroyed-lot lookup: a correction row names its lot too.
  const returnsRead = await readReturnsForCorrections(admin, fromISO, toISO);
  const liveIds = new Set(liveLots.map((l) => assignedInventoryExternalId(l)).filter((x): x is string => !!x));
  const destroyedRefs = [
    ...new Set([
      ...eventLotRefs([
        { type: "InventoryAdjustment", csv: adj.csv },
        { type: "Sale", csv: sale.csv },
      ]),
      ...returnsRead.records.map((r) => r.inventoryExternalId).filter(Boolean),
    ]),
  ].filter((ref) => !liveIds.has(ref));
  const destroyedLots = await readDestroyedLots(admin, destroyedRefs);
  const lots: LotRow[] = [...liveLots, ...destroyedLots];

  // --- Build each master-data file ------------------------------------------
  // S-11: one pure plan routes every Strain/Product/Inventory row against the
  // ledger (what CCRS already holds). S-12b loads it: ccrs_ledger_slice returns
  // the entries for exactly these lots and product names (Part 03 §D.3). While
  // the 0248 migration is not applied or the seed is not finalized the slice
  // is "absent", `ledger` is null and the plan reproduces the pre-S-11 rows
  // (every row Insert, our ids). Any other failure THROWS: routing against a
  // partial ledger could turn an Update into an Insert.
  const productBuild = buildProductFile(items, lots, license.licenseNumber, createdBy, createdDate);
  const slice = await loadLedgerForBatch(
    admin,
    env,
    lots.map((l) => assignedInventoryExternalId(l)).filter((x): x is string => !!x),
    [...productBuild.nameByProductKey.values()],
  );
  const ledger: LedgerView | null = slice.kind === "loaded" ? slice.ledger.view : null;
  // R74 S42: a duplicated ledger id holds back ONLY the records it names
  // (lots with that Inventory id, products with that Product id), never the
  // whole batch. Listed as E59; the rest uploads.
  const dupIds = new Set(slice.kind === "loaded" ? slice.ledger.duplicates : []);
  if (dupIds.size > 0) {
    syncIssues.push({
      severity: "error",
      file: "Inventory",
      code: "E59_LEDGER_DUPLICATE_HELD",
      specPin: specPinFor("E59_LEDGER_DUPLICATE_HELD"),
      count: dupIds.size,
      rows: [...dupIds].map((d) => ({ id: d, label: d, detail: LEDGER_DUPLICATE_REASON })),
      message: `Our copy of the CCRS record holds ${dupIds.size} id(s) twice, so what CCRS holds for them cannot be proven. HELD BACK, not blocking: only the lots and products with these ids are left out of this upload; everything else uploads. Merging the examiner's fresh CCRS data copy (Compliance \u2192 CCRS \u2192 CCRS Records) settles them; then rebuild.`,
    });
  }
  // --- R5-1: the Sale ledger for this batch's sale lines ----------------------
  // One read (0283 ccrs_sale_slice) answers, per sale line this batch Inserts
  // or would correct, what CCRS holds and whether a file naming it is still
  // unanswered. Those entries are merged into the view the self-check and the
  // export route verify against, so a correction is only ever an Update or
  // Delete of a line CCRS holds [FAQ L0052-L0053, G L1413-L1414], and an
  // Insert is never sent for a line CCRS already holds [G L1412].
  const SALE_DETAIL = CCRS_COLUMNS.Sale.indexOf("SaleDetailExternalIdentifier");
  const correctionLineIds = [...new Set(returnsRead.records.map((r) => r.saleDetailExternalId).filter(Boolean))];
  const saleSlice = ledger ? await loadSaleSlice(admin, env, [...sale.rows.map((r) => r[SALE_DETAIL]), ...correctionLineIds]) : null;
  let saleAwareLedger: LedgerView | null = null;
  if (ledger && saleSlice?.kind === "loaded") {
    const merged = buildLedgerView(env, [...ledger.entries.values(), ...saleLedgerEntries(saleSlice.held)], ledger.productIdByKey);
    if (merged.duplicates.length > 0) throw new Error(`R5-1: Sale ledger entries collide with the batch ledger: ${merged.duplicates.join(", ")}`);
    saleAwareLedger = merged.view;
  }
  // R74 S25: the identity guard. A Cultivera lot whose id CCRS does not hold
  // (production) is held BEFORE planning, so it neither becomes an Insert nor
  // makes its product ask for a GWP- id (ccrs-identity-guard-core).
  const migrationManifestIds = await readMigrationManifestIds(admin, lots);
  const identityLots: IdentityLot[] = lots.map((l) => ({
    lotId: l.id,
    label: l.lot_code ?? l.product_name ?? l.id,
    lotCode: l.lot_code,
    ccrsId: assignedInventoryExternalId(l),
    productKey: (l.pos_product_key ?? "").trim(),
    isCultivera: lotFlaggedCultivera(l, migrationManifestIds),
  }));
  const identityHeld = cultiveraLotsToHold({ env, view: ledger, lots: identityLots });
  const rawPlan = planLedgerBatch({
    view: ledger,
    lots: lots
      .filter((l) => !identityHeld.has(l.id))
      .map((l) => ({ l, ext: assignedInventoryExternalId(l) }))
      .filter((x): x is { l: LotRow; ext: string } => !!x.ext)
      .map(({ l, ext }) => {
        const key = (l.pos_product_key ?? "").trim();
        return {
          lotId: l.id,
          label: l.lot_code ?? ext,
          inventoryExternalId: ext,
          productKey: key,
          strain: ((key ? itemsByKey.get(key) : undefined)?.strain_name ?? "").trim(),
        };
      }),
    products: productBuild.keys.map((key, i) => ({
      key,
      legacyId: productBuild.rows[i][CCRS_COLUMNS.Product.indexOf("ExternalIdentifier")],
      ourName: productBuild.nameByProductKey.get(key) ?? "",
    })),
    strains: items.map((it) => (it.strain_name ?? "").trim()).filter(Boolean),
  });
  const identityPlan = applyIdentityHolds(rawPlan, identityHeld, identityLots);
  // R74 S42: products CCRS would reject (E9 no unit weight, E57 unknown type)
  // and products on the owner's clean-up list (E58) are withheld with every
  // lot that would name them; a reserved strain (E11) or a duplicated ledger
  // id (E59) holds only its own lots. Nothing here blocks the batch.
  const cleanup = await readCleanupList(admin);
  const cleanupKeys = new Map(cleanup.items.map((c) => [c.key, c]));
  const productHolds = new Map<string, ProductHold>(productBuild.holds);
  for (const c of cleanup.items) productHolds.set(c.key, { reason: "on the CCRS clean-up list (removed from CCRS reporting by the owner)", cleanup: true });
  for (const [key, id] of ledger?.productIdByKey ?? new Map<string, string>()) {
    if (dupIds.has(`Product/${id}`) && !productHolds.has(key)) productHolds.set(key, { reason: LEDGER_DUPLICATE_REASON });
  }
  const dupLots = new Map<string, string>();
  for (const l of lots) {
    const ext = assignedInventoryExternalId(l);
    if (ext && dupIds.has(`Inventory/${ext}`)) dupLots.set(l.id, LEDGER_DUPLICATE_REASON);
  }
  const holdResult = applyProductHolds({
    plan: identityPlan,
    view: ledger,
    products: productHolds,
    lots: dupLots,
    lotKeys: lots.map((l) => ({ lotId: l.id, productKey: (l.pos_product_key ?? "").trim() })),
  });
  const plan = holdResult.plan;
  // E9 / E57 list only the products really left out (a product with no row of
  // its own, because every lot names a filed product, is not held).
  productBuild.issues = productBuild.issues.flatMap((i) => {
    if (i.code !== "E9_UNITWEIGHT_ZERO_USABLE" && i.code !== "E57_PRODUCT_TYPE_UNKNOWN") return [i];
    const rows = (i.rows ?? []).filter((r) => holdResult.heldProducts.has(r.id) && !cleanupKeys.has(r.id));
    if (rows.length === 0) return [];
    return [{ ...i, rows, count: rows.length, message: i.message.replace(/^\d+ /, `${rows.length} `) }];
  });
  if (cleanup.error) {
    syncIssues.push({ severity: "warning", file: "General", message: `Could not read the CCRS clean-up list (${cleanup.error}); products on it may appear as held back this time.` });
  }
  const cleanupInMenu = items.filter((it) => cleanupKeys.has((it.source_item_id ?? "").trim()));
  if (cleanup.items.length > 0) {
    const lotsByKey = new Map<string, number>();
    for (const l of lots) {
      const k = (l.pos_product_key ?? "").trim();
      if (cleanupKeys.has(k)) lotsByKey.set(k, (lotsByKey.get(k) ?? 0) + 1);
    }
    syncIssues.push({
      severity: "warning",
      file: "Product",
      code: "E58_PRODUCT_ON_CLEANUP_LIST",
      specPin: specPinFor("E58_PRODUCT_ON_CLEANUP_LIST"),
      count: cleanup.items.length,
      rows: cleanup.items.map((c) => ({ id: c.key, label: c.label, detail: `on the clean-up list since ${c.at.slice(0, 10) || "?"}; ${lotsByKey.get(c.key) ?? 0} lot(s) left out${cleanupInMenu.some((i) => (i.source_item_id ?? "").trim() === c.key) ? "" : " (no longer in the published menu)"}` })),
      message: `${cleanup.items.length} product(s) are on your CCRS clean-up list, so they and their lots are not reported (and are not counted as owed). Remove one from the list (button on its row) to report it again.`,
    });
  }
  const identity = buildIdentityProof({ env, view: ledger, lots: identityLots, plan, held: identityHeld });
  syncIssues.push(...identityIssues(identity, slice.kind === "loaded" ? null : slice.reason));
  const strain = buildStrainFile(items, license.licenseNumber, submittedBy, createdBy, createdDate, plan);
  const area = buildAreaFile(env, license.licenseNumber, createdBy, createdDate, ledger);
  const product = { ...productBuild, ...applyProductPlan(productBuild.rows, productBuild.keys, plan) };
  // S-17b: keys of every visible published item that has a product plan. A
  // lot whose key is not here names a product Product.csv cannot carry. Only
  // the lots the PLANNER withheld for that reason are spoken about (a filed lot
  // whose product left the menu is emitted under its filed product, so it is
  // not left out; an E3 / routing-refused lot already has its own reason).
  const plannedKeys = new Set(plan.products.keys());
  // Legacy mode (no ledger view) withholds nothing: such a lot is written with
  // a blank Product cell, and the E47 message says so.
  const coverageLots = (ledger ? lotsWithheldForMissingProduct(lots, plan.lots) : legacyLotsWithBlankProduct(lots, plan.lots, plannedKeys)).map((l) => ({
    id: l.id,
    label: l.lot_code ?? l.id,
    productKey: (l.pos_product_key ?? "").trim(),
  }));
  const menuPresence = await readMenuPresence(
    admin,
    versionId,
    items.map((i) => i.source_item_id),
    keysNeedingMenuLookup(coverageLots, plannedKeys),
  );
  const inventory = buildInventoryFile(lots, license.licenseNumber, createdBy, plan, area.inventoryAreaName, menuPresence);
  const routingWithheld = product.withheld.filter((w) => !productHolds.has(w.key) || productHolds.get(w.key)!.reason === LEDGER_DUPLICATE_REASON);
  if (routingWithheld.length > 0) {
    syncIssues.push({
      severity: "error",
      file: "Product",
      code: "E41_LEDGER_WITHHELD",
      specPin: specPinFor("E41_LEDGER_WITHHELD"),
      count: routingWithheld.length,
      rows: routingWithheld.map((w) => ({ id: w.key, label: w.label, detail: w.reason })),
      message: `${routingWithheld.length} product(s) were left out of Product.csv because no CCRS Product id is assigned or its CCRS status is unproven [G L0246-L0248]. Lots of these products are withheld from Inventory.csv too.`,
    });
  }
  if (plan.nameFromLedger.length > 0) {
    syncIssues.push({
      severity: "warning",
      file: "Inventory",
      code: "E40_PRODUCT_NAME_FROM_LEDGER",
      specPin: specPinFor("E40_PRODUCT_NAME_FROM_LEDGER"),
      count: plan.nameFromLedger.length,
      rows: plan.nameFromLedger.map((n) => ({ id: n.lotId, label: n.label, detail: `ours "${n.ours}" → filed "${n.filed}"` })),
      message: `${plan.nameFromLedger.length} lot(s) are already filed in CCRS under a product whose name differs from ours. Inventory must name the product "in the same format and spelling as previously submitted" [G L0580-L0583], so the filed name was used. To change the name in CCRS, choose Rename for that product.`,
    });
  }

  // S-02: coded, pinned pre-flight errors from the master-data builders. These
  // are BLOCKING — the submit gate refuses to build the zip while any remain,
  // because CCRS rejects each bad row (row-by-row acceptance, U-17 CLOSED
  // FALSE), tells us only by email [FAQ L0102], and dependent rows then fail.
  syncIssues.push(...strain.issues, ...area.issues, ...product.issues, ...inventory.issues);

  // Adjustment + Sale were built above (R5-1: before the ledger slice).

  const files: CcrsFile[] = [];
  const encode = (type: CcrsRetailerFileType, rawRows: string[][]) => {
    // S-09 E38 / S-09b E42-E44: CCRS splits every row on every comma and does
    // not honour quoting (PREprod P20261005A). Free-text columns are rewritten
    // (`,`→`;`, `"`→`'`, reported); a line break, or a comma/quote in any other
    // column, withholds the row (never silently dropped, never sent shifted).
    // A product withheld for its Name also withholds its lots: the same Name
    // sits in Inventory.Product, so those rows are caught here too.
    const e38 = withholdUnencodableRows(
      rawRows,
      CCRS_COLUMNS[type],
      (r, i) => {
        // R5-1: a Sale row is named by its line id (Sale has no ExternalIdentifier).
        const ext = CCRS_COLUMNS[type].indexOf(type === "Sale" ? "SaleDetailExternalIdentifier" : "ExternalIdentifier");
        const name = CCRS_COLUMNS[type].indexOf(type === "Strain" ? "Strain" : type === "Area" ? "Area" : "Name");
        return (ext >= 0 && r[ext]) || (name >= 0 && r[name]) || `row ${i + 1}`;
      },
      CCRS_FREE_TEXT_COLUMNS[type] ?? [],
    );
    const rows = e38.rows;
    for (const reason of ["line break", "comma"] as const) {
      const these = e38.withheld.filter((w) => w.reason === reason);
      if (these.length === 0) continue;
      const code = CCRS_UNENCODABLE_CODE[reason];
      syncIssues.push({
        severity: "error",
        file: type,
        code,
        specPin: specPinFor(code),
        count: these.length,
        rows: these.map((w) => ({ id: w.label, label: w.label, detail: `${w.column} contains a ${reason}` })),
        message: unencodableMessage(type, these),
      });
    }
    if (e38.rewritten.length > 0) {
      syncIssues.push({
        severity: "warning",
        file: type,
        code: "E44_FREE_TEXT_REWRITTEN",
        specPin: specPinFor("E44_FREE_TEXT_REWRITTEN"),
        count: e38.rewritten.length,
        rows: e38.rewritten.map((w) => ({ id: w.label, label: w.label, detail: `${w.column}: "${w.before}" → "${w.after}"` })),
        message: freeTextRewriteMessage(type, e38.rewritten),
      });
    }
    return { rows, withheld: e38.withheld };
  };
  const push = (
    type: CcrsRetailerFileType,
    rawRows: string[][],
    warnings: string[],
    skipped = 0,
  ) => {
    const { rows, withheld } = encode(type, rawRows);
    files.push({
      type,
      group: uploadGroupOf(type),
      fileName: ccrsFileName(type, license.licenseNumber, now),
      csv: assembleCcrsFile({ type, submittedBy, submittedDate: now, rows }),
      recordCount: rows.length,
      skipped: skipped + withheld.length,
      warnings,
      empty: rows.length === 0,
    });
  };

  push("Strain", strain.rows, strain.warnings);
  push("Area", area.rows, area.warnings);
  push("Product", product.rows, product.warnings);
  // R6-3: Inventory is pushed AFTER the event files below, because a lot an
  // event row of this batch names is always re-sent (planInventoryDelta).

  // Adjustment + Sale come pre-assembled by their own builders; the
  // Adjustment file is pushed after R74 S39 drops rows whose lot is held.
  // --- InventoryTransfer (R6-2) ----------------------------------------------
  // The retailer is the RECEIVING licensee, so the retailer files it, weekly:
  // "only the receiving licensee is required to submit ... inventory transfer"
  // [G L0124-L0128, G L0143-L0144, G L1162]. One row per accepted lot of a
  // real delivery (Cultivera migration lots are skipped: Cultivera filed them).
  // Prod: the owner's obligation start date is a hard floor and, with the
  // transfer ledger loaded, any earlier lot never filed is caught up. The
  // ledger (0285 ccrs_transfer_slice) stops a re-Insert ("Duplicate
  // InventoryTransfer for Licensee" [G L1190]).
  const fromDay = pacificDayKey(fromISO);
  const toDay = pacificDayKey(toISO);
  const transferRead = await readTransferLots(admin, toDay);
  let transferRows: string[][] = [];
  const transferWarnings: string[] = [];
  if (transferRead.kind === "absent") {
    transferWarnings.push("InventoryTransfer is empty: migration 0285 (vendor inventory ids) is not applied yet. Apply it, then rebuild.");
  } else {
    const obligation = env === "prod" ? await getObligationContext() : null;
    const notBefore = obligation?.startDate ?? null;
    const transferIds = transferRead.lots.map((l) => l.ourId).filter((x): x is string => !!x).map(transferExternalId);
    const transferSlice = ledger ? await loadTransferSlice(admin, env, transferIds) : null;
    const held = transferSlice?.kind === "loaded" ? transferSlice.held : null;
    if (held) {
      const merged = buildLedgerView(env, [...(saleAwareLedger ?? ledger!).entries.values(), ...transferLedgerEntries(held)], ledger!.productIdByKey);
      if (merged.duplicates.length > 0) throw new Error(`R6-2: InventoryTransfer ledger entries collide with the batch ledger: ${merged.duplicates.join(", ")}`);
      saleAwareLedger = merged.view;
    }
    const reportable = new Set<string>();
    const invExt = CCRS_COLUMNS.Inventory.indexOf("ExternalIdentifier");
    for (const r of inventory.rows) if (r[invExt]) reportable.add(r[invExt]);
    if (ledger) {
      for (const e of ledger.entries.values()) {
        if (e.fileType === "Inventory" && (e.state === "seed" || e.state === "filed" || e.state === "confirmed" || e.state === "closed")) reportable.add(e.externalId);
      }
    }
    const tplan = buildTransferRows({
      lots: transferRead.lots,
      licenseNumber: license.licenseNumber,
      createdBy,
      fromDay,
      toDay,
      notBefore,
      // Catch-up needs BOTH the ledger (to know what was already filed) and
      // the floor (so years of pre-Greenway deliveries are never swept in).
      catchUp: env === "prod" && held !== null && notBefore !== null,
      held,
      reportable,
    });
    transferRows = tplan.rows;
    if (env === "prod" && notBefore === null) {
      transferWarnings.push("InventoryTransfer covers this week only: set the CCRS obligation start date so missed earlier weeks are caught up.");
    }
    const byCode = new Map<TransferIssueCode, typeof tplan.issues>();
    for (const i of tplan.issues) byCode.set(i.code, [...(byCode.get(i.code) ?? []), i]);
    for (const [code, list] of byCode) {
      syncIssues.push({
        severity: TRANSFER_BLOCKING.has(code) ? "error" : "warning",
        file: "InventoryTransfer",
        code,
        specPin: specPinFor(code),
        count: list.length,
        rows: list.map((i) => ({ id: i.manifestId ?? i.lotId, label: i.label, detail: i.detail })),
        message: TRANSFER_ISSUE_TEXT[code](list.length),
      });
    }
    if (tplan.rows.length > 0 || tplan.alreadyHeld.length > 0) transferWarnings.push(transferSummaryText(tplan));
  }
  push("InventoryTransfer", transferRows, transferWarnings);
  // --- Sale: this range's Inserts + customer-return corrections (R5-1) ------
  // ONE Sale file per emission (planOutboxFiles refuses two). The Insert rows
  // already passed E38 in buildCcrsSaleCsv; correction rows pass it here.
  let insertRows: string[][] = sale.rows;
  let corrections: ReturnCorrectionPlan = { rows: [], groups: [], withheld: [], invalid: [], reflected: [] };
  const saleNotes: CorrectionNote[] = [];
  if (saleAwareLedger && saleSlice?.kind === "loaded") {
    const routed = routeSaleInserts(sale.rows, saleSlice.held);
    insertRows = routed.rows;
    if (routed.alreadyHeld.length > 0) {
      syncIssues.push({
        severity: "warning",
        file: "Sale",
        code: "E49_SALE_LINE_ALREADY_HELD",
        specPin: specPinFor("E49_SALE_LINE_ALREADY_HELD"),
        count: routed.alreadyHeld.length,
        rows: routed.alreadyHeld.map((d) => ({ id: d, label: d, detail: `ledger state ${saleSlice.held.get(d)?.state ?? "?"}` })),
        message: `${routed.alreadyHeld.length} sale line(s) in this range are already held by CCRS (${env}), so they were not Inserted again: a second Insert is rejected as "Duplicate Sale detail item for Licensee" [G L1412]. Nothing to do.`,
      });
    }
    if (routed.uncertain.length > 0) {
      syncIssues.push({
        severity: "error",
        file: "Sale",
        code: "E49_SALE_LINE_ALREADY_HELD",
        specPin: specPinFor("E49_SALE_LINE_ALREADY_HELD"),
        count: routed.uncertain.length,
        rows: routed.uncertain.map((d) => ({ id: d, label: d, detail: `ledger state ${saleSlice.held.get(d)?.state ?? "?"}` })),
        message: `${routed.uncertain.length} sale line(s) were left out of Sale.csv because the ${env} ledger cannot say whether CCRS holds them (an earlier file's outcome is not recorded). An Insert of a held line is rejected [G L1412] and leaving it out under-reports the sale, so record that file's outcome in the CCRS hub, then rebuild.`,
      });
    }
    corrections = planReturnCorrections({
      returns: returnsRead.records,
      license: { licenseNumber: license.licenseNumber, submittedBy },
      ledger: saleSlice.held,
      insertedDetailIds: new Set(insertRows.map((r) => r[SALE_DETAIL])),
      inFlightOnly: saleSlice.inFlightOnly,
    });
  } else if (returnsRead.records.some((r) => r.pending)) {
    // No Sale ledger to prove CCRS holds each line: nothing is corrected here.
    const why = !ledger
      ? `the ${env} ledger is not loaded (legacy routing); use the Sale correction download on the Disposition page`
      : "migration 0283 (ccrs_sale_slice) is not applied, so the batch cannot prove CCRS holds each sale line";
    const pendingByLine = new Map<string, string[]>();
    for (const r of returnsRead.records.filter((x) => x.pending)) {
      pendingByLine.set(r.saleDetailExternalId, [...(pendingByLine.get(r.saleDetailExternalId) ?? []), r.id]);
    }
    for (const [detailId, returnIds] of [...pendingByLine].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      saleNotes.push({ detailId, returnIds, reason: why });
    }
  }
  const correctionE38 = encode("Sale", corrections.rows);
  const e38WithheldLines = new Set(correctionE38.withheld.map((w) => w.label));
  // R74 S39: an event row (Sale / Adjustment) whose lot is HELD BACK (not in
  // this Inventory.csv and not held by CCRS) is left out too, instead of
  // blocking the whole batch with L_REF_INVENTORY: CCRS would reject that one
  // row ("Invalid InventoryExternalIdentifier" [G L1302-L1304]) and nothing
  // else. The row is tracked as owed and goes out when the week is rebuilt
  // after its lot is fixed (an already-filed sale line is never re-Inserted:
  // routeSaleInserts / E49).
  const sendableLots = sendableLotIds(inventory.rows, saleAwareLedger ?? ledger);
  const heldWhy = new Map<string, string>();
  for (const l of lots) {
    const ext = assignedInventoryExternalId(l);
    const pl = plan.lots.get(l.id);
    if (ext && pl?.action === "withhold") heldWhy.set(ext, pl.reason);
  }
  const saleDrop = dropEventRowsForHeldLots("Sale", [...insertRows, ...correctionE38.rows], sendableLots, heldWhy);
  const adjDrop = dropEventRowsForHeldLots("InventoryAdjustment", csvDataRows(adj.csv), sendableLots, heldWhy);
  for (const d of saleDrop.dropped) e38WithheldLines.add(d.id);
  const saleRows = saleDrop.rows;
  if (adjDrop.dropped.length > 0) {
    adj.csv = assembleCcrsFile({ type: "InventoryAdjustment", submittedBy: license.submittedBy, rows: adjDrop.rows });
    adj.recordCount = adjDrop.rows.length;
    adj.skipped += adjDrop.dropped.length;
  }
  for (const d of [saleDrop, adjDrop]) {
    if (d.dropped.length === 0) continue;
    syncIssues.push({
      severity: "error",
      file: d.type,
      code: "E56_EVENT_ROW_LOT_HELD",
      specPin: specPinFor("E56_EVENT_ROW_LOT_HELD"),
      count: d.dropped.length,
      rows: d.dropped,
      message: heldEventRowsMessage(d.type, d.dropped.length),
    });
  }
  files.push({
    type: "InventoryAdjustment",
    group: uploadGroupOf("InventoryAdjustment"),
    fileName: adj.fileName,
    csv: adj.csv,
    recordCount: adj.recordCount,
    skipped: adj.skipped,
    warnings: adj.warnings,
    empty: adj.recordCount === 0,
  });
  const withheldNotes = [...corrections.withheld, ...saleNotes];
  if (withheldNotes.length > 0 || corrections.invalid.length > 0) {
    const all = [...withheldNotes, ...corrections.invalid];
    syncIssues.push({
      severity: "warning",
      file: "Sale",
      code: "E48_SALE_CORRECTION_WITHHELD",
      specPin: specPinFor("E48_SALE_CORRECTION_WITHHELD"),
      count: all.length,
      rows: all.map((n) => ({ id: n.detailId || "(no sale line id)", label: n.detailId || "(no sale line id)", detail: `${n.reason} (returns: ${n.returnIds.join(", ") || "none pending"})` })),
      message: `${all.length} customer-return Sale correction(s) were not put in Sale.csv. An Update or Delete of a sale line CCRS does not hold is rejected ("SaleDetailExternalIdentifier not found" [G L1413-L1414]), so each waits until the line is proven held; ${corrections.invalid.length} cannot be built from the return record and must be fixed there. The returns stay pending and are picked up by the next batch. Each row says why.`,
    });
  }
  // --- Inventory: send only what changed (R6-3) -----------------------------
  // "Inventory.CSV is required weekly ... only when inventory exists that is
  // unreported, or unreported updates to an existing inventory. No report is
  // needed if there are no changes." [G L0525-L0527]. An Update row equal to
  // what CCRS last ACCEPTED (0286 ccrs_inventory_last_told) is left out; every
  // sent Update carries UpdatedBy/UpdatedDate [G L0234-L0242]. Without the
  // ledger (legacy) or before 0286 every row is sent, as before.
  const invExtCol = CCRS_COLUMNS.Inventory.indexOf("ExternalIdentifier");
  const invOpCol = CCRS_COLUMNS.Inventory.indexOf("Operation");
  const updateIds = inventory.rows.filter((r) => r[invOpCol] === "Update").map((r) => r[invExtCol]);
  const told = ledger && updateIds.length > 0 ? await loadInventoryTold(admin, env, updateIds) : ({ kind: "absent" } as const);
  const namedByEvents = new Set([
    ...eventLotRefs([{ type: "InventoryAdjustment", csv: adj.csv }]),
    ...lotsNamedByEventRows({ adjustment: [], sale: saleRows, transfer: transferRows }),
  ]);
  const delta = planInventoryDelta({ rows: inventory.rows, told, namedByEvents, updatedBy: submittedBy, batchDay: createdDate });
  if (delta.unchanged.length > 0) {
    syncIssues.push({
      severity: "warning",
      file: "Inventory",
      code: "E51_INVENTORY_UNCHANGED_NOT_SENT",
      specPin: specPinFor("E51_INVENTORY_UNCHANGED_NOT_SENT"),
      count: delta.unchanged.length,
      rows: delta.unchanged.map((u) => ({ id: u.id, label: u.id, detail: `CCRS (${env}) already holds exactly these values (ledger state ${u.state ?? "?"})` })),
      message: `${delta.unchanged.length} lot(s) were not re-sent in Inventory.csv because CCRS already accepted exactly these values and nothing changed. "No report is needed if there are no changes." [G L0525-L0527]. Nothing to do: any lot that changes, or that a sale, adjustment or transfer in this batch names, is sent.`,
    });
  }
  push("Inventory", delta.rows, inventory.warnings);

  files.push({
    type: "Sale",
    group: uploadGroupOf("Sale"),
    fileName: ccrsFileName("Sale", license.licenseNumber, now),
    csv: assembleCcrsFile({ type: "Sale", submittedBy, submittedDate: now, rows: saleRows }),
    recordCount: saleRows.length,
    skipped: sale.skipped + correctionE38.withheld.length,
    warnings: sale.warnings,
    empty: saleRows.length === 0,
  });

  // Order files by upload group (1 → 2 → 3), preserving intra-group order.
  const order = new Map(CCRS_UPLOAD_ORDER.map((t, i) => [t, i]));
  files.sort((a, b) => (order.get(a.type) ?? 99) - (order.get(b.type) ?? 99));

  // --- Sync / data-integrity analysis (flag out-of-sync BEFORE upload) ------
  // S-10: same rule as buildInventoryFile's E3 — an unassigned id is missing,
  // whatever could be minted for it.
  // R74 S39: the uncoded duplicate of E3 that stood here was removed. It
  // counted the same lots as buildInventoryFile's coded E3 (which lists each
  // one and is held back, not blocking) and, having no code, blocked the
  // whole batch for lots that were already left out.

  // S-17b (U-60): lots whose product key has NO product plan, i.e. the product
  // is not a visible item of the published menu, so Product.csv cannot carry
  // it and Inventory.Product would be "Invalid Product" [G L0579-L0583].
  // Compared by product KEY. (Before S-17b this compared the lot key with
  // Product column 6, which after applyProductPlan holds the CCRS id the row is
  // filed under, so every lot of an emitted GWP- product looked orphaned:
  // production 2026-10-19 said "(38)" for 38 lots.) Products that ARE in the
  // menu but withheld are the E41 Product error, not repeated here. With a
  // ledger it is advisory: each such lot is already withheld from
  // Inventory.csv (E41 Inventory). In legacy mode the lot is WRITTEN with a
  // blank Product, which CCRS rejects ("Product is required" [G L0578]), so it
  // blocks.
  const notInMenu = lotsWithProductNotInMenu(coverageLots, plannedKeys, menuPresence);
  if (notInMenu.length > 0) {
    syncIssues.push({
      severity: ledger ? "warning" : "error",
      file: "Product",
      code: "E47_LOT_PRODUCT_NOT_IN_MENU",
      specPin: specPinFor("E47_LOT_PRODUCT_NOT_IN_MENU"),
      count: notInMenu.length,
      rows: notInMenu,
      message: e47Message(notInMenu.length, !ledger),
    });
  }

  // R74 S42 (owner, Round 22: "remove all blockers"): a ROW the offline
  // verifier or the ledger self-check would refuse is taken out of its file
  // and held back (E60) instead of refusing the whole zip. CCRS accepts row
  // by row (U-17 CLOSED FALSE). Repeated so a row that named a removed row
  // (a lot of a removed product, a sale of a removed lot) goes too. A FILE-
  // level problem (header, line endings, totals) is a code fault and still
  // blocks: it is never data the owner can fix.
  const e60Rows = new Map<CcrsRetailerFileType, CcrsIssueRow[]>();
  for (let pass = 0; pass < 4; pass += 1) {
    const refused = new Map<CcrsRetailerFileType, Map<number, string>>();
    const mark = (t: CcrsRetailerFileType, row: number, why: string) => {
      if (!refused.has(t)) refused.set(t, new Map());
      if (!refused.get(t)!.has(row)) refused.get(t)!.set(row, why);
    };
    for (const f of files) {
      for (const pr of verifyCcrsBatch([{ type: f.type, csv: f.csv }]).problems) {
        if (pr.severity !== "error") continue;
        for (const n of rowNumbersOf(pr.message)) mark(f.type, n, pr.message);
      }
    }
    if (f_saleRowsChecked(files)) {
      const sf = files.find((f) => f.type === "Sale")!;
      verifySaleNumericColumns(csvDataRows(sf.csv)).forEach((pr) => rowNumbersOf(pr.message).forEach((n) => mark("Sale", n, pr.message)));
    }
    if (ledger) {
      const planned = planOutboxFiles(
        files.map((f) => ({ type: f.type, csv: f.csv })),
        { licenseNumber: license.licenseNumber, now, lastStamp: null },
      );
      const chunkByName = new Map(planned.map((pf) => [pf.fileName, pf]));
      for (const pr of verifyOutboxAgainstLedger(saleAwareLedger ?? ledger, planned)) {
        if (pr.code === "L_TOTALS") continue;
        const pf = chunkByName.get(pr.fileName);
        if (pf) mark(pr.type, (pf.chunkNo - 1) * CCRS_CHUNK_ROWS + pr.row, `[${pr.code}] ${pr.message}`);
      }
    }
    if (refused.size === 0) break;
    for (const f of files) {
      const rows = refused.get(f.type);
      if (!rows) continue;
      const cols = CCRS_COLUMNS[f.type];
      const idCol = cols.indexOf(f.type === "Sale" ? "SaleDetailExternalIdentifier" : f.type === "Strain" ? "Strain" : "ExternalIdentifier");
      const nameCol = cols.indexOf(f.type === "Area" ? "Area" : "Name");
      const d = dropCsvDataRows(f.csv, new Set(rows.keys()));
      const nums = [...rows.keys()].sort((x, y) => x - y);
      d.dropped.forEach((line, i) => {
        const cells = ccrsReaderSplit(line);
        const id = (idCol >= 0 && cells[idCol]) || `${f.type} row ${nums[i]}`;
        const label = (nameCol >= 0 && cells[nameCol]) || id;
        if (!e60Rows.has(f.type)) e60Rows.set(f.type, []);
        e60Rows.get(f.type)!.push({ id, label, detail: rows.get(nums[i]) ?? "" });
      });
      f.csv = d.csv;
      f.recordCount = d.kept;
      f.skipped += d.dropped.length;
      f.empty = d.kept === 0;
    }
  }
  for (const [type, rows] of e60Rows) {
    syncIssues.push({
      severity: "error",
      file: type,
      code: "E60_ROW_REFUSED_HELD",
      specPin: specPinFor("E60_ROW_REFUSED_HELD"),
      count: rows.length,
      rows,
      message: `${rows.length} ${type} row(s) failed the last check before upload (a bad value, or a reference CCRS does not hold), so CCRS would reject them. HELD BACK, not blocking: each row was taken out of its file and everything else uploads. Each row says what is wrong; fix it at the source and rebuild.`,
    });
  }

  // Slice 96: numeric-column safety on the EMITTED Sale rows. Parse the assembled
  // Sale csv's data rows (skip the 3-row header + column row) and flag any
  // negative/NaN/mis-formatted Quantity or money value. Defense-in-depth — the
  // builder already skips bad lines, but this guarantees the file the LCB sees is
  // numerically sound. Never rewrites values.
  const saleFile = files.find((f) => f.type === "Sale");
  if (saleFile && saleFile.recordCount > 0) {
    const saleLines = saleFile.csv.replace(/\r\n$/, "").split("\r\n").slice(4);
    const saleRows = saleLines.map((l) => splitCsvLine(l));
    for (const p of verifySaleNumericColumns(saleRows)) {
      syncIssues.push({ severity: p.severity, file: "Sale", message: p.message });
    }
  }

  // S-17b (Part 17 §K.4): the export route refuses on the ledger self-check
  // (planOutboxFiles → verifyOutboxAgainstLedger). Running the SAME check here
  // makes the hub, the compliance report and the download agree: e.g. a Sale
  // row whose lot is not reported in Inventory.csv and not held by CCRS
  // ("Invalid InventoryExternalIdentifier" [G L1302-L1304]) is now a blocking
  // error on screen, not only a refused download. Legacy mode (no ledger view)
  // has nothing to check against, exactly as in the route.
  if (ledger) {
    for (const i of ledgerSelfCheckIssues(
      saleAwareLedger ?? ledger,
      files.map((f) => ({ type: f.type, csv: f.csv })),
      {
        licenseNumber: license.licenseNumber,
        now,
        lastStamp: slice.kind === "loaded" && slice.ledger.lastStamp ? slice.ledger.lastStamp : null,
      },
    )) {
      syncIssues.push(i);
    }
  }

  // Carry each file's own warnings up as sync issues with HONEST severity
  // (Slice 93). S-12b: no cap — "no caps; every finding is recorded" (Part 05
  // §H). A capped list hides findings from the operator and from the issues
  // stored with the emitted file (ccrs_file_issues).
  for (const f of files) {
    for (const w of f.warnings) {
      syncIssues.push({ severity: classifyWarning(w), file: f.type, message: w });
    }
  }

  const totalRecords = files.reduce((a, f) => a + f.recordCount, 0);

  return {
    licenseNumber: license.licenseNumber,
    submittedBy,
    fromISO,
    toISO,
    files,
    syncIssues,
    totalRecords,
    generatedAt: now.toISOString(),
    ledger: {
      env,
      // R5-1: with the Sale entries merged, so the export route's self-check
      // verifies Sale Insert/Update/Delete rows against what CCRS holds.
      view: saleAwareLedger ?? ledger,
      absentReason: slice.kind === "loaded" ? null : slice.reason,
      lastStamp: slice.kind === "loaded" && slice.ledger.lastStamp ? slice.ledger.lastStamp.toISOString() : null,
      unassignedProductKeys: [...plan.products]
        .filter(([, pp]) => pp.action === "withhold" && pp.reason === NO_PRODUCT_ID_REASON)
        .map(([k]) => k)
        .sort(),
    },
    identity,
    corrections: {
      exportReturnIds: correctionExportIds(env, corrections, e38WithheldLines),
      emitted: corrections.rows.length - correctionE38.withheld.length,
      withheld: withheldNotes.length,
      invalid: corrections.invalid.length,
      reflected: corrections.reflected.length,
    },
  };
}
