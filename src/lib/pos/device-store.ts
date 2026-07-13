/**
 * src/lib/pos/device-store.ts  (POS Slice B5)
 *
 * SERVER-ONLY management of provisioned register iPads (`pos_devices`,
 * migration 0120). Provisioning follows the clock-PIN discipline (S-10):
 * the device key is generated server-side, shown to the manager EXACTLY ONCE,
 * and only its salted scrypt hash is stored. Revocation is instant — the sync
 * route re-verifies the hash on every flush.
 */
import "server-only";
import { randomBytes } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { hashPin } from "@/lib/security/pin-hash";

function isMissingSchemaError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    /relation .* does not exist|column .* does not exist|Could not find the table|could not find .* column/i.test(
      error.message ?? "",
    )
  );
}

const MIGRATION_HINT =
  "POS device tables are not available yet — apply supabase/migrations/0120_pos_foundation.sql first.";

export type PosDeviceRow = {
  id: string;
  name: string;
  register_id: string | null;
  status: "active" | "revoked";
  last_seen_at: string | null;
  last_synced_at: string | null;
  notes: string | null;
  created_at: string;
};

export type DeviceListResult =
  | { ok: true; devices: PosDeviceRow[] }
  | { ok: false; error: string; migrationMissing: boolean };

export async function listPosDevices(): Promise<DeviceListResult> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Database not configured.", migrationMissing: false };
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("pos_devices")
    .select("id, name, register_id, status, last_seen_at, last_synced_at, notes, created_at")
    .order("created_at", { ascending: true });
  if (error) {
    return {
      ok: false,
      error: isMissingSchemaError(error) ? MIGRATION_HINT : error.message,
      migrationMissing: isMissingSchemaError(error),
    };
  }
  return { ok: true, devices: (data as PosDeviceRow[] | null) ?? [] };
}

export type ProvisionResult =
  | {
      ok: true;
      deviceId: string;
      /** Plaintext device key — shown ONCE, never stored, never retrievable. */
      deviceKey: string;
    }
  | { ok: false; error: string };

/**
 * Provision a new register iPad: create the row and mint its key. The
 * PLAINTEXT key is returned exactly once for the manager to enter on the
 * device; only the scrypt hash persists.
 */
export async function provisionDevice(opts: {
  name: string;
  registerId: string | null;
  createdBy: string | null;
  notes?: string | null;
}): Promise<ProvisionResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const name = opts.name.trim();
  if (name.length < 3) return { ok: false, error: "Give the device a name (at least 3 characters)." };

  const deviceKey = randomBytes(24).toString("base64url"); // 192-bit key
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("pos_devices")
    .insert({
      name,
      register_id: opts.registerId,
      status: "active",
      provision_hash: hashPin(deviceKey),
      notes: opts.notes?.trim() || null,
      created_by: opts.createdBy,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    return { ok: false, error: isMissingSchemaError(error) ? MIGRATION_HINT : error?.message ?? "Insert failed." };
  }
  return { ok: true, deviceId: data.id, deviceKey };
}

/** Rotate a device's key (old key stops working immediately). */
export async function rotateDeviceKey(deviceId: string): Promise<ProvisionResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const deviceKey = randomBytes(24).toString("base64url");
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("pos_devices")
    .update({ provision_hash: hashPin(deviceKey) })
    .eq("id", deviceId)
    .eq("status", "active")
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) return { ok: false, error: isMissingSchemaError(error) ? MIGRATION_HINT : error.message };
  if (!data) return { ok: false, error: "Device not found or revoked." };
  return { ok: true, deviceId: data.id, deviceKey };
}

/** Revoke a device — its key stops authenticating on the next request. */
export async function revokeDevice(deviceId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("pos_devices").update({ status: "revoked" }).eq("id", deviceId);
  if (error) return { ok: false, error: isMissingSchemaError(error) ? MIGRATION_HINT : error.message };
  return { ok: true };
}

/** Bind (or unbind) a device to a register. */
export async function bindDeviceToRegister(
  deviceId: string,
  registerId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("pos_devices").update({ register_id: registerId }).eq("id", deviceId);
  if (error) return { ok: false, error: isMissingSchemaError(error) ? MIGRATION_HINT : error.message };
  return { ok: true };
}
