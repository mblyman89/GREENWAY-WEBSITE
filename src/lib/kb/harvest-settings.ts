/**
 * src/lib/kb/harvest-settings.ts — Slice H7 (Harvest Tuning), server wrapper.
 *
 * Reads/writes the kb_harvest_settings singleton (migration 0098) and maps it
 * to the camelCase HarvestSettings the app consumes.
 *
 * FAIL-OPEN: if Supabase isn't configured, the table doesn't exist yet (the
 * owner applies migrations manually), or the read errors for any reason, the
 * loader returns the vetted HARVEST_DEFAULTS — the pipeline keeps running on
 * exactly the numbers it ran on before this slice existed. Every loaded value
 * is re-clamped so even a direct DB edit can't smuggle an out-of-range knob
 * into the pipeline.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  HARVEST_DEFAULTS,
  mergeHarvestSettings,
  clampHarvestSettings,
  type HarvestSettings,
} from "./harvest-settings-core";

export type { HarvestSettings } from "./harvest-settings-core";

/** DB row shape (snake_case) of public.kb_harvest_settings. */
type SettingsRow = {
  fast_lane_min_confidence: number | string | null;
  fast_lane_min_chars: number | null;
  stale_after_days: number | null;
  refresh_batch: number | null;
  trickle_batch: number | null;
  batch_accept_cap: number | null;
  pending_limit: number | null;
  tier1_max_pages: number | null;
  tier2_max_pages: number | null;
  tier3_max_pages: number | null;
  tier3_delay_seconds: number | null;
  updated_at: string | null;
};

export type HarvestSettingsState = HarvestSettings & {
  /** True when the values came from the DB row (vs compiled-in defaults). */
  persisted: boolean;
  /** Last save time (ISO) when persisted, else null. */
  updatedAt: string | null;
};

/**
 * Load the effective harvest settings. Never throws; never returns
 * out-of-range values.
 */
export async function loadHarvestSettings(): Promise<HarvestSettingsState> {
  const fallback: HarvestSettingsState = { ...HARVEST_DEFAULTS, persisted: false, updatedAt: null };
  if (!isSupabaseServiceConfigured) return fallback;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_harvest_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (error || !data) return fallback; // table missing / row missing → defaults
    const row = data as SettingsRow;
    const merged = mergeHarvestSettings(HARVEST_DEFAULTS, {
      fastLaneMinConfidence: row.fast_lane_min_confidence,
      fastLaneMinChars: row.fast_lane_min_chars,
      staleAfterDays: row.stale_after_days,
      refreshBatch: row.refresh_batch,
      trickleBatch: row.trickle_batch,
      batchAcceptCap: row.batch_accept_cap,
      pendingLimit: row.pending_limit,
      tier1MaxPages: row.tier1_max_pages,
      tier2MaxPages: row.tier2_max_pages,
      tier3MaxPages: row.tier3_max_pages,
      tier3DelaySeconds: row.tier3_delay_seconds,
    });
    return { ...merged, persisted: true, updatedAt: row.updated_at ?? null };
  } catch {
    return fallback;
  }
}

/**
 * Persist a full settings object (clamped first — the DB CHECKs are the
 * backstop, not the front line). Returns an error message or null on success.
 */
export async function saveHarvestSettings(input: HarvestSettings): Promise<string | null> {
  if (!isSupabaseServiceConfigured) return "Supabase isn't configured.";
  const s = clampHarvestSettings(input);
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("kb_harvest_settings").upsert(
    {
      id: 1,
      fast_lane_min_confidence: s.fastLaneMinConfidence,
      fast_lane_min_chars: s.fastLaneMinChars,
      stale_after_days: s.staleAfterDays,
      refresh_batch: s.refreshBatch,
      trickle_batch: s.trickleBatch,
      batch_accept_cap: s.batchAcceptCap,
      pending_limit: s.pendingLimit,
      tier1_max_pages: s.tier1MaxPages,
      tier2_max_pages: s.tier2MaxPages,
      tier3_max_pages: s.tier3MaxPages,
      tier3_delay_seconds: s.tier3DelaySeconds,
    },
    { onConflict: "id" },
  );
  if (error) {
    // The most likely failure: migration 0098 not applied yet.
    if (/relation .* does not exist/i.test(error.message)) {
      return "The kb_harvest_settings table doesn't exist yet — run migration 0098 first.";
    }
    return error.message;
  }
  return null;
}

/** Reset the singleton to the vetted defaults. */
export async function resetHarvestSettings(): Promise<string | null> {
  return saveHarvestSettings({ ...HARVEST_DEFAULTS });
}
