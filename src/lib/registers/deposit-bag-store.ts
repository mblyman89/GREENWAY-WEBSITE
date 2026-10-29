/**
 * src/lib/registers/deposit-bag-store.ts  (Fix Phase 2.6 · G-04)
 *
 * Reads and writes for the deposit bag screen. Every write is made here, by
 * the server (service role), after the server action has checked the
 * permission, the PIN and the rule in deposit-bag-flow-core.ts, and before it
 * records the audit row. Migration 0316 removed the staff write policy
 * (F-03-9), so there is no other way in.
 *
 * Rule 46: a failed read is returned as an error, never as "no bags".
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { type DenomCounts } from "@/lib/registers/cash";
import { type BagStatus } from "@/lib/accounting/safe-bag-core";
import { expectedDeposit, type BagRow, type ExpectedDeposit } from "@/lib/registers/deposit-bag-flow-core";

const BAG_COLUMNS =
  "id, bag_no, business_day, status, amount_minor, night_count_minor, night_counted_by, night_counted_at, expected_minor, night_note, " +
  "morning_count_minor, morning_counted_by, morning_counted_at, variance_reason, sealed_at, sealed_by, seal_journal_id, banked_on, banked_by, bank_note, deposit_confirmed_on";

type DbBag = {
  id: string;
  bag_no: string;
  business_day: string;
  status: BagStatus;
  amount_minor: number | null;
  night_count_minor: number | null;
  night_counted_by: string | null;
  night_counted_at: string | null;
  expected_minor: number | null;
  night_note: string | null;
  morning_count_minor: number | null;
  morning_counted_by: string | null;
  morning_counted_at: string | null;
  variance_reason: string | null;
  sealed_at: string | null;
  sealed_by: string | null;
  seal_journal_id: string | null;
  banked_on: string | null;
  banked_by: string | null;
  bank_note: string | null;
  deposit_confirmed_on: string | null;
};

function toRow(d: DbBag): BagRow {
  return {
    id: d.id,
    bagNo: d.bag_no,
    businessDay: d.business_day,
    status: d.status,
    amountMinor: d.amount_minor,
    nightCountMinor: d.night_count_minor,
    nightCountedBy: d.night_counted_by,
    nightCountedAt: d.night_counted_at,
    expectedMinor: d.expected_minor,
    nightNote: d.night_note,
    morningCountMinor: d.morning_count_minor,
    morningCountedBy: d.morning_counted_by,
    morningCountedAt: d.morning_counted_at,
    varianceReason: d.variance_reason,
    sealedAt: d.sealed_at,
    sealedBy: d.sealed_by,
    sealJournalId: d.seal_journal_id,
    bankedOn: d.banked_on,
    bankedBy: d.banked_by,
    bankNote: d.bank_note,
    depositConfirmedOn: d.deposit_confirmed_on,
  };
}

/** "The 0316 columns are not there yet" (the owner has not applied the migration). */
export function isMissingBagSchema(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "42703" || err.code === "42P01" || err.code === "PGRST204") return true;
  return /column .* does not exist|Could not find the .* column|relation .* does not exist|Could not find the table/i.test(err.message ?? "");
}

export type BagListResult =
  | { ok: true; bags: BagRow[] }
  | { ok: false; missingSchema: boolean; error: string };

/**
 * Every bag that is not yet taken to the bank, plus the bags of the last
 * `days` business days (for the log). Newest business day first.
 */
export async function listBags(opts: { sinceDay: string; untilDay?: string }): Promise<BagListResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, missingSchema: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  let q = admin.from("deposit_bags").select(BAG_COLUMNS).or(`banked_on.is.null,business_day.gte.${opts.sinceDay}`);
  if (opts.untilDay) q = q.lte("business_day", opts.untilDay);
  const { data, error } = await q.order("business_day", { ascending: false }).order("created_at", { ascending: false });
  if (error) return { ok: false, missingSchema: isMissingBagSchema(error), error: error.message };
  return { ok: true, bags: ((data as unknown as DbBag[] | null) ?? []).map(toRow) };
}

/** Bags in a business-day range, for the printable log and the CSV. */
export async function listBagsInRange(fromDay: string, toDay: string): Promise<BagListResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, missingSchema: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("deposit_bags")
    .select(BAG_COLUMNS)
    .gte("business_day", fromDay)
    .lte("business_day", toDay)
    .order("business_day", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return { ok: false, missingSchema: isMissingBagSchema(error), error: error.message };
  return { ok: true, bags: ((data as unknown as DbBag[] | null) ?? []).map(toRow) };
}

export async function getBag(id: string): Promise<{ ok: true; bag: BagRow | null } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("deposit_bags").select(BAG_COLUMNS).eq("id", id).maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, bag: data ? toRow(data as unknown as DbBag) : null };
}

/** The bag already recorded for a business day, if any (one day, one bag). */
export async function bagForDay(day: string): Promise<{ ok: true; bagNo: string | null } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("deposit_bags").select("bag_no").eq("business_day", day).limit(1);
  if (error) return { ok: false, error: error.message };
  const rows = (data as { bag_no: string }[] | null) ?? [];
  return { ok: true, bagNo: rows[0]?.bag_no ?? null };
}

/**
 * Fix Phase 2.6b (G-15): the day's bag with both denomination grids, for the
 * end-of-day sheet. Errors are returned, never shown as "no bag".
 */
export async function bagDetailForDay(
  day: string,
): Promise<
  | { ok: true; bag: (BagRow & { nightDenoms: unknown; morningDenoms: unknown }) | null }
  | { ok: false; missingSchema: boolean; error: string }
> {
  if (!isSupabaseServiceConfigured) return { ok: false, missingSchema: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("deposit_bags")
    .select(`${BAG_COLUMNS}, night_denoms, morning_denoms`)
    .eq("business_day", day)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) return { ok: false, missingSchema: isMissingBagSchema(error), error: error.message };
  const row = ((data as unknown as (DbBag & { night_denoms: unknown; morning_denoms: unknown })[] | null) ?? [])[0];
  if (!row) return { ok: true, bag: null };
  return { ok: true, bag: { ...toRow(row), nightDenoms: row.night_denoms, morningDenoms: row.morning_denoms } };
}

export type DayDrawers =
  | { ok: true; expected: ExpectedDeposit; sessionIds: string[] }
  | { ok: false; error: string };

/**
 * The day's drawers and drops, and the deposit they say should be in the bag
 * (deposit-bag-flow-core#expectedDeposit). Errors are returned, not hidden.
 */
export async function drawersForDay(day: string): Promise<DayDrawers> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const [regs, sess] = await Promise.all([
    admin.from("registers").select("id, name"),
    admin.from("drawer_sessions").select("id, register_id, status, opening_count_minor, closing_count_minor, opened_at").eq("business_day", day).order("opened_at", { ascending: true }),
  ]);
  if (regs.error) return { ok: false, error: `Registers could not be read: ${regs.error.message}` };
  if (sess.error) return { ok: false, error: `Drawer sessions could not be read: ${sess.error.message}` };
  const names = new Map(((regs.data as { id: string; name: string }[] | null) ?? []).map((r) => [r.id, r.name]));
  const sessions = (sess.data as { id: string; register_id: string; status: string; opening_count_minor: number | null; closing_count_minor: number | null }[] | null) ?? [];
  let drops: { sessionId: string; amountMinor: number }[] = [];
  if (sessions.length > 0) {
    const d = await admin.from("drawer_drops").select("session_id, amount_minor").in("session_id", sessions.map((s) => s.id));
    if (d.error) return { ok: false, error: `Drops could not be read: ${d.error.message}` };
    drops = ((d.data as { session_id: string; amount_minor: number }[] | null) ?? []).map((x) => ({ sessionId: x.session_id, amountMinor: x.amount_minor }));
  }
  const expected = expectedDeposit(
    sessions.map((s) => ({
      id: s.id,
      registerName: names.get(s.register_id) ?? "Register",
      status: s.status,
      openingMinor: s.opening_count_minor,
      closingMinor: s.closing_count_minor,
    })),
    drops,
  );
  return { ok: true, expected, sessionIds: sessions.map((s) => s.id) };
}

type WriteResult = { ok: true; id: string } | { ok: false; error: string };
export type NightWriteResult = { ok: true; id: string; linkError: string | null } | { ok: false; error: string };

/** Night count: a new bag record, status undeclared (D23: unsealed in the safe overnight). */
export async function insertNightCount(input: {
  bagNo: string;
  businessDay: string;
  countMinor: number;
  denoms: DenomCounts;
  closerId: string;
  expected: ExpectedDeposit;
  note: string | null;
}): Promise<NightWriteResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("deposit_bags")
    .insert({
      bag_no: input.bagNo,
      business_day: input.businessDay,
      status: "undeclared",
      pulled_by: input.closerId,
      night_count_minor: input.countMinor,
      night_counted_by: input.closerId,
      night_counted_at: new Date().toISOString(),
      night_denoms: input.denoms,
      expected_minor: input.expected.expectedMinor,
      night_note: input.note,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: `Bag ${input.bagNo} is already recorded for ${input.businessDay}. Nothing was saved.` };
    return { ok: false, error: `The bag could not be saved: ${error.message}` };
  }
  const id = (data as { id: string }).id;
  // Which drawers the bag carries (0212 deposit_bag_sessions, amount > 0 only).
  const links = input.expected.lines.filter((l) => l.toBagMinor > 0).map((l) => ({ bag_id: id, session_id: l.sessionId, amount_minor: l.toBagMinor }));
  if (links.length > 0) {
    const { error: linkErr } = await admin.from("deposit_bag_sessions").insert(links);
    // The bag itself is saved (the money is recorded); a failed link is shown
    // to the person, never hidden (rule 46).
    if (linkErr) return { ok: true, id, linkError: linkErr.message };
  }
  return { ok: true, id, linkError: null };
}

/** Morning recount by a different employee (D24). Refused by the database once sealed. */
export async function saveMorningRecount(input: {
  bagId: string;
  countMinor: number;
  denoms: DenomCounts;
  recounterId: string;
  reason: string | null;
  status: BagStatus;
}): Promise<WriteResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const declared = input.status === "counted";
  const { data, error } = await admin
    .from("deposit_bags")
    .update({
      morning_count_minor: input.countMinor,
      morning_counted_by: input.recounterId,
      morning_counted_at: new Date().toISOString(),
      morning_denoms: input.denoms,
      variance_reason: input.reason,
      status: input.status,
      counted_by: declared ? input.recounterId : null,
      amount_minor: declared ? input.countMinor : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.bagId)
    .is("sealed_at", null)
    .select("id");
  if (error) return { ok: false, error: `The recount could not be saved: ${error.message}` };
  if (((data as unknown[] | null) ?? []).length !== 1) return { ok: false, error: "The bag was sealed or changed by someone else. Reload the page. Nothing was saved." };
  return { ok: true, id: input.bagId };
}

/** Seal (anyone, D25). Conditional on not sealed yet, so two presses seal once. */
export async function saveSeal(input: { bagId: string; bagNo: string; amountMinor: number; sealerId: string }): Promise<WriteResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("deposit_bags")
    .update({
      bag_no: input.bagNo,
      status: "deposited",
      amount_minor: input.amountMinor,
      sealed_at: new Date().toISOString(),
      sealed_by: input.sealerId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.bagId)
    .eq("status", "counted")
    .is("sealed_at", null)
    .select("id");
  if (error) {
    if (error.code === "23505") return { ok: false, error: `Bag number ${input.bagNo} is already used on this business day. Nothing was saved.` };
    return { ok: false, error: `The seal could not be saved: ${error.message}` };
  }
  if (((data as unknown[] | null) ?? []).length !== 1) return { ok: false, error: "This bag was already sealed, or is not ready to seal. Reload the page. Nothing was written twice." };
  return { ok: true, id: input.bagId };
}

/** Fill the books entry id once (the 0316 trigger refuses changing it). */
export async function saveSealJournalId(bagId: string, journalId: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("deposit_bags").update({ seal_journal_id: journalId }).eq("id", bagId).is("seal_journal_id", null);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Owner-only bank record (D25). Each bag once. */
export async function saveBanked(input: { bagIds: string[]; bankedOn: string; ownerStaffId: string; note: string | null }): Promise<{ ok: true; saved: string[] } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("deposit_bags")
    .update({ banked_on: input.bankedOn, banked_by: input.ownerStaffId, bank_note: input.note })
    .in("id", input.bagIds)
    .not("sealed_at", "is", null)
    .is("banked_on", null)
    .select("id");
  if (error) return { ok: false, error: `The bank run could not be saved: ${error.message}` };
  return { ok: true, saved: ((data as { id: string }[] | null) ?? []).map((r) => r.id) };
}

/**
 * Bags counted at night but not yet recounted (status undeclared), for the
 * D27 warning. Business days before `beforeDay` only.
 */
export async function undeclaredBagsBefore(beforeDay: string): Promise<{ ok: true; bags: { bagNo: string; businessDay: string }[] } | { ok: false; error: string; missingSchema: boolean }> {
  if (!isSupabaseServiceConfigured) return { ok: true, bags: [] };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("deposit_bags")
    .select("bag_no, business_day")
    .eq("status", "undeclared")
    .lt("business_day", beforeDay)
    .order("business_day", { ascending: true });
  if (error) return { ok: false, error: error.message, missingSchema: isMissingBagSchema(error) };
  return { ok: true, bags: ((data as { bag_no: string; business_day: string }[] | null) ?? []).map((r) => ({ bagNo: r.bag_no, businessDay: r.business_day })) };
}

/** Back-office user names (banked_by is a staff_profiles id). Errors returned, not hidden. */
export async function staffNames(ids: readonly string[]): Promise<{ ok: true; names: Map<string, string> } | { ok: false; error: string }> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (uniq.length === 0 || !isSupabaseServiceConfigured) return { ok: true, names: new Map() };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("staff_profiles").select("id, full_name, email").in("id", uniq);
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    names: new Map(((data as { id: string; full_name: string | null; email: string }[] | null) ?? []).map((r) => [r.id, r.full_name || r.email])),
  };
}
