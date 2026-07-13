/**
 * src/lib/syndication/engine-store.ts  (Task X)
 *
 * Server-side store for the sync engine's two persistence needs (migration
 * 0119 — owner applies manually):
 *
 *   1. syndication_sync_settings — the owner's transmission parameters per
 *      channel. Stored as a raw jsonb blob; ALWAYS resolved through the pure
 *      sync-settings-core resolvers on read so garbage can never break a push
 *      (clamped defaults win).
 *
 *   2. syndication_sync_state — the id -> payload-hash map from the LAST
 *      SUCCESSFUL sync per channel. Powers delta plans (creates / updates /
 *      unchanged / deletes) and "skipped — no changes" idempotency.
 *
 * Best-effort like the other syndication stores: before the migration is
 * applied (or without a service role) reads return defaults/empty and writes
 * no-op with a console warning — pushes still work, they just send everything.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  resolveLeaflySettings,
  resolveWeedmapsSettings,
  type LeaflySyncSettings,
  type WeedmapsSyncSettings,
} from "./sync-settings-core";
import type { SyndicationChannel } from "./store";

const SETTINGS_TABLE = "syndication_sync_settings";
const STATE_TABLE = "syndication_sync_state";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Raw stored settings blob for a channel (null when unset/pre-migration). */
export async function getSyncSettingsRaw(
  channel: SyndicationChannel,
): Promise<Record<string, unknown> | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from(SETTINGS_TABLE)
    .select("settings")
    .eq("channel", channel)
    .maybeSingle();
  if (error || !data) return null;
  const settings = (data as { settings?: unknown }).settings;
  return settings && typeof settings === "object" ? (settings as Record<string, unknown>) : null;
}

/** Resolved (clamped, defaulted) Leafly sync settings. */
export async function getLeaflySyncSettings(): Promise<LeaflySyncSettings> {
  return resolveLeaflySettings(await getSyncSettingsRaw("leafly"));
}

/** Resolved (clamped, defaulted) Weedmaps sync settings. */
export async function getWeedmapsSyncSettings(): Promise<WeedmapsSyncSettings> {
  return resolveWeedmapsSettings(await getSyncSettingsRaw("weedmaps"));
}

export type SaveSyncSettingsResult = { ok: true } | { ok: false; error: string };

/**
 * Upsert a channel's settings blob. Callers pass an ALREADY-RESOLVED settings
 * object (the pure resolvers both clamp and fully populate it) so what's
 * stored is always complete and valid.
 */
export async function saveSyncSettings(
  channel: SyndicationChannel,
  settings: LeaflySyncSettings | WeedmapsSyncSettings,
  updatedBy?: string | null,
): Promise<SaveSyncSettingsResult> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase is not configured on the server." };
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from(SETTINGS_TABLE)
    .upsert(
      { channel, settings, updated_by: updatedBy ?? null },
      { onConflict: "channel" },
    );
  if (error) {
    // Pre-migration (42P01 = relation does not exist) or transient failure.
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * One-shot force-resend: after a successful FORCED sync the flag auto-clears
 * so idempotency is never silently disabled forever. Best-effort.
 */
export async function clearForceResendFlag(channel: SyndicationChannel): Promise<void> {
  const raw = await getSyncSettingsRaw(channel);
  if (!raw || raw["forceResend"] !== true) return;
  const resolved =
    channel === "leafly" ? resolveLeaflySettings(raw) : resolveWeedmapsSettings(raw);
  await saveSyncSettings(channel, { ...resolved, forceResend: false });
}

// ---------------------------------------------------------------------------
// Sync state (id -> payload hash from the last successful sync)
// ---------------------------------------------------------------------------

export type SyncStateRow = {
  /** id -> 8-hex payload hash from the last successful sync (empty = never synced). */
  hashes: Map<string, string>;
  lastVersionId: string | null;
  lastSyncedAt: string | null;
};

const EMPTY_STATE: SyncStateRow = { hashes: new Map(), lastVersionId: null, lastSyncedAt: null };

/** Read a channel's last-successful-sync state (empty pre-migration / first sync). */
export async function getSyncState(channel: SyndicationChannel): Promise<SyncStateRow> {
  if (!isSupabaseServiceConfigured) return { ...EMPTY_STATE, hashes: new Map() };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from(STATE_TABLE)
    .select("item_hashes, last_version_id, last_synced_at")
    .eq("channel", channel)
    .maybeSingle();
  if (error || !data) return { ...EMPTY_STATE, hashes: new Map() };
  const row = data as {
    item_hashes?: unknown;
    last_version_id?: string | null;
    last_synced_at?: string | null;
  };
  const hashes = new Map<string, string>();
  if (row.item_hashes && typeof row.item_hashes === "object" && !Array.isArray(row.item_hashes)) {
    for (const [id, hash] of Object.entries(row.item_hashes as Record<string, unknown>)) {
      if (typeof hash === "string" && hash.length > 0) hashes.set(id, hash);
    }
  }
  return {
    hashes,
    lastVersionId: row.last_version_id ?? null,
    lastSyncedAt: row.last_synced_at ?? null,
  };
}

/**
 * Persist the id -> hash map after a successful (or partially successful)
 * sync. Best-effort: a failed write only means the next sync resends items it
 * didn't need to — never data loss.
 */
export async function saveSyncState(
  channel: SyndicationChannel,
  hashes: Map<string, string>,
  versionId: string | null,
): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  const item_hashes: Record<string, string> = {};
  for (const [id, hash] of hashes) item_hashes[id] = hash;
  const { error } = await admin
    .from(STATE_TABLE)
    .upsert(
      {
        channel,
        item_hashes,
        last_version_id: versionId,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "channel" },
    );
  if (error) {
    console.error(`[syndication] saveSyncState(${channel}) error:`, error.message);
  }
}

/** Forget a channel's sync state so the next push resends everything (recovery tool). */
export async function resetSyncState(channel: SyndicationChannel): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from(STATE_TABLE)
    .upsert(
      { channel, item_hashes: {}, last_version_id: null, last_synced_at: null },
      { onConflict: "channel" },
    );
  if (error) {
    console.error(`[syndication] resetSyncState(${channel}) error:`, error.message);
  }
}
