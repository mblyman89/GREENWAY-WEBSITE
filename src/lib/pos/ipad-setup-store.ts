/**
 * src/lib/pos/ipad-setup-store.ts  (D142–D150)
 *
 * Server-side persistence for the iPad lockdown work. No migration: every
 * value is a site_settings JSON row, the same pattern as the return policy.
 *
 *   pos_ipad_lockdown              the owner-only lockdown policy the registers enforce
 *   pos_ipad_setup                 the per-iPad setup checklist ticks (who / when)
 *   pos_device_health:<device id>  each iPad's latest self-reported health
 *
 * Health writes are best-effort and throttled (ipad-setup-core.healthWriteDue)
 * so a register heartbeat can never fail or slow a sync because of them.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  DEFAULT_LOCKDOWN_POLICY,
  DEVICE_HEALTH_KEY_PREFIX,
  deviceHealthKey,
  deviceIdFromHealthKey,
  healthWriteDue,
  normalizeChecklistState,
  normalizeLockdownPolicy,
  sanitizeDeviceHealthReport,
  type ChecklistState,
  type DeviceHealthReport,
  type IpadLockdownPolicy,
} from "@/lib/pos/ipad-setup-core";

export const POS_IPAD_LOCKDOWN_KEY = "pos_ipad_lockdown";
export const POS_IPAD_SETUP_KEY = "pos_ipad_setup";

async function readValue(key: string): Promise<unknown> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("site_settings").select("value_json").eq("key", key).maybeSingle();
    return data?.value_json ?? null;
  } catch {
    return null;
  }
}

async function writeValue(key: string, label: string, value: unknown, updatedBy: string | null): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("site_settings")
      .upsert({ key, label, value_json: value as Record<string, unknown>, updated_by: updatedBy }, { onConflict: "key" });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

export async function getIpadLockdownPolicy(): Promise<IpadLockdownPolicy> {
  const raw = await readValue(POS_IPAD_LOCKDOWN_KEY);
  return raw == null ? { ...DEFAULT_LOCKDOWN_POLICY } : normalizeLockdownPolicy(raw);
}

export async function saveIpadLockdownPolicy(policy: IpadLockdownPolicy, updatedBy: string): Promise<{ ok: boolean; error?: string }> {
  return writeValue(POS_IPAD_LOCKDOWN_KEY, "iPad lockdown policy (D146, owner-only)", normalizeLockdownPolicy(policy), updatedBy);
}

export async function getIpadChecklistState(): Promise<ChecklistState> {
  return normalizeChecklistState(await readValue(POS_IPAD_SETUP_KEY));
}

export async function saveIpadChecklistState(state: ChecklistState, updatedBy: string): Promise<{ ok: boolean; error?: string }> {
  return writeValue(POS_IPAD_SETUP_KEY, "iPad setup checklist (D147, owner-only)", { v: 1, devices: state }, updatedBy);
}

/** Record a register's self-reported health. Best-effort; never throws. */
export async function recordDeviceHealth(deviceId: string, rawReport: unknown): Promise<void> {
  const key = deviceHealthKey(deviceId);
  const report = sanitizeDeviceHealthReport(rawReport);
  if (!key || !report || !isSupabaseServiceConfigured) return;
  try {
    const prevRaw = await readValue(key);
    const prev = prevRaw ? sanitizeDeviceHealthReport(prevRaw) : null;
    const prevAt = prevRaw && typeof (prevRaw as { reportedAt?: unknown }).reportedAt === "string" ? (prevRaw as { reportedAt: string }).reportedAt : undefined;
    const now = Date.now();
    if (!healthWriteDue(prev ? { ...prev, reportedAt: prevAt } : null, report, now)) return;
    await writeValue(key, "Register iPad health (D145, self-reported)", { ...report, reportedAt: new Date(now).toISOString() }, null);
  } catch {
    // Visibility only: a failed write must never affect a sync.
  }
}

/** Every device's latest health report, keyed by device id. */
export async function listDeviceHealth(): Promise<Record<string, DeviceHealthReport>> {
  const out: Record<string, DeviceHealthReport> = {};
  if (!isSupabaseServiceConfigured) return out;
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("site_settings")
      .select("key, value_json")
      .like("key", `${DEVICE_HEALTH_KEY_PREFIX}%`)
      .limit(200);
    for (const row of (data ?? []) as Array<{ key: string; value_json: unknown }>) {
      const id = deviceIdFromHealthKey(row.key);
      const rep = sanitizeDeviceHealthReport(row.value_json);
      if (!id || !rep) continue;
      const at = (row.value_json as { reportedAt?: unknown })?.reportedAt;
      out[id] = { ...rep, reportedAt: typeof at === "string" ? at : undefined };
    }
  } catch {
    // Empty map: the page shows "not reported".
  }
  return out;
}
