/**
 * src/lib/registers/atm-daily-fill-store.ts   (D198i - the ATM's daily fill amount)
 *
 * Two reads, both NEVER throw and both say when they could not read (a missing read is a question,
 * not zero - on a cash screen "nothing pending" must never be a silent failure):
 *
 *   1. atmLoadsSince(sinceIso, terminalId): the $20s already taken for the ATM since a time - the
 *      deposit bag pulls (deposit_bags.atm_pulled_at, migration 0347) and the till ATM drops
 *      (drawer_drops destination atm, or the pre-0346 note tag). The deposit bag banner subtracts
 *      them from the need so a stale PAI reading cannot invite a second top-off.
 *   2. dailyFillHistory(limit): who changed the daily fill amount and when, from the Security Log
 *      (audit action "atm.daily_fill_set"), newest first.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { readDropDestination, type DropRowLike } from "@/lib/registers/atm-drop-core";
import type { PendingLoad } from "@/lib/registers/atm-daily-fill-core";

/** The Security Log action every daily fill change is written under. */
export const DAILY_FILL_AUDIT_ACTION = "atm.daily_fill_set";

const MAX_ROWS = 500;

function isMissingColumn(e: { message?: string; code?: string } | null): boolean {
  if (!e) return false;
  return e.code === "42703" || e.code === "PGRST204" || /column .* does not exist|could not find the .* column/i.test(e.message ?? "");
}

export async function atmLoadsSince(
  sinceIso: string,
  terminalId: string,
): Promise<{ ok: true; items: PendingLoad[]; notes: string[] } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const notes: string[] = [];
  const items: PendingLoad[] = [];
  const empIds = new Set<string>();
  const raw: { atIso: string; amountMinor: number; kind: PendingLoad["kind"]; by: string | null }[] = [];

  // 1. Deposit bag pulls (0347). Before 0347 there are none to find.
  const bags = await admin
    .from("deposit_bags")
    .select("atm_pulled_at, atm_pull_minor, atm_pull_terminal_id, atm_pulled_by")
    .gt("atm_pulled_at", sinceIso)
    .not("atm_pull_twenties", "is", null)
    .order("atm_pulled_at", { ascending: true })
    .limit(MAX_ROWS);
  if (bags.error) {
    if (isMissingColumn(bags.error)) notes.push("Deposit bag $20 pulls are not set up yet (migration 0347).");
    else return { ok: false, error: `Deposit bag pulls could not be read: ${bags.error.message}` };
  } else {
    for (const r of (bags.data ?? []) as { atm_pulled_at: string; atm_pull_minor: number | null; atm_pull_terminal_id: string | null; atm_pulled_by: string | null }[]) {
      if (r.atm_pull_terminal_id && r.atm_pull_terminal_id !== terminalId) continue;
      const amt = Number(r.atm_pull_minor);
      if (!Number.isInteger(amt) || amt <= 0) continue;
      raw.push({ atIso: r.atm_pulled_at, amountMinor: amt, kind: "bag_pull", by: r.atm_pulled_by });
      if (r.atm_pulled_by) empIds.add(r.atm_pulled_by);
    }
  }

  // 2. Till ATM drops (select * so a pre-0346 database still answers; the note tag is read too).
  const drops = await admin.from("drawer_drops").select("*").gt("dropped_at", sinceIso).order("dropped_at", { ascending: true }).limit(MAX_ROWS);
  if (drops.error) return { ok: false, error: `Till drops could not be read: ${drops.error.message}` };
  const dropRows = (drops.data ?? []) as (DropRowLike & { dropped_at: string; dropped_by: string | null })[];
  if (dropRows.length >= MAX_ROWS) notes.push(`Only the first ${MAX_ROWS} till drops since the reading were checked.`);
  for (const r of dropRows) {
    const d = readDropDestination(r);
    if (d.destination !== "atm") continue;
    if (d.terminalId && d.terminalId !== terminalId) continue;
    const amt = Number(r.amount_minor);
    if (!Number.isInteger(amt) || amt <= 0) continue;
    raw.push({ atIso: r.dropped_at, amountMinor: amt, kind: "till_drop", by: r.dropped_by });
    if (r.dropped_by) empIds.add(r.dropped_by);
  }

  const names = new Map<string, string>();
  if (empIds.size) {
    const { data } = await admin.from("employees").select("id, full_name").in("id", [...empIds]);
    for (const e of (data ?? []) as { id: string; full_name: string }[]) names.set(e.id, e.full_name);
  }
  for (const r of raw) items.push({ atIso: r.atIso, amountMinor: r.amountMinor, kind: r.kind, who: r.by ? (names.get(r.by) ?? "Former employee") : null });
  items.sort((a, b) => Date.parse(a.atIso) - Date.parse(b.atIso));
  return { ok: true, items, notes };
}

export type DailyFillChange = {
  atIso: string;
  byEmail: string | null;
  beforeCents: number | null;
  afterCents: number | null;
  note: string | null;
};

export async function dailyFillHistory(limit = 25): Promise<{ ok: true; changes: DailyFillChange[] } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("audit_logs")
    .select("created_at, actor_email, before_json, after_json")
    .eq("action", DAILY_FILL_AUDIT_ACTION)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(100, Math.trunc(limit))));
  if (error) return { ok: false, error: error.message };
  const cents = (j: Record<string, unknown> | null): number | null => {
    const v = j?.fillToCents;
    return typeof v === "number" && Number.isInteger(v) ? v : null;
  };
  const rows = (data as { created_at: string; actor_email: string | null; before_json: Record<string, unknown> | null; after_json: Record<string, unknown> | null }[] | null) ?? [];
  return {
    ok: true,
    changes: rows.map((r) => ({
      atIso: r.created_at,
      byEmail: r.actor_email,
      beforeCents: cents(r.before_json),
      afterCents: cents(r.after_json),
      note: typeof r.after_json?.note === "string" ? (r.after_json.note as string) : null,
    })),
  };
}
