/**
 * GET /admin/reports/compliance/export?from=&to=
 *
 * Generates and downloads the CCRS Sale.csv for the range. Admin-gated
 * (settings.manage) because it produces a regulatory file and logs a batch.
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { resolveRange } from "@/lib/reports/range";
import { buildCcrsSaleCsv } from "@/lib/compliance/ccrs-sales";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await requirePermission("settings.manage");
  const url = new URL(request.url);
  const range = resolveRange({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    range: url.searchParams.get("range") ?? undefined,
    year: url.searchParams.get("year") ?? undefined,
  });

  const built = await buildCcrsSaleCsv(range.fromISO, range.toISO);

  // Audit-log the batch so we can track what was reported.
  if (isSupabaseServiceConfigured) {
    try {
      const admin = createSupabaseAdminClient();
      await admin.from("ccrs_export_batches").insert({
        file_name: built.fileName,
        range_from: range.fromISO,
        range_to: range.toISO,
        record_count: built.recordCount,
        operation: "Insert",
        generated_by: session.profile.id,
        notes: built.warnings.join(" | ") || null,
      });
      await recordAudit({
        actorId: session.profile.id,
        action: "ccrs.export",
        entityType: "ccrs_export_batches",
        entityId: built.fileName,
        after: { record_count: built.recordCount, range_from: range.fromISO, range_to: range.toISO },
      });
    } catch {
      // non-fatal
    }
  }

  return new Response(built.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${built.fileName}"`,
    },
  });
}
