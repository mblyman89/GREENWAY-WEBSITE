/**
 * src/lib/merch/merch-alerts-server.ts  (D232 slice M-7, SOP-11 G-85)
 *
 * Server-only. The merch alerts inbox (0361 merch_alerts):
 *   - recordMerchAlert: one row per distinct alert (fingerprint = SHA-256 of
 *     subject + lines). A repeat bumps repeat_count / last_seen_at and
 *     re-opens an acknowledged alert, so a retried webhook never hides.
 *   - listMerchAlerts: open first (newest), then the last few acknowledged.
 *   - acknowledgeMerchAlert: who and when (never deleted).
 * Never throws; a missing table says which migration to run.
 */
import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { MERCH_ALERTS_TABLE, type CleanAlert, type MerchAlertRow } from "./merch-alerts-core";

const missing = (code: string | undefined) => code === "42P01" || code === "PGRST205";
const MISSING = "The merch alerts table is not installed: run supabase/migrations/0361_merch_alerts.sql.";

export function alertFingerprint(a: Pick<CleanAlert, "subject" | "lines">): string {
  return createHash("sha256").update(JSON.stringify([a.subject, a.lines])).digest("hex");
}

export async function recordMerchAlert(a: CleanAlert): Promise<{ ok: true; id: string; repeat: boolean } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  const admin = createSupabaseAdminClient();
  const fingerprint = alertFingerprint(a);
  try {
    const { data: found, error: readErr } = await admin.from(MERCH_ALERTS_TABLE).select("id, repeat_count").eq("fingerprint", fingerprint).maybeSingle();
    if (readErr) return { ok: false, error: missing(readErr.code) ? MISSING : readErr.message };
    const now = new Date().toISOString();
    if (found) {
      const row = found as { id: string; repeat_count: number };
      const { error } = await admin.from(MERCH_ALERTS_TABLE).update({ repeat_count: (row.repeat_count ?? 1) + 1, last_seen_at: now, acknowledged_at: null, acknowledged_by_email: null }).eq("id", row.id);
      return error ? { ok: false, error: error.message } : { ok: true, id: row.id, repeat: true };
    }
    const { data, error } = await admin.from(MERCH_ALERTS_TABLE).insert({ fingerprint, subject: a.subject, lines: a.lines, order_ref: a.orderRef, first_seen_at: now, last_seen_at: now }).select("id").single();
    if (error && error.code === "23505") return recordMerchAlert(a); // lost a race with the same alert: count it as a repeat
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: String((data as { id: string }).id), repeat: false };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "save failed" };
  }
}

export async function listMerchAlerts(opts: { orderRef?: string; limit?: number } = {}): Promise<{ open: MerchAlertRow[]; recent: MerchAlertRow[]; error: string | null }> {
  if (!isSupabaseServiceConfigured) return { open: [], recent: [], error: "Database is not configured." };
  const cols = "id, subject, lines, order_ref, repeat_count, first_seen_at, last_seen_at, acknowledged_at, acknowledged_by_email";
  try {
    const admin = createSupabaseAdminClient();
    let openQ = admin.from(MERCH_ALERTS_TABLE).select(cols).is("acknowledged_at", null).order("last_seen_at", { ascending: false }).limit(opts.limit ?? 50);
    let doneQ = admin.from(MERCH_ALERTS_TABLE).select(cols).not("acknowledged_at", "is", null).order("acknowledged_at", { ascending: false }).limit(10);
    if (opts.orderRef) {
      openQ = openQ.eq("order_ref", opts.orderRef);
      doneQ = doneQ.eq("order_ref", opts.orderRef);
    }
    const [o, d] = await Promise.all([openQ, doneQ]);
    const err = o.error ?? d.error;
    if (err) return { open: [], recent: [], error: missing(err.code) ? MISSING : err.message };
    return { open: (o.data ?? []) as MerchAlertRow[], recent: (d.data ?? []) as MerchAlertRow[], error: null };
  } catch (e) {
    return { open: [], recent: [], error: e instanceof Error ? e.message : "read failed" };
  }
}

export async function acknowledgeMerchAlert(id: string, byEmail: string): Promise<{ ok: true; subject: string } | { ok: false; error: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "Unknown alert." };
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  try {
    const { data, error } = await createSupabaseAdminClient()
      .from(MERCH_ALERTS_TABLE)
      .update({ acknowledged_at: new Date().toISOString(), acknowledged_by_email: byEmail.slice(0, 200) })
      .eq("id", id)
      .is("acknowledged_at", null)
      .select("subject")
      .maybeSingle();
    if (error) return { ok: false, error: missing(error.code) ? MISSING : error.message };
    if (!data) return { ok: false, error: "That alert was already acknowledged (or no longer exists)." };
    return { ok: true, subject: String((data as { subject: string }).subject) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "save failed" };
  }
}
