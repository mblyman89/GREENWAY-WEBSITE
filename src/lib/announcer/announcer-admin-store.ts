/**
 * src/lib/announcer/announcer-admin-store.ts
 *
 * SLICE 30 — the reads and writes behind the back-office Announcer panel.
 *
 * SERVER-ONLY. Thin I/O around the pure view logic in announcer-admin-core.ts.
 * Like the enqueue path, everything here is written so a broken database
 * degrades the PANEL rather than the PAGE: the Announcer sits on the Orders
 * screen, and a missing table must never stop Michael from working orders.
 * Every reader therefore returns a usable empty state instead of throwing.
 */
import "server-only";

// SLICE L-21 — per-request memoisation for getAnnouncerPanelDataCached(). This
// is React's `cache`, scoped to a single render pass: it is NOT a data cache
// and never serves a stale verdict across requests, which matters because the
// thing being cached is "will I hear the next order?".
import { cache } from "react";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

import { BUILT_IN_SOUNDS } from "./announcer-core";
import {
  pendingPairings as computePendingPairings,
  summarizeShop,
  toDeviceView,
  type AdminDeviceRow,
  type AdminDeviceView,
  type PendingPairingRow,
  type PendingPairingView,
  type ShopVerdict,
} from "./announcer-admin-core";
import { getAnnouncerSettings, type AnnouncerSettings } from "./announcer-store";

/**
 * SLICE L-21 — the SAME read, shared by the panel and the page.
 *
 * The orders page now needs the announcer's verdict even when the announcer
 * PANEL is not on screen: the panel moved to the "Setup & equipment" tab, and
 * "no speaker is online, so orders are arriving silently" is one of the two
 * alarms that is not allowed to move with it (see orders-tabs-core.ts).
 *
 * Two readers of the same fact is exactly how the L-19 email bug happened —
 * the checklist said "configured" while the notifier sent nothing, because
 * they asked different questions. So the page does not re-derive the verdict
 * from device rows; it reads THIS, the one answer, through React's per-request
 * `cache`. On the setup tab the page and the panel both call it and the
 * database is queried once, not twice.
 */
export const getAnnouncerPanelDataCached = cache(
  async (): Promise<AnnouncerPanelData> => getAnnouncerPanelData(),
);

export type AnnouncerPanelData = {
  devices: AdminDeviceView[];
  settings: AnnouncerSettings;
  verdict: ShopVerdict;
  /** Recent announcements, newest first, for the activity log. */
  recent: RecentAnnouncement[];
  /** True when the tables are missing entirely (migration not run yet). */
  notInstalled: boolean;
  /**
   * SLICE 34 — which sound each speaker is actually assigned, straight from the
   * row. AdminDeviceView deliberately drops sound_id (it shows a label, not an
   * id), but the sound library needs the raw value to answer "is this file in
   * use?" before someone deletes it. Without this the warning would always say
   * "safe to delete", which is worse than no warning at all.
   */
  assignments: { name: string; sound_id: string | null }[];
  /**
   * D-66 — pairing codes that are still live, newest first.
   *
   * Before this existed, `createPairing()` wrote a code to the database and the
   * action discarded it, so the code was real but unreadable: the owner pressed
   * the button and watched a spinner forever. The panel now reads them back.
   */
  pendingPairings: PendingPairingView[];
};

export type RecentAnnouncement = {
  id: string;
  deviceName: string;
  message: string;
  kind: string;
  createdAt: string;
  status: "played" | "waiting" | "missed";
};

const DEVICE_COLUMNS = "id, name, enabled, volume, sound_id, custom_sound_path, last_seen_at, agent_info";

/**
 * Everything the panel needs, in as few round trips as possible.
 *
 * Never throws. If the announcer tables do not exist yet, `notInstalled` is
 * true and the panel renders a "run the migration" card instead of an error.
 */
export async function getAnnouncerPanelData(now: Date = new Date()): Promise<AnnouncerPanelData> {
  const settings = await getAnnouncerSettings();
  const nowIso = now.toISOString();

  const empty = (notInstalled: boolean): AnnouncerPanelData => ({
    devices: [],
    settings,
    verdict: summarizeShop({
      devices: [],
      globalEnabled: settings.enabled,
      quietHoursEnabled: settings.quiet_hours_enabled,
      quietStart: settings.quiet_start,
      quietEnd: settings.quiet_end,
      now,
    }),
    recent: [],
    notInstalled,
    assignments: [],
    pendingPairings: [],
  });

  if (!isSupabaseServiceConfigured) return empty(false);

  try {
    const admin = createSupabaseAdminClient();

    const { data: deviceRows, error: deviceError } = await admin
      .from("announcer_devices")
      .select(DEVICE_COLUMNS)
      .order("name", { ascending: true });

    if (deviceError) {
      // 42P01 is "undefined_table" — the migration has not been run yet. That
      // is a setup state, not a fault, and it gets its own friendly card.
      const code = (deviceError as { code?: string }).code;
      return empty(code === "42P01");
    }

    const devices = (Array.isArray(deviceRows) ? deviceRows : []).map((row) =>
      toDeviceView({
        row: row as AdminDeviceRow,
        nowIso,
        builtIns: BUILT_IN_SOUNDS,
        defaultSoundId: settings.default_sound_id,
        defaultVolume: settings.default_volume,
      }),
    );

    const verdict = summarizeShop({
      devices,
      globalEnabled: settings.enabled,
      quietHoursEnabled: settings.quiet_hours_enabled,
      quietStart: settings.quiet_start,
      quietEnd: settings.quiet_end,
      now,
    });

    const assignments = (Array.isArray(deviceRows) ? deviceRows : []).map((row) => {
      const r = row as AdminDeviceRow;
      return { name: r.name, sound_id: r.sound_id ?? null };
    });

    return {
      devices,
      settings,
      verdict,
      recent: await getRecentAnnouncements(devices),
      notInstalled: false,
      assignments,
      pendingPairings: await getPendingPairings(admin, nowIso),
    };
  } catch {
    return empty(false);
  }
}

/**
 * D-66 — read back the codes that were being written and never shown.
 *
 * Degrades to an empty list like every other reader here: a broken pairings
 * table must not take the Orders page down with it.
 */
async function getPendingPairings(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  nowIso: string,
): Promise<PendingPairingView[]> {
  try {
    const { data, error } = await admin
      .from("announcer_pairings")
      .select("code, device_name, created_at, consumed_at")
      .is("consumed_at", null)
      .order("created_at", { ascending: false })
      .limit(10);

    if (error || !Array.isArray(data)) return [];
    // Expiry is decided by the pure function, not by the query, so the rule
    // lives in one place and is covered by tests that execute it.
    return computePendingPairings(data as PendingPairingRow[], nowIso);
  } catch {
    return [];
  }
}

/**
 * The activity log. Answers "did it actually play?" for the last few orders,
 * which is the question asked immediately after "why didn't I hear that?".
 */
async function getRecentAnnouncements(devices: readonly AdminDeviceView[]): Promise<RecentAnnouncement[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("announcer_queue")
      .select("id, device_id, message, kind, created_at, delivered_at, claimed_at")
      .order("created_at", { ascending: false })
      .limit(25);

    if (error || !Array.isArray(data)) return [];

    const nameById = new Map(devices.map((d) => [d.id, d.name]));

    return data.map((raw) => {
      const row = raw as {
        id: number | string;
        device_id: string;
        message: string;
        kind: string;
        created_at: string;
        delivered_at: string | null;
        claimed_at: string | null;
      };
      // "missed" is deliberately not inferred here from age alone — a row that
      // was never delivered but is still young is simply waiting.
      const status: RecentAnnouncement["status"] = row.delivered_at
        ? "played"
        : row.claimed_at
          ? "waiting"
          : "waiting";
      return {
        id: String(row.id),
        deviceName: nameById.get(row.device_id) ?? "Removed speaker",
        message: typeof row.message === "string" ? row.message : "",
        kind: typeof row.kind === "string" ? row.kind : "order",
        createdAt: typeof row.created_at === "string" ? row.created_at : "",
        status,
      };
    });
  } catch {
    return [];
  }
}

export type MutationResult = { ok: boolean; message: string };

/** Rename / re-tune a single speaker. */
export async function updateDevice(input: {
  id: string;
  name?: string;
  enabled?: boolean;
  volume?: number;
  soundId?: string | null;
  customSoundPath?: string | null;
}): Promise<MutationResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, message: "Database not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    if (input.volume !== undefined) patch.volume = input.volume;
    if (input.soundId !== undefined) patch.sound_id = input.soundId;
    if (input.customSoundPath !== undefined) patch.custom_sound_path = input.customSoundPath;
    if (Object.keys(patch).length === 0) return { ok: true, message: "Nothing to change." };

    const { error } = await admin.from("announcer_devices").update(patch).eq("id", input.id);
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: "Saved." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Unexpected error." };
  }
}

/** Unpair a speaker. The queue rows cascade with it. */
export async function removeDevice(id: string): Promise<MutationResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, message: "Database not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("announcer_devices").delete().eq("id", id);
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: "Speaker removed." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Unexpected error." };
  }
}

/** Shop-wide settings. Written as one upsert against the singleton row. */
export async function updateAnnouncerSettings(patch: Partial<AnnouncerSettings>): Promise<MutationResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, message: "Database not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("announcer_settings")
      .upsert({ id: 1, ...patch }, { onConflict: "id" });
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: "Settings saved." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Unexpected error." };
  }
}
