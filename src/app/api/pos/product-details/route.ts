/**
 * GET /api/pos/product-details?productId=...&variantId=...
 *
 * Owner (verbatim): "add significantly more details to the browse menu. We
 * need every detail available, vendor lot number, everything."
 *
 * The register's info card asks for this ONLINE, on demand, when it opens
 * (same pattern as /api/pos/product-image). Lot facts never ride the menu
 * bundle: the bundle is size-capped and cached on the iPad, while this
 * read is small (≤ MAX_DETAIL_LOTS lots for one size) and always current.
 * Offline, the card still shows every bundle fact and says lot details need
 * a connection.
 *
 * Device-authenticated like every /api/pos/* endpoint. The card is reachable
 * from the LOCK SCREEN (price lookup, no PIN), so the response carries NO
 * cost or margin — product-detail-core never emits them.
 *
 * Rule 15: explicit columns on every read; every `{ error }` is read and
 * turned into a plain-English warning on the card (never swallowed). Columns
 * added by later migrations are OPTIONAL: if production has not applied that
 * migration yet, the read retries without the column instead of failing.
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/pos/sync-store";
import { posPreflightResponse, withPosCors } from "@/lib/pos/cors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pacificDayKey } from "@/lib/reports/timezone";
import {
  buildProductDetails,
  detailLotKeys,
  explainReadError,
  missingOptionalColumn,
  type DetailBrandRow,
  type DetailLabRow,
  type DetailLotRow,
  type DetailManifestRow,
  type DetailVendorRow,
} from "@/lib/pos/product-detail-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// --- Tables (named once so the G-71a db-contract scan reads them) -------------
const LOTS_TABLE = "inventory_lots";
const VENDORS_TABLE = "vendors";
const BRANDS_TABLE = "brands";
const MANIFESTS_TABLE = "inbound_manifests";
const LABS_TABLE = "lab_results";

// --- Column lists (explicit — rule 15) ---------------------------------------

/** inventory_lots columns from 0023/0024: always present. */
const LOT_REQUIRED = [
  "id",
  "lot_code",
  "vendor_id",
  "brand_id",
  "manifest_id",
  "lab_result_id",
  "pos_product_key",
  "product_name",
  "strain_name",
  "category",
  "inventory_type",
  "unit_weight",
  "unit_weight_uom",
  "is_sample",
  "is_medical",
  "received_qty",
  "on_hand_qty",
  "unit",
  "expires_on",
  "status",
  "created_at",
] as const;

/** inventory_lots columns from later migrations (retry without if missing). */
const LOT_OPTIONAL = [
  "ccrs_inventory_external_id", // 0031
  "strain_type", // 0138
  "servings_per_pack",
  "mg_per_serving",
  "package_thc_mg",
  "package_cbd_mg",
  "minor_cannabinoids_json",
  "ratio_label",
  "net_weight_grams",
  "net_volume_ml",
  "received_on", // 0214
  "received_on_source",
  "low_thc_liquid", // 0216/0217
  "unit_thc_mg",
  "otherwise_taken",
  "units_per_package",
  "pos_thc", // 0241
  "pos_thca",
  "pos_cbd",
  "pos_cbda",
  "vendor_inventory_external_id", // 0285
  "vendor_inventory_external_id_source",
  "menu_source_variant_id", // 0294
  "held_qty", // 0308
] as const;

const LAB_REQUIRED = [
  "id",
  "labtest_external_identifier",
  "lab_name",
  "tested_on",
  "thc_pct",
  "cbd_pct",
  "total_thc_pct",
  "total_cbd_pct",
  "passed",
] as const;
const LAB_OPTIONAL = [
  "thca_pct",
  "cbda_pct",
  "total_cannabinoids_pct",
  "coa_url",
  "coa_release_date",
  "coa_expire_date",
  "wcia_json_url",
  "coa_extract_json",
  "coa_extract_status",
] as const;

const VENDOR_REQUIRED = ["id", "display_name"] as const;
const VENDOR_OPTIONAL = ["legal_name", "dba", "license_number"] as const;

const BRAND_REQUIRED = ["id", "display_name"] as const;

const MANIFEST_REQUIRED = ["id", "manifest_number", "vendor_label", "transfer_date"] as const;
const MANIFEST_OPTIONAL = ["invoice_number_override", "invoice_number_detected"] as const;

/** Hard cap on lots read per size (the card shows fewer; this bounds egress). */
const LOT_READ_LIMIT = 60;

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type DbError = { code?: string | null; message?: string | null };
type Filter = { column: string; op: "in" | "eq"; value: string | string[] };

/**
 * Read `table` with explicit columns. When the database reports a missing
 * OPTIONAL column, drop just that column and retry (bounded). A required
 * column or any other error is returned to the caller to explain.
 */
async function readWithOptional<T>(
  admin: Admin,
  table: string,
  required: readonly string[],
  optional: readonly string[],
  filter: Filter,
  limit: number,
): Promise<{ rows: T[]; error: DbError | null }> {
  const opt = [...optional];
  for (let attempt = 0; attempt <= optional.length; attempt += 1) {
    const cols = [...required, ...opt].join(",");
    let q = admin.from(table).select(cols);
    q = filter.op === "in" ? q.in(filter.column, filter.value as string[]) : q.eq(filter.column, filter.value as string);
    const { data, error } = await q.limit(limit);
    if (!error) return { rows: (data ?? []) as unknown as T[], error: null };
    const missing = missingOptionalColumn(error, opt);
    if (!missing) return { rows: [], error };
    opt.splice(opt.indexOf(missing), 1);
  }
  return { rows: [], error: { message: "too many missing columns" } };
}

function uniq(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === "string" && v.length > 0))];
}

async function handleGet(req: NextRequest): Promise<NextResponse> {
  const deviceId = req.headers.get("x-pos-device-id") ?? "";
  const deviceKey = req.headers.get("x-pos-device-key") ?? "";
  const auth = await authenticateDevice(deviceId, deviceKey);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const productId = (req.nextUrl.searchParams.get("productId") ?? "").trim().slice(0, 200);
  const variantId = ((req.nextUrl.searchParams.get("variantId") ?? "").trim() || productId).slice(0, 200);
  if (!productId) {
    return NextResponse.json({ error: "productId is required." }, { status: 400 });
  }
  if (!isSupabaseServiceConfigured) {
    return NextResponse.json({ lots: [], lotCount: 0, warnings: ["Lot details are not available: the server database is not configured."] });
  }

  const admin = createSupabaseAdminClient();
  const warnings: string[] = [];

  // 1) Lots filed under this card or this size's lot key…
  const keys = detailLotKeys(productId, variantId);
  const byKey = await readWithOptional<DetailLotRow>(
    admin,
    LOTS_TABLE,
    LOT_REQUIRED,
    LOT_OPTIONAL,
    { column: "pos_product_key", op: "in", value: keys },
    LOT_READ_LIMIT,
  );
  if (byKey.error) warnings.push(explainReadError("the lots for this product", byKey.error));

  // 2) …plus lots explicitly linked to this size (0294). A missing column
  //    here only means the size-link migration is not applied: no warning.
  let linked: DetailLotRow[] = [];
  if (!byKey.error) {
    const bySize = await readWithOptional<DetailLotRow>(
      admin,
      LOTS_TABLE,
      LOT_REQUIRED,
      LOT_OPTIONAL.filter((c) => c !== "menu_source_variant_id"),
      { column: "menu_source_variant_id", op: "eq", value: variantId },
      LOT_READ_LIMIT,
    );
    if (bySize.error && !missingOptionalColumn(bySize.error, ["menu_source_variant_id"])) {
      warnings.push(explainReadError("the lots linked to this size", bySize.error));
    } else {
      linked = bySize.rows.map((r) => ({ ...r, menu_source_variant_id: variantId }));
    }
  }

  const lots = [...byKey.rows, ...linked];

  // 3) The lots' vendor, brand, manifest and lab result, by id.
  const vendorIds = uniq(lots.map((l) => l.vendor_id));
  const brandIds = uniq(lots.map((l) => l.brand_id));
  const manifestIds = uniq(lots.map((l) => l.manifest_id));
  const labIds = uniq(lots.map((l) => l.lab_result_id));

  const [vendors, brands, manifests, labs] = await Promise.all([
    vendorIds.length
      ? readWithOptional<DetailVendorRow>(admin, VENDORS_TABLE, VENDOR_REQUIRED, VENDOR_OPTIONAL, { column: "id", op: "in", value: vendorIds }, vendorIds.length)
      : Promise.resolve({ rows: [] as DetailVendorRow[], error: null }),
    brandIds.length
      ? readWithOptional<DetailBrandRow>(admin, BRANDS_TABLE, BRAND_REQUIRED, [], { column: "id", op: "in", value: brandIds }, brandIds.length)
      : Promise.resolve({ rows: [] as DetailBrandRow[], error: null }),
    manifestIds.length
      ? readWithOptional<DetailManifestRow>(admin, MANIFESTS_TABLE, MANIFEST_REQUIRED, MANIFEST_OPTIONAL, { column: "id", op: "in", value: manifestIds }, manifestIds.length)
      : Promise.resolve({ rows: [] as DetailManifestRow[], error: null }),
    labIds.length
      ? readWithOptional<DetailLabRow>(admin, LABS_TABLE, LAB_REQUIRED, LAB_OPTIONAL, { column: "id", op: "in", value: labIds }, labIds.length)
      : Promise.resolve({ rows: [] as DetailLabRow[], error: null }),
  ]);
  if (vendors.error) warnings.push(explainReadError("the vendor", vendors.error));
  if (brands.error) warnings.push(explainReadError("the brand", brands.error));
  if (manifests.error) warnings.push(explainReadError("the manifest", manifests.error));
  if (labs.error) warnings.push(explainReadError("the lab result", labs.error));

  const body = buildProductDetails({
    productId,
    variantId,
    lots,
    labs: labs.rows,
    vendors: vendors.rows,
    brands: brands.rows,
    manifests: manifests.rows,
    todayPacific: pacificDayKey(new Date()),
    warnings,
  });
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
}

/** CORS preflight for the packaged register app (capacitor://localhost). */
export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  return posPreflightResponse(req);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    return withPosCors(req, await handleGet(req));
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return withPosCors(req, NextResponse.json({ lots: [], lotCount: 0, warnings: [`Lot details failed to load: ${message.slice(0, 140)}`] }));
  }
}
