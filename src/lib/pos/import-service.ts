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

    // 4. Create the staged menu_version.
    const { data: versionRow, error: versionErr } = await admin
      .from("menu_versions")
      .insert({
        import_id: posImport.id,
        status: "staged",
        item_count: result.items.length,
        variant_count: result.items.reduce((s, i) => s + i.variants.length, 0),
        vendor_count: result.vendors.length,
        hidden_count: result.items.filter((i) => i.hidden).length,
        error_count: result.diagnosticCounts.errors,
        warning_count: result.diagnosticCounts.warnings,
        summary_json: result.summary,
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

    // 6. Persist diagnostics in batches.
    await persistDiagnostics(posImport.id, result.diagnostics);

    // 7. Mark the import staged.
    await admin
      .from("pos_imports")
      .update({
        status: "staged",
        summary_json: result.summary,
        completed_at: new Date().toISOString(),
      })
      .eq("id", posImport.id);

    return {
      import: { ...posImport, status: "staged" },
      version,
      transform: {
        diagnosticCounts: result.diagnosticCounts,
        summary: result.summary,
        ok: result.ok,
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
 */
export async function publishMenuVersion(versionId: string, actorId: string | null): Promise<void> {
  const admin = createSupabaseAdminClient();

  // Guard: refuse to publish a version that has error-severity diagnostics.
  const { data: version } = await admin
    .from("menu_versions")
    .select("id, status, error_count, import_id")
    .eq("id", versionId)
    .single();
  if (!version) throw new Error("Menu version not found.");
  if ((version as MenuVersion).error_count > 0) {
    throw new Error("Cannot publish: this version has blocking errors. Resolve them and re-import.");
  }

  const { error } = await admin.rpc("publish_menu_version", {
    p_version_id: versionId,
    p_actor: actorId,
  });
  if (error) throw new Error(`Publish failed: ${error.message}`);
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "file.xlsx";
}
