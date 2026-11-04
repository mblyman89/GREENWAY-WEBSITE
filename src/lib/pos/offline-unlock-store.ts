/**
 * src/lib/pos/offline-unlock-store.ts  (D161–D167)
 *
 * Server half of offline PIN unlock. See offline-unlock-core.ts for the
 * design; this file only touches the database and node:crypto.
 *
 *   site_settings  pos_offline_unlock_policy   owner policy + revocation epoch
 *
 * THE DEVICE OFFLINE KEY
 *   key = HMAC-SHA256(server secret,
 *                     "gw-pos-offline-key|v1|" + device id + "|" + epoch + "|" + device provision hash)
 * so it is different for every iPad, changes when the owner presses "Reset
 * offline PINs" (epoch), and changes when a manager rotates the iPad's device
 * key (provision hash). Any change erases every verifier on that iPad at its
 * next check-in. The server never stores it; it re-derives it per request.
 *
 * THE PIN STAMP
 *   stamp = first 32 hex of HMAC-SHA256(server secret, "gw-pos-pin-stamp|v1|" + employee id + "|" + clock_pin hash)
 * It changes whenever the PIN changes (new random scrypt salt), so a changed
 * PIN purges the old offline verifier everywhere. It reveals nothing about
 * the PIN or the hash.
 *
 * SERVER SECRET: POS_OFFLINE_SECRET (32+ chars) when set, otherwise derived
 * from the Supabase service key with a domain label. Rotating whichever one
 * is in use simply resets offline PINs everywhere (safe; each person re-arms
 * by unlocking once online).
 */
import "server-only";

import { createHmac } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured, supabaseServiceRoleKey } from "@/lib/supabase/env";
import { registerGateForEmployee } from "@/lib/staffing/handbook-ack-store";
import { openSessionForRegister } from "@/lib/registers/store";
import {
  DEFAULT_OFFLINE_POLICY,
  OFFLINE_APPROVER_ROLES,
  normalizeOfflinePolicy,
  offlineKeyId,
  type CachedDrawer,
  type OfflineArmBlock,
  type OfflineRoster,
  type OfflineRosterEntry,
  type OfflineUnlockPolicy,
} from "@/lib/pos/offline-unlock-core";

export const POS_OFFLINE_POLICY_KEY = "pos_offline_unlock_policy";

function serverSecret(): string | null {
  const explicit = (process.env.POS_OFFLINE_SECRET ?? "").trim();
  if (explicit.length >= 32) return explicit;
  return supabaseServiceRoleKey ? `svc-derived|${supabaseServiceRoleKey}` : null;
}

/** True when the server can issue offline keys at all. */
export function offlineUnlockConfigured(): boolean {
  return serverSecret() !== null;
}

function hmacB64url(secret: string, msg: string): string {
  return createHmac("sha256", secret).update(msg, "utf8").digest("base64url");
}

export function deviceOfflineKey(device: { id: string; provision_hash: string | null }, epoch: number): string | null {
  const secret = serverSecret();
  if (!secret || !device.provision_hash) return null;
  return hmacB64url(secret, `gw-pos-offline-key|v1|${device.id.toLowerCase()}|${epoch}|${device.provision_hash}`);
}

export function pinStampFor(employeeId: string, clockPinHash: string | null): string | null {
  const secret = serverSecret();
  if (!secret || !clockPinHash) return null;
  return createHmac("sha256", secret)
    .update(`gw-pos-pin-stamp|v1|${employeeId.toLowerCase()}|${clockPinHash}`, "utf8")
    .digest("hex")
    .slice(0, 32);
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export async function getOfflinePolicy(): Promise<OfflineUnlockPolicy> {
  if (!isSupabaseServiceConfigured) return { ...DEFAULT_OFFLINE_POLICY };
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("site_settings").select("value_json").eq("key", POS_OFFLINE_POLICY_KEY).maybeSingle();
    return data?.value_json == null ? { ...DEFAULT_OFFLINE_POLICY } : normalizeOfflinePolicy(data.value_json);
  } catch {
    return { ...DEFAULT_OFFLINE_POLICY };
  }
}

/**
 * STRICT read for writes (the owner's reset bumps the epoch). Returns null on
 * any database error instead of the default, so a hiccup can never turn
 * "epoch 7 + 1" into "default 1 + 1" and silently UN-revoke old offline PINs.
 */
export async function getOfflinePolicyStrict(): Promise<OfflineUnlockPolicy | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("site_settings").select("value_json").eq("key", POS_OFFLINE_POLICY_KEY).maybeSingle();
    if (error) return null;
    return data?.value_json == null ? { ...DEFAULT_OFFLINE_POLICY } : normalizeOfflinePolicy(data.value_json);
  } catch {
    return null;
  }
}

export async function saveOfflinePolicy(policy: OfflineUnlockPolicy, updatedBy: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("site_settings").upsert(
      {
        key: POS_OFFLINE_POLICY_KEY,
        label: "Register offline PIN unlock policy (D161, owner-only)",
        value_json: normalizeOfflinePolicy(policy) as unknown as Record<string, unknown>,
        updated_by: updatedBy,
      },
      { onConflict: "key" },
    );
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

// ---------------------------------------------------------------------------
// Arm block (rides the ONLINE unlock / approve / clock answers)
// ---------------------------------------------------------------------------

type DeviceLike = { id: string; provision_hash: string | null; register_id: string | null };
type EmployeeLike = { id: string; full_name: string; job_role: string; saw_username?: string | null; clock_pin: string | null };

/**
 * The block that lets the iPad arm THIS employee for offline unlock, or null
 * when it cannot be issued (no server secret, unprovisioned device, legacy
 * plaintext PIN). Never throws: a failure here must never fail an online unlock.
 */
export async function offlineArmFor(device: DeviceLike, employee: EmployeeLike): Promise<OfflineArmBlock | null> {
  try {
    const policy = await getOfflinePolicy();
    const key = deviceOfflineKey(device, policy.epoch);
    const pinStamp = pinStampFor(employee.id, employee.clock_pin);
    if (!key || !pinStamp) return null;
    return {
      keyId: offlineKeyId(policy.epoch),
      key,
      policy,
      serverNowMs: Date.now(),
      pinStamp,
      canApprove: OFFLINE_APPROVER_ROLES.includes(employee.job_role),
      employee: { id: employee.id, fullName: employee.full_name, jobRole: employee.job_role, sawUsername: employee.saw_username ?? null },
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

export type RosterResult = { ok: true; roster: OfflineRoster } | { ok: false; status: number; error: string };

/**
 * Who may unlock THIS iPad offline right now. ALL-OR-NOTHING: if any lookup
 * fails the whole answer is a 503, because a partial roster would purge
 * people from the iPad because of a database hiccup.
 */
export async function buildOfflineRoster(device: DeviceLike): Promise<RosterResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, status: 503, error: "Database not configured." };
  if (!device.register_id) return { ok: false, status: 409, error: "This device is not bound to a register." };
  const policy = await getOfflinePolicy();
  const key = deviceOfflineKey(device, policy.epoch);
  if (!key) return { ok: false, status: 503, error: "Offline unlock is not configured on the server." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("employees")
    .select("id, full_name, job_role, saw_username, staff_id, clock_pin, active")
    .eq("active", true)
    .not("clock_pin", "is", null)
    .limit(500);
  if (error) return { ok: false, status: 503, error: error.message };
  const rows = (data ?? []) as Array<{ id: string; full_name: string; job_role: string; saw_username: string | null; staff_id: string | null; clock_pin: string | null }>;

  const { data: punches, error: punchErr } = await admin
    .from("time_punches")
    .select("employee_id")
    .is("clock_out_at", null)
    .eq("punch_kind", "work")
    .limit(1000);
  const onClock = punchErr ? null : new Set(((punches ?? []) as Array<{ employee_id: string }>).map((p) => p.employee_id));

  const employees: OfflineRosterEntry[] = [];
  if (policy.enabled) {
    for (const r of rows) {
      const stamp = pinStampFor(r.id, r.clock_pin);
      // Only scrypt-hashed PINs are offered offline; a legacy plaintext PIN
      // is re-hashed on its next online use and then appears here.
      if (!stamp || !(r.clock_pin ?? "").startsWith("scrypt$")) continue;
      let gate;
      try {
        gate = await registerGateForEmployee({ employeeId: r.id, staffId: r.staff_id ?? null });
      } catch (e) {
        return { ok: false, status: 503, error: e instanceof Error ? e.message : "Handbook check failed." };
      }
      if (!gate.ok) continue;
      employees.push({
        id: r.id,
        fullName: r.full_name,
        jobRole: r.job_role,
        canApprove: OFFLINE_APPROVER_ROLES.includes(r.job_role),
        sawUsername: r.saw_username ?? null,
        pinStamp: stamp,
        ...(onClock ? { clockedIn: onClock.has(r.id) } : {}),
      });
    }
  }

  let drawer: CachedDrawer | null | undefined;
  try {
    const s = await openSessionForRegister(device.register_id);
    drawer = s ? { sessionId: s.id, openedAt: s.opened_at, businessDay: s.business_day } : null;
  } catch {
    drawer = undefined; // unknown: the iPad keeps what it had
  }

  return {
    ok: true,
    roster: {
      keyId: offlineKeyId(policy.epoch),
      key,
      policy,
      serverNowMs: Date.now(),
      employees,
      ...(drawer !== undefined ? { drawer } : {}),
    },
  };
}
