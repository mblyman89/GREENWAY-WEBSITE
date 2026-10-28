/**
 * GET /admin/inventory/disposition/vendor-return-manifest?id=<vendor return id>
 *
 * Fix Phase 1.5 (G-42 v1.1 item 8; D63 (2)): Greenway is the ORIGIN of a
 * vendor return and files the CCRS Manifest.CSV. This builds that file from
 * the return, in the LCB template's exact shape (vendor-return-core
 * buildManifestCsv), named manifest_<license>_<YYYYMMDDHHMMSS>.csv in Pacific
 * time. The owner or admin uploads it at cannabisreporting.lcb.wa.gov and
 * waits for the LCB's success email with the manifest PDF.
 *
 * Nothing is guessed: a missing value (phone, email, vehicle, the lot's CCRS
 * InventoryExternalIdentifier, weight or servings per unit) refuses the file
 * and says which one. Requires inventory.manage; the download is audited.
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getVendorReturn } from "@/lib/inventory/disposition";
import { assignedInventoryExternalId } from "@/lib/compliance/ccrs-identifiers";
import { AVOIRDUPOIS_GRAMS_PER_OUNCE } from "@/lib/compliance/grams-per-ounce";
import {
  buildManifestCsv,
  manifestFileName,
  manifestUom,
  vendorReturnManifestId,
  isOpenVendorReturn,
} from "@/lib/inventory/vendor-return-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** grams per unit from the lot's unit weight (same conversion as the CCRS Inventory file). */
function gramsPerUnit(weight: number | null, uom: string | null): number | null {
  if (weight == null || !Number.isFinite(Number(weight)) || Number(weight) <= 0) return null;
  const w = Number(weight);
  const u = (uom ?? "g").toLowerCase();
  return u === "mg" ? w / 1000 : u === "oz" ? w * AVOIRDUPOIS_GRAMS_PER_OUNCE : w;
}

function positive(v: unknown): number | null {
  const n = Number(v);
  return v != null && Number.isFinite(n) && n > 0 ? n : null;
}

function refuse(errors: string[]): Response {
  const body = ["Manifest.CSV was not built. Fix these, then download again:", ...errors.map((e) => `- ${e}`)].join("\n");
  return new Response(body, { status: 422, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export async function GET(request: Request) {
  const session = await requirePermission("inventory.manage");
  if (!isSupabaseServiceConfigured) return refuse(["Supabase service role not configured."]);
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const ret = id ? await getVendorReturn(id) : null;
  if (!ret) return refuse(["Vendor return not found."]);
  if (!isOpenVendorReturn(ret.manifest_status)) return refuse(["This return has departed or was cancelled; its manifest can no longer change."]);

  const admin = createSupabaseAdminClient();
  const [{ data: lic }, { data: lotRow }, { data: vendorRow }] = await Promise.all([
    admin.from("license_settings").select("license_number, submitted_by, contact_phone, contact_email").eq("id", true).maybeSingle(),
    admin.from("inventory_lots").select("id, ccrs_inventory_external_id, unit, unit_weight, unit_weight_uom, servings_per_pack").eq("id", ret.lot_id).maybeSingle(),
    ret.vendor_id ? admin.from("vendors").select("phone, email, license_number").eq("id", ret.vendor_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const l = (lic ?? {}) as Record<string, string | null>;
  const lot = lotRow as {
    ccrs_inventory_external_id: string | null;
    unit: string | null;
    unit_weight: number | null;
    unit_weight_uom: string | null;
    servings_per_pack: number | null;
  } | null;
  const v = (vendorRow ?? {}) as { phone?: string | null; email?: string | null };
  if (!lot) return refuse(["The lot on this return was not found."]);

  const now = new Date();
  const license = (l.license_number ?? "").trim();
  const built = buildManifestCsv({
    submittedBy: (l.submitted_by ?? "").trim(),
    submittedAt: now,
    externalManifestId: ret.manifest_number?.trim() || vendorReturnManifestId(ret.id),
    // A corrected upload after "Manifest uploaded" is an Update of the same identifier.
    headerOperation: ret.manifest_status === "submitted" || ret.manifest_status === "confirmed" ? "Update" : "Insert",
    transportationType: ret.transportation_type ?? "",
    originLicense: license,
    originPhone: (l.contact_phone ?? "").trim(),
    originEmail: (l.contact_email ?? "").trim(),
    transporterLicense: ret.transporter_license ?? "",
    driverName: ret.driver_name ?? "",
    departureIso: ret.est_departure_at ?? null,
    arrivalIso: ret.est_arrival_at ?? null,
    vin: ret.vehicle_vin ?? "",
    plate: ret.vehicle_plate ?? "",
    model: ret.vehicle_model ?? "",
    make: ret.vehicle_make ?? "",
    color: ret.vehicle_color ?? "",
    destinationLicense: ret.processor_license ?? "",
    destinationPhone: (v.phone ?? "").trim(),
    destinationEmail: (v.email ?? "").trim(),
    items: [
      {
        inventoryExternalId: assignedInventoryExternalId({ ccrs_inventory_external_id: lot.ccrs_inventory_external_id }) ?? "",
        quantity: Number(ret.quantity),
        uom: manifestUom(lot.unit) ?? "",
        // The lot's own figures first; the owner's entry on the return when the lot has none (never guessed).
        weightPerUnit: gramsPerUnit(lot.unit_weight, lot.unit_weight_uom) ?? positive(ret.weight_per_unit_g),
        servingsPerUnit: positive(lot.servings_per_pack) ?? positive(ret.servings_per_unit),
      },
    ],
  });
  if (!built.ok) return refuse(built.errors);

  const fileName = manifestFileName(license, now);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "vendor_return.manifest_csv",
    entityType: "vendor_returns",
    entityId: ret.id,
    after: { file_name: fileName, external_manifest_id: ret.manifest_number?.trim() || vendorReturnManifestId(ret.id) },
  });
  return new Response(built.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
