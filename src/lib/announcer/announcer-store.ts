/**
 * src/lib/announcer/announcer-store.ts
 *
 * SLICE 28 — SERVER-ONLY data access for the order announcer.
 *
 * Every function here is deliberately dull. The interesting decisions all live
 * in announcer-core.ts and announcer-protocol-core.ts, which are pure and
 * self-tested; this file only moves rows.
 *
 * TWO DISCIPLINES THAT ARE NOT NEGOTIABLE IN THIS FILE
 * -----------------------------------------------------
 * 1. Device keys are stored as scrypt hashes and never in plaintext, exactly
 *    the way pos_devices.provision_hash works (see src/lib/pos/sync-store.ts
 *    authenticateDevice). The plaintext exists for the length of one HTTP
 *    response and then only on the Pi.
 *
 * 2. Nothing here may throw into a caller that is announcing an order. A
 *    speaker failing must never fail a customer's order, so the write paths
 *    that sit near order placement return a result rather than raising.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { hashPin, verifyPin } from "@/lib/security/pin-hash";
import {
  ANNOUNCEMENT_TTL_SECONDS,
  CLAIM_LEASE_SECONDS,
  normalizeDeviceName,
  normalizeVolume,
  PAIRING_ALPHABET,
  PAIRING_CODE_LENGTH,
  pairingCodeValidity,
} from "./announcer-core";
import { toJob, type AnnouncerJob } from "./announcer-protocol-core";
import { randomInt } from "node:crypto";

const MIGRATION_HINT =
  "The announcer tables are not installed yet. Apply migration 0222_order_announcer.sql in the Supabase SQL editor.";

function isMissingSchema(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  // 42P01 undefined_table, 42703 undefined_column, PGRST205 unknown relation.
  const code = err.code ?? "";
  if (code === "42P01" || code === "42703" || code === "PGRST205") return true;
  const m = (err.message ?? "").toLowerCase();
  return m.includes("does not exist") || m.includes("could not find the table");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AnnouncerDevice = {
  id: string;
  name: string;
  enabled: boolean;
  volume: number;
  sound_id: string | null;
  custom_sound_path: string | null;
  last_seen_at: string | null;
  agent_info: Record<string, unknown>;
};

export type DeviceAuth =
  | { ok: true; device: AnnouncerDevice }
  | { ok: false; status: 401 | 503; error: string };

// ---------------------------------------------------------------------------
// Device authentication
// ---------------------------------------------------------------------------

const DEVICE_COLUMNS = "id, name, enabled, volume, sound_id, custom_sound_path, last_seen_at, agent_info";

/**
 * Authenticate a Pi by id + key.
 *
 * FAILS CLOSED, mirroring authenticateDevice in src/lib/pos/sync-store.ts: an
 * unknown id, a revoked device, or a row with no stored hash cannot
 * authenticate. A device that is merely DISABLED still authenticates, because
 * "turned off in the back office" is a setting, not a security event — the
 * poll succeeds and simply returns no work, which keeps the dot green so the
 * owner can see the speaker is healthy but muted. A disabled speaker that
 * looked offline would be indistinguishable from a broken one.
 */
export async function authenticateAnnouncerDevice(
  deviceId: string,
  deviceKey: string,
): Promise<DeviceAuth> {
  if (!isSupabaseServiceConfigured) return { ok: false, status: 503, error: "Database not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("announcer_devices")
    .select(`${DEVICE_COLUMNS}, device_key_hash`)
    .eq("id", deviceId)
    .maybeSingle<AnnouncerDevice & { device_key_hash: string | null }>();

  if (error) {
    return { ok: false, status: 503, error: isMissingSchema(error) ? MIGRATION_HINT : error.message };
  }
  if (!data) {
    return { ok: false, status: 401, error: "This speaker is not paired. Pair it from the Announcer page." };
  }
  if (!data.device_key_hash || !verifyPin(deviceKey, data.device_key_hash)) {
    return { ok: false, status: 401, error: "Device key rejected. Re-pair this speaker." };
  }
  const { device_key_hash: _drop, ...device } = data;
  void _drop;
  return { ok: true, device };
}

/**
 * Stamp last_seen_at. Best-effort: a failed heartbeat must never break a poll
 * that is otherwise about to deliver an announcement.
 */
export async function touchDevice(
  deviceId: string,
  agentInfo?: Record<string, unknown>,
): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  const patch: Record<string, unknown> = { last_seen_at: new Date().toISOString() };
  if (agentInfo && Object.keys(agentInfo).length > 0) patch.agent_info = agentInfo;
  await admin
    .from("announcer_devices")
    .update(patch)
    .eq("id", deviceId)
    .then(
      () => {},
      () => {},
    );
}

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

/**
 * Generate a code from the confusion-free alphabet using a CSPRNG.
 *
 * randomInt rather than Math.random: these codes are short-lived but they are
 * still credentials, and a predictable one would let anyone who can reach the
 * endpoint claim a speaker slot. node:crypto costs nothing here.
 */
export function generatePairingCode(): string {
  let out = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
    out += PAIRING_ALPHABET[randomInt(0, PAIRING_ALPHABET.length)];
  }
  return out;
}

/** 32 bytes of base64url. Long enough that brute force is not a consideration. */
function generateDeviceKey(): string {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = randomInt(0, 256);
  return Buffer.from(bytes).toString("base64url");
}

export type CreatePairingResult =
  | { ok: true; code: string; deviceName: string; expiresAt: string }
  | { ok: false; error: string };

export async function createPairing(
  deviceName: string,
  createdBy: string | null,
): Promise<CreatePairingResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const admin = createSupabaseAdminClient();
  const name = normalizeDeviceName(deviceName);

  // Retry on the astronomically unlikely collision rather than failing a setup
  // somebody is standing in a storage room waiting on.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generatePairingCode();
    const { error } = await admin
      .from("announcer_pairings")
      .insert({ code, device_name: name, created_by: createdBy });
    if (!error) {
      const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      return { ok: true, code, deviceName: name, expiresAt: expires };
    }
    if (isMissingSchema(error)) return { ok: false, error: MIGRATION_HINT };
    if (error.code !== "23505") return { ok: false, error: error.message };
  }
  return { ok: false, error: "Could not generate a unique code. Try again." };
}

export type RedeemResult =
  | { ok: true; deviceId: string; deviceKey: string; deviceName: string }
  | { ok: false; status: 400 | 404 | 409 | 503; error: string };

/**
 * Trade a pairing code for a permanent device identity.
 *
 * The returned deviceKey is the ONLY time the plaintext exists on this side.
 * We store a scrypt hash and hand the plaintext straight to the Pi, so a
 * database dump can never be turned into a working speaker credential.
 */
export async function redeemPairing(
  code: string,
  agentInfo: Record<string, unknown>,
): Promise<RedeemResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, status: 503, error: "Database not configured." };
  const admin = createSupabaseAdminClient();

  const { data: pairing, error: findErr } = await admin
    .from("announcer_pairings")
    .select("id, code, device_name, consumed_at, created_at")
    .eq("code", code)
    .maybeSingle<{
      id: string;
      code: string;
      device_name: string;
      consumed_at: string | null;
      created_at: string;
    }>();

  if (findErr) {
    return { ok: false, status: 503, error: isMissingSchema(findErr) ? MIGRATION_HINT : findErr.message };
  }
  if (!pairing) {
    return { ok: false, status: 404, error: "We do not recognize this code. Generate a new one." };
  }

  const validity = pairingCodeValidity({
    code: pairing.code,
    createdAtIso: pairing.created_at,
    consumedAtIso: pairing.consumed_at,
    nowIso: new Date().toISOString(),
  });
  if (!validity.valid) {
    return { ok: false, status: 409, error: validity.reason };
  }

  const deviceKey = generateDeviceKey();
  const { data: device, error: insErr } = await admin
    .from("announcer_devices")
    .insert({
      name: pairing.device_name,
      device_key_hash: hashPin(deviceKey),
      agent_info: agentInfo,
      last_seen_at: new Date().toISOString(),
    })
    .select("id, name")
    .single<{ id: string; name: string }>();

  if (insErr || !device) {
    return { ok: false, status: 503, error: insErr?.message ?? "Could not create the speaker." };
  }

  // Consume the code, and only for a code that is still unconsumed. If two
  // Pis race the same code, exactly one update matches and the loser is told
  // to get a fresh code rather than both quietly succeeding.
  const { data: consumed, error: consumeErr } = await admin
    .from("announcer_pairings")
    .update({ consumed_at: new Date().toISOString(), device_id: device.id })
    .eq("id", pairing.id)
    .is("consumed_at", null)
    .select("id");

  if (consumeErr || !consumed || consumed.length === 0) {
    // Lost the race. Roll the orphan device back so a failed pairing does not
    // leave a ghost card on the Announcer page.
    await admin.from("announcer_devices").delete().eq("id", device.id).then(
      () => {},
      () => {},
    );
    return { ok: false, status: 409, error: "This code was just used by another speaker. Generate a new one." };
  }

  return { ok: true, deviceId: device.id, deviceKey, deviceName: device.name };
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

export type ClaimResult = { ok: true; jobs: AnnouncerJob[] } | { ok: false; error: string };

/**
 * Ask the database for this device's work.
 *
 * The atomicity lives in the SQL function, not here — announcer_claim_work
 * uses FOR UPDATE SKIP LOCKED so two concurrent polls can never be handed the
 * same row. That property was proven by racing it, not by reading it; see
 * supabase/diagnostics/announcer_concurrency_proof.sh.
 */
export async function claimWork(deviceId: string, limit: number): Promise<ClaimResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("announcer_claim_work", {
    p_device_id: deviceId,
    p_limit: limit,
    p_ttl_seconds: ANNOUNCEMENT_TTL_SECONDS,
    p_lease_seconds: CLAIM_LEASE_SECONDS,
  });
  if (error) {
    return { ok: false, error: isMissingSchema(error) ? MIGRATION_HINT : error.message };
  }
  const rows = Array.isArray(data) ? data : [];
  // toJob returns null for a malformed row. One bad row must not poison a poll
  // and silence the shop, so they are filtered rather than thrown on.
  const jobs = rows.map(toJob).filter((j): j is AnnouncerJob => j !== null);
  return { ok: true, jobs };
}

/** Mark rows delivered. Ids are validated as digits before use. */
export async function markDelivered(deviceId: string, ids: string[]): Promise<void> {
  if (!isSupabaseServiceConfigured || ids.length === 0) return;
  const numeric = ids.map((i) => Number(i)).filter((n) => Number.isInteger(n) && n > 0);
  if (numeric.length === 0) return;
  const admin = createSupabaseAdminClient();
  await admin
    .from("announcer_queue")
    .update({ delivered_at: new Date().toISOString() })
    .in("id", numeric)
    // Scoped to the calling device so one speaker can never retire another
    // speaker's work and silence it.
    .eq("device_id", deviceId)
    .then(
      () => {},
      () => {},
    );
}

/**
 * Record a playback failure WITHOUT marking the row delivered.
 *
 * Leaving delivered_at null is the point: the lease lapses and another attempt
 * happens. A speaker that could not reach its audio device for one job should
 * get the announcement on the next poll, not lose it.
 */
export async function markFailed(
  deviceId: string,
  failures: { id: string; reason: string }[],
): Promise<void> {
  if (!isSupabaseServiceConfigured || failures.length === 0) return;
  const numeric = failures
    .map((f) => Number(f.id))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (numeric.length === 0) return;
  const admin = createSupabaseAdminClient();
  // Clear the lease immediately so the retry does not have to wait it out.
  await admin
    .from("announcer_queue")
    .update({ claimed_at: null })
    .in("id", numeric)
    .eq("device_id", deviceId)
    .then(
      () => {},
      () => {},
    );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type AnnouncerSettings = {
  enabled: boolean;
  quiet_hours_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
  default_sound_id: string;
  default_volume: number;
};

export const FALLBACK_SETTINGS: AnnouncerSettings = {
  enabled: true,
  quiet_hours_enabled: false,
  quiet_start: "21:00",
  quiet_end: "08:00",
  default_sound_id: "chime",
  default_volume: 70,
};

/**
 * Read the single settings row.
 *
 * NEVER throws and never returns null. If the table is missing, unreachable,
 * or empty, the shop gets FALLBACK_SETTINGS, which announce. The alternative —
 * failing closed — means one bad read silences every speaker in the building,
 * and nobody would know why.
 */
export async function getAnnouncerSettings(): Promise<AnnouncerSettings> {
  if (!isSupabaseServiceConfigured) return FALLBACK_SETTINGS;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("announcer_settings")
      .select("enabled, quiet_hours_enabled, quiet_start, quiet_end, default_sound_id, default_volume")
      .eq("id", 1)
      .maybeSingle<AnnouncerSettings>();
    if (error || !data) return FALLBACK_SETTINGS;
    return {
      enabled: data.enabled !== false,
      quiet_hours_enabled: data.quiet_hours_enabled === true,
      quiet_start: typeof data.quiet_start === "string" ? data.quiet_start : FALLBACK_SETTINGS.quiet_start,
      quiet_end: typeof data.quiet_end === "string" ? data.quiet_end : FALLBACK_SETTINGS.quiet_end,
      default_sound_id:
        typeof data.default_sound_id === "string" && data.default_sound_id.trim() !== ""
          ? data.default_sound_id
          : FALLBACK_SETTINGS.default_sound_id,
      default_volume: normalizeVolume(data.default_volume),
    };
  } catch {
    return FALLBACK_SETTINGS;
  }
}
