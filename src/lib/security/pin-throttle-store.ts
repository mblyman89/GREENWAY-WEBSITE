/**
 * pin-throttle-store.ts (Task AN-8)
 *
 * Server wrapper for the DURABLE PIN brute-force throttle (`pin_throttle`
 * table, migration 0123; pure math in pin-throttle-core.ts).
 *
 * FALLBACK POSTURE — the legacy S-10 in-memory throttle is the safety net,
 * not dead code: when Supabase is unconfigured, the table is missing
 * (migration 0123 applied MANUALLY by the owner — code must work before it
 * lands), or a read/write fails, every function falls back to the in-memory
 * window so the pad is NEVER less protected than it was before AN-8. When
 * the durable row is available it is authoritative and per-scope
 * ('pos-device:<id>' / 'timeclock'), surviving cold starts and shared across
 * instances.
 *
 * CONCURRENCY: failure recording is read-modify-write without a lock; two
 * exactly-simultaneous failures can collapse into one counted attempt. That
 * bounded undercount is acceptable — the durable window is still categorically
 * stronger than per-instance memory, and PIN attempts are human-speed.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  pinThrottleBlocked as memBlocked,
  recordPinFailure as memFailure,
  recordPinSuccess as memSuccess,
} from "@/lib/security/pin-hash";
import {
  parseThrottleState,
  recordThrottleFailure,
  throttleBlockedMessage,
} from "@/lib/security/pin-throttle-core";

export { deviceThrottleScope, TIMECLOCK_THROTTLE_SCOPE } from "@/lib/security/pin-throttle-core";

type ThrottleRow = { failure_times: unknown; locked_until: string | null };

/** PostgREST "relation does not exist" — migration 0123 not applied yet. */
function isMissingSchemaError(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  if (!err) return false;
  return (
    err.code === "42P01" ||
    /relation .* does not exist|Could not find the table/i.test(err.message ?? "")
  );
}

/**
 * Null when attempts are allowed for this scope; otherwise the lock message.
 * Falls back to the in-memory window on any durable-store problem.
 */
export async function pinPadBlocked(scope: string): Promise<string | null> {
  if (!isSupabaseServiceConfigured) return memBlocked();
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("pin_throttle")
      .select("failure_times, locked_until")
      .eq("scope", scope)
      .maybeSingle();
    if (error) throw error;
    const now = Date.now();
    const row = (data as ThrottleRow | null) ?? null;
    const state = parseThrottleState(row?.failure_times ?? [], row?.locked_until ?? null, now);
    return throttleBlockedMessage(state, now);
  } catch (e) {
    if (!isMissingSchemaError(e)) {
      console.error("[pin-throttle] read failed; using in-memory fallback:", e);
    }
    return memBlocked();
  }
}

/** Record a failed attempt for this scope (durable; in-memory on fallback). */
export async function notePinFailure(scope: string): Promise<void> {
  if (!isSupabaseServiceConfigured) {
    memFailure();
    return;
  }
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("pin_throttle")
      .select("failure_times, locked_until")
      .eq("scope", scope)
      .maybeSingle();
    if (error) throw error;
    const now = Date.now();
    const row = (data as ThrottleRow | null) ?? null;
    const state = parseThrottleState(row?.failure_times ?? [], row?.locked_until ?? null, now);
    const next = recordThrottleFailure(state, now);
    const { error: writeError } = await admin.from("pin_throttle").upsert(
      {
        scope,
        failure_times: next.failureTimes,
        locked_until: next.lockedUntilMs != null ? new Date(next.lockedUntilMs).toISOString() : null,
        updated_at: new Date(now).toISOString(),
      },
      { onConflict: "scope" },
    );
    if (writeError) throw writeError;
  } catch (e) {
    if (!isMissingSchemaError(e)) {
      console.error("[pin-throttle] failure write failed; using in-memory fallback:", e);
    }
    memFailure();
  }
}

/** Clear the scope's window after a successful PIN (durable + in-memory). */
export async function notePinSuccess(scope: string): Promise<void> {
  // Always clear the in-memory fallback too, so a prior fallback lock can't
  // outlive a legitimate success.
  memSuccess();
  if (!isSupabaseServiceConfigured) return;
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("pin_throttle").delete().eq("scope", scope);
    if (error) throw error;
  } catch (e) {
    if (!isMissingSchemaError(e)) {
      console.error("[pin-throttle] success clear failed (best-effort):", e);
    }
  }
}
