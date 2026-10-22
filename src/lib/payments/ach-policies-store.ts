/**
 * R41 S18: read and write the owner's ACH control records (migration 0291,
 * table ach_control_records): policy adoptions, quarterly access reviews and
 * yearly key checks.
 *
 * Writes: owner only (the action checks ach.act; the 0291 trigger checks the
 * owner again with ach_write_by_owner, refuses backdating and never lets a
 * row change). The fingerprint stored with each record is computed HERE,
 * from the text on the server, never taken from the browser.
 *
 * Reads: paged by unique id (pagedAllChecked). An unfinished read returns
 * { ok: false } so the page never shows "not done" for something that was.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import {
  KEY_ITEMS,
  buildAccessReport,
  controlDbErrorMessage,
  keyItemFingerprint,
  policyTextFingerprint,
  type ControlInsert,
  type ControlRow,
  type StaffLite,
} from "@/lib/payments/ach-policies-core";

type Fail = { ok: false; error: string };

const COLS = "id, kind, period_key, recorded_on, text_sha256, summary, item, item_set_on, created_by, created_at";

export async function readControlRecords(): Promise<{ ok: true; rows: ControlRow[] } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected, so the records cannot be read." };
  const sb = createSupabaseAdminClient();
  const { rows, verdict } = await pagedAllChecked<ControlRow>(async (from, to) => {
    const { data, error } = await sb.from("ach_control_records").select(COLS).order("id", { ascending: true }).range(from, to);
    return { rows: (data ?? []) as unknown as ControlRow[], ok: !error };
  });
  if (!verdict.complete) return { ok: false, error: "The policy records could not be read in full (has migration 0291 been applied?)." };
  return { ok: true, rows: [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at)) };
}

export async function readStaffLite(): Promise<{ ok: true; rows: StaffLite[] } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  const sb = createSupabaseAdminClient();
  const { rows, verdict } = await pagedAllChecked<StaffLite>(async (from, to) => {
    const { data, error } = await sb.from("staff_profiles").select("id, email, full_name, role, active, last_login_at").order("id", { ascending: true }).range(from, to);
    return { rows: (data ?? []) as unknown as StaffLite[], ok: !error };
  });
  if (!verdict.complete) return { ok: false, error: "The staff list could not be read in full." };
  return { ok: true, rows };
}

/** The fingerprint stored with a record: what the owner actually looked at. */
export function fingerprintFor(row: ControlInsert, staff: readonly StaffLite[], todayIso: string): string {
  if (row.kind === "policy_adoption") return policyTextFingerprint();
  if (row.kind === "access_review") return buildAccessReport(staff, todayIso).fingerprint;
  const item = KEY_ITEMS.find((k) => k.id === row.item);
  return item ? keyItemFingerprint(item) : policyTextFingerprint();
}

export async function recordControl(input: { row: ControlInsert; textSha256: string; actorId: string; todayIso: string }): Promise<{ ok: true; id: string } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected. Nothing was saved." };
  const r = input.row;
  const { data, error } = await createSupabaseAdminClient()
    .from("ach_control_records")
    .insert({
      kind: r.kind,
      period_key: r.periodKey,
      recorded_on: input.todayIso,
      text_sha256: input.textSha256,
      summary: r.summary,
      item: r.item,
      item_set_on: r.itemSetOn,
      created_by: input.actorId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: controlDbErrorMessage(`${error.code ?? ""} ${error.message ?? ""}`) };
  const id = (data as { id?: string } | null)?.id;
  if (!id) return { ok: false, error: "The database did not confirm the record. Reload the page and check before recording it again." };
  return { ok: true, id };
}
