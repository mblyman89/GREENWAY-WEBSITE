/**
 * GET /admin/inventory/disposition/sale-correction-export
 *
 * Generates and downloads the CCRS Sale.csv CORRECTION file (Operation
 * Delete/Update) for all customer returns whose correction is still pending.
 * Per the LCB CCRS FAQ, a valid customer return means the sale identifier is
 * deleted (or updated for a partial return) in CCRS — this file is that
 * correction, built from the snapshots captured when each return was accepted.
 *
 * R5-1: built by the SAME cumulative planner as the weekly batch
 * (planReturnCorrections, legacy mode: no ledger here). A sale line's
 * correction states the line after ALL its returns — the old route sent
 * "original − this return", which was wrong on a second partial return. A
 * line whose returns cannot be built into a correction (missing SaleType or
 * SaleDate, more returned than sold, disagreeing snapshots) is refused by name
 * and stays pending.
 *
 * Fix Phase 7.1 (G-45, F-15-10): the weekly batch checks each line is held
 * by CCRS and records the file in the outbox; this download does not. So it
 * only runs while the production ledger is NOT loaded (or 0283 is missing),
 * which is exactly when the batch withholds every correction and points here.
 * Once the ledger is loaded it refuses (409) and nothing is marked; when the
 * app cannot tell, it refuses too (readCorrectionRoute).
 *
 * Marks the included returns as exported and audits the download. Requires
 * inventory.manage (same gate as the disposition page).
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getCcrsLicenseSettings } from "@/lib/compliance/ccrs-sales";
import { buildSaleCorrectionFile, makeSaleCorrectionFileName } from "@/lib/compliance/ccrs-sale-correction-core";
import { markCorrectionsExported, readCorrectionRoute } from "@/lib/inventory/disposition";
import { correctionDownloadRefusal } from "@/lib/inventory/disposition-messages-core";
import { CCRS_COLUMNS, withholdUnencodableRows } from "@/lib/compliance/ccrs-batch-core";
import {
  planReturnCorrections,
  returnRecordFromRow,
  type CustomerReturnRowLike,
  type ReturnRecord,
} from "@/lib/compliance/ccrs-return-corrections-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RETURN_COLUMNS =
  "id, sale_external_id, sale_detail_external_id, inventory_external_id, sale_type, sale_date, unit_price_minor, discount_minor, sales_tax_minor, excise_minor, quantity, original_quantity, correction_status, created_at";

export async function GET() {
  const session = await requirePermission("inventory.manage");

  // G-45: refuse before reading or marking anything unless this download is
  // the only way the corrections can go out.
  const refusal = correctionDownloadRefusal(await readCorrectionRoute());
  if (refusal) {
    return new Response(`${refusal}\r\n`, { status: 409, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  const license = await getCcrsLicenseSettings();
  let rows: string[][] = [];
  /** rowReturnIds[i] = the pending return ids answered by rows[i]. */
  let rowReturnIds: string[][] = [];
  const skipped: string[] = [];

  if (isSupabaseServiceConfigured) {
    try {
      const admin = createSupabaseAdminClient();
      const { data: pending } = await admin
        .from("customer_returns")
        .select(RETURN_COLUMNS)
        .eq("correction_status", "pending")
        .order("created_at", { ascending: true })
        .limit(500);
      const pendingRows = (pending as CustomerReturnRowLike[] | null) ?? [];
      // Every other return of the same sale lines: the correction states the
      // line after ALL its returns, not just the pending ones.
      const lineIds = [...new Set(pendingRows.map((r) => (r.sale_detail_external_id ?? "").trim()).filter(Boolean))];
      const { data: siblings } = lineIds.length
        ? await admin.from("customer_returns").select(RETURN_COLUMNS).in("sale_detail_external_id", lineIds)
        : { data: [] };
      const byId = new Map<string, ReturnRecord>();
      for (const r of [...pendingRows, ...((siblings as CustomerReturnRowLike[] | null) ?? [])]) {
        // Fix Phase 7.1: an Other Inventory (non-cannabis) return is never a
        // CCRS Sale correction, the same rule as the weekly batch (Phase 4,
        // ccrs-batch.ts readReturnsForCorrections; 0323 writes 'NonCannabis').
        if ((r as { sale_type?: string | null }).sale_type === "NonCannabis") continue;
        byId.set(r.id, returnRecordFromRow(r));
      }
      const plan = planReturnCorrections({
        returns: [...byId.values()],
        license,
        ledger: "legacy",
        insertedDetailIds: new Set(),
      });
      rows = plan.rows;
      rowReturnIds = plan.groups.map((g) => g.returnIds);
      for (const n of plan.invalid) skipped.push(`${n.detailId || "(no sale line id)"} [${n.returnIds.join(", ")}]: ${n.reason}`);
    } catch {
      // customer_returns missing (pre-0115) — empty file below.
    }
  }

  // S-09 E38 / S-09b E42: a correction carrying a line break or comma cannot
  // be one CCRS record (CCRS splits on every comma). A `"` is fine (S-09c).
  // Withhold it and leave its returns PENDING (never marked exported) so it is
  // fixed and re-sent, not lost. rows[i] answers rowReturnIds[i].
  const e38 = withholdUnencodableRows(rows, CCRS_COLUMNS.Sale, (_r, i) => String(i));
  const withheldRows = new Set(e38.withheld.map((w) => Number(w.label)));
  const exportIds = rowReturnIds.filter((_ids, i) => !withheldRows.has(i)).flat();
  for (const w of e38.withheld) skipped.push(`${rowReturnIds[Number(w.label)].join(", ")}: ${w.column} contains a ${w.reason} — left pending`);

  const csv = buildSaleCorrectionFile(e38.rows, license);
  const fileName = makeSaleCorrectionFileName(license.licenseNumber);

  if (exportIds.length > 0) {
    await markCorrectionsExported(exportIds);
  }
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ccrs.sale_correction_export",
    entityType: "customer_returns",
    entityId: fileName,
    after: { record_count: e38.rows.length, skipped: skipped.length, e38_withheld: e38.withheld.length },
  });

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
