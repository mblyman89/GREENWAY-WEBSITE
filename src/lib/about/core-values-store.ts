/**
 * src/lib/about/core-values-store.ts
 *
 * SLICE T-310 — server-side service for the owner-managed About page
 * "Our Values" cards (table public.about_core_values, migration 0149).
 *
 * SINGLE-DOCUMENT model: the whole ordered list of cards lives in ONE row
 * (doc_key = 'about-core-values') with a published `values` array and a
 * `draft_values` array. Saving a draft never touches the live list; publishing
 * copies draft → published. This makes editing / reordering / adding / deleting
 * cards an ATOMIC draft → publish of the entire set.
 *
 * Public reads return the PUBLISHED values, draft-aware in Draft Mode, and fall
 * back to FALLBACK_CORE_VALUES (the four shipped cards, byte-identical) if the
 * table is empty / missing / Supabase isn't configured — so the About page
 * NEVER renders blank and stays identical to the old static cards until the
 * owner edits + publishes. This is what keeps the code WORKING PRE-MIGRATION
 * (a missing table throws inside the try and we return the fallback).
 */
import "server-only";
import { draftMode } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  type CoreValue,
  FALLBACK_CORE_VALUES,
  normalizeCoreValues,
  serializeCoreValues,
} from "./core-values-core";

const DOC_KEY = "about-core-values";
const SELECT = "*";

/** The admin view-model for the editor. */
export type CoreValuesDocVM = {
  id: string | null;
  status: "draft" | "published";
  /** Currently published cards. */
  published: CoreValue[];
  /** Cards the editor is staging (falls back to published when never saved). */
  draft: CoreValue[];
  /** Has the draft diverged from what's published? */
  dirty: boolean;
  /** True when there is no row yet (pre-migration or pre-seed). */
  isFallback: boolean;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** jsonb may come back as an array OR a JSON string depending on the driver. */
function coerceValues(value: unknown): CoreValue[] {
  if (value == null) return [];
  if (typeof value === "string") {
    try {
      return normalizeCoreValues(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return normalizeCoreValues(value);
}

type Row = {
  id: string;
  status: "draft" | "published";
  enabled: boolean;
  draft_enabled: boolean;
  values: unknown;
  draft_values: unknown;
};

// ---------------------------------------------------------------------------
// Admin read (editor)
// ---------------------------------------------------------------------------

/**
 * Load the single document for the editor. Pre-migration / pre-seed returns a
 * fallback VM seeded with the four shipped cards, so the editor is never blank.
 */
export async function getCoreValuesDoc(): Promise<CoreValuesDocVM> {
  const fallback: CoreValuesDocVM = {
    id: null,
    status: "published",
    published: normalizeCoreValues(FALLBACK_CORE_VALUES),
    draft: normalizeCoreValues(FALLBACK_CORE_VALUES),
    dirty: false,
    isFallback: true,
  };

  if (!isSupabaseServiceConfigured) return fallback;

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("about_core_values")
      .select(SELECT)
      .eq("doc_key", DOC_KEY)
      .maybeSingle();

    if (error || !data) return fallback;

    const row = data as Row;
    const published = coerceValues(row.values);
    const draftRaw = row.draft_values == null ? null : coerceValues(row.draft_values);
    const draft = draftRaw ?? published;
    const dirty =
      draftRaw != null &&
      serializeCoreValues(draftRaw) !== serializeCoreValues(published);

    return {
      id: row.id,
      status: row.status,
      published: published.length ? published : normalizeCoreValues(FALLBACK_CORE_VALUES),
      draft: draft.length ? draft : normalizeCoreValues(FALLBACK_CORE_VALUES),
      dirty,
      isFallback: false,
    };
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Public render resolution (draft-aware, with fallback)
// ---------------------------------------------------------------------------

/**
 * Resolve the core-value cards to show on the PUBLIC About page.
 * - Draft Mode (staff preview): show draft values.
 * - Normally: published values only.
 * - Empty / unconfigured / table-missing: fall back to FALLBACK_CORE_VALUES so
 *   the section never blanks and stays identical until publish.
 */
export async function getCoreValuesForRender(): Promise<CoreValue[]> {
  let preview = false;
  try {
    preview = (await draftMode()).isEnabled;
  } catch {
    preview = false;
  }

  if (!isSupabaseServiceConfigured) {
    return normalizeCoreValues(FALLBACK_CORE_VALUES);
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("about_core_values")
      .select(SELECT)
      .eq("doc_key", DOC_KEY)
      .maybeSingle();

    // A missing table (pre-migration) surfaces as an error — fall back safely.
    if (error || !data) return normalizeCoreValues(FALLBACK_CORE_VALUES);

    const row = data as Row;

    if (preview) {
      const draft = row.draft_values == null ? coerceValues(row.values) : coerceValues(row.draft_values);
      return draft.length ? draft : normalizeCoreValues(FALLBACK_CORE_VALUES);
    }

    if (row.status !== "published" || !row.enabled) {
      return normalizeCoreValues(FALLBACK_CORE_VALUES);
    }
    const published = coerceValues(row.values);
    return published.length ? published : normalizeCoreValues(FALLBACK_CORE_VALUES);
  } catch {
    return normalizeCoreValues(FALLBACK_CORE_VALUES);
  }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Ensure the single document row exists, seeded with the shipped cards. Returns
 * the row id, or null pre-migration / when Supabase isn't configured.
 */
async function ensureDocRow(
  editorId: string | null,
): Promise<string | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("about_core_values")
    .select("id")
    .eq("doc_key", DOC_KEY)
    .maybeSingle();
  if (error) return null; // table not migrated yet
  if (data) return (data as { id: string }).id;

  // Seed the row from the shipped cards. Draft == published so nothing shows as
  // "unpublished" on day one.
  const seeded = JSON.parse(serializeCoreValues(FALLBACK_CORE_VALUES));
  const { data: ins, error: insErr } = await admin
    .from("about_core_values")
    .insert({
      doc_key: DOC_KEY,
      status: "published",
      enabled: true,
      draft_enabled: true,
      values: seeded,
      draft_values: seeded,
      last_edited_by: editorId,
    })
    .select("id")
    .single();
  if (insErr) return null;
  return (ins as { id: string }).id;
}

/**
 * Save the DRAFT list (never touches the live/published list). Creates the row
 * first if needed. Input is normalized (empties dropped, capped, de-duped).
 */
export async function saveCoreValuesDraft(
  values: readonly CoreValue[],
  editorId: string | null,
): Promise<void> {
  const id = await ensureDocRow(editorId);
  if (!id) throw new Error("The core-values table isn't set up yet.");
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("about_core_values")
    .update({
      draft_values: JSON.parse(serializeCoreValues(values)),
      last_edited_by: editorId,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Publish: copy draft_values → values, set status=published. Creates + seeds
 * the row first if needed.
 */
export async function publishCoreValues(
  publisherId: string | null,
): Promise<void> {
  const id = await ensureDocRow(publisherId);
  if (!id) throw new Error("The core-values table isn't set up yet.");
  const admin = createSupabaseAdminClient();

  const { data } = await admin
    .from("about_core_values")
    .select("values, draft_values")
    .eq("id", id)
    .maybeSingle();

  const row = (data ?? {}) as { values?: unknown; draft_values?: unknown };
  const next =
    row.draft_values == null ? coerceValues(row.values) : coerceValues(row.draft_values);
  const serialized = JSON.parse(serializeCoreValues(next));

  const { error } = await admin
    .from("about_core_values")
    .update({
      status: "published",
      enabled: true,
      values: serialized,
      draft_values: serialized,
      last_published_by: publisherId,
      published_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
