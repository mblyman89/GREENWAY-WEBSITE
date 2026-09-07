/**
 * ANNOUNCER SOUND LIBRARY — server side (SLICE 31)
 *
 * Reads and writes the sound catalogue and the private `announcer-sounds`
 * bucket. Every function here follows the same rule as the rest of the
 * announcer: NEVER THROW. A broken sound library must degrade to "you only
 * have the built-in sounds", never to a crashed Orders page.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  buildStoragePath,
  isValidStoragePath,
  MAX_SOUND_BYTES,
  type AllowedSoundExtension,
} from "./announcer-sounds-core";

const BUCKET = "announcer-sounds";

/** Postgres code for "relation does not exist" — i.e. migration 0222 was never run. */
const UNDEFINED_TABLE = "42P01";

export type SoundRow = {
  id: string;
  label: string;
  storage_path: string;
  mime_type: string | null;
  bytes: number | null;
  duration_ms: number | null;
  created_at: string;
};

export type SoundLibrary = {
  sounds: SoundRow[];
  /** True when migration 0222 has not been applied yet. */
  notInstalled: boolean;
  /** Non-null when something went wrong; already plain English. */
  error: string | null;
};

const EMPTY_LIBRARY: SoundLibrary = { sounds: [], notInstalled: false, error: null };

/**
 * Every custom sound, newest first.
 * Never throws. Never returns null.
 */
export async function listSounds(): Promise<SoundLibrary> {
  try {
    if (!isSupabaseServiceConfigured) return EMPTY_LIBRARY;
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("announcer_sounds")
      .select("id, label, storage_path, mime_type, bytes, duration_ms, created_at")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      if (error.code === UNDEFINED_TABLE) {
        return { sounds: [], notInstalled: true, error: null };
      }
      return {
        sounds: [],
        notInstalled: false,
        error: "The sound library could not be loaded. The built-in sounds still work.",
      };
    }
    return { sounds: (data ?? []) as SoundRow[], notInstalled: false, error: null };
  } catch {
    return {
      sounds: [],
      notInstalled: false,
      error: "The sound library could not be loaded. The built-in sounds still work.",
    };
  }
}

export type UploadResult =
  | { ok: true; id: string; storagePath: string; label: string }
  | { ok: false; error: string };

/**
 * Store an uploaded sound.
 *
 * The row is written only after the file lands in the bucket, so the
 * catalogue can never list a sound that does not exist — a listed-but-missing
 * sound would mean a speaker that silently falls back on every order.
 */
export async function createSound(input: {
  label: string;
  extension: AllowedSoundExtension;
  bytes: ArrayBuffer;
  contentType: string;
  uploadedBy: string | null;
}): Promise<UploadResult> {
  try {
    if (!isSupabaseServiceConfigured) {
      return { ok: false, error: "Storage is not configured on the server yet." };
    }
    if (input.bytes.byteLength > MAX_SOUND_BYTES) {
      return { ok: false, error: "That file is larger than the 5 MB limit." };
    }

    const supabase = createSupabaseAdminClient();
    const id = globalThis.crypto.randomUUID();
    const storagePath = buildStoragePath(id, input.extension);

    const upload = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, input.bytes, { contentType: input.contentType, upsert: false });

    if (upload.error) {
      return {
        ok: false,
        error:
          "The file could not be saved to storage. Check the 'announcer-sounds' bucket exists, then try again.",
      };
    }

    const { error } = await supabase.from("announcer_sounds").insert({
      id,
      label: input.label,
      storage_path: storagePath,
      mime_type: input.contentType,
      bytes: input.bytes.byteLength,
      uploaded_by: input.uploadedBy,
    });

    if (error) {
      // Roll the file back so we never leave an orphan in the bucket.
      await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => undefined);
      if (error.code === UNDEFINED_TABLE) {
        return {
          ok: false,
          error: "The announcer tables are not installed yet. Run migration 0222 first.",
        };
      }
      return { ok: false, error: "The sound was uploaded but could not be saved. Try again." };
    }

    return { ok: true, id, storagePath, label: input.label };
  } catch {
    return { ok: false, error: "The sound could not be uploaded. Try again." };
  }
}

export type DeleteResult = { ok: boolean; error?: string };

/**
 * Delete a sound and detach it from any device or setting still pointing at it.
 *
 * Detaching FIRST is the whole point: a device left pointing at a deleted
 * sound would fall back to the chime on every order, which looks like the
 * custom sound "randomly stopped working" rather than "was deleted".
 */
export async function deleteSound(id: string): Promise<DeleteResult> {
  try {
    if (!isSupabaseServiceConfigured) {
      return { ok: false, error: "Storage is not configured on the server yet." };
    }
    const supabase = createSupabaseAdminClient();

    const { data: row } = await supabase
      .from("announcer_sounds")
      .select("storage_path")
      .eq("id", id)
      .maybeSingle();

    // Point any device using this sound back at the default.
    await supabase
      .from("announcer_devices")
      .update({ sound_id: null, custom_sound_path: null })
      .eq("sound_id", id);

    await supabase
      .from("announcer_settings")
      .update({ default_sound_id: "chime" })
      .eq("default_sound_id", id);

    const { error } = await supabase.from("announcer_sounds").delete().eq("id", id);
    if (error) {
      return { ok: false, error: "That sound could not be deleted. Try again." };
    }

    const path = (row as { storage_path?: string } | null)?.storage_path;
    if (typeof path === "string" && isValidStoragePath(path)) {
      await supabase.storage.from(BUCKET).remove([path]);
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "That sound could not be deleted. Try again." };
  }
}

export async function renameSound(id: string, label: string): Promise<DeleteResult> {
  try {
    if (!isSupabaseServiceConfigured) {
      return { ok: false, error: "Storage is not configured on the server yet." };
    }
    const clean = label.trim().slice(0, 60);
    if (clean === "") return { ok: false, error: "Give the sound a name first." };
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("announcer_sounds").update({ label: clean }).eq("id", id);
    if (error) return { ok: false, error: "That sound could not be renamed. Try again." };
    return { ok: true };
  } catch {
    return { ok: false, error: "That sound could not be renamed. Try again." };
  }
}

/**
 * Fetch the bytes of a stored sound, for the Pi download route.
 * Returns null rather than throwing when anything at all goes wrong.
 */
export async function downloadSound(
  storagePath: string,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  try {
    if (!isValidStoragePath(storagePath)) return null;
    if (!isSupabaseServiceConfigured) return null;
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
    if (error || !data) return null;
    const bytes = await data.arrayBuffer();
    if (bytes.byteLength === 0) return null;
    return { bytes, contentType: data.type || "application/octet-stream" };
  } catch {
    return null;
  }
}
