/**
 * src/lib/atm/atm-drop-match-store.ts   (D198 S5 - ATM cash drops: the owner's match page)
 *
 * Owner (2026-11-07): "i definitely want the plaid atm bank account connection to be reconciled
 * against the atm drops from the tills ... there should be a new owner only page for me to see the
 * atm cash loads being matched to the till drops ... it is a lot of money and is easy to steal. so
 * matching is essential."
 *
 * Server-only READS for /admin/atm/drops, plus the one WRITE the owner makes there: an append-only
 * review row (atm_drop_reviews, migration 0346). It does no arithmetic and makes no judgement: every
 * decision lives in the pure atm-drop-match-core so it is unit tested. Reads never throw; a missing
 * table / migration comes back as a flag so the page says "run migration 0346" instead of crashing.
 *
 * Sources (all four legs of the money trail):
 *   1. drawer_drops   - the till side (destination atm, or the pre-0346 note tag), with register,
 *                       employee and witness names.
 *   2. atm_cash_loads - the machine side (PAI "Cash Load" report, synced daily by /api/cron/atm-sync).
 *   3. atm_settlements- what the machine dispensed (PAI settlement report).
 *   4. Plaid          - the ATM-role bank account's deposits (role "atm" on /admin/plaid), and when
 *                       that bank connection last synced.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { readDropDestination } from "@/lib/registers/atm-drop-core";
import { getAtmDropSettings } from "@/lib/registers/atm-drop-settings-store";
import { listAtmSettlements, getAtmReconcileInputs } from "@/lib/atm/store";
import { listPlaidAccounts, listPlaidItems } from "@/lib/plaid/store";
import type { BankDeposit } from "@/lib/atm/atm-reconcile-core";
import type { AtmDropSettings } from "@/lib/registers/atm-drop-core";
import {
  addDays,
  type MatchDrop,
  type MatchLoad,
  type MatchReview,
  type MatchSettlement,
  type ReviewDecision,
} from "@/lib/atm/atm-drop-match-core";

export type AtmDropMatchInputs = {
  configured: boolean;
  /** False when atm_drop_reviews is missing (migration 0346 not applied yet). */
  reviewsTableReady: boolean;
  fromDay: string;
  toDay: string;
  settings: AtmDropSettings;
  drops: MatchDrop[];
  loads: MatchLoad[];
  settlements: MatchSettlement[];
  deposits: BankDeposit[];
  reviews: MatchReview[];
  hasAtmAccount: boolean;
  atmAccountNames: string[];
  /** Oldest "last successful sync" among the Plaid items behind the ATM-role account(s). */
  plaidLastSyncedAt: string | null;
  /** Newest PAI cash load we hold (to show "PAI last reported"). */
  paiLatestLoadDay: string | null;
  errors: string[];
};

const MISSING = new Set(["42P01", "PGRST205", "42703", "PGRST204"]);

type DropDb = {
  id: string;
  session_id: string;
  amount_minor: number;
  dropped_by: string | null;
  witnessed_by: string | null;
  notes: string | null;
  dropped_at: string;
  destination?: string | null;
  twenties_count?: number | null;
  atm_terminal_id?: string | null;
  recorded_via?: string | null;
};

function pacificToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Clamp the requested window: yyyy-mm-dd, at most 366 days, default the last 45 days. */
export function resolveMatchWindow(from?: string | null, to?: string | null): { fromDay: string; toDay: string } {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const toDay = to && re.test(to) ? to : pacificToday();
  let fromDay = from && re.test(from) ? from : addDays(toDay, -45);
  if (fromDay > toDay) fromDay = addDays(toDay, -45);
  if (addDays(fromDay, 366) < toDay) fromDay = addDays(toDay, -366);
  return { fromDay, toDay };
}

export async function getAtmDropMatchInputs(window: { fromDay: string; toDay: string }): Promise<AtmDropMatchInputs> {
  const settings = await getAtmDropSettings();
  const base: AtmDropMatchInputs = {
    configured: isSupabaseServiceConfigured,
    reviewsTableReady: false,
    fromDay: window.fromDay,
    toDay: window.toDay,
    settings,
    drops: [],
    loads: [],
    settlements: [],
    deposits: [],
    reviews: [],
    hasAtmAccount: false,
    atmAccountNames: [],
    plaidLastSyncedAt: null,
    paiLatestLoadDay: null,
    errors: [],
  };
  if (!isSupabaseServiceConfigured) return base;
  const admin = createSupabaseAdminClient();
  // A drop late in the window may be loaded the next day; a load early in the window may belong to
  // a drop the evening before. Pad both reads by a day and let the engine sort it out.
  const fromIso = `${addDays(window.fromDay, -1)}T00:00:00-08:00`;
  const toIso = `${addDays(window.toDay, 2)}T00:00:00-08:00`;

  // 1. Till drops (select * so a pre-0346 database still answers; destination read via the tag).
  try {
    // Paged + checked (SLICE 5C): a short read must never look like "no drops" on a theft screen.
    const read = await pagedAllChecked<DropDb>(async (a, b) => {
      const { data, error } = await admin
        .from("drawer_drops")
        .select("*")
        .gte("dropped_at", fromIso)
        .lt("dropped_at", toIso)
        .order("id", { ascending: true })
        .range(a, b);
      if (error) base.errors.push(`Drops: ${error.message}`);
      return { rows: (data ?? []) as DropDb[], ok: !error };
    });
    if (!read.verdict.complete) base.errors.push(`Drops: ${read.verdict.message}`);
    const rows = read.rows
      .filter((r) => readDropDestination(r).destination === "atm")
      .sort((x, y) => (x.dropped_at < y.dropped_at ? -1 : x.dropped_at > y.dropped_at ? 1 : 0));
    const sessionIds = [...new Set(rows.map((r) => r.session_id))];
    const empIds = [...new Set(rows.flatMap((r) => [r.dropped_by, r.witnessed_by]).filter((x): x is string => !!x))];
    const regBySession = new Map<string, string>();
    if (sessionIds.length) {
      const { data: ses } = await admin.from("drawer_sessions").select("id, register_id").in("id", sessionIds);
      const regIds = [...new Set(((ses ?? []) as { id: string; register_id: string }[]).map((s) => s.register_id))];
      const { data: regs } = regIds.length ? await admin.from("registers").select("id, name").in("id", regIds) : { data: [] };
      const regName = new Map(((regs ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]));
      for (const s of (ses ?? []) as { id: string; register_id: string }[]) regBySession.set(s.id, regName.get(s.register_id) ?? "Register");
    }
    const empName = new Map<string, string>();
    if (empIds.length) {
      const { data: emps } = await admin.from("employees").select("id, full_name").in("id", empIds);
      for (const e of (emps ?? []) as { id: string; full_name: string }[]) empName.set(e.id, e.full_name);
    }
    base.drops = rows.map((r) => {
      const read = readDropDestination(r);
      const via = r.recorded_via === "register" || r.recorded_via === "offline" || r.recorded_via === "back_office" ? r.recorded_via : null;
      return {
        id: r.id,
        droppedAt: r.dropped_at,
        amountCents: Number(r.amount_minor),
        twenties: read.twenties,
        terminalId: read.terminalId,
        registerName: regBySession.get(r.session_id) ?? "Register",
        employeeId: r.dropped_by,
        employeeName: r.dropped_by ? (empName.get(r.dropped_by) ?? "Former employee") : null,
        witnessId: r.witnessed_by,
        witnessName: r.witnessed_by ? (empName.get(r.witnessed_by) ?? "Former employee") : null,
        recordedVia: via,
        storedAs: read.fromNote ? "note_tag" : "columns",
        notes: r.notes,
      } satisfies MatchDrop;
    });
  } catch (e) {
    base.errors.push(`Drops: ${e instanceof Error ? e.message : "read failed"}`);
  }

  // 2. PAI cash loads (loaded_at is the ISO instant; load_date the Pacific day).
  try {
    type LoadDb = {
      id: string;
      terminal_id: string;
      loaded_at: string | null;
      load_date: string | null;
      cash_load_cents: number | string;
      balance_after_cents: number | string | null;
      source: string | null;
    };
    const read = await pagedAllChecked<LoadDb>(async (a, b) => {
      const { data, error } = await admin
        .from("atm_cash_loads")
        .select("id, terminal_id, loaded_at, load_date, cash_load_cents, balance_after_cents, source")
        .gte("load_date", addDays(window.fromDay, -1))
        .lte("load_date", addDays(window.toDay, 1))
        .order("id", { ascending: true })
        .range(a, b);
      if (error) base.errors.push(`Cash loads: ${error.message}`);
      return { rows: (data ?? []) as LoadDb[], ok: !error };
    });
    if (!read.verdict.complete) base.errors.push(`Cash loads: ${read.verdict.message}`);
    base.loads = read.rows
      .map((r) => {
        const cents = Number(r.cash_load_cents);
        const bal = r.balance_after_cents === null ? null : Number(r.balance_after_cents);
        return {
          id: r.id,
          terminalId: r.terminal_id,
          loadedAt: r.loaded_at,
          loadDate: r.load_date,
          cashLoadCents: cents,
          balanceAfterCents: bal !== null && Number.isFinite(bal) ? bal : null,
          source: r.source === "manual" ? "manual" : "pai",
        } satisfies MatchLoad;
      })
      // A blank / unreadable amount is reported, never silently treated as $0 (D-22).
      .filter((l) => {
        if (Number.isFinite(l.cashLoadCents)) return true;
        base.errors.push(`Cash load ${l.id} has an unreadable amount and was left out.`);
        return false;
      });
    const { data: latest } = await admin.from("atm_cash_loads").select("load_date").order("load_date", { ascending: false }).limit(1);
    base.paiLatestLoadDay = ((latest ?? []) as { load_date: string | null }[])[0]?.load_date ?? null;
  } catch (e) {
    base.errors.push(`Cash loads: ${e instanceof Error ? e.message : "read failed"}`);
  }

  // 3. PAI settlements (dispensed per day).
  try {
    const rows = await listAtmSettlements(500);
    base.settlements = rows
      .filter((s) => s.settlementDate >= window.fromDay && s.settlementDate <= window.toDay)
      .map((s) => ({ date: s.settlementDate, terminalId: s.terminalId, terminalTransactionCents: s.terminalTransactionCents }));
  } catch {
    /* settlements are context only */
  }

  // 4. Plaid ATM-role account: deposits + freshness.
  try {
    const rec = await getAtmReconcileInputs(500);
    base.hasAtmAccount = rec.hasAtmAccount;
    base.atmAccountNames = rec.atmAccountNames;
    base.deposits = rec.deposits.filter((d) => d.date >= addDays(window.fromDay, -1) && d.date <= addDays(window.toDay, 3));
    if (rec.hasAtmAccount) {
      const [accounts, items] = await Promise.all([listPlaidAccounts(), listPlaidItems()]);
      const itemIds = new Set(accounts.filter((a) => a.role === "atm" && a.active).map((a) => a.itemId));
      const syncs = items.filter((i) => itemIds.has(i.itemId)).map((i) => i.lastSuccessfulSync);
      base.plaidLastSyncedAt = syncs.some((s) => !s) ? null : (syncs.sort()[0] ?? null);
    }
  } catch (e) {
    base.errors.push(`Bank: ${e instanceof Error ? e.message : "read failed"}`);
  }

  // 5. The owner's reviews (append-only; the newest per subject wins inside the engine).
  try {
    type ReviewDb = {
      id: string;
      subject_kind: "drop" | "load" | "day";
      subject_id: string;
      decision: ReviewDecision;
      link_load_id: string | null;
      note: string;
      reviewed_by_email: string | null;
      reviewed_at: string;
    };
    let missingTable = false;
    const read = await pagedAllChecked<ReviewDb>(async (a, b) => {
      const { data, error } = await admin
        .from("atm_drop_reviews")
        .select("id, subject_kind, subject_id, decision, link_load_id, note, reviewed_by_email, reviewed_at")
        .order("id", { ascending: true })
        .range(a, b);
      if (error) {
        if (MISSING.has(error.code ?? "")) missingTable = true;
        else base.errors.push(`Reviews: ${error.message}`);
      }
      return { rows: (data ?? []) as ReviewDb[], ok: !error };
    });
    if (!missingTable) {
      base.reviewsTableReady = read.verdict.complete;
      if (!read.verdict.complete) base.errors.push(`Reviews: ${read.verdict.message}`);
      base.reviews = [...read.rows]
        .sort((x, y) => (x.reviewed_at < y.reviewed_at ? -1 : x.reviewed_at > y.reviewed_at ? 1 : 0))
        .map((r) => ({
        id: r.id,
        subjectKind: r.subject_kind,
        subjectId: r.subject_id,
        decision: r.decision,
        linkLoadId: r.link_load_id,
        note: r.note,
        reviewedByEmail: r.reviewed_by_email,
        reviewedAt: r.reviewed_at,
      }));
    }
  } catch {
    /* table missing = migration 0346 not applied */
  }

  return base;
}

export type InsertReviewInput = {
  subjectKind: "drop" | "load" | "day";
  subjectId: string;
  decision: ReviewDecision;
  linkLoadId: string | null;
  note: string;
  signalCodes: string[];
  reviewedBy: string | null;
  reviewedByEmail: string | null;
};

/** Append one review row. Nothing is ever updated or deleted (0346 grants select + insert only). */
export async function insertAtmDropReview(input: InsertReviewInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("atm_drop_reviews")
      .insert({
        subject_kind: input.subjectKind,
        subject_id: input.subjectId,
        decision: input.decision,
        link_load_id: input.linkLoadId,
        note: input.note,
        signal_codes: input.signalCodes.slice(0, 40),
        reviewed_by: input.reviewedBy,
        reviewed_by_email: input.reviewedByEmail,
      })
      .select("id")
      .single();
    if (error) {
      if (MISSING.has(error.code ?? "")) return { ok: false, error: "Run migration 0346 first (docs/MIGRATIONS_TO_RUN.md) - the review table is not there yet." };
      return { ok: false, error: error.message };
    }
    return { ok: true, id: (data as { id: string }).id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}
