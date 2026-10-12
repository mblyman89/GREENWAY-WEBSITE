/**
 * R47-S2 — database access for website_click_events (migration 0268).
 * Server only. Every function tolerates the table not existing yet: inserts
 * become no-ops and the report shows "apply migration 0268".
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import type { ClickEventRow, StoredClick } from "./click-events-core";

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /relation .* does not exist|could not find the table/.test(msg)
  );
}

export type InsertResult = "ok" | "missing_table" | "not_configured" | "error";

export async function insertClickEvent(row: ClickEventRow): Promise<InsertResult> {
  if (!isSupabaseServiceConfigured) return "not_configured";
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("website_click_events").insert(row);
    if (!error) return "ok";
    if (isMissingTable(error)) return "missing_table";
    console.error("[clicks] insert failed:", error.message);
    return "error";
  } catch (e) {
    console.error("[clicks] insert threw:", e instanceof Error ? e.message : e);
    return "error";
  }
}

/** Page size for the report read (kept under the 1,000-row PostgREST cap). */
const PAGE = 500;
/** Safety cap on rows read for one report view (40 pages). */
export const CLICK_REPORT_MAX_ROWS = 20_000;

export type ClickReadResult = {
  rows: StoredClick[];
  missingTable: boolean;
  /** True when the period had more clicks than the safety cap. */
  truncated: boolean;
};

export async function readClicksSince(sinceIso: string): Promise<ClickReadResult> {
  if (!isSupabaseServiceConfigured) return { rows: [], missingTable: false, truncated: false };
  const admin = createSupabaseAdminClient();
  const rows: StoredClick[] = [];
  for (let from = 0; from < CLICK_REPORT_MAX_ROWS; from += PAGE) {
    const { data, error } = await admin
      .from("website_click_events")
      .select("occurred_at,page_path,placement,slot_key,slot_label,slot_position,button_label,target_href,device")
      .gte("occurred_at", sinceIso)
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) {
      if (isMissingTable(error)) return { rows: [], missingTable: true, truncated: false };
      throw new Error(error.message);
    }
    const batch = (data as StoredClick[] | null) ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) return { rows, missingTable: false, truncated: false };
  }
  return { rows, missingTable: false, truncated: true };
}
