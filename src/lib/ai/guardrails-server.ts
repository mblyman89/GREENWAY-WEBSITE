/**
 * src/lib/ai/guardrails-server.ts — D244 R-23: read and save the owner's
 * Compliance guardrails settings (one site_settings row, no migration;
 * site_settings is KEEP on factory reset).
 *
 * `syncGuardrails()` loads the settings (cached for 60 s, cleared on save)
 * and makes them the active settings for every check in this server
 * process (guardrails-state-core). It is called by loadBannedPhrases()
 * (which every accept / publish gate already awaits) and by each server
 * path that checks text without the owner's phrase list. It never throws:
 * when the row is missing or the database is down, the built-in levels are
 * used, exactly as before R-23.
 */
import "server-only";
import { unstable_cache, revalidateTag } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  GUARDRAILS_SETTING_KEY,
  GUARDRAILS_SETTING_LABEL,
  emptyGuardrails,
  normalizeGuardrails,
  setActiveGuardrails,
  type GuardrailSettings,
} from "./guardrails-state-core";

export const GUARDRAILS_TAG = "compliance-guardrails";

async function readUncached(): Promise<GuardrailSettings> {
  if (!isSupabaseServiceConfigured) return emptyGuardrails();
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("site_settings").select("value_json").eq("key", GUARDRAILS_SETTING_KEY).maybeSingle();
    return normalizeGuardrails((data as { value_json?: unknown } | null)?.value_json ?? null);
  } catch {
    return emptyGuardrails();
  }
}

let readCached: (() => Promise<GuardrailSettings>) | null = null;
function cachedReader(): () => Promise<GuardrailSettings> {
  if (!readCached) {
    try {
      readCached = unstable_cache(readUncached, ["compliance-guardrails", "v1"], { revalidate: 60, tags: [GUARDRAILS_TAG] });
    } catch {
      readCached = readUncached;
    }
  }
  return readCached;
}

/** The owner's settings (cached). Never throws. */
export async function getGuardrails(): Promise<GuardrailSettings> {
  try {
    return await cachedReader()();
  } catch {
    return readUncached();
  }
}

/** For the Compliance guardrails page (always fresh). */
export async function getGuardrailsForEdit(): Promise<GuardrailSettings> {
  return readUncached();
}

/** Load the owner's settings and make them active for every check. Never throws. */
export async function syncGuardrails(): Promise<GuardrailSettings> {
  const s = await getGuardrails().catch(() => emptyGuardrails());
  setActiveGuardrails(s);
  return s;
}

export async function saveGuardrails(s: GuardrailSettings, updatedBy: string | null): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  const clean = normalizeGuardrails(s);
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("site_settings")
      .upsert(
        { key: GUARDRAILS_SETTING_KEY, label: GUARDRAILS_SETTING_LABEL, value_json: clean as unknown as Record<string, unknown>, updated_by: updatedBy },
        { onConflict: "key" },
      );
    if (error) return { ok: false, error: error.message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
  setActiveGuardrails(clean);
  try {
    revalidateTag(GUARDRAILS_TAG, "max");
  } catch {
    /* outside a request (tests) */
  }
  return { ok: true };
}
