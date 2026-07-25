/**
 * src/lib/pos/import-service.ts
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
import { planImportLots } from "@/lib/pos/import-lot-core";
import { resolveOrCreateVendor, resolveBrandId } from "@/lib/inventory/intake-store";
import { chunkedIn } from "@/lib/supabase/chunked-in";

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
    .select("id, status, error_count, import_id, is_test")
    .eq("id", versionId)
    .single();
  if (!version) throw new Error("Menu version not found.");
  if ((version as MenuVersion).error_count > 0) {
    throw new Error("Cannot publish: this version has blocking errors. Resolve them and re-import.");
  }

  const importId = (version as MenuVersion).import_id;
  const isTest = Boolean((version as MenuVersion & { is_test?: boolean }).is_test);
  if (importId && !isTest) {
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

  // 2. Synthetic manifest recording the migration event.
  const { data: manifestRow, error: mErr } = await admin
    .from("inbound_manifests")
    .insert({
      manifest_number: `POS-IMPORT-${importId.slice(0, 8)}`,
      vendor_id: null,
      vendor_label: "Cultivera POS migration (multi-vendor import)",
      transfer_date: new Date().toISOString().slice(0, 10),
      raw_payload: { kind: "pos-import-migration", import_id: importId, lot_plan: plan.summary },
      status: "accepted",
      notes:
        "Synthetic manifest for the one-time Cultivera POS migration. Each lot carries its own vendor; this manifest records the import event for lineage.",
      created_by: actorId,
      updated_by: actorId,
    })
    .select("id")
    .single();
  if (mErr || !manifestRow) throw new Error(`Lot creation failed: could not create the migration manifest (${mErr?.message ?? "unknown"}).`);
  const manifestId = (manifestRow as { id: string }).id;

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
        ...(lot.createdAtIso ? { created_at: lot.createdAtIso } : {}),
      });
    }
    const { error: insErr } = await admin.from("inventory_lots").insert(rows);
    if (insErr) throw new Error(`Lot creation failed while inserting batch ${start / LOT_BATCH + 1}: ${insErr.message}`);
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
export async function cleanSlateTestData(): Promise<{ menuVersionsDeleted: number; posImportsDeleted: number }> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("clean_slate_test_data");
  if (error) throw new Error(`Clean Slate failed: ${error.message}`);
  const summary = (data ?? {}) as { menu_versions_deleted?: number; pos_imports_deleted?: number };
  return {
    menuVersionsDeleted: summary.menu_versions_deleted ?? 0,
    posImportsDeleted: summary.pos_imports_deleted ?? 0,
  };
}
