/**
 * destruction-evidence-store.ts (Fix Phase 1.7a · G-43 req 7)
 *
 * Server reads and writes for destruction photo and video evidence
 * (migration 0312: private bucket `destruction-evidence`, append-only table
 * `destruction_evidence`). Rules live in destruction-evidence-core.ts.
 *
 * The file goes straight from the browser to the private bucket on a signed
 * upload URL (no Vercel body cap). A row is written ONLY after the stored
 * size, type and first bytes were checked; a refused file is removed. Files
 * are shown through short-lived signed links (the bucket is never public).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { chunkedIn } from "@/lib/supabase/chunked-in";
import { EVIDENCE_BUCKET, EVIDENCE_PENDING_MIGRATION, EVIDENCE_VIEW_SECONDS } from "@/lib/inventory/destruction-evidence-core";

export type DestructionEvidenceRow = {
  id: string;
  destruction_event_id: string;
  kind: "photo" | "video";
  storage_key: string;
  filename: string;
  mime: string;
  size_bytes: number;
  note: string | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
};

const COLS = "id, destruction_event_id, kind, storage_key, filename, mime, size_bytes, note, uploaded_by, uploaded_by_name, uploaded_at";

export function isMissingEvidenceSchema(message: string | null | undefined): boolean {
  return /does not exist|could not find|schema cache/i.test(message ?? "");
}

/** Evidence for many events, grouped by event id. pending = migration 0312 not applied. */
export async function listEvidenceForEvents(
  eventIds: string[],
): Promise<{ byEvent: Map<string, DestructionEvidenceRow[]>; pending: boolean; error: string | null }> {
  const byEvent = new Map<string, DestructionEvidenceRow[]>();
  if (!isSupabaseServiceConfigured || eventIds.length === 0) return { byEvent, pending: false, error: null };
  const admin = createSupabaseAdminClient();
  let firstError: string | null = null;
  const rows = await chunkedIn([...new Set(eventIds)], async (chunk, from, to) => {
    const { data, error } = await admin
      .from("destruction_evidence")
      .select(COLS)
      .in("destruction_event_id", chunk)
      .order("id", { ascending: true })
      .range(from, to);
    if (error && !firstError) firstError = error.message;
    return (data as DestructionEvidenceRow[] | null) ?? [];
  });
  const err = firstError as string | null;
  if (err) return { byEvent, pending: isMissingEvidenceSchema(err), error: err };
  rows.sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at));
  for (const r of rows) {
    const list = byEvent.get(r.destruction_event_id) ?? [];
    list.push(r);
    byEvent.set(r.destruction_event_id, list);
  }
  return { byEvent, pending: false, error: null };
}

/** Is migration 0312 applied? (A cheap head read; used before signing an upload.) */
export async function evidenceSchemaReady(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Storage isn't configured on this deployment." };
  const { error } = await createSupabaseAdminClient().from("destruction_evidence").select("id", { head: true, count: "exact" }).limit(1);
  if (!error) return { ok: true };
  return { ok: false, error: isMissingEvidenceSchema(error.message) ? EVIDENCE_PENDING_MIGRATION : error.message };
}

export async function insertEvidence(row: Omit<DestructionEvidenceRow, "id" | "uploaded_at">): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await createSupabaseAdminClient().from("destruction_evidence").insert(row).select("id").single();
  if (error || !data) {
    return { ok: false, error: isMissingEvidenceSchema(error?.message) ? EVIDENCE_PENDING_MIGRATION : `Couldn't save the evidence record: ${error?.message ?? "no row"}` };
  }
  return { ok: true, id: (data as { id: string }).id };
}

/** Short-lived viewing links (the bucket is private). Missing keys map to null. */
export async function signEvidenceUrls(keys: string[], download = false): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!isSupabaseServiceConfigured || keys.length === 0) return out;
  const bucket = createSupabaseAdminClient().storage.from(EVIDENCE_BUCKET);
  for (const key of keys) {
    const { data } = await bucket.createSignedUrl(key, EVIDENCE_VIEW_SECONDS, download ? { download: true } : undefined);
    if (data?.signedUrl) out.set(key, data.signedUrl);
  }
  return out;
}
