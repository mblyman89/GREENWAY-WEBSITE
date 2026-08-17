import "server-only";

/**
 * src/lib/plaid/store.ts — Plaid persistence layer (Slice P1, server-only).
 *
 * CRUD over plaid_items / plaid_accounts / plaid_transactions (migration 0157).
 * Mirrors the enterprise patterns already in the repo:
 *   - isSupabaseServiceConfigured guard → graceful "not configured" (empty
 *     reads, {ok:false} writes) so the app renders before the DB is wired,
 *   - createSupabaseAdminClient() for service-role access,
 *   - access_token + transactions_cursor envelope-encrypted at rest via
 *     encryptSecret (no-op until DATA_ENCRYPTION_KEY is set); decrypted on read
 *     and NEVER returned to the browser (only server callers get the token),
 *   - idempotent upserts on the Plaid dedup keys (item_id / account_id /
 *     transaction_id) so replaying a sync is safe.
 *
 * P1 is foundation only — these functions are called by later slices
 * (P2 exchange, P3 sync). Nothing here makes a network call.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { encryptSecret, decryptSecret } from "@/lib/security/at-rest-crypto";
import { type NormalizedTxn } from "./plaid-core";

// ---------------------------------------------------------------------------
// Types (storage-facing; money in cents)
// ---------------------------------------------------------------------------

export type PlaidItemStatus = "healthy" | "login_required" | "pending_disconnect" | "error";

/** Server-side item record. `accessToken` is DECRYPTED — never send to client. */
export type PlaidItemRecord = {
  id: string;
  itemId: string;
  accessToken: string;
  institutionId: string | null;
  institutionName: string | null;
  products: string[];
  transactionsCursor: string | null;
  status: PlaidItemStatus;
  errorCode: string | null;
  lastSuccessfulSync: string | null;
  /** Which credential set linked this item (migration 0159). Default 'primary'. */
  credentialSet: string;
  /** Owner label for grouping (migration 0159). NULL = fall back to set owner. */
  owner: string | null;
};

export type PlaidAccountRecord = {
  id: string;
  accountId: string;
  itemId: string;
  name: string | null;
  officialName: string | null;
  /** Owner-assigned nickname (migration 0184). NULL = fall back to the bank name. */
  customName: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  /** Canonical role value OR a custom (typed) role key; null = unassigned. */
  role: string | null;
  currentBalanceCents: number | null;
  availableBalanceCents: number | null;
  isoCurrencyCode: string | null;
  balancesUpdatedAt: string | null;
  active: boolean;
};

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

type ItemRow = {
  id: string;
  item_id: string;
  access_token: string | null;
  institution_id: string | null;
  institution_name: string | null;
  products: string[] | null;
  transactions_cursor: string | null;
  status: string | null;
  error_code: string | null;
  last_successful_sync: string | null;
  credential_set: string | null;
  owner: string | null;
};

const ITEM_COLS =
  "id,item_id,access_token,institution_id,institution_name,products,transactions_cursor,status,error_code,last_successful_sync,credential_set,owner";

function normStatus(s: string | null | undefined): PlaidItemStatus {
  const v = (s ?? "").trim().toLowerCase();
  if (v === "login_required") return "login_required";
  if (v === "pending_disconnect") return "pending_disconnect";
  if (v === "error") return "error";
  return "healthy";
}

function toItemRecord(row: ItemRow): PlaidItemRecord {
  return {
    id: row.id,
    itemId: row.item_id,
    accessToken: row.access_token ? decryptSecret(row.access_token) : "",
    institutionId: row.institution_id,
    institutionName: row.institution_name,
    products: row.products ?? [],
    transactionsCursor: row.transactions_cursor ? decryptSecret(row.transactions_cursor) : null,
    status: normStatus(row.status),
    errorCode: row.error_code,
    lastSuccessfulSync: row.last_successful_sync,
    // Legacy rows (pre-0159) read as null → treat as 'primary' (the original keys).
    credentialSet: (row.credential_set ?? "primary").trim() || "primary",
    owner: row.owner,
  };
}

export type InsertPlaidItemInput = {
  itemId: string;
  accessToken: string;
  institutionId?: string | null;
  institutionName?: string | null;
  products?: string[];
  /** Which credential set linked this item (default 'primary'). */
  credentialSet?: string | null;
  /** Owner label for grouping (e.g. 'Michael', 'Wife'). */
  owner?: string | null;
};

/** Insert-or-update an item (dedup on item_id). access_token encrypted at rest. */
export async function upsertPlaidItem(
  input: InsertPlaidItemInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("plaid_items").upsert(
    {
      item_id: input.itemId,
      access_token: encryptSecret(input.accessToken),
      institution_id: input.institutionId ?? null,
      institution_name: input.institutionName ?? null,
      products: input.products ?? [],
      credential_set: (input.credentialSet ?? "primary").trim() || "primary",
      owner: input.owner ?? null,
      status: "healthy",
      error_code: null,
    },
    { onConflict: "item_id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** List all items (server-side; includes decrypted tokens for sync callers). */
export async function listPlaidItems(): Promise<PlaidItemRecord[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("plaid_items").select(ITEM_COLS).order("created_at", { ascending: true });
    if (error || !data) return [];
    return (data as ItemRow[]).map(toItemRecord);
  } catch {
    return [];
  }
}

export async function getPlaidItem(itemId: string): Promise<PlaidItemRecord | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("plaid_items").select(ITEM_COLS).eq("item_id", itemId).maybeSingle();
    if (error || !data) return null;
    return toItemRecord(data as ItemRow);
  } catch {
    return null;
  }
}

/**
 * Delete a Plaid item and everything under it. The FK cascades (0157/0168/0170)
 * mean this one delete removes the item's accounts → their transactions,
 * mortgage detail, and investment holdings too. Used to remove a connection
 * (e.g. a duplicate re-link). Returns ok even if the row was already gone.
 */
export async function deletePlaidItem(
  itemId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  const id = (itemId ?? "").trim();
  if (id === "") return { ok: false, error: "Missing connection id." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("plaid_items").delete().eq("item_id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Persist the (encrypted) sync cursor + mark a successful sync. */
export async function savePlaidCursor(
  itemId: string,
  cursor: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("plaid_items")
    .update({
      transactions_cursor: encryptSecret(cursor),
      last_successful_sync: new Date().toISOString(),
      status: "healthy",
      error_code: null,
    })
    .eq("item_id", itemId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Record an item's error/status (never throws to UI; best-effort). */
export async function setPlaidItemStatus(
  itemId: string,
  status: PlaidItemStatus,
  errorCode: string | null,
): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  try {
    const admin = createSupabaseAdminClient();
    await admin.from("plaid_items").update({ status, error_code: errorCode }).eq("item_id", itemId);
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

type AccountRow = {
  id: string;
  account_id: string;
  item_id: string;
  name: string | null;
  official_name: string | null;
  custom_name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  role: string | null;
  current_balance_cents: number | null;
  available_balance_cents: number | null;
  iso_currency_code: string | null;
  balances_updated_at: string | null;
  active: boolean | null;
};

const ACCOUNT_COLS =
  "id,account_id,item_id,name,official_name,custom_name,mask,type,subtype,role,current_balance_cents,available_balance_cents,iso_currency_code,balances_updated_at,active";

function toAccountRecord(row: AccountRow): PlaidAccountRecord {
  // Roles may be one of the 8 canonical values OR a custom (typed) key. Accept
  // any non-blank stored string; only null/blank means "unassigned".
  const role = typeof row.role === "string" && row.role.trim() !== "" ? row.role : null;
  return {
    id: row.id,
    accountId: row.account_id,
    itemId: row.item_id,
    name: row.name,
    officialName: row.official_name,
    customName: row.custom_name,
    mask: row.mask,
    type: row.type,
    subtype: row.subtype,
    role,
    currentBalanceCents: row.current_balance_cents,
    availableBalanceCents: row.available_balance_cents,
    isoCurrencyCode: row.iso_currency_code,
    balancesUpdatedAt: row.balances_updated_at,
    active: row.active ?? true,
  };
}

export type UpsertPlaidAccountInput = {
  accountId: string;
  itemId: string;
  name?: string | null;
  officialName?: string | null;
  mask?: string | null;
  type?: string | null;
  subtype?: string | null;
  currentBalanceCents?: number | null;
  availableBalanceCents?: number | null;
  isoCurrencyCode?: string | null;
};

/**
 * Insert-or-update an account (dedup on account_id). Deliberately does NOT
 * write `role` — the owner assigns that via a dedicated action so a re-sync
 * never clobbers a role. Balances refresh on each sync.
 */
export async function upsertPlaidAccount(
  input: UpsertPlaidAccountInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("plaid_accounts").upsert(
    {
      account_id: input.accountId,
      item_id: input.itemId,
      name: input.name ?? null,
      official_name: input.officialName ?? null,
      mask: input.mask ?? null,
      type: input.type ?? null,
      subtype: input.subtype ?? null,
      current_balance_cents: input.currentBalanceCents ?? null,
      available_balance_cents: input.availableBalanceCents ?? null,
      iso_currency_code: input.isoCurrencyCode ?? "USD",
      balances_updated_at: new Date().toISOString(),
    },
    { onConflict: "account_id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function listPlaidAccounts(): Promise<PlaidAccountRecord[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("plaid_accounts").select(ACCOUNT_COLS).order("created_at", { ascending: true });
    if (error || !data) return [];
    return (data as AccountRow[]).map(toAccountRecord);
  } catch {
    return [];
  }
}

/** Assign (or clear) an account's owner-chosen role. role=null clears it. */
export async function setPlaidAccountRole(
  accountId: string,
  role: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("plaid_accounts").update({ role }).eq("account_id", accountId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Set (or clear) an account's owner-assigned nickname (migration 0184).
 * Pass null/blank to clear it (falls back to the bank name). Written ONLY here,
 * never by a sync, so /accounts refreshes can't clobber the owner's name.
 */
export async function setPlaidAccountCustomName(
  accountId: string,
  customName: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("plaid_accounts")
    .update({ custom_name: customName })
    .eq("account_id", accountId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

/**
 * A stored transaction, camelCase, money in CENTS with Plaid's sign preserved
 * (positive = money out, negative = money in). This is the projection the P5
 * money views read; `removed` rows are already filtered out by the reader.
 */
export type PlaidTransactionRecord = {
  transactionId: string;
  accountId: string;
  amountCents: number;
  date: string;
  authorizedDate: string | null;
  name: string | null;
  merchantName: string | null;
  categoryPrimary: string | null;
  categoryDetailed: string | null;
  pending: boolean;
  pendingTransactionId: string | null;
  paymentChannel: string | null;
};

type TxnRow = {
  transaction_id: string;
  account_id: string;
  amount_cents: number;
  date: string;
  authorized_date: string | null;
  name: string | null;
  merchant_name: string | null;
  personal_finance_category_primary: string | null;
  personal_finance_category_detailed: string | null;
  pending: boolean;
  pending_transaction_id: string | null;
  payment_channel: string | null;
};

const TXN_COLS =
  "transaction_id,account_id,amount_cents,date,authorized_date,name,merchant_name," +
  "personal_finance_category_primary,personal_finance_category_detailed,pending," +
  "pending_transaction_id,payment_channel";

function toTxnRecord(row: TxnRow): PlaidTransactionRecord {
  return {
    transactionId: row.transaction_id,
    accountId: row.account_id,
    // bigint arrives as number (safe for money magnitudes) or string; coerce.
    amountCents: typeof row.amount_cents === "string" ? Number(row.amount_cents) : row.amount_cents,
    date: row.date,
    authorizedDate: row.authorized_date,
    name: row.name,
    merchantName: row.merchant_name,
    categoryPrimary: row.personal_finance_category_primary,
    categoryDetailed: row.personal_finance_category_detailed,
    pending: !!row.pending,
    pendingTransactionId: row.pending_transaction_id,
    paymentChannel: row.payment_channel,
  };
}

/** Cap rows a single account-detail view will pull (keeps the page snappy). */
export const PLAID_TXN_READ_LIMIT = 500;

/**
 * Read one account's live (not removed) transactions, newest first — the source
 * for the P5 money views. Uses idx_plaid_transactions_account_date (account_id,
 * date desc). Returns [] when the DB isn't configured or on any error, so the
 * page renders an empty state instead of crashing.
 */
export async function listPlaidTransactions(
  accountId: string,
  limit: number = PLAID_TXN_READ_LIMIT,
): Promise<PlaidTransactionRecord[]> {
  if (!isSupabaseServiceConfigured) return [];
  const id = (accountId ?? "").trim();
  if (id === "") return [];
  const cap = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), PLAID_TXN_READ_LIMIT) : PLAID_TXN_READ_LIMIT;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("plaid_transactions")
      .select(TXN_COLS)
      .eq("account_id", id)
      .eq("removed", false)
      .order("date", { ascending: false })
      .limit(cap);
    if (error || !data) return [];
    return (data as unknown as TxnRow[]).map(toTxnRecord);
  } catch {
    return [];
  }
}

/**
 * Apply a merge plan (from plaid-core.planTransactionMerge): upsert added/
 * modified rows (dedup on transaction_id) and soft-delete removed ones. Returns
 * counts so the sync layer can log a summary. Best-effort per batch; the first
 * DB error stops and is reported.
 */
export async function applyTransactionMerge(plan: {
  upserts: NormalizedTxn[];
  removals: string[];
}): Promise<{ ok: true; upserted: number; removed: number } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  const admin = createSupabaseAdminClient();

  let upserted = 0;
  if (plan.upserts.length > 0) {
    const rows = plan.upserts.map((t) => ({
      transaction_id: t.transaction_id,
      account_id: t.account_id,
      amount_cents: t.amount_cents,
      date: t.date,
      authorized_date: t.authorized_date,
      name: t.name,
      merchant_name: t.merchant_name,
      personal_finance_category_primary: t.personal_finance_category_primary,
      personal_finance_category_detailed: t.personal_finance_category_detailed,
      pending: t.pending,
      pending_transaction_id: t.pending_transaction_id,
      removed: false,
      payment_channel: t.payment_channel,
      raw: t.raw,
    }));
    const { error } = await admin.from("plaid_transactions").upsert(rows, { onConflict: "transaction_id" });
    if (error) return { ok: false, error: error.message };
    upserted = rows.length;
  }

  let removed = 0;
  if (plan.removals.length > 0) {
    const { error } = await admin
      .from("plaid_transactions")
      .update({ removed: true })
      .in("transaction_id", plan.removals);
    if (error) return { ok: false, error: error.message };
    removed = plan.removals.length;
  }

  return { ok: true, upserted, removed };
}

// ---------------------------------------------------------------------------
// Webhook events (Slice P4) — dedup + audit of Plaid webhook deliveries.
// body_sha256 is the idempotency key (unique index in migration 0157).
// ---------------------------------------------------------------------------

/**
 * Record a received webhook delivery. Returns `{duplicate:true}` when we've
 * already seen this exact body (the unique body_sha256 collided), so the route
 * can 200 immediately without re-processing. Any other DB error is reported.
 * Never throws.
 */
export async function recordPlaidWebhookEvent(input: {
  bodySha256: string;
  webhookType: string | null;
  webhookCode: string | null;
  itemId: string | null;
}): Promise<{ ok: true; duplicate: boolean } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("plaid_webhook_events").insert({
    body_sha256: input.bodySha256,
    webhook_type: input.webhookType,
    webhook_code: input.webhookCode,
    item_id: input.itemId,
  });
  if (error) {
    // 23505 = unique_violation → we've already stored this exact delivery.
    if (error.code === "23505" || /duplicate key|unique/i.test(error.message)) {
      return { ok: true, duplicate: true };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true, duplicate: false };
}

/** Mark a recorded webhook delivery as processed (best-effort; never throws). */
export async function markPlaidWebhookProcessed(bodySha256: string): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  try {
    const admin = createSupabaseAdminClient();
    await admin
      .from("plaid_webhook_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("body_sha256", bodySha256);
  } catch {
    // best-effort; the dedup row already exists so a missed timestamp is harmless
  }
}

// ---------------------------------------------------------------------------
// Mortgages (Plaid Liabilities detail; migration 0168)
// ---------------------------------------------------------------------------

/** A stored mortgage-detail row (money in integer cents, rate in basis points). */
export type PlaidMortgageRecord = {
  accountId: string;
  accountNumberMask: string | null;
  interestRateBps: number | null;
  interestRateType: string | null;
  nextMonthlyPaymentCents: number | null;
  nextPaymentDueDate: string | null;
  lastPaymentAmountCents: number | null;
  lastPaymentDate: string | null;
  escrowBalanceCents: number | null;
  currentLateFeeCents: number | null;
  pastDueAmountCents: number | null;
  originationPrincipalCents: number | null;
  originationDate: string | null;
  maturityDate: string | null;
  loanTerm: string | null;
  loanTypeDescription: string | null;
  hasPmi: boolean | null;
  hasPrepaymentPenalty: boolean | null;
  ytdInterestPaidCents: number | null;
  ytdPrincipalPaidCents: number | null;
  propertyAddress: string | null;
};

type MortgageRow = {
  account_id: string;
  account_number_mask: string | null;
  interest_rate_bps: number | null;
  interest_rate_type: string | null;
  next_monthly_payment_cents: number | null;
  next_payment_due_date: string | null;
  last_payment_amount_cents: number | null;
  last_payment_date: string | null;
  escrow_balance_cents: number | null;
  current_late_fee_cents: number | null;
  past_due_amount_cents: number | null;
  origination_principal_cents: number | null;
  origination_date: string | null;
  maturity_date: string | null;
  loan_term: string | null;
  loan_type_description: string | null;
  has_pmi: boolean | null;
  has_prepayment_penalty: boolean | null;
  ytd_interest_paid_cents: number | null;
  ytd_principal_paid_cents: number | null;
  property_address: string | null;
};

const MORTGAGE_COLS =
  "account_id,account_number_mask,interest_rate_bps,interest_rate_type,next_monthly_payment_cents,next_payment_due_date,last_payment_amount_cents,last_payment_date,escrow_balance_cents,current_late_fee_cents,past_due_amount_cents,origination_principal_cents,origination_date,maturity_date,loan_term,loan_type_description,has_pmi,has_prepayment_penalty,ytd_interest_paid_cents,ytd_principal_paid_cents,property_address";

function toMortgageRecord(row: MortgageRow): PlaidMortgageRecord {
  return {
    accountId: row.account_id,
    accountNumberMask: row.account_number_mask,
    interestRateBps: row.interest_rate_bps,
    interestRateType: row.interest_rate_type,
    nextMonthlyPaymentCents: row.next_monthly_payment_cents,
    nextPaymentDueDate: row.next_payment_due_date,
    lastPaymentAmountCents: row.last_payment_amount_cents,
    lastPaymentDate: row.last_payment_date,
    escrowBalanceCents: row.escrow_balance_cents,
    currentLateFeeCents: row.current_late_fee_cents,
    pastDueAmountCents: row.past_due_amount_cents,
    originationPrincipalCents: row.origination_principal_cents,
    originationDate: row.origination_date,
    maturityDate: row.maturity_date,
    loanTerm: row.loan_term,
    loanTypeDescription: row.loan_type_description,
    hasPmi: row.has_pmi,
    hasPrepaymentPenalty: row.has_prepayment_penalty,
    ytdInterestPaidCents: row.ytd_interest_paid_cents,
    ytdPrincipalPaidCents: row.ytd_principal_paid_cents,
    propertyAddress: row.property_address,
  };
}

/**
 * Upsert one mortgage-detail row (keyed on account_id). The caller passes a
 * record already normalized to integer cents / basis points by the pure core
 * (liabilities-core.mapMortgage). The mortgage account must already exist in
 * plaid_accounts (FK), which it will after the /accounts refresh.
 */
export async function upsertPlaidMortgage(
  rec: PlaidMortgageRecord,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("plaid_mortgages").upsert(
    {
      account_id: rec.accountId,
      account_number_mask: rec.accountNumberMask,
      interest_rate_bps: rec.interestRateBps,
      interest_rate_type: rec.interestRateType,
      next_monthly_payment_cents: rec.nextMonthlyPaymentCents,
      next_payment_due_date: rec.nextPaymentDueDate,
      last_payment_amount_cents: rec.lastPaymentAmountCents,
      last_payment_date: rec.lastPaymentDate,
      escrow_balance_cents: rec.escrowBalanceCents,
      current_late_fee_cents: rec.currentLateFeeCents,
      past_due_amount_cents: rec.pastDueAmountCents,
      origination_principal_cents: rec.originationPrincipalCents,
      origination_date: rec.originationDate,
      maturity_date: rec.maturityDate,
      loan_term: rec.loanTerm,
      loan_type_description: rec.loanTypeDescription,
      has_pmi: rec.hasPmi,
      has_prepayment_penalty: rec.hasPrepaymentPenalty,
      ytd_interest_paid_cents: rec.ytdInterestPaidCents,
      ytd_principal_paid_cents: rec.ytdPrincipalPaidCents,
      property_address: rec.propertyAddress,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "account_id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** List every stored mortgage detail (best-effort; empty when not configured). */
export async function listPlaidMortgages(): Promise<PlaidMortgageRecord[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("plaid_mortgages").select(MORTGAGE_COLS);
    if (error || !data) return [];
    return (data as MortgageRow[]).map(toMortgageRecord);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Plaid investment holdings (migration 0170). One row per position
// (account_id + security_id). Money in integer cents; quantity in integer
// micro-units. Refreshed by investments-server on link + every "Sync now".
// ---------------------------------------------------------------------------

export type PlaidHoldingStoreRecord = {
  accountId: string;
  securityId: string;
  securityName: string | null;
  tickerSymbol: string | null;
  securityType: string | null;
  quantityMicros: number | null;
  institutionPriceCents: number | null;
  institutionValueCents: number | null;
  costBasisCents: number | null;
  isoCurrencyCode: string | null;
};

type HoldingRow = {
  account_id: string;
  security_id: string;
  security_name: string | null;
  ticker_symbol: string | null;
  security_type: string | null;
  quantity_micros: number | null;
  institution_price_cents: number | null;
  institution_value_cents: number | null;
  cost_basis_cents: number | null;
  iso_currency_code: string | null;
};

const HOLDING_COLS =
  "account_id,security_id,security_name,ticker_symbol,security_type,quantity_micros,institution_price_cents,institution_value_cents,cost_basis_cents,iso_currency_code";

function toHoldingRecord(row: HoldingRow): PlaidHoldingStoreRecord {
  return {
    accountId: row.account_id,
    securityId: row.security_id,
    securityName: row.security_name,
    tickerSymbol: row.ticker_symbol,
    securityType: row.security_type,
    quantityMicros: row.quantity_micros,
    institutionPriceCents: row.institution_price_cents,
    institutionValueCents: row.institution_value_cents,
    costBasisCents: row.cost_basis_cents,
    isoCurrencyCode: row.iso_currency_code,
  };
}

/**
 * Replace the stored holdings for a set of investment accounts (delete then
 * insert), so a sold-off position no longer lingers. Only the given account ids
 * are cleared; every other account's holdings are untouched. Returns how many
 * rows were inserted. Best-effort: a DB error returns 0 rather than throwing.
 */
export async function replacePlaidHoldingsForAccounts(
  accountIds: readonly string[],
  records: readonly PlaidHoldingStoreRecord[],
): Promise<number> {
  if (!isSupabaseServiceConfigured) return 0;
  const admin = createSupabaseAdminClient();
  try {
    if (accountIds.length > 0) {
      const { error: delErr } = await admin
        .from("plaid_holdings")
        .delete()
        .in("account_id", accountIds as string[]);
      if (delErr) return 0;
    }
    if (records.length === 0) return 0;
    const rows = records.map((rec) => ({
      account_id: rec.accountId,
      security_id: rec.securityId,
      security_name: rec.securityName,
      ticker_symbol: rec.tickerSymbol,
      security_type: rec.securityType,
      quantity_micros: rec.quantityMicros,
      institution_price_cents: rec.institutionPriceCents,
      institution_value_cents: rec.institutionValueCents,
      cost_basis_cents: rec.costBasisCents,
      iso_currency_code: rec.isoCurrencyCode,
      updated_at: new Date().toISOString(),
    }));
    const { error: insErr } = await admin.from("plaid_holdings").insert(rows);
    if (insErr) return 0;
    return rows.length;
  } catch {
    return 0;
  }
}

/** List every stored holding (best-effort; empty when not configured). */
export async function listPlaidHoldings(): Promise<PlaidHoldingStoreRecord[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("plaid_holdings").select(HOLDING_COLS);
    if (error || !data) return [];
    return (data as HoldingRow[]).map(toHoldingRecord);
  } catch {
    return [];
  }
}
