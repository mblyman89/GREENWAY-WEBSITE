/**
 * src/lib/inventory/count-time-store.ts   (Fix Phase 4.5c · G-40 / G-41 · D58)
 *
 * SERVER-ONLY: reads what count-time-core needs to turn lots into minutes:
 *   - the most recent finished counts (claimed_at, submitted_at, planned lots;
 *     both stamps exist since migration 0326), newest first;
 *   - the owner's minutes-per-lot setting (site_settings `count_pace`; no
 *     migration: site_settings stores any key, 0001).
 * Fails soft to "no measurements": the pace only labels and sizes a PROPOSAL.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  PACE_LOOKBACK_COUNTS,
  PACE_SETTING_KEY,
  paceFromSetting,
  resolvePace,
  type CountPace,
  type FinishedCount,
} from "./count-time-core";

const PACE_SETTING_LABEL = "Cycle counts: minutes per lot for planning (Fix Phase 4.5c)";

export async function getOwnerMinutesPerLot(): Promise<number | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("site_settings").select("value_json").eq("key", PACE_SETTING_KEY).maybeSingle();
    if (error) return null;
    return paceFromSetting(data?.value_json ?? null);
  } catch {
    return null;
  }
}

export async function loadFinishedCounts(): Promise<FinishedCount[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    // Small, bounded read (the newest few dozen), well under the 1,000-row cap.
    const { data, error } = await admin
      .from("inventory_audit_sessions")
      .select("claimed_at, submitted_at, planned_lot_count")
      .not("submitted_at", "is", null)
      .not("claimed_at", "is", null)
      .order("submitted_at", { ascending: false })
      .limit(PACE_LOOKBACK_COUNTS * 2);
    if (error || !data) return [];
    return (data as { claimed_at: string | null; submitted_at: string | null; planned_lot_count: number | null }[]).map((r) => ({
      claimedAt: r.claimed_at,
      submittedAt: r.submitted_at,
      lots: Number(r.planned_lot_count ?? 0),
    }));
  } catch {
    return [];
  }
}

export async function getCountPace(): Promise<CountPace> {
  const [finished, owner] = await Promise.all([loadFinishedCounts(), getOwnerMinutesPerLot()]);
  return resolvePace(finished, owner);
}

export async function saveOwnerMinutesPerLot(minutesPerLot: number, byId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database is not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("site_settings")
      .upsert({ key: PACE_SETTING_KEY, label: PACE_SETTING_LABEL, value_json: { minutesPerLot }, updated_by: byId }, { onConflict: "key" });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}
