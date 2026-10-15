/**
 * R41 S10: the Timberland communications log (migration 0277, table
 * ach_timberland_comms).
 *
 * One row per message from (or event at) Timberland that starts a clock:
 * amendment, fee or reserve notices, a request for an authorization copy, an
 * over-limit request, a termination notice, a compromise phone call, a
 * reversal that is needed, a statement to review. A 'done' row closes one
 * item, once. Rows are never changed or deleted (the 0277 trigger refuses);
 * a mistake is fixed with a new entry.
 *
 * Who may write is decided twice: by achGate (the owner at once, an admin's
 * entry becomes a request for the owner: kinds timberland_comms.log and
 * timberland_comms.done) and by the 0277 trigger (ach_write_by_owner on
 * created_by).
 *
 * A read failure returns { ok: false } with plain words, never a fake empty
 * list: an empty clock panel must mean "nothing is due", not "the read
 * failed".
 */
import "server-only";
import { cache } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { commsDbErrorMessage, type CommsInsert, type CommsRow } from "@/lib/payments/timberland-obligations-core";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";

type Fail = { ok: false; error: string };

const NOT_CONFIGURED = "Database not connected. Nothing was saved.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The newest rows the page shows (and the clocks are computed from). */
export const COMMS_READ_CAP = 500;

const COLS = "id, entry_type, received_on, occurred_at, effective_on, amount_cents, summary, closes_id, created_at";

function dbErr(e: { code?: string; message?: string } | null | undefined): string {
  return commsDbErrorMessage(`${e?.code ?? ""} ${e?.message ?? ""}`.trim());
}

/** The log, newest first, capped. */
export async function readTimberlandComms(): Promise<{ ok: true; rows: CommsRow[]; capped: boolean } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected, so the Timberland log cannot be read." };
  const { data, error } = await createSupabaseAdminClient()
    .from("ach_timberland_comms")
    .select(COLS)
    .order("received_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(COMMS_READ_CAP);
  if (error) return { ok: false, error: dbErr(error) };
  const rows = (data ?? []) as CommsRow[];
  return { ok: true, rows, capped: rows.length >= COMMS_READ_CAP };
}

/** One entry (checked by checkCommsForm first). */
export async function addTimberlandComms(input: { row: CommsInsert; actorId: string }): Promise<{ ok: true; id: string } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: NOT_CONFIGURED };
  const r = input.row;
  const { data, error } = await createSupabaseAdminClient()
    .from("ach_timberland_comms")
    .insert({
      entry_type: r.entryType,
      received_on: r.receivedOn,
      occurred_at: r.occurredAtUtc,
      effective_on: r.effectiveOn,
      amount_cents: r.amountCents,
      summary: r.summary,
      created_by: input.actorId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: dbErr(error) };
  const id = (data as { id?: string } | null)?.id;
  if (!id) return { ok: false, error: "The database did not confirm the entry. Reload the page and check the log before adding it again." };
  return { ok: true, id };
}

/** Close one item with a 'done' row (checked by checkCloseForm first). */
export async function closeTimberlandComms(input: { closesId: string; summary: string; receivedOn: string; actorId: string }): Promise<{ ok: true; id: string; closedType: string } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: NOT_CONFIGURED };
  if (!UUID.test(input.closesId)) return { ok: false, error: "That item could not be found. Reload the page." };
  const admin = createSupabaseAdminClient();
  const target = await admin.from("ach_timberland_comms").select("id, entry_type").eq("id", input.closesId).maybeSingle();
  if (target.error) return { ok: false, error: dbErr(target.error) };
  if (!target.data) return { ok: false, error: "That item could not be found. Reload the page." };
  const { data, error } = await admin
    .from("ach_timberland_comms")
    .insert({ entry_type: "done", received_on: input.receivedOn, closes_id: input.closesId, summary: input.summary, created_by: input.actorId })
    .select("id")
    .single();
  if (error) return { ok: false, error: dbErr(error) };
  const id = (data as { id?: string } | null)?.id;
  if (!id) return { ok: false, error: "The database did not confirm it. Reload the page and check the log." };
  return { ok: true, id, closedType: String((target.data as { entry_type?: string }).entry_type ?? "") };
}

/** One read per request, shared by the banking layout (STOP card, termination banner) and the pages. */
export const readTimberlandCommsCached = cache(readTimberlandComms);

/**
 * Returns and NOCs logged with a received date in this Pacific month (open or
 * resolved), for the Schedule B fees card. Read in pages ordered by the unique
 * id (pagedAllChecked), because PostgREST silently caps one response at 1,000
 * rows (SLICE 5C). A failed page or an unfinished read returns null: the card
 * then says it could not count, never a short total.
 */
export async function countNoticesThisMonth(todayIso: string): Promise<{ returns: number; nocs: number } | null> {
  if (!isSupabaseServiceConfigured || !/^\d{4}-\d{2}-\d{2}$/.test(todayIso)) return null;
  const first = `${todayIso.slice(0, 7)}-01`;
  const sb = createSupabaseAdminClient();
  const { rows, verdict } = await pagedAllChecked<{ notice_kind?: string }>(async (from, to) => {
    const { data, error } = await sb
      .from("ach_return_notices")
      .select("id, notice_kind")
      .gte("received_on", first)
      .lte("received_on", todayIso)
      .order("id", { ascending: true })
      .range(from, to);
    return { rows: (data ?? []) as { notice_kind?: string }[], ok: !error };
  });
  if (!verdict.complete) return null;
  return { returns: rows.filter((r) => r.notice_kind === "return").length, nocs: rows.filter((r) => r.notice_kind === "noc").length };
}
