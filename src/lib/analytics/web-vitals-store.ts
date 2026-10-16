/**
 * R59-S4 — database access for website_web_vitals (migration 0280).
 * Server only. Tolerates the table not existing yet: inserts become no-ops
 * and the report shows "apply update 0280".
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import type { StoredVital, VitalRow } from "./web-vitals-core";

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return error.code === "42P01" || error.code === "PGRST205" || /relation .* does not exist|could not find the table/.test(msg);
}

export async function insertVitals(rows: VitalRow[]): Promise<void> {
  if (!rows.length || !isSupabaseServiceConfigured) return;
  try {
    const { error } = await createSupabaseAdminClient().from("website_web_vitals").insert(rows);
    if (error && !isMissingTable(error)) console.error("[vitals] insert failed:", error.message);
  } catch (e) {
    console.error("[vitals] insert threw:", e instanceof Error ? e.message : e);
  }
}

const PAGE = 1000;
/** Safety cap on rows read for one report view. */
export const VITALS_REPORT_MAX_ROWS = 50_000;

export type VitalsReadResult = { rows: StoredVital[]; missingTable: boolean; truncated: boolean };

export async function readVitalsSince(sinceIso: string): Promise<VitalsReadResult> {
  if (!isSupabaseServiceConfigured) return { rows: [], missingTable: false, truncated: false };
  const admin = createSupabaseAdminClient();
  const rows: StoredVital[] = [];
  for (let from = 0; from < VITALS_REPORT_MAX_ROWS; from += PAGE) {
    const { data, error } = await admin
      .from("website_web_vitals")
      .select("occurred_at,page_path,metric,value,rating,device,nav_type")
      .gte("occurred_at", sinceIso)
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) {
      if (isMissingTable(error)) return { rows: [], missingTable: true, truncated: false };
      throw new Error(error.message);
    }
    const batch = (data as StoredVital[] | null) ?? [];
    rows.push(...batch.map((r) => ({ ...r, value: Number(r.value) })));
    if (batch.length < PAGE) return { rows, missingTable: false, truncated: false };
  }
  return { rows, missingTable: false, truncated: true };
}
