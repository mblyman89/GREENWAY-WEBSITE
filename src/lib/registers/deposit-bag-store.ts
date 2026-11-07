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
import { readDropDestination, type DropRowLike } from "@/lib/registers/atm-drop-core";
import { countedCashMinor } from "@/lib/registers/count-integrity-core";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { type DenomCounts } from "@/lib/registers/cash";
import { type BagStatus } from "@/lib/accounting/safe-bag-core";
import { expectedDeposit, type BagRow, type ExpectedDeposit } from "@/lib/registers/deposit-bag-flow-core";
import { type BagAtmPull, type PullPatternBag } from "@/lib/registers/deposit-bag-atm-pull-core";

const BAG_COLUMNS =
  "id, bag_no, business_day, status, amount_minor, night_count_minor, night_counted_by, night_counted_at, expected_minor, night_note, " +
  "morning_count_minor, morning_counted_by, morning_counted_at, variance_reason, sealed_at, sealed_by, seal_journal_id, banked_on, banked_by, bank_note, deposit_confirmed_on";

/** Lists also read night_denoms, only to tell an assembled night bag (D82) from a counted one. */
const LIST_COLUMNS = `${BAG_COLUMNS}, night_denoms`;

/**
 * D198e (0347): the ATM pull on the bag. Read WITH the bag; when 0347 is not applied yet the read is
 * retried without them (withPullColumns), so the page never breaks before the owner runs it.
 */
const PULL_COLUMNS =
  "atm_pull_twenties, atm_pull_minor, atm_pulled_by, atm_pull_witnessed_by, atm_pulled_at, atm_pull_terminal_id, " +
  "atm_pull_flags, atm_pull_reason, atm_pull_balance_seen_cents, atm_pull_balance_seen_at";

/** "The 0347 pull columns are not there yet". */
export function isMissingPullSchema(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return (err.code === "42703" || err.code === "PGRST204" || /column/i.test(err.message ?? "")) && /atm_pull/i.test(err.message ?? "");
}

/** Run a bag read with the pull columns, and once more without them if 0347 is not applied. */
async function withPullColumns<T extends { error: { code?: string; message?: string } | null }>(
  run: (extra: string) => PromiseLike<T>,
): Promise<T> {
  const first = await run(`, ${PULL_COLUMNS}`);
  if (first.error && isMissingPullSchema(first.error)) return run("");
  return first;
}

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
  night_denoms?: unknown;
  atm_pull_twenties?: number | null;
  atm_pull_minor?: number | null;
  atm_pulled_by?: string | null;
  atm_pull_witnessed_by?: string | null;
  atm_pulled_at?: string | null;
  atm_pull_terminal_id?: string | null;
  atm_pull_flags?: string[] | null;
  atm_pull_reason?: string | null;
  atm_pull_balance_seen_cents?: number | string | null;
  atm_pull_balance_seen_at?: string | null;
};

function numOrNull(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

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
    ...("night_denoms" in d ? { nightAssembled: d.night_count_minor !== null && (d.night_denoms === null || d.night_denoms === undefined) } : {}),
    ...("atm_pull_twenties" in d
      ? {
          atmPullTwenties: d.atm_pull_twenties ?? null,
          atmPullMinor: d.atm_pull_minor ?? null,
          atmPulledBy: d.atm_pulled_by ?? null,
          atmPullWitnessedBy: d.atm_pull_witnessed_by ?? null,
          atmPulledAt: d.atm_pulled_at ?? null,
          atmPullTerminalId: d.atm_pull_terminal_id ?? null,
          atmPullFlags: Array.isArray(d.atm_pull_flags) ? d.atm_pull_flags : [],
          atmPullReason: d.atm_pull_reason ?? null,
          atmPullBalanceSeenCents: numOrNull(d.atm_pull_balance_seen_cents),
          atmPullBalanceSeenAt: d.atm_pull_balance_seen_at ?? null,
        }
      : {}),
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
  const { data, error } = await withPullColumns((extra) => {
    let q = admin.from("deposit_bags").select(`${LIST_COLUMNS}${extra}`).or(`banked_on.is.null,business_day.gte.${opts.sinceDay}`);
    if (opts.untilDay) q = q.lte("business_day", opts.untilDay);
    return q.order("business_day", { ascending: false }).order("created_at", { ascending: false });
  });
  if (error) return { ok: false, missingSchema: isMissingBagSchema(error), error: error.message };
  return { ok: true, bags: ((data as unknown as DbBag[] | null) ?? []).map(toRow) };
}

/** Bags in a business-day range, for the printable log and the CSV. */
export async function listBagsInRange(fromDay: string, toDay: string): Promise<BagListResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, missingSchema: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await withPullColumns((extra) =>
    admin
      .from("deposit_bags")
      .select(`${LIST_COLUMNS}${extra}`)
      .gte("business_day", fromDay)
      .lte("business_day", toDay)
      .order("business_day", { ascending: true })
      .order("created_at", { ascending: true }),
  );
  if (error) return { ok: false, missingSchema: isMissingBagSchema(error), error: error.message };
  return { ok: true, bags: ((data as unknown as DbBag[] | null) ?? []).map(toRow) };
}

export async function getBag(id: string): Promise<{ ok: true; bag: BagRow | null } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await withPullColumns((extra) => admin.from("deposit_bags").select(`${BAG_COLUMNS}${extra}`).eq("id", id).maybeSingle());
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
  const { data, error } = await withPullColumns((extra) =>
    admin
      .from("deposit_bags")
      .select(`${BAG_COLUMNS}, night_denoms, morning_denoms${extra}`)
      .eq("business_day", day)
      .order("created_at", { ascending: true })
      .limit(1),
  );
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
    admin.from("drawer_sessions").select("*").eq("business_day", day).order("opened_at", { ascending: true }),
  ]);
  if (regs.error) return { ok: false, error: `Registers could not be read: ${regs.error.message}` };
  if (sess.error) return { ok: false, error: `Drawer sessions could not be read: ${sess.error.message}` };
  const names = new Map(((regs.data as { id: string; name: string }[] | null) ?? []).map((r) => [r.id, r.name]));
  const sessions =
    (sess.data as {
      id: string;
      register_id: string;
      status: string;
      opening_count_minor: number | null;
      closing_count_minor: number | null;
      reconciled_count_minor?: number | null;
      second_count_minor?: number | null;
    }[] | null) ?? [];
  let drops: { sessionId: string; amountMinor: number }[] = [];
  if (sessions.length > 0) {
    // D198: "*" so the 0346 destination columns ride along when applied (and the note tag otherwise).
    const d = await admin.from("drawer_drops").select("*").in("session_id", sessions.map((s) => s.id));
    if (d.error) return { ok: false, error: `Drops could not be read: ${d.error.message}` };
    // D198: ATM drops went into the ATM, never into the safe - the bag only carries SAFE drops.
    drops = ((d.data as (DropRowLike & { session_id: string })[] | null) ?? [])
      .filter((x) => readDropDestination(x).destination === "safe")
      .map((x) => ({ sessionId: x.session_id, amountMinor: x.amount_minor }));
  }
  const expected = expectedDeposit(
    sessions.map((s) => ({
      id: s.id,
      registerName: names.get(s.register_id) ?? "Register",
      status: s.status,
      openingMinor: s.opening_count_minor,
      // D180: the count the drawer was reconciled on (0343), the closer's for older rows.
      closingMinor: countedCashMinor(s),
      // D180: a closed drawer stays blind here until its second count is in.
      secondCountMinor: s.second_count_minor ?? null,
    })),
    drops,
  );
  return { ok: true, expected, sessionIds: sessions.map((s) => s.id) };
}

/**
 * Fix Phase 6 (G-66, owner D87): the drawers a bag carries (0212
 * deposit_bag_sessions) with their status, for the seal's reconcile warning.
 */
export async function bagDrawers(
  bagId: string,
): Promise<{ ok: true; drawers: { sessionId: string; registerName: string; status: string }[] } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const links = await admin.from("deposit_bag_sessions").select("session_id").eq("bag_id", bagId);
  if (links.error) return { ok: false, error: links.error.message };
  const ids = ((links.data as { session_id: string }[] | null) ?? []).map((l) => l.session_id);
  if (ids.length === 0) return { ok: true, drawers: [] };
  const [sess, regs] = await Promise.all([
    admin.from("drawer_sessions").select("id, register_id, status").in("id", ids),
    admin.from("registers").select("id, name"),
  ]);
  if (sess.error) return { ok: false, error: sess.error.message };
  const names = new Map(((regs.data as { id: string; name: string }[] | null) ?? []).map((r) => [r.id, r.name]));
  return {
    ok: true,
    drawers: ((sess.data as { id: string; register_id: string; status: string }[] | null) ?? []).map((r) => ({
      sessionId: r.id,
      registerName: names.get(r.register_id) ?? "Register",
      status: r.status,
    })),
  };
}

type WriteResult = { ok: true; id: string } | { ok: false; error: string };
export type NightWriteResult = { ok: true; id: string; linkError: string | null } | { ok: false; error: string };

/** Night count: a new bag record, status undeclared (D23: unsealed in the safe overnight). */
export async function insertNightCount(input: {
  bagNo: string;
  businessDay: string;
  countMinor: number;
  /**
   * null = ASSEMBLED and verified against the screen, no denomination count
   * (Fix Phase 6, G-65, owner D82). The morning blind recount is unchanged.
   */
  denoms: DenomCounts | null;
  closerId: string;
  expected: ExpectedDeposit;
  note: string | null;
  /**
   * D198e: $20s taken out of the deposit for the ATM, written in the SAME insert as the bag (never
   * half-saved). countMinor is then what is IN the bag (expected - pull). The builder is the puller.
   */
  pull?: BagAtmPull | null;
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
      ...(input.pull
        ? {
            atm_pull_twenties: input.pull.twenties,
            atm_pull_minor: input.pull.amountMinor,
            atm_pulled_by: input.closerId,
            atm_pull_witnessed_by: input.pull.witnessedBy,
            atm_pulled_at: new Date().toISOString(),
            atm_pull_terminal_id: input.pull.terminalId,
            atm_pull_flags: input.pull.flags,
            atm_pull_reason: input.pull.reason,
            atm_pull_balance_seen_cents: input.pull.balanceSeenCents,
            atm_pull_balance_seen_at: input.pull.balanceSeenAt,
          }
        : {}),
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: `Bag ${input.bagNo} is already recorded for ${input.businessDay}. Nothing was saved.` };
    if (input.pull && isMissingPullSchema(error)) {
      return {
        ok: false,
        error: "Taking $20s out of the deposit for the ATM needs database migration 0347, which is not applied yet. Nothing was saved. Ask the owner to run it, or record the bag without the ATM pull.",
      };
    }
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

/**
 * D198e: the ATM pulls from the deposit in a business-day range (the repeat-puller pattern on the
 * bag page). Pre-0347: an empty list with migrationMissing = true, never an error.
 */
export async function recentBagPulls(
  fromDay: string,
): Promise<{ ok: true; pulls: PullPatternBag[]; migrationMissing: boolean } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("deposit_bags")
    .select("business_day, atm_pulled_by, atm_pull_minor, atm_pull_witnessed_by")
    .gte("business_day", fromDay)
    .not("atm_pull_twenties", "is", null)
    .order("business_day", { ascending: false })
    .limit(400); // one bag a day: ~a year of pulls at most
  if (error) {
    if (isMissingPullSchema(error)) return { ok: true, pulls: [], migrationMissing: true };
    return { ok: false, error: error.message };
  }
  const rows = (data as { business_day: string; atm_pulled_by: string | null; atm_pull_minor: number | null; atm_pull_witnessed_by: string | null }[] | null) ?? [];
  return {
    ok: true,
    migrationMissing: false,
    pulls: rows.map((r) => ({ businessDay: r.business_day, atmPulledBy: r.atm_pulled_by, atmPullMinor: r.atm_pull_minor, atmPullWitnessedBy: r.atm_pull_witnessed_by })),
  };
}
