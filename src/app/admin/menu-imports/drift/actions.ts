"use server";

/**
 * R50 A6 - the drift page's one button: "I ran today's check". It re-reads
 * everything on the server (never trusts the page), records the result for
 * today's Pacific date as one audit_logs row, and returns to the page. It
 * changes no stock.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { isSafeImportId } from "@/lib/inventory/import-lineage-core";
import { loadDrift, recordDriftCheck } from "@/lib/pos/cutover-drift";
import { DRIFT_HREF, driftPhase } from "@/lib/pos/cutover-drift-core";

function to(importId: string, k: "notice" | "error", msg: string): string {
  const q = new URLSearchParams();
  if (importId) q.set("import", importId);
  q.set(k, msg);
  return `${DRIFT_HREF}?${q.toString()}`;
}

export async function recordDriftCheckAction(form: FormData): Promise<void> {
  const session = await requirePermission("menu.import");
  const raw = String(form.get("importId") ?? "");
  const importId = isSafeImportId(raw) ? raw : "";
  if (!importId) redirect(to("", "error", "Missing or invalid import id."));
  if (!isSupabaseServiceConfigured) redirect(to(importId, "error", "Supabase is not configured."));
  const now = Date.now();
  const admin = createSupabaseAdminClient();
  const load = await loadDrift(admin, importId, now);
  if (!load.ok) redirect(to(importId, "error", load.error));
  if (!load.report.checks[0].pass) redirect(to(importId, "error", "Not recorded: something could not be read, so today's numbers cannot be trusted. Try again."));
  const date = driftPhase(now).date;
  const err = await recordDriftCheck(admin, { importId, actorId: session.userId, actorEmail: session.email, date, report: load.report });
  if (err) redirect(to(importId, "error", `Today's check was NOT recorded: ${err}`));
  revalidatePath(DRIFT_HREF);
  redirect(
    to(
      importId,
      "notice",
      load.report.ok
        ? `Recorded for ${date}: every unit is explained.`
        : `Recorded for ${date}: ${load.report.totals.driftProducts} product(s) drifted (net ${load.report.totals.drift}). Work the red lines below.`,
    ),
  );
}
