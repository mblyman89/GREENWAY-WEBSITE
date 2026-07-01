// Server-only data access for WebAuthn passkeys + challenges. All reads/writes
// use the service-role client so the anonymous authentication ceremony can look
// up credentials by email before a session exists. RLS on the tables still
// protects direct client access (see migration 0058).
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { encodeTransports, decodeTransports, type WebAuthnTransport } from "./webauthn-core";

export type StoredCredential = {
  id: string;
  userId: string;
  webauthnUserId: string;
  publicKey: Uint8Array;
  counter: number;
  deviceType: string | null;
  backedUp: boolean;
  transports: WebAuthnTransport[];
  label: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

export type CredentialListItem = {
  id: string;
  label: string | null;
  deviceType: string | null;
  backedUp: boolean;
  lastUsedAt: string | null;
  createdAt: string;
};

// bytea comes back from PostgREST as a hex string like "\\x0a1b..." — decode it.
function decodeByteaHex(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) {
    // Ensure an ArrayBuffer-backed copy (not SharedArrayBuffer) for exact typing.
    const copy = new Uint8Array(new ArrayBuffer(v.byteLength));
    copy.set(v);
    return copy;
  }
  const s = String(v ?? "");
  const hex = s.startsWith("\\x") ? s.slice(2) : s;
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// Encode bytes to the "\\x..." hex literal PostgREST accepts for a bytea column.
function encodeByteaHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `\\x${hex}`;
}

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

export type ChallengeKind = "registration" | "authentication";

export type StoredChallenge = {
  id: string;
  kind: ChallengeKind;
  challenge: string;
  userId: string | null;
  email: string | null;
  webauthnUserId: string | null;
  expiresAt: string;
};

/** Persist a fresh challenge; returns its opaque handle id. */
export async function saveChallenge(input: {
  kind: ChallengeKind;
  challenge: string;
  userId?: string | null;
  email?: string | null;
  webauthnUserId?: string | null;
}): Promise<string | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("webauthn_challenges")
    .insert({
      kind: input.kind,
      challenge: input.challenge,
      user_id: input.userId ?? null,
      email: input.email ?? null,
      webauthn_user_id: input.webauthnUserId ?? null,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) return null;
  return data.id as string;
}

/** Read + delete a challenge (single-use). Returns null if missing. */
export async function consumeChallenge(id: string): Promise<StoredChallenge | null> {
  if (!isSupabaseServiceConfigured || !id) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("webauthn_challenges")
    .select("id,kind,challenge,user_id,email,webauthn_user_id,expires_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  // Single-use: delete immediately so a challenge can't be replayed.
  await admin.from("webauthn_challenges").delete().eq("id", id);
  return {
    id: data.id as string,
    kind: data.kind as ChallengeKind,
    challenge: data.challenge as string,
    userId: (data.user_id as string | null) ?? null,
    email: (data.email as string | null) ?? null,
    webauthnUserId: (data.webauthn_user_id as string | null) ?? null,
    expiresAt: data.expires_at as string,
  };
}

/** Best-effort cleanup of expired challenges (called opportunistically). */
export async function purgeExpiredChallenges(): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  await admin.from("webauthn_challenges").delete().lt("expires_at", new Date().toISOString());
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

/** All passkeys for a given auth user (used to exclude/allow in ceremonies). */
export async function getCredentialsForUser(userId: string): Promise<StoredCredential[]> {
  if (!isSupabaseServiceConfigured || !userId) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("webauthn_credentials")
    .select("*")
    .eq("user_id", userId);
  return (data ?? []).map(rowToCredential);
}

/** Passkeys by the WebAuthn user handle (authentication candidate resolution). */
export async function getCredentialsByWebauthnUserId(webauthnUserId: string): Promise<StoredCredential[]> {
  if (!isSupabaseServiceConfigured || !webauthnUserId) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("webauthn_credentials")
    .select("*")
    .eq("webauthn_user_id", webauthnUserId);
  return (data ?? []).map(rowToCredential);
}

/** A single credential by its Base64URL id. */
export async function getCredentialById(id: string): Promise<StoredCredential | null> {
  if (!isSupabaseServiceConfigured || !id) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("webauthn_credentials").select("*").eq("id", id).maybeSingle();
  return data ? rowToCredential(data) : null;
}

/** Lightweight list for the Settings UI (no key material). */
export async function listCredentialsForUser(userId: string): Promise<CredentialListItem[]> {
  const creds = await getCredentialsForUser(userId);
  return creds
    .map((c) => ({
      id: c.id,
      label: c.label,
      deviceType: c.deviceType,
      backedUp: c.backedUp,
      lastUsedAt: c.lastUsedAt,
      createdAt: c.createdAt,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Insert a verified credential (service-role only). */
export async function insertCredential(input: {
  id: string;
  userId: string;
  webauthnUserId: string;
  publicKey: Uint8Array;
  counter: number;
  deviceType: string | null;
  backedUp: boolean;
  transports: readonly string[] | null;
  label: string | null;
}): Promise<boolean> {
  if (!isSupabaseServiceConfigured) return false;
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("webauthn_credentials").insert({
    id: input.id,
    user_id: input.userId,
    webauthn_user_id: input.webauthnUserId,
    public_key: encodeByteaHex(input.publicKey),
    counter: input.counter,
    device_type: input.deviceType,
    backed_up: input.backedUp,
    transports: encodeTransports(input.transports),
    label: input.label,
  });
  return !error;
}

/** Update the signature counter + last-used stamp after a successful auth. */
export async function updateCredentialCounter(id: string, counter: number): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  await admin
    .from("webauthn_credentials")
    .update({ counter, last_used_at: new Date().toISOString() })
    .eq("id", id);
}

/** Rename a passkey (owner-scoped by the caller before invoking). */
export async function renameCredential(userId: string, id: string, label: string): Promise<boolean> {
  if (!isSupabaseServiceConfigured) return false;
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("webauthn_credentials")
    .update({ label: label.slice(0, 120) })
    .eq("id", id)
    .eq("user_id", userId);
  return !error;
}

/** Delete a passkey (owner-scoped). */
export async function deleteCredential(userId: string, id: string): Promise<boolean> {
  if (!isSupabaseServiceConfigured) return false;
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("webauthn_credentials")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  return !error;
}

function rowToCredential(row: Record<string, unknown>): StoredCredential {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    webauthnUserId: row.webauthn_user_id as string,
    publicKey: decodeByteaHex(row.public_key),
    counter: Number(row.counter ?? 0),
    deviceType: (row.device_type as string | null) ?? null,
    backedUp: Boolean(row.backed_up),
    transports: decodeTransports(row.transports as string | null),
    label: (row.label as string | null) ?? null,
    lastUsedAt: (row.last_used_at as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}
