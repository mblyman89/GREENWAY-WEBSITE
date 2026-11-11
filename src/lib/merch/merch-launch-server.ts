/**
 * src/lib/merch/merch-launch-server.ts  (D232 slice M-3a, G-78)
 *
 * Server-only read/write of the Setup & Launch progress (site_settings key
 * merch_launch_progress; no migration). Read -> change -> write; never
 * overwrites progress it could not read.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { MERCH_LAUNCH_KEY, MERCH_LAUNCH_LABEL, emptyLaunchProgress, normalizeLaunchProgress, type LaunchProgress } from "./merch-launch-core";

export async function readLaunchProgress(): Promise<{ progress: LaunchProgress; error: string | null }> {
  if (!isSupabaseServiceConfigured) return { progress: emptyLaunchProgress(), error: "Database is not configured." };
  try {
    const { data, error } = await createSupabaseAdminClient().from("site_settings").select("value_json").eq("key", MERCH_LAUNCH_KEY).maybeSingle();
    if (error) return { progress: emptyLaunchProgress(), error: error.message };
    return { progress: normalizeLaunchProgress(data?.value_json ?? null), error: null };
  } catch (e) {
    return { progress: emptyLaunchProgress(), error: e instanceof Error ? e.message : "read failed" };
  }
}

export async function updateLaunchProgress(change: (p: LaunchProgress) => LaunchProgress, updatedBy: string | null): Promise<{ ok: true; progress: LaunchProgress } | { ok: false; error: string }> {
  const cur = await readLaunchProgress();
  if (cur.error) return { ok: false, error: `Couldn't read the setup progress, so nothing was changed: ${cur.error}` };
  const next = normalizeLaunchProgress(change(cur.progress));
  try {
    const { error } = await createSupabaseAdminClient()
      .from("site_settings")
      .upsert({ key: MERCH_LAUNCH_KEY, label: MERCH_LAUNCH_LABEL, value_json: next as unknown as Record<string, unknown>, updated_by: updatedBy }, { onConflict: "key" });
    return error ? { ok: false, error: error.message } : { ok: true, progress: next };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}
