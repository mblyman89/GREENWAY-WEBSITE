import "server-only";

/**
 * src/lib/loans/loan-store.ts — Manual loans persistence layer (server-only).
 *
 * CRUD over manual_loans / manual_loan_payments (migration 0171). Mirrors the
 * Plaid store patterns:
 *   - isSupabaseServiceConfigured guard → graceful "not configured" (empty
 *     reads, {ok:false} writes) so the app renders before the DB is wired,
 *   - createSupabaseAdminClient() for service-role access,
 *   - money in INTEGER CENTS; rate in INTEGER MILLI-PERCENT (2375 = 2.375%).
 *
 * No amortization math lives here — that is loan-core.ts (pure). This file only
 * moves rows in and out of the database.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { optionalBigint, requiredBigint } from "@/lib/supabase/pg-bigint";
import { type LoanKind } from "./loan-core";

// ---------------------------------------------------------------------------
// Types (storage-facing; money in cents, rate in milli-percent)
// ---------------------------------------------------------------------------

export type LoanRecord = {
  id: string;
  name: string;
  kind: LoanKind;
  originalPrincipalCents: number;
  currentBalanceCents: number | null;
  rateMilliPct: number;
  termMonths: number;
  firstPaymentDate: string;
  maturityDate: string | null;
  scheduledPaymentCents: number | null;
  fundingAccountId: string | null;
  notes: string | null;
  active: boolean;
};

export type LoanPaymentRecord = {
  id: string;
  loanId: string;
  paidDate: string;
  amountCents: number;
  principalCents: number | null;
  interestCents: number | null;
  escrowCents: number | null;
  feesCents: number | null;
  matchedTransactionId: string | null;
  description: string | null;
};

/** Fields accepted when creating/updating a loan (id/timestamps managed by DB). */
export type LoanUpsertInput = {
  id?: string;
  name: string;
  kind: LoanKind;
  originalPrincipalCents: number;
  currentBalanceCents: number | null;
  rateMilliPct: number;
  termMonths: number;
  firstPaymentDate: string;
  maturityDate: string | null;
  scheduledPaymentCents: number | null;
  fundingAccountId: string | null;
  notes: string | null;
  active: boolean;
};

export type LoanPaymentInput = {
  loanId: string;
  paidDate: string;
  amountCents: number;
  principalCents: number | null;
  interestCents: number | null;
  escrowCents: number | null;
  feesCents: number | null;
  matchedTransactionId: string | null;
  description: string | null;
};

// ---------------------------------------------------------------------------
// Row shapes + mappers (DB snake_case → camelCase record)
// ---------------------------------------------------------------------------

const LOAN_COLS =
  "id,name,kind,original_principal_cents,current_balance_cents,rate_milli_pct,term_months,first_payment_date,maturity_date,scheduled_payment_cents,funding_account_id,notes,active";

type LoanRow = {
  id: string;
  name: string;
  kind: string;
  original_principal_cents: number | string | null;
  current_balance_cents: number | string | null;
  rate_milli_pct: number | string | null;
  term_months: number | string | null;
  first_payment_date: string | null;
  maturity_date: string | null;
  scheduled_payment_cents: number | string | null;
  funding_account_id: string | null;
  notes: string | null;
  active: boolean | null;
};

/**
 * Read a `not null` numeric column on a loan row.
 *
 * WHY THERE ARE NOW TWO OF THESE. There used to be one `toNum` returning
 * `number | null`, and four of its ten call sites finished with `?? 0`. That
 * pattern is worth naming, because it looks defensive and is the opposite: the
 * reader gave up and the caller invented a zero. On a loan, a fabricated zero
 * principal or a zero interest rate does not fail loudly - it produces a
 * plausible amortisation schedule for a loan that does not exist on those
 * terms, and the interest split then flows into the books.
 *
 * The four `?? 0` sites turned out to be exactly the four columns the schema
 * declares `not null`: `manual_loans.original_principal_cents`, `rate_milli_pct`
 * and `term_months`, and `manual_loan_payments.amount_cents`. That is not a
 * coincidence - `?? 0` was standing in for "this one is always there", which is
 * a fact the migration already states. So it is now stated once, by calling the
 * reader that refuses instead of the one that returns null.
 *
 * The conversion itself is in `@/lib/supabase/pg-bigint`, along with the record
 * of the two defects the old shared idiom carried: `Number("")` is 0, not NaN,
 * and `Number.isFinite` does not tell you a 64-bit value survived the trip.
 */
function requiredNum(v: number | string | null | undefined, column: string): number {
  return requiredBigint(v, { table: "manual_loans", column, context: "a loan record" });
}

/**
 * Read a genuinely nullable numeric column on a loan row.
 *
 * These six columns are nullable in the schema and their absence is real
 * information: a payment with no recorded principal/interest split has not been
 * broken out yet, and a loan with no scheduled payment has no fixed one. Null
 * is passed through faithfully; an UNREADABLE value throws rather than
 * masquerading as one of those legitimate blanks.
 */
function optionalNum(v: number | string | null | undefined, column: string): number | null {
  return optionalBigint(v, { table: "manual_loans", column, context: "a loan record" });
}

function toLoanRecord(row: LoanRow): LoanRecord {
  const kind: LoanKind = row.kind === "interest_free" ? "interest_free" : "amortizing";
  return {
    id: row.id,
    name: row.name,
    kind,
    originalPrincipalCents: requiredNum(row.original_principal_cents, "original_principal_cents"),
    currentBalanceCents: optionalNum(row.current_balance_cents, "current_balance_cents"),
    rateMilliPct: requiredNum(row.rate_milli_pct, "rate_milli_pct"),
    termMonths: requiredNum(row.term_months, "term_months"),
    firstPaymentDate: row.first_payment_date ?? "",
    maturityDate: row.maturity_date,
    scheduledPaymentCents: optionalNum(row.scheduled_payment_cents, "scheduled_payment_cents"),
    fundingAccountId: row.funding_account_id,
    notes: row.notes,
    active: row.active !== false,
  };
}

const PAYMENT_COLS =
  "id,loan_id,paid_date,amount_cents,principal_cents,interest_cents,escrow_cents,fees_cents,matched_transaction_id,description";

type PaymentRow = {
  id: string;
  loan_id: string;
  paid_date: string | null;
  amount_cents: number | string | null;
  principal_cents: number | string | null;
  interest_cents: number | string | null;
  escrow_cents: number | string | null;
  fees_cents: number | string | null;
  matched_transaction_id: string | null;
  description: string | null;
};

function toPaymentRecord(row: PaymentRow): LoanPaymentRecord {
  return {
    id: row.id,
    loanId: row.loan_id,
    paidDate: row.paid_date ?? "",
    amountCents: requiredNum(row.amount_cents, "amount_cents"),
    principalCents: optionalNum(row.principal_cents, "principal_cents"),
    interestCents: optionalNum(row.interest_cents, "interest_cents"),
    escrowCents: optionalNum(row.escrow_cents, "escrow_cents"),
    feesCents: optionalNum(row.fees_cents, "fees_cents"),
    matchedTransactionId: row.matched_transaction_id,
    description: row.description,
  };
}

// ---------------------------------------------------------------------------
// Loans CRUD
// ---------------------------------------------------------------------------

export async function listLoans(): Promise<LoanRecord[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("manual_loans")
      .select(LOAN_COLS)
      .order("created_at", { ascending: true });
    if (error || !data) return [];
    return (data as LoanRow[]).map(toLoanRecord);
  } catch {
    return [];
  }
}

export async function getLoan(id: string): Promise<LoanRecord | null> {
  if (!isSupabaseServiceConfigured) return null;
  const trimmed = id.trim();
  if (trimmed === "") return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("manual_loans")
      .select(LOAN_COLS)
      .eq("id", trimmed)
      .maybeSingle();
    if (error || !data) return null;
    return toLoanRecord(data as LoanRow);
  } catch {
    return null;
  }
}

type LoanWriteResult = { ok: true; id: string } | { ok: false; error: string };

/** Insert a new loan (or update when input.id is provided). Returns its id. */
export async function upsertLoan(input: LoanUpsertInput): Promise<LoanWriteResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  try {
    const admin = createSupabaseAdminClient();
    const row = {
      name: input.name,
      kind: input.kind,
      original_principal_cents: input.originalPrincipalCents,
      current_balance_cents: input.currentBalanceCents,
      rate_milli_pct: input.rateMilliPct,
      term_months: input.termMonths,
      first_payment_date: input.firstPaymentDate,
      maturity_date: input.maturityDate,
      scheduled_payment_cents: input.scheduledPaymentCents,
      funding_account_id: input.fundingAccountId,
      notes: input.notes,
      active: input.active,
      updated_at: new Date().toISOString(),
    };

    if (input.id && input.id.trim() !== "") {
      const { error } = await admin.from("manual_loans").update(row).eq("id", input.id.trim());
      if (error) return { ok: false, error: error.message };
      return { ok: true, id: input.id.trim() };
    }

    const { data, error } = await admin.from("manual_loans").insert(row).select("id").single();
    if (error || !data) return { ok: false, error: error?.message ?? "Insert failed." };
    return { ok: true, id: (data as { id: string }).id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error." };
  }
}

export async function deleteLoan(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  const trimmed = id.trim();
  if (trimmed === "") return { ok: false, error: "Missing loan id." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("manual_loans").delete().eq("id", trimmed);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error." };
  }
}

// ---------------------------------------------------------------------------
// Payments CRUD
// ---------------------------------------------------------------------------

export async function listLoanPayments(loanId: string): Promise<LoanPaymentRecord[]> {
  if (!isSupabaseServiceConfigured) return [];
  const trimmed = loanId.trim();
  if (trimmed === "") return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("manual_loan_payments")
      .select(PAYMENT_COLS)
      .eq("loan_id", trimmed)
      .order("paid_date", { ascending: false });
    if (error || !data) return [];
    return (data as PaymentRow[]).map(toPaymentRecord);
  } catch {
    return [];
  }
}

export async function addLoanPayment(
  input: LoanPaymentInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  try {
    const admin = createSupabaseAdminClient();
    const row = {
      loan_id: input.loanId,
      paid_date: input.paidDate,
      amount_cents: input.amountCents,
      principal_cents: input.principalCents,
      interest_cents: input.interestCents,
      escrow_cents: input.escrowCents,
      fees_cents: input.feesCents,
      matched_transaction_id: input.matchedTransactionId,
      description: input.description,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await admin
      .from("manual_loan_payments")
      .insert(row)
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: error?.message ?? "Insert failed." };
    return { ok: true, id: (data as { id: string }).id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error." };
  }
}

export async function deleteLoanPayment(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  const trimmed = id.trim();
  if (trimmed === "") return { ok: false, error: "Missing payment id." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("manual_loan_payments").delete().eq("id", trimmed);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error." };
  }
}
