/**
 * src/lib/compliance/ccrs-handover-store.ts  (CCRS Bible v2 S-17d)
 *
 * Server glue for the integrator hand-over facts: site_settings key
 * ccrs_handover_facts, value_json { integratorLastSaleDate,
 * integratorFinalUploadDate } (YYYY-MM-DD or null). No migration: the
 * site_settings table (0001) already stores any key.
 *
 * All rules live in the PURE ccrs-handover-core. FAILS SAFE: an unreadable
 * setting reads as "not recorded", which only ADDS warnings to the plan
 * (LAST_SALE_UNKNOWN / FINAL_UPLOAD_UNKNOWN); it can never hide one.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pacificToday } from "@/lib/reports/timezone";
import { validateStartDate } from "./obligation-waiver-core";
import { EMPTY_HANDOVER_FACTS, handoverFactsFromSetting, type HandoverFacts } from "./ccrs-handover-core";

export const HANDOVER_SETTING_KEY = "ccrs_handover_facts";
const HANDOVER_SETTING_LABEL = "CCRS hand-over: integrator's last sale day and final upload day (S-17d)";

export async function getHandoverFacts(): Promise<HandoverFacts> {
  if (!isSupabaseServiceConfigured) return EMPTY_HANDOVER_FACTS;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("site_settings")
      .select("value_json")
      .eq("key", HANDOVER_SETTING_KEY)
      .maybeSingle();
    if (error) return EMPTY_HANDOVER_FACTS;
    return handoverFactsFromSetting(data?.value_json ?? null);
  } catch {
    return EMPTY_HANDOVER_FACTS;
  }
}

/** Save both dates. Each may be "" to clear it. Same date rules as the first day of sales. */
export async function setHandoverFacts(opts: {
  lastSaleRaw: unknown;
  finalUploadRaw: unknown;
  byId: string | null;
}): Promise<{ ok: true; facts: HandoverFacts } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  const today = pacificToday();
  const a = validateStartDate(opts.lastSaleRaw, today);
  if (!a.ok) return { ok: false, error: `Integrator's last sale day: ${a.error}` };
  const b = validateStartDate(opts.finalUploadRaw, today);
  if (!b.ok) return { ok: false, error: `Integrator's final upload day: ${b.error}` };
  const facts: HandoverFacts = {
    integratorLastSaleDate: a.value === "" ? null : a.value,
    integratorFinalUploadDate: b.value === "" ? null : b.value,
  };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("site_settings").upsert(
      {
        key: HANDOVER_SETTING_KEY,
        label: HANDOVER_SETTING_LABEL,
        value_json: facts,
        updated_by: opts.byId,
      },
      { onConflict: "key" },
    );
    if (error) return { ok: false, error: error.message };
    return { ok: true, facts };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}
