/**
 * src/lib/plaid/plaid-core.ts — Plaid pure core (Slice P1).
 *
 * No I/O, no network, no server-only imports — fully unit-testable with tsx
 * and mirrored in vitest. This is the "money + rules brain" that later slices
 * (store/sync/webhook/UI) lean on so those layers stay thin.
 *
 * Responsibilities (per BIBLE §SLICE P1):
 *   1. plaidDollarsToCents — Plaid returns amounts as floating-point DOLLARS;
 *      we store integer CENTS everywhere (standing rule). Math.round(a*100),
 *      SIGN PRESERVED.
 *   2. validateAccountRole — owner assigns each account a role from the
 *      canonical ACCOUNT_ROLES list (main | atm | credit | savings | reserve |
 *      mortgage | loan | personal) or null (unassigned). Anything else rejected.
 *   3. mapItemStatus — turn a Plaid item error_code into our status enum plus a
 *      plain-English message a non-technical owner can act on.
 *   4. planTransactionMerge — turn a /transactions/sync delta (added / modified
 *      / removed) into idempotent upsert/soft-delete instructions, including the
 *      pending → posted transition.
 *
 * PLAID SIGN CONVENTION (documented, load-bearing): in Plaid, a POSITIVE amount
 * means money LEFT the account (a debit / outflow); a NEGATIVE amount means
 * money CAME IN (a credit / inflow). We PRESERVE Plaid's sign in
 * amount_cents and let the UI render inflow/outflow. Do not flip it here.
 */

// ---------------------------------------------------------------------------
// 1) Money — dollars → integer cents, sign preserved
// ---------------------------------------------------------------------------

/**
 * Convert a Plaid dollar amount to integer cents. Accepts number | numeric
 * string. Returns null for null/undefined/non-finite/garbage so callers can
 * skip a bad row rather than store a wrong number.
 *
 * Uses round-half-away-from-zero with a tiny epsilon to defeat binary
 * float artifacts (e.g. 12.005 * 100 = 1200.4999999). Sign is preserved:
 *   19.99  → 1999   (outflow)
 *  -50.00  → -5000   (inflow / refund)
 */
export function plaidDollarsToCents(input: number | string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  let n: number;
  if (typeof input === "number") {
    n = input;
  } else {
    const s = input.trim();
    if (s === "") return null;
    n = Number(s);
  }
  if (!Number.isFinite(n)) return null;
  const scaled = n * 100;
  const sign = scaled < 0 ? -1 : 1;
  // epsilon guards float error at the half-cent boundary
  return sign * Math.round(Math.abs(scaled) + 1e-9);
}

// ---------------------------------------------------------------------------
// 2) Account role validation
// ---------------------------------------------------------------------------

/**
 * The canonical list of account roles Michael can assign on the Plaid page.
 * This is the SINGLE SOURCE OF TRUTH — the AccountRole type, validation, the
 * store read-back whitelist, the human labels, and the UI dropdown all derive
 * from (or must stay in lock-step with) this list. Add a role here first.
 *
 * NOTE: "main" is load-bearing for reconciliation (vendor-reconcile uses
 * role==="main" to find the operating account). Never rename or remove it.
 */
export const ACCOUNT_ROLES = [
  "main",
  "atm",
  "credit",
  "savings",
  "reserve",
  "mortgage",
  "loan",
  "personal",
] as const;

export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/** Type guard: is this string one of our canonical roles? */
export function isAccountRole(v: string): v is AccountRole {
  return (ACCOUNT_ROLES as readonly string[]).includes(v);
}

/**
 * Validate/normalize an owner-assigned account role. Returns the canonical
 * role, or null for "unassigned" (empty / null / the literal "none"). Throws
 * NOTHING — invalid non-empty strings return { ok:false } so the caller can
 * show a friendly error.
 */
export function validateAccountRole(
  input: string | null | undefined,
): { ok: true; role: AccountRole | null } | { ok: false; error: string } {
  const v = (input ?? "").trim().toLowerCase();
  if (v === "" || v === "none" || v === "null" || v === "unassigned") return { ok: true, role: null };
  if (isAccountRole(v)) return { ok: true, role: v };
  return {
    ok: false,
    error: `Unknown account role "${input}". Use one of: ${ACCOUNT_ROLES.join(", ")}, or leave unassigned.`,
  };
}

// ---------------------------------------------------------------------------
// 3) Item status mapper — error_code → status + plain English
// ---------------------------------------------------------------------------

export type ItemStatus = "healthy" | "login_required" | "pending_disconnect" | "error";

export type ItemStatusView = {
  status: ItemStatus;
  /** Plain-English, owner-actionable message. */
  message: string;
  /** True when the owner must re-authenticate the connection (Fix connection). */
  needsUserAction: boolean;
};

/**
 * Map a Plaid item error_code (or null when the item is healthy) to our status
 * enum plus a plain-English message. Unknown codes fall through to a generic
 * "error" so we never crash on a code Plaid adds later.
 */
export function mapItemStatus(errorCode: string | null | undefined): ItemStatusView {
  const code = (errorCode ?? "").trim().toUpperCase();

  if (code === "") {
    return { status: "healthy", message: "Connection is healthy.", needsUserAction: false };
  }

  switch (code) {
    case "ITEM_LOGIN_REQUIRED":
    case "INVALID_CREDENTIALS":
    case "INVALID_MFA":
    case "ITEM_LOCKED":
      return {
        status: "login_required",
        message:
          'Your bank needs you to sign in again. Click "Fix connection" and re-enter your login to restore syncing.',
        needsUserAction: true,
      };
    case "PENDING_DISCONNECT":
    case "PENDING_EXPIRATION":
      return {
        status: "pending_disconnect",
        message:
          'This connection will stop working soon and needs to be refreshed. Click "Fix connection" to keep it active.',
        needsUserAction: true,
      };
    case "INSTITUTION_DOWN":
    case "INSTITUTION_NOT_RESPONDING":
    case "INSTITUTION_NO_LONGER_SUPPORTED":
      return {
        status: "error",
        message: "The bank is temporarily unavailable. This usually clears on its own; we'll keep retrying.",
        needsUserAction: false,
      };
    case "RATE_LIMIT_EXCEEDED":
      return {
        status: "error",
        message: "Too many requests to the bank right now. Syncing will resume automatically shortly.",
        needsUserAction: false,
      };
    default:
      return {
        status: "error",
        message: `The connection reported an issue (${code}). We'll keep retrying; if it persists, use "Fix connection".`,
        needsUserAction: false,
      };
  }
}

// ---------------------------------------------------------------------------
// 3b) Plaid error extraction + link-token error guidance
// ---------------------------------------------------------------------------

/** The bits of a Plaid API error we can safely read + surface. */
export type PlaidErrorInfo = {
  /** Machine code, e.g. "INVALID_API_KEYS". null if we couldn't find one. */
  code: string | null;
  /** Plaid's technical message (safe for server logs; may name the request). */
  message: string | null;
  /** Plaid's user-safe display_message, when present. */
  display: string | null;
  /** Plaid's error_type bucket, e.g. "INVALID_INPUT". null if absent. */
  type: string | null;
  /**
   * Plaid's request_id — present on EVERY Plaid error body. This is the single
   * value Plaid Support asks for, and it is NOT a secret, so it is safe to show
   * the owner so they can quote it. null if absent.
   */
  requestId: string | null;
};

/**
 * Pull the Plaid error fields out of an unknown thrown value. Plaid errors
 * arrive as an axios error whose body is at `err.response.data`. This never
 * throws and never assumes a shape — anything missing comes back null. PURE.
 */
export function extractPlaidError(err: unknown): PlaidErrorInfo {
  const out: PlaidErrorInfo = { code: null, message: null, display: null, type: null, requestId: null };
  if (err && typeof err === "object") {
    const anyErr = err as {
      response?: {
        data?: {
          error_code?: unknown;
          error_message?: unknown;
          display_message?: unknown;
          error_type?: unknown;
          request_id?: unknown;
        };
      };
    };
    const data = anyErr.response?.data;
    if (data && typeof data === "object") {
      if (typeof data.error_code === "string" && data.error_code.trim() !== "") out.code = data.error_code;
      if (typeof data.error_message === "string" && data.error_message.trim() !== "") out.message = data.error_message;
      if (typeof data.display_message === "string" && data.display_message.trim() !== "") out.display = data.display_message;
      if (typeof data.error_type === "string" && data.error_type.trim() !== "") out.type = data.error_type;
      if (typeof data.request_id === "string" && data.request_id.trim() !== "") out.requestId = data.request_id;
    }
  }
  return out;
}

/**
 * Map a /link/token/create failure error_code to a specific, owner-actionable
 * sentence (plain English, no jargon). CRITICAL: the four "keys" codes each have
 * a DIFFERENT real cause and fix per Plaid's official docs
 * (https://plaid.com/docs/errors/invalid-input), so we DO NOT collapse them into
 * one generic line anymore — that hid the single fact needed to fix it. Unknown
 * codes get a safe generic line that echoes the code. PURE.
 */
export function describeLinkTokenCode(errorCode: string | null | undefined): string {
  const code = (errorCode ?? "").trim().toUpperCase();
  switch (code) {
    case "":
      return "Couldn't start the bank connection. Please try again in a moment.";
    case "UNAUTHORIZED_ENVIRONMENT":
      // Plaid: "you are not authorized to create items in this api environment."
      // = the client ID is NOT enabled for Production yet (Production access not
      // granted/approved). Having a Production key is not the same as being
      // approved for Production. This is the most likely cause when the keys are
      // "correct" but the connection is still rejected.
      return "Your Plaid client ID isn't approved for the Production environment yet. In the Plaid Dashboard, confirm your app is enabled for Production (request/complete Production access if it's still pending), then try again.";
    case "INVALID_API_KEYS":
    case "INVALID_CLIENT_ID":
    case "INVALID_SECRET":
      // Plaid: "invalid client_id or secret provided" = keys not valid FOR THE
      // ENVIRONMENT being used (e.g. a Sandbox secret while PLAID_ENV=production).
      return "Plaid rejected the client ID or secret for this environment. In Vercel, make sure PLAID_ENV is \"production\" and PLAID_SECRET is your Production secret (not the Sandbox one) — then REDEPLOY so the new values take effect.";
    case "PRODUCTS_NOT_SUPPORTED":
    case "PRODUCT_NOT_ENABLED":
    case "PRODUCT_NOT_READY":
      return "The Transactions product isn't enabled on this Plaid account yet. Enable Transactions (or request Production access) in the Plaid Dashboard, then try again.";
    case "INVALID_FIELD":
    case "INVALID_BODY":
    case "INVALID_WEBHOOK_VERIFICATION_KEY_ID":
      return "Plaid rejected part of the connection request (often the webhook URL). Set NEXT_PUBLIC_SITE_URL in Vercel to your live https:// address, then try again.";
    case "INVALID_PRODUCT":
      return "This Plaid account can't use one of the requested products (Transactions). Request Transactions/Production access in the Plaid Dashboard, then try again.";
    case "ADDITIONAL_CONSENT_REQUIRED":
      return "Plaid needs additional consent configured for this account. Review your Plaid Dashboard settings, then try again.";
    case "INTERNAL_SERVER_ERROR":
    case "PLANNED_MAINTENANCE":
      return "Plaid is temporarily unavailable. Please try again in a few minutes.";
    case "RATE_LIMIT_EXCEEDED":
      return "Too many requests to Plaid right now. Please wait a moment and try again.";
    default:
      return `Couldn't start the bank connection (${code}). Please try again; if it keeps happening, share this code.`;
  }
}

/**
 * Build the full owner-facing link-token error string: the actionable sentence
 * PLUS a safe diagnostic tail `[CODE · request_id: ...]`. Neither the code nor
 * the request_id is a secret (they carry no key material), and both are exactly
 * what Plaid Support — and we — need to pin down the true cause. Accepts the full
 * PlaidErrorInfo so a bare code still works via `describeLinkTokenCode`. PURE.
 */
export function describeLinkTokenError(info: PlaidErrorInfo | string | null | undefined): string {
  // Back-compat: a bare code string still maps to the sentence (no tail).
  if (info === null || info === undefined || typeof info === "string") {
    return describeLinkTokenCode(info ?? null);
  }
  const sentence = describeLinkTokenCode(info.code);
  const bits: string[] = [];
  if (info.code) bits.push(info.code);
  if (info.requestId) bits.push(`request_id: ${info.requestId}`);
  if (bits.length === 0) return sentence;
  return `${sentence} [${bits.join(" · ")}]`;
}

// ---------------------------------------------------------------------------
// 4) Transaction merge planner (idempotent upsert / soft-delete)
// ---------------------------------------------------------------------------

/** A normalized, storage-ready transaction row (money already in cents). */
export type NormalizedTxn = {
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
  raw: unknown;
};

/**
 * The raw shape we accept from Plaid's /transactions/sync (only the fields we
 * use; `raw` keeps the whole payload). Amount is DOLLARS here.
 */
export type PlaidTxnInput = {
  transaction_id: string;
  account_id: string;
  amount: number;
  date: string;
  authorized_date?: string | null;
  name?: string | null;
  merchant_name?: string | null;
  personal_finance_category?: { primary?: string | null; detailed?: string | null } | null;
  pending?: boolean;
  pending_transaction_id?: string | null;
  payment_channel?: string | null;
  iso_currency_code?: string | null;
};

export type TxnMergePlan = {
  /** Rows to insert-or-update (dedup key = transaction_id). */
  upserts: NormalizedTxn[];
  /** transaction_ids to soft-delete (set removed=true). */
  removals: string[];
  /** Rows we skipped because the amount was unparseable (defensive). */
  skipped: { transaction_id: string; reason: string }[];
};

/** Normalize a single Plaid transaction to our storage shape (or a skip). */
export function normalizeTxn(
  t: PlaidTxnInput,
): { ok: true; row: NormalizedTxn } | { ok: false; reason: string } {
  const cents = plaidDollarsToCents(t.amount);
  if (cents === null) return { ok: false, reason: "unparseable amount" };
  if (!t.transaction_id || !t.account_id) return { ok: false, reason: "missing id" };
  return {
    ok: true,
    row: {
      transaction_id: t.transaction_id,
      account_id: t.account_id,
      amount_cents: cents,
      date: t.date,
      authorized_date: t.authorized_date ?? null,
      name: t.name ?? null,
      merchant_name: t.merchant_name ?? null,
      personal_finance_category_primary: t.personal_finance_category?.primary ?? null,
      personal_finance_category_detailed: t.personal_finance_category?.detailed ?? null,
      pending: !!t.pending,
      pending_transaction_id: t.pending_transaction_id ?? null,
      payment_channel: t.payment_channel ?? null,
      raw: t,
    },
  };
}

/**
 * Build an idempotent merge plan from a /transactions/sync delta.
 *
 * - `added` and `modified` both become upserts keyed on transaction_id, so
 *   replaying the same delta is safe (idempotent). The pending → posted
 *   transition is just a `modified` row whose `pending` flips to false and
 *   which carries the same transaction_id (Plaid keeps the id stable for that
 *   account), so no special-casing is needed here — the upsert handles it.
 * - `removed` become soft-delete removals (we never hard-delete: audit-friendly).
 * - unparseable rows are recorded in `skipped` rather than silently dropped.
 */
export function planTransactionMerge(delta: {
  added?: PlaidTxnInput[];
  modified?: PlaidTxnInput[];
  removed?: { transaction_id: string }[];
}): TxnMergePlan {
  const upserts: NormalizedTxn[] = [];
  const skipped: { transaction_id: string; reason: string }[] = [];

  const takeAll = (list: PlaidTxnInput[] | undefined) => {
    for (const t of list ?? []) {
      const r = normalizeTxn(t);
      if (r.ok) upserts.push(r.row);
      else skipped.push({ transaction_id: t.transaction_id ?? "(unknown)", reason: r.reason });
    }
  };

  takeAll(delta.added);
  takeAll(delta.modified);

  const removals = (delta.removed ?? [])
    .map((r) => r.transaction_id)
    .filter((id): id is string => !!id);

  return { upserts, removals, skipped };
}

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts + vitest wrapper)
// ---------------------------------------------------------------------------

export function __runPlaidCoreTests(): void {
  let failures = 0;
  const expect = (name: string, cond: boolean) => {
    if (cond) {
      console.log(`  ok - ${name}`);
    } else {
      failures += 1;
      console.error(`  FAIL - ${name}`);
    }
  };

  // --- plaidDollarsToCents (money boundary, sign preserved) ---
  expect("cents: 19.99 → 1999", plaidDollarsToCents(19.99) === 1999);
  expect("cents: 0 → 0", plaidDollarsToCents(0) === 0);
  expect("cents: -50 → -5000 (inflow sign preserved)", plaidDollarsToCents(-50) === -5000);
  expect("cents: string '12.34' → 1234", plaidDollarsToCents("12.34") === 1234);
  expect("cents: 12.005 → 1201 (half up, epsilon)", plaidDollarsToCents(12.005) === 1201);
  expect("cents: -12.005 → -1201 (symmetric)", plaidDollarsToCents(-12.005) === -1201);
  expect("cents: 1234.5 → 123450", plaidDollarsToCents(1234.5) === 123450);
  expect("cents: null → null", plaidDollarsToCents(null) === null);
  expect("cents: undefined → null", plaidDollarsToCents(undefined) === null);
  expect("cents: '' → null", plaidDollarsToCents("") === null);
  expect("cents: 'abc' → null", plaidDollarsToCents("abc") === null);
  expect("cents: NaN → null", plaidDollarsToCents(NaN) === null);
  expect("cents: Infinity → null", plaidDollarsToCents(Infinity) === null);

  // --- validateAccountRole ---
  expect("role: main ok", (() => { const r = validateAccountRole("main"); return r.ok && r.role === "main"; })());
  expect("role: ATM (case) → atm", (() => { const r = validateAccountRole("ATM"); return r.ok && r.role === "atm"; })());
  expect("role: credit ok", (() => { const r = validateAccountRole("credit"); return r.ok && r.role === "credit"; })());
  expect("role: savings ok (new)", (() => { const r = validateAccountRole("savings"); return r.ok && r.role === "savings"; })());
  expect("role: reserve ok (new)", (() => { const r = validateAccountRole("reserve"); return r.ok && r.role === "reserve"; })());
  expect("role: mortgage ok (new)", (() => { const r = validateAccountRole("mortgage"); return r.ok && r.role === "mortgage"; })());
  expect("role: loan ok (new)", (() => { const r = validateAccountRole("loan"); return r.ok && r.role === "loan"; })());
  expect("role: personal ok (new)", (() => { const r = validateAccountRole("personal"); return r.ok && r.role === "personal"; })());
  expect("role: 'PERSONAL' (case) → personal", (() => { const r = validateAccountRole("PERSONAL"); return r.ok && r.role === "personal"; })());
  expect("role: '' → null (unassigned)", (() => { const r = validateAccountRole(""); return r.ok && r.role === null; })());
  expect("role: 'none' → null", (() => { const r = validateAccountRole("none"); return r.ok && r.role === null; })());
  expect("role: null → null", (() => { const r = validateAccountRole(null); return r.ok && r.role === null; })());
  expect("role: garbage → error", (() => { const r = validateAccountRole("banana"); return !r.ok; })());
  expect("ACCOUNT_ROLES has 8 entries", ACCOUNT_ROLES.length === 8);
  expect("ACCOUNT_ROLES includes main (reconciliation)", (ACCOUNT_ROLES as readonly string[]).includes("main"));

  // --- mapItemStatus ---
  expect("status: null → healthy", (() => { const s = mapItemStatus(null); return s.status === "healthy" && !s.needsUserAction; })());
  expect("status: ITEM_LOGIN_REQUIRED → login_required + action", (() => { const s = mapItemStatus("ITEM_LOGIN_REQUIRED"); return s.status === "login_required" && s.needsUserAction; })());
  expect("status: lower-case login req still maps", (() => { const s = mapItemStatus("item_login_required"); return s.status === "login_required"; })());
  expect("status: PENDING_DISCONNECT → pending_disconnect + action", (() => { const s = mapItemStatus("PENDING_DISCONNECT"); return s.status === "pending_disconnect" && s.needsUserAction; })());
  expect("status: INSTITUTION_DOWN → error, no user action", (() => { const s = mapItemStatus("INSTITUTION_DOWN"); return s.status === "error" && !s.needsUserAction; })());
  expect("status: unknown code → error + echoes code", (() => { const s = mapItemStatus("SOME_NEW_CODE"); return s.status === "error" && s.message.includes("SOME_NEW_CODE"); })());
  expect("status: healthy message is plain english", mapItemStatus("").message.length > 0);

  // --- extractPlaidError (axios error body) ---
  expect("extractPlaidError: reads request_id + type", (() => {
    const e = extractPlaidError({ response: { data: { error_code: "UNAUTHORIZED_ENVIRONMENT", error_type: "INVALID_INPUT", request_id: "HNTDNrA8F1shFEW" } } });
    return e.code === "UNAUTHORIZED_ENVIRONMENT" && e.type === "INVALID_INPUT" && e.requestId === "HNTDNrA8F1shFEW";
  })());
  expect("extractPlaidError: blank request_id \u2192 null", (() => {
    const e = extractPlaidError({ response: { data: { error_code: "X", request_id: "   " } } });
    return e.requestId === null;
  })());
  expect("extractPlaidError: reads code/message/display", (() => {
    const e = extractPlaidError({ response: { data: { error_code: "INVALID_API_KEYS", error_message: "bad keys", display_message: "Please retry." } } });
    return e.code === "INVALID_API_KEYS" && e.message === "bad keys" && e.display === "Please retry.";
  })());
  expect("extractPlaidError: missing body \u2192 all null", (() => {
    const e = extractPlaidError(new Error("network"));
    return e.code === null && e.message === null && e.display === null;
  })());
  expect("extractPlaidError: null input \u2192 all null", (() => {
    const e = extractPlaidError(null);
    return e.code === null && e.message === null && e.display === null;
  })());
  expect("extractPlaidError: blank code \u2192 null", (() => {
    const e = extractPlaidError({ response: { data: { error_code: "   " } } });
    return e.code === null;
  })());

  // --- describeLinkTokenError ---
  // describeLinkTokenCode (bare-code sentence)
  expect("linkErr: null \u2192 generic", describeLinkTokenCode(null).length > 0);
  expect("linkErr: INVALID_API_KEYS \u2192 mentions secret + redeploy", describeLinkTokenCode("INVALID_API_KEYS").toLowerCase().includes("secret") && describeLinkTokenCode("INVALID_API_KEYS").toLowerCase().includes("redeploy"));
  expect("linkErr: UNAUTHORIZED_ENVIRONMENT \u2192 distinct (Production approval)", describeLinkTokenCode("UNAUTHORIZED_ENVIRONMENT").toLowerCase().includes("production") && describeLinkTokenCode("UNAUTHORIZED_ENVIRONMENT").toLowerCase().includes("approved"));
  expect("linkErr: the two key-codes are NOT the same message", describeLinkTokenCode("INVALID_API_KEYS") !== describeLinkTokenCode("UNAUTHORIZED_ENVIRONMENT"));
  expect("linkErr: PRODUCTS_NOT_SUPPORTED \u2192 mentions Transactions", describeLinkTokenCode("PRODUCTS_NOT_SUPPORTED").includes("Transactions"));
  expect("linkErr: INVALID_FIELD \u2192 mentions webhook/site url", describeLinkTokenCode("INVALID_FIELD").toLowerCase().includes("webhook") || describeLinkTokenCode("INVALID_FIELD").includes("NEXT_PUBLIC_SITE_URL"));
  expect("linkErr: case-insensitive", describeLinkTokenCode("unauthorized_environment").toLowerCase().includes("production"));
  expect("linkErr: unknown code echoed", describeLinkTokenCode("SOME_FUTURE_CODE").includes("SOME_FUTURE_CODE"));
  // describeLinkTokenError (info overload + diagnostic tail)
  expect("linkErr: bare string still works (back-compat)", describeLinkTokenError("UNAUTHORIZED_ENVIRONMENT").toLowerCase().includes("production"));
  expect("linkErr: null info \u2192 generic", describeLinkTokenError(null).length > 0);
  expect("linkErr: info appends code + request_id tail", (() => {
    const s = describeLinkTokenError({ code: "UNAUTHORIZED_ENVIRONMENT", message: null, display: null, type: "INVALID_INPUT", requestId: "REQ123" });
    return s.includes("UNAUTHORIZED_ENVIRONMENT") && s.includes("request_id: REQ123");
  })());
  expect("linkErr: info with no code/request_id \u2192 no tail brackets", (() => {
    const s = describeLinkTokenError({ code: null, message: null, display: null, type: null, requestId: null });
    return !s.includes("[");
  })());

  // --- normalizeTxn / planTransactionMerge ---
  const sampleAdded: PlaidTxnInput = {
    transaction_id: "txn_1",
    account_id: "acc_1",
    amount: 19.99,
    date: "2026-01-05",
    name: "Coffee",
    merchant_name: "Cafe",
    personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_COFFEE" },
    pending: true,
    payment_channel: "in store",
  };
  const n1 = normalizeTxn(sampleAdded);
  expect("normalizeTxn: ok", n1.ok);
  expect("normalizeTxn: amount → cents", n1.ok && n1.row.amount_cents === 1999);
  expect("normalizeTxn: pending true", n1.ok && n1.row.pending === true);
  expect("normalizeTxn: pfc primary mapped", n1.ok && n1.row.personal_finance_category_primary === "FOOD_AND_DRINK");
  expect("normalizeTxn: raw retained", n1.ok && n1.row.raw === sampleAdded);

  const badAmount = normalizeTxn({ transaction_id: "txn_bad", account_id: "acc_1", amount: NaN, date: "2026-01-05" });
  expect("normalizeTxn: NaN amount → skip", !badAmount.ok);
  const badId = normalizeTxn({ transaction_id: "", account_id: "acc_1", amount: 1, date: "2026-01-05" });
  expect("normalizeTxn: missing id → skip", !badId.ok);

  const plan = planTransactionMerge({
    added: [sampleAdded],
    modified: [
      // same txn_1, now posted (pending flips false) — upsert handles the transition
      { ...sampleAdded, pending: false },
      { transaction_id: "txn_2", account_id: "acc_1", amount: -50, date: "2026-01-06" },
    ],
    removed: [{ transaction_id: "txn_9" }, { transaction_id: "" }],
  });
  expect("plan: 3 upserts (added + 2 modified)", plan.upserts.length === 3);
  expect("plan: pending→posted present as upsert", plan.upserts.some((u) => u.transaction_id === "txn_1" && u.pending === false));
  expect("plan: inflow sign preserved (-5000)", plan.upserts.some((u) => u.transaction_id === "txn_2" && u.amount_cents === -5000));
  expect("plan: 1 removal (blank id filtered)", plan.removals.length === 1 && plan.removals[0] === "txn_9");
  expect("plan: no skips on good data", plan.skipped.length === 0);

  const planWithBad = planTransactionMerge({ added: [{ transaction_id: "t", account_id: "a", amount: Infinity, date: "2026-01-05" }] });
  expect("plan: bad amount recorded in skipped", planWithBad.skipped.length === 1 && planWithBad.upserts.length === 0);

  if (failures > 0) {
    throw new Error(`plaid-core self-tests FAILED (${failures} failing)`);
  }
  console.log("plaid-core: all self-tests passed");
}
