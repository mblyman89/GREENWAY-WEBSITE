/**
 * src/lib/pos/import-service.ts
 *
 * ============================================================================
 * SPREADSHEET/MENU IMPORT — A MIGRATION TOOL, NOT THE PRODUCT PIPELINE.
 * ----------------------------------------------------------------------------
 * This path (and the Cultivera menu import that feeds it) is a ONE-TIME event
 * for bringing legacy vendor data into our system. It will NOT be how products
 * enter Greenway going forward.
 *
 * PRODUCTS ENTER GREENWAY THROUGH RECEIVING INTAKE — a vendor manifest or
 * invoice arriving with physical inventory (src/lib/inventory/intake-store.ts
 * -> inventory_lots -> mastering -> staged menu -> published menu). That is the
 * real, permanent, critical pipeline; fix pipeline bugs THERE first.
 *
 * See docs/RECEIVING-IS-THE-REAL-PIPELINE.md and standing rule 11 in AGENTS.md.
 * ============================================================================
 *
 * Server-only service that orchestrates a POS import end to end:
 *   1. store raw workbook buffers in the private `pos-raw` bucket
 *   2. create a `pos_imports` row (with file hashes for dedup)
 *   3. run the shared transform (src/lib/pos/transform.ts)
 *   4. persist a STAGED `menu_version` + its menu_items / menu_variants
 *   5. persist diagnostics into `pos_import_diagnostics`
 *   6. publish a staged version (manager approval) via publish_menu_version()
 *
 * All writes use the service-role admin client so RLS is bypassed for trusted
 * server work; the calling server actions are responsible for permission gating.
 */
import "server-only";
import crypto from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { transformWorkbooks, type TransformResult } from "@/lib/pos/transform";
import type { GreenwayMenuItem } from "@/lib/pos/transform";
import type { MenuVersion, PosImport } from "@/lib/pos/db-types";
import { injectApprovedDraftsIntoVersion } from "@/lib/pos/draft-injection";
import { planImportLots, resolveLotCreatedAt, assertUniformInsertKeys } from "@/lib/pos/import-lot-core";
import { storeNow } from "@/lib/reports/timezone";
import { resolveOrCreateVendor, resolveBrandId, logManifestEvent } from "@/lib/inventory/intake-store";
import { chunkedIn } from "@/lib/supabase/chunked-in";
import { getImportDiagnostics, getVersionItems, countVersionItems } from "@/lib/pos/menu-version";
import { listFactReviewsResult, factReviewsToResolutions } from "@/lib/pos/fact-review-store";
import {
  buildFactReviewBuckets,
  menuItemRowToFactReviewItem,
  posDiagnosticToFactReviewDiagnostic,
} from "@/lib/pos/fact-review-core";
import { evaluateCommitGate } from "@/lib/pos/import-commit-core";

const POS_RAW_BUCKET = "pos-raw";

export function sha256(buffer: Buffer | Uint8Array): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export type CreateImportInput = {
  productsBuffer: Buffer;
  inventoriesBuffer: Buffer;
  productsFilename: string;
  inventoriesFilename: string;
  uploadedBy: string | null;
  /** Mark this as a TEST/rehearsal import so Clean Slate can remove it later. */
  isTest?: boolean;
};

export type CreateImportResult = {
  import: PosImport;
  version: MenuVersion;
  transform: Pick<TransformResult, "diagnosticCounts" | "summary" | "ok">;
};

/** Detect whether an identical pair of files has already been imported. */
export async function findDuplicateImport(
  productsHash: string,
  inventoriesHash: string,
): Promise<PosImport | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("pos_imports")
    .select("*")
    .eq("products_file_hash", productsHash)
    .eq("inventories_file_hash", inventoriesHash)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as PosImport | null) ?? null;
}

/**
 * Run a full import: upload raw files, transform, and stage a menu_version.
 * Does NOT publish — that's a separate, gated step.
 */
export async function runImport(input: CreateImportInput): Promise<CreateImportResult> {
  const admin = createSupabaseAdminClient();
  const productsHash = sha256(input.productsBuffer);
  const inventoriesHash = sha256(input.inventoriesBuffer);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const productsKey = `${stamp}/${productsHash.slice(0, 12)}-${sanitize(input.productsFilename)}`;
  const inventoriesKey = `${stamp}/${inventoriesHash.slice(0, 12)}-${sanitize(input.inventoriesFilename)}`;

  // 1. Store raw files (private bucket).
  await admin.storage.from(POS_RAW_BUCKET).upload(productsKey, input.productsBuffer, {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    upsert: true,
  });
  await admin.storage.from(POS_RAW_BUCKET).upload(inventoriesKey, input.inventoriesBuffer, {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    upsert: true,
  });

  // 2. Create the import row (processing).
  const { data: importRow, error: importErr } = await admin
    .from("pos_imports")
    .insert({
      uploaded_by: input.uploadedBy,
      products_storage_key: productsKey,
      inventories_storage_key: inventoriesKey,
      products_filename: input.productsFilename,
      inventories_filename: input.inventoriesFilename,
      products_file_hash: productsHash,
      inventories_file_hash: inventoriesHash,
      products_size_bytes: input.productsBuffer.length,
      inventories_size_bytes: input.inventoriesBuffer.length,
      status: "processing",
      is_test: Boolean(input.isTest),
      started_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (importErr || !importRow) {
    throw new Error(`Failed to create import row: ${importErr?.message ?? "unknown"}`);
  }
  const posImport = importRow as PosImport;

  try {
    // 3. Run the shared transform.
    const result = transformWorkbooks({
      productsBuffer: input.productsBuffer,
      inventoriesBuffer: input.inventoriesBuffer,
      productsSheet: "Sheet1",
      inventoriesSheet: "Inventories",
    });

    // 3b. SLICE 46 (owner Q1: imported products enter the system "as if we
    // received them through intake"): plan the compliance inventory lots NOW so
    // the full worklist (COA-missing lots, merged barcodes, mixed-size cards)
    // sits on the review screen before the manager publishes. The lots
    // themselves are created at PUBLISH time (createImportLots below) — a
    // staged draft that is never published must never mint inventory.
    const lotPlan = planImportLots(result.lotSources);
    const allDiagnostics = [...result.diagnostics, ...lotPlan.diagnostics];
    const combinedCounts = {
      total: allDiagnostics.length,
      errors: allDiagnostics.filter((d) => d.severity === "error").length,
      warnings: allDiagnostics.filter((d) => d.severity === "warning").length,
      info: allDiagnostics.filter((d) => d.severity === "info").length,
    };

    // 4. Create the staged menu_version.
    const { data: versionRow, error: versionErr } = await admin
      .from("menu_versions")
      .insert({
        import_id: posImport.id,
        status: "staged",
        is_test: Boolean(input.isTest),
        item_count: result.items.length,
        variant_count: result.items.reduce((s, i) => s + i.variants.length, 0),
        vendor_count: result.vendors.length,
        hidden_count: result.items.filter((i) => i.hidden).length,
        error_count: combinedCounts.errors,
        warning_count: combinedCounts.warnings,
        summary_json: { ...result.summary, lotPlan: lotPlan.summary },
        created_by: input.uploadedBy,
      })
      .select("*")
      .single();
    if (versionErr || !versionRow) {
      throw new Error(`Failed to create menu version: ${versionErr?.message ?? "unknown"}`);
    }
    const version = versionRow as MenuVersion;

    // 5. Persist items + variants in batches.
    await persistMenuItems(version.id, result.items);

    // 6. Persist diagnostics in batches (transform + lot plan together, so
    // the review screen shows the whole worklist before publish).
    await persistDiagnostics(posImport.id, allDiagnostics);

    // 6b. W7 (owner Decision B): append APPROVED onboarding drafts to this
    // STAGED version so validated new products truly reach the next publish.
    // POS stays the source of truth (keys already in the export are skipped),
    // the human still reviews + publishes, and a failure here never fails the
    // import (best-effort).
    try {
      await injectApprovedDraftsIntoVersion(version.id, posImport.id);
    } catch (err) {
      console.error("[import-service] injectApprovedDraftsIntoVersion failed:", err);
    }

    // 7. Mark the import staged.
    await admin
      .from("pos_imports")
      .update({
        status: "staged",
        summary_json: { ...result.summary, lotPlan: lotPlan.summary },
        completed_at: new Date().toISOString(),
      })
      .eq("id", posImport.id);

    return {
      import: { ...posImport, status: "staged" },
      version,
      transform: {
        diagnosticCounts: combinedCounts,
        summary: result.summary,
        ok: combinedCounts.errors === 0,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin
      .from("pos_imports")
      .update({ status: "failed", error_message: message, completed_at: new Date().toISOString() })
      .eq("id", posImport.id);
    throw err;
  }
}

const ITEM_BATCH = 250;
const VARIANT_BATCH = 500;
const DIAG_BATCH = 500;

async function persistMenuItems(versionId: string, items: GreenwayMenuItem[]) {
  const admin = createSupabaseAdminClient();

  for (let start = 0; start < items.length; start += ITEM_BATCH) {
    const batch = items.slice(start, start + ITEM_BATCH);
    const rows = batch.map((item, idx) => ({
      menu_version_id: versionId,
      source_item_id: item.id,
      name: item.name,
      product_name: item.productName ?? null,
      brand_name: item.brand ?? "",
      vendor_name: item.vendor ?? null,
      category: item.category,
      filter_categories: item.filterCategories ?? [],
      pos_inventory_type: item.posInventoryType ?? null,
      pos_inventory_category: item.posInventoryCategory ?? null,
      strain_type: item.strainType,
      strain_name: item.strainName ?? null,
      thc: item.thc,
      cbd: item.cbd,
      total_thc_json: item.totalThc ?? null,
      total_cbd_json: item.totalCbd ?? null,
      compounds_json: item.compounds ?? [],
      // SLICE 56: structured facts (migration 0138) — verified-only values
      // from the word-by-word extraction engine; null means "not verified",
      // never "zero".
      servings_per_pack: item.servingsPerPack,
      mg_per_serving: item.mgPerServing,
      package_thc_mg: item.packageThcMg,
      package_cbd_mg: item.packageCbdMg,
      ratio_label: item.ratioLabel,
      net_weight_grams: item.netWeightGrams,
      net_volume_ml: item.netVolumeMl,
      fact_provenance: item.factProvenance ?? {},
      description: item.description ?? "",
      price_label: item.priceLabel ?? "",
      price_minor_units: item.priceMinorUnits ?? 0,
      inventory_status: item.inventoryStatus ?? "in-stock",
      hidden: item.hidden ?? false,
      hidden_reason: item.hiddenReason ?? null,
      sort_order: start + idx,
    }));

    const { data: inserted, error } = await admin
      .from("menu_items")
      .insert(rows)
      .select("id, source_item_id");
    if (error || !inserted) {
      throw new Error(`Failed to insert menu items: ${error?.message ?? "unknown"}`);
    }

    // Map source_item_id -> db id to attach variants.
    const idBySource = new Map<string, string>();
    for (const r of inserted as { id: string; source_item_id: string }[]) {
      idBySource.set(r.source_item_id, r.id);
    }

    const variantRows: Record<string, unknown>[] = [];
    for (const item of batch) {
      const dbId = idBySource.get(item.id);
      if (!dbId) continue;
      item.variants.forEach((v, vIdx) => {
        variantRows.push({
          menu_item_id: dbId,
          source_variant_id: v.id,
          label: v.label,
          price_minor_units: v.priceMinorUnits,
          inventory_level: v.inventoryLevel,
          medical: v.medical,
          sort_order: vIdx,
        });
      });
    }
    for (let v = 0; v < variantRows.length; v += VARIANT_BATCH) {
      const vBatch = variantRows.slice(v, v + VARIANT_BATCH);
      const { error: vErr } = await admin.from("menu_variants").insert(vBatch);
      if (vErr) throw new Error(`Failed to insert menu variants: ${vErr.message}`);
    }
  }
}

async function persistDiagnostics(
  importId: string,
  diagnostics: { severity: string; code: string; message: string; context?: unknown }[],
) {
  if (diagnostics.length === 0) return;
  const admin = createSupabaseAdminClient();
  for (let start = 0; start < diagnostics.length; start += DIAG_BATCH) {
    const batch = diagnostics.slice(start, start + DIAG_BATCH).map((d) => ({
      import_id: importId,
      severity: d.severity,
      code: d.code,
      message: d.message,
      context_json: d.context ?? null,
    }));
    const { error } = await admin.from("pos_import_diagnostics").insert(batch);
    if (error) throw new Error(`Failed to insert diagnostics: ${error.message}`);
  }
}

/**
 * Publish a staged menu version (after manager approval + no blocking errors).
 * Delegates the atomic swap to the publish_menu_version() SQL function.
 *
 * SLICE 46: for POS-import versions (import_id set), compliance inventory
 * lots are created FIRST — if lot creation fails, nothing publishes, and a
 * retry skips lots that already exist (idempotent by CCRS identifier). Only
 * then does the atomic menu swap run, so a live imported menu always has its
 * traceability backbone in place before the first sale.
 */
export async function publishMenuVersion(versionId: string, actorId: string | null): Promise<void> {
  const admin = createSupabaseAdminClient();

  // Guard: refuse to publish a version that has error-severity diagnostics.
  const { data: version } = await admin
    .from("menu_versions")
    // SLICE 4A: `item_count` joins the select so the commit gate has an
    // INDEPENDENT witness for how many products this version really holds.
    // It is written by the parser from the workbook before any row is read
    // back, so it never passes through PostgREST's 1,000-row ceiling.
    .select("id, status, error_count, import_id, is_test, item_count")
    .eq("id", versionId)
    .single();
  if (!version) throw new Error("Menu version not found.");
  if ((version as MenuVersion).error_count > 0) {
    throw new Error("Cannot publish: this version has blocking errors. Resolve them and re-import.");
  }

  const importId = (version as MenuVersion).import_id;
  const isTest = Boolean((version as MenuVersion & { is_test?: boolean }).is_test);
  if (importId && !isTest) {
    // SLICE 58 commit gate (Rule 3.1): rebuild the SLICE 57 dry-run buckets
    // from FRESH database reads and refuse to publish while ANY fact-review
    // exception is still awaiting a human decision. The gate also verifies
    // the Rule 3.3 reconciliation arithmetic (rows in = going live +
    // documented rejects + resolved flags) instead of assuming it.
    const [diagnostics, reviewsResult, items, serverItemCount] = await Promise.all([
      // SLICE 3: no `limit`. `.limit(5000)` never raised PostgREST's 1,000-row
      // ceiling, so on a large import this gate was counting pending
      // fact-reviews from a TRUNCATED list and could open with real reviews
      // still unresolved. Omitting the limit pages every diagnostic in.
      getImportDiagnostics(importId),
      // SLICE 4B: the gate needs to know whether this read SUCCEEDED, not just
      // what it returned. These rows record the human approve/fix/reject
      // decisions; an empty array means both "nothing decided" and "the read
      // failed", and treating a failure as "nothing pending" is a fail-open.
      listFactReviewsResult(importId),
      getVersionItems(versionId),
      // SLICE 4A: a THIRD witness. `count: "exact", head: true` is a
      // server-side COUNT(*) -- it returns a number, not rows, so the
      // db.max_rows cap cannot touch it. null means "witness unavailable",
      // never "zero".
      countVersionItems(versionId),
    ]);
    const buckets = buildFactReviewBuckets(
      items.map(menuItemRowToFactReviewItem),
      diagnostics.map(posDiagnosticToFactReviewDiagnostic),
      factReviewsToResolutions(reviewsResult.reviews),
    );
    // SLICE 4A: the reconciliation arithmetic is computed FROM these buckets,
    // so it cannot detect that its own inputs came back short. Corroborate the
    // read against independent witnesses BEFORE trusting the equation.
    // `getVersionItems` returns [] on a read error, which previously
    // reconciled as a "trivially balanced" empty import and OPENED the gate --
    // the evidence check turns that fail-open into a refusal.
    const gate = evaluateCommitGate(buckets, {
      observedItems: items.length,
      recordedItemCount: (version as MenuVersion).item_count,
      serverItemCount,
      observedReviews: reviewsResult.reviews.length,
      reviewsReadFailed: !reviewsResult.ok,
    });
    if (!gate.ready) throw new Error(gate.message);
    // Persist the balanced equation so the audit trail shows exactly what
    // this publish committed (idempotent by code+import via the review UI).
    await persistDiagnostics(importId, [
      {
        severity: "info",
        code: "import_commit_reconciled",
        message: gate.message,
        context: gate.reconciliation,
      },
    ]);

    // Compliance lots BEFORE the menu swap. Throws on failure → publish aborts.
    await createImportLots(importId, actorId);
  }

  const { error } = await admin.rpc("publish_menu_version", {
    p_version_id: versionId,
    p_actor: actorId,
  });
  if (error) throw new Error(`Publish failed: ${error.message}`);
}

const LOT_BATCH = 200;

/**
 * Create compliance inventory lots for a POS import (owner Q1: imported
 * products must live in the system "as if we received them through intake").
 *
 * How it works, end to end:
 *   1. Re-download the import's RAW workbooks from the private pos-raw bucket
 *      and re-run the deterministic transform + lot planner — the plan the
 *      manager reviewed is exactly the plan executed.
 *   2. Create ONE synthetic inbound_manifest (status "accepted") recording the
 *      migration event, so every lot has the same manifest → lot lineage an
 *      intake delivery gets.
 *   3. Resolve each lot's vendor via the intake resolver ladder
 *      (license → exact name → alias → normalized scan → auto-create DRAFT
 *      vendor) and its brand within that vendor — identical behavior to a
 *      real delivery.
 *   4. Dedupe by ccrs_inventory_external_id: lots already in the table are
 *      skipped, so re-publishing (or retrying a failed publish) NEVER doubles
 *      inventory.
 *   5. Insert lots with status "active". WHY ACTIVE, NOT QUARANTINE: these
 *      products were already received, tested, and reported to CCRS by the
 *      previous POS (Cultivera is a WSLCB integrator; the Barcode column is
 *      the identifier it filed). The migration changes the system of record,
 *      not the product's regulatory state — quarantining would block the sale
 *      floor and make the weekly Sale.csv flag every line. Lots with COA flag
 *      "N" are surfaced as a warning-severity enrichment worklist instead.
 *   6. created_at is backdated to each lot's Received date so the sale path's
 *      created_at-ordered FIFO consumes genuinely-oldest stock first.
 *
 * Test-mode imports NEVER reach this function (guarded by the caller), so
 * Clean Slate stays sufficient for rehearsals.
 */
async function createImportLots(importId: string, actorId: string | null): Promise<void> {
  const admin = createSupabaseAdminClient();

  const { data: importRow, error: impErr } = await admin
    .from("pos_imports")
    .select("id, products_storage_key, inventories_storage_key, is_test")
    .eq("id", importId)
    .single();
  if (impErr || !importRow) throw new Error(`Lot creation failed: import ${importId} not found.`);
  const imp = importRow as Pick<PosImport, "id" | "products_storage_key" | "inventories_storage_key" | "is_test">;
  if (imp.is_test) return; // belt & braces — the caller already skips test versions
  if (!imp.products_storage_key || !imp.inventories_storage_key) {
    throw new Error("Lot creation failed: this import has no stored raw workbook files to re-read.");
  }

  // 1. Re-run the deterministic transform on the stored raw files.
  const [productsDl, inventoriesDl] = await Promise.all([
    admin.storage.from(POS_RAW_BUCKET).download(imp.products_storage_key),
    admin.storage.from(POS_RAW_BUCKET).download(imp.inventories_storage_key),
  ]);
  if (productsDl.error || !productsDl.data || inventoriesDl.error || !inventoriesDl.data) {
    throw new Error(
      `Lot creation failed: could not re-read the raw workbook files (${productsDl.error?.message ?? inventoriesDl.error?.message ?? "unknown"}).`,
    );
  }
  const result = transformWorkbooks({
    productsBuffer: Buffer.from(await productsDl.data.arrayBuffer()),
    inventoriesBuffer: Buffer.from(await inventoriesDl.data.arrayBuffer()),
    productsSheet: "Sheet1",
    inventoriesSheet: "Inventories",
  });
  const plan = planImportLots(result.lotSources);
  if (plan.lots.length === 0) return;

  // 4 (early). Dedupe against lots that already exist (idempotent re-publish).
  const existingIds = new Set<string>(
    (
      await chunkedIn(
        plan.lots.map((l) => l.ccrsExternalId),
        async (chunk, from, to) => {
          const { data } = await admin
            .from("inventory_lots")
            .select("ccrs_inventory_external_id")
            .in("ccrs_inventory_external_id", chunk)
            .order("id", { ascending: true })
            .range(from, to);
          return ((data as { ccrs_inventory_external_id: string | null }[] | null) ?? [])
            .map((r) => r.ccrs_inventory_external_id)
            .filter((v): v is string => !!v);
        },
      )
    ),
  );
  const toCreate = plan.lots.filter((l) => !existingIds.has(l.ccrsExternalId));
  if (toCreate.length === 0) {
    await persistDiagnostics(importId, [
      {
        severity: "info",
        code: "import_lots_already_created",
        message: `All ${plan.lots.length} planned lot(s) already exist (previous publish); nothing inserted.`,
      },
    ]);
    return;
  }

  // 2. Synthetic manifest recording the migration event. SLICE 58 (one door):
  // stamped accepted_at and given a manifest_events timeline entry so it wears
  // the SAME lifecycle fingerprint as a natively accepted delivery -- nothing
  // downstream can tell an imported manifest from a native one.
  const { data: manifestRow, error: mErr } = await admin
    .from("inbound_manifests")
    .insert({
      manifest_number: `POS-IMPORT-${importId.slice(0, 8)}`,
      vendor_id: null,
      vendor_label: "Cultivera POS migration (multi-vendor import)",
      transfer_date: new Date().toISOString().slice(0, 10),
      raw_payload: { kind: "pos-import-migration", import_id: importId, lot_plan: plan.summary },
      status: "accepted",
      accepted_at: new Date().toISOString(),
      notes:
        "Synthetic manifest for the one-time Cultivera POS migration. Each lot carries its own vendor; this manifest records the import event for lineage.",
      created_by: actorId,
      updated_by: actorId,
    })
    .select("id")
    .single();
  if (mErr || !manifestRow) throw new Error(`Lot creation failed: could not create the migration manifest (${mErr?.message ?? "unknown"}).`);
  const manifestId = (manifestRow as { id: string }).id;
  await logManifestEvent(
    manifestId,
    "accepted",
    `Cultivera POS migration: ${toCreate.length} lot(s) created under this manifest via the menu-import publish path.`,
    actorId,
  );

  // 3. Vendor + brand resolution with per-label caches (121 vendors / 183
  // brands in the real export — resolve each label once, not per lot).
  const vendorIdByLabel = new Map<string, string | null>();
  const brandIdByKey = new Map<string, string | null>();
  async function vendorIdFor(label: string | null): Promise<string | null> {
    const key = (label ?? "").trim();
    if (!key) return null;
    if (vendorIdByLabel.has(key)) return vendorIdByLabel.get(key) ?? null;
    const id = await resolveOrCreateVendor(admin, key, null, actorId);
    vendorIdByLabel.set(key, id);
    return id;
  }
  async function brandIdFor(label: string | null, vendorId: string | null): Promise<string | null> {
    const key = `${(label ?? "").trim()}|${vendorId ?? ""}`;
    if (!(label ?? "").trim()) return null;
    if (brandIdByKey.has(key)) return brandIdByKey.get(key) ?? null;
    const id = await resolveBrandId(admin, label, vendorId);
    brandIdByKey.set(key, id);
    return id;
  }

  // 5 + 6. Insert in batches (plan order = oldest received first).
  //
  // SLICE 1 — created_at must be present on EVERY row.
  // `inventory_lots.created_at` is NOT NULL (migration 0023:112). postgrest-js
  // builds `columns=` from the UNION of the keys of every row in an array
  // insert and does not send `Prefer: missing=default`
  // (node_modules/@supabase/postgrest-js/dist/index.mjs:4189-4201), so a row
  // that OMITS created_at inside a batch where another row SETS it is written
  // as an explicit NULL -> not-null violation. The Cultivera export has 203
  // rows with a blank Received date, so real batches are mixed and the publish
  // aborted mid-run, before publish_menu_version could execute (which is why
  // the customer-facing menu stayed empty).
  //
  // One instant for the whole run, taken from the store clock (Rule 8), so
  // undated lots share a single deterministic timestamp that is younger than
  // every real received date -- preserving the planner's FIFO ordering.
  const importCreatedAtFallback = storeNow().toISOString();
  let created = 0;
  for (let start = 0; start < toCreate.length; start += LOT_BATCH) {
    const batch = toCreate.slice(start, start + LOT_BATCH);
    const rows: Record<string, unknown>[] = [];
    for (const lot of batch) {
      const vendorId = await vendorIdFor(lot.vendorLabel);
      const brandId = await brandIdFor(lot.brandLabel, vendorId);
      rows.push({
        lot_code: lot.lotCode,
        vendor_id: vendorId,
        brand_id: brandId,
        manifest_id: manifestId,
        pos_product_key: lot.posProductKey,
        ccrs_inventory_external_id: lot.ccrsExternalId,
        product_name: lot.productName,
        strain_name: lot.strainName,
        // SLICE 54 (migration 0138, Rule 1.4): strain type in its own box.
        strain_type: lot.strainType,
        category: lot.category,
        inventory_type: lot.inventoryType,
        unit_weight: lot.unitWeight,
        unit_weight_uom: lot.unitWeightUom,
        is_sample: lot.isSample,
        is_medical: lot.isMedical,
        received_qty: lot.receivedQty,
        on_hand_qty: lot.receivedQty,
        unit: lot.unit,
        unit_cost_minor_units: lot.unitCostMinorUnits,
        expires_on: lot.expiresOn,
        status: "active",
        notes: lot.notes,
        created_by: actorId,
        updated_by: actorId,
        // NEVER conditional: see the SLICE 1 note above. Received date when the
        // POS export had one, otherwise this run's store-clock instant.
        created_at: resolveLotCreatedAt(lot.createdAtIso, importCreatedAtFallback),
      });
    }
    const batchNumber = start / LOT_BATCH + 1;
    // Fail loudly and precisely BEFORE the network call if the row builder ever
    // regresses into a ragged key set (Rule 3: precise warnings, never invent).
    assertUniformInsertKeys(rows, `inventory_lots batch ${batchNumber}`);
    const { error: insErr } = await admin.from("inventory_lots").insert(rows);
    if (insErr) throw new Error(`Lot creation failed while inserting batch ${batchNumber}: ${insErr.message}`);
    created += rows.length;
  }

  await persistDiagnostics(importId, [
    {
      severity: "info",
      code: "import_lots_created",
      message: `Created ${created} compliance inventory lot(s) (${existingIds.size} already existed) under migration manifest POS-IMPORT-${importId.slice(0, 8)}. Lots are ACTIVE: this stock was already received and CCRS-reported by the previous POS; the import migrates the system of record.`,
      context: { created, skippedExisting: existingIds.size, manifestId, plan: plan.summary },
    },
  ]);
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "file.xlsx";
}

/** How many test-flagged imports/versions currently exist (for the UI badge). */
export async function countTestData(): Promise<{ imports: number; versions: number }> {
  const admin = createSupabaseAdminClient();
  const [{ count: imports }, { count: versions }] = await Promise.all([
    admin.from("pos_imports").select("id", { count: "exact", head: true }).eq("is_test", true),
    admin.from("menu_versions").select("id", { count: "exact", head: true }).eq("is_test", true),
  ]);
  return { imports: imports ?? 0, versions: versions ?? 0 };
}

/**
 * Clean Slate: delete ONLY test-flagged import/menu data via the DB function
 * (migration 0066). Never touches real data or the knowledge base. Returns the
 * server-side deletion summary.
 */
export async function cleanSlateTestData(): Promise<{
  menuVersionsDeleted: number;
  stagedVersionsDeleted: number;
  publishedVersionDeleted: number;
  posImportsDeleted: number;
  restoredVersionId: string | null;
}> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("clean_slate_test_data");
  if (error) throw new Error(`Clean Slate failed: ${error.message}`);
  const summary = (data ?? {}) as {
    menu_versions_deleted?: number;
    staged_versions_deleted?: number;
    published_version_deleted?: number;
    pos_imports_deleted?: number;
    restored_version_id?: string | null;
  };
  return {
    menuVersionsDeleted: summary.menu_versions_deleted ?? 0,
    stagedVersionsDeleted: summary.staged_versions_deleted ?? 0,
    publishedVersionDeleted: summary.published_version_deleted ?? 0,
    posImportsDeleted: summary.pos_imports_deleted ?? 0,
    restoredVersionId: summary.restored_version_id ?? null,
  };
}

/**
 * T-327 (roadmap Slice 1): BACKFILL compliance inventory lots for an import
 * that was already PUBLISHED but never got lots.
 *
 * Why this exists: `createImportLots` only runs inside `publishMenuVersion`
 * (line ~374), and only for a non-test import. Imports PUBLISHED before the
 * lot-creation feature shipped (SLICE 46, PR #678, 2026-07-25) therefore have a
 * live menu but ZERO inventory_lots. This function re-runs the SAME idempotent
 * routine so the owner can heal those imports with one click — no re-upload, no
 * menu churn, no duplicate risk (createImportLots dedupes by
 * ccrs_inventory_external_id).
 *
 * Guards (never guess — refuse anything unsafe):
 *   • the import must exist;
 *   • it must NOT be a test import (test data never mints real lots);
 *   • its menu version must be PUBLISHED (a still-staged version should be
 *     published through the normal button, which creates lots as part of the
 *     publish — backfill is strictly a post-publish remedy).
 *
 * Returns the before/after lot count for THIS import's synthetic manifest so the
 * caller can report exactly how many lots were created.
 */
export async function backfillImportLots(
  importId: string,
  actorId: string | null,
): Promise<{ created: number; alreadyPresent: number; totalNow: number }> {
  const admin = createSupabaseAdminClient();

  // 1. Load + guard the import.
  const { data: importRow, error: impErr } = await admin
    .from("pos_imports")
    .select("id, is_test")
    .eq("id", importId)
    .single();
  if (impErr || !importRow) throw new Error(`Backfill failed: import ${importId} not found.`);
  const imp = importRow as Pick<PosImport, "id" | "is_test">;
  if (imp.is_test) {
    throw new Error(
      "Backfill refused: this is a TEST import. Test imports never create real inventory. " +
        "Re-import with Test mode OFF, then publish.",
    );
  }

  // 2. The import's version must be PUBLISHED.
  const { data: versionRow } = await admin
    .from("menu_versions")
    .select("id, status")
    .eq("import_id", importId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = versionRow as { id: string; status: string } | null;
  if (!version) {
    throw new Error("Backfill refused: this import has no menu version yet.");
  }
  if (version.status !== "published") {
    throw new Error(
      "Backfill refused: this import's version is not published. " +
        "Use the Publish button — publishing already creates the inventory lots.",
    );
  }

  // 3. Count the lots that already exist under this import's synthetic manifest
  //    BEFORE we act, so we can report a truthful "created" delta even though
  //    createImportLots is idempotent.
  const manifestNumber = `POS-IMPORT-${importId.slice(0, 8)}`;
  const before = await countLotsForManifestNumber(admin, manifestNumber);

  // 4. Run the SAME routine the publish path runs. Idempotent: existing
  //    barcodes are skipped; it writes its own import_lots_created /
  //    import_lots_already_created diagnostics.
  await createImportLots(importId, actorId);

  // 5. Recount and report the delta.
  const after = await countLotsForManifestNumber(admin, manifestNumber);
  const created = Math.max(0, after - before);
  return { created, alreadyPresent: before, totalNow: after };
}

/** Count inventory_lots that hang off a synthetic POS-import manifest number. */
async function countLotsForManifestNumber(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  manifestNumber: string,
): Promise<number> {
  const { data: mrow } = await admin
    .from("inbound_manifests")
    .select("id")
    .eq("manifest_number", manifestNumber)
    .maybeSingle();
  const manifestId = (mrow as { id: string } | null)?.id ?? null;
  if (!manifestId) return 0;
  const { count } = await admin
    .from("inventory_lots")
    .select("id", { count: "exact", head: true })
    .eq("manifest_id", manifestId);
  return count ?? 0;
}
