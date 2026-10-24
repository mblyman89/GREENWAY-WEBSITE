/**
 * R74 S35 - the batch lookup pause switch (one site_settings row). Read by
 * both cron ticks every minute; written by the Batch Lookups console.
 * A failed read never stops the queue (fails open: lookups keep running).
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { BATCH_CONTROL_KEY, BATCH_CONTROL_LABEL, OPEN_CONTROL, parseBatchControl, type BatchControl } from "@/lib/ai/batch-console-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export async function readBatchControl(admin: Admin): Promise<BatchControl> {
  try {
    const { data, error } = await admin.from("site_settings").select("value_json").eq("key", BATCH_CONTROL_KEY).maybeSingle();
    if (error) return { ...OPEN_CONTROL };
    return parseBatchControl((data as { value_json?: unknown } | null)?.value_json ?? null);
  } catch {
    return { ...OPEN_CONTROL };
  }
}

export async function writeBatchControl(admin: Admin, next: BatchControl, actor: { userId: string | null; email: string | null }): Promise<boolean> {
  const value = { ...next, at: new Date().toISOString(), by: actor.email };
  const { error } = await admin
    .from("site_settings")
    .upsert({ key: BATCH_CONTROL_KEY, label: BATCH_CONTROL_LABEL, value_json: value, updated_by: actor.userId, updated_at: new Date().toISOString() }, { onConflict: "key" });
  return !error;
}
