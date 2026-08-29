"use server";

/**
 * /admin/plaid server actions — Plaid Slice P2 (Connect flow).
 *
 * Gate: requirePermission("finances.view") — OWNER ONLY as of slice books-06
 * (was owner+admin under settings.manage). Migration 0190 re-gates the plaid_*
 * tables to is_owner() to match. Mirrors src/app/admin/atm/actions.ts: gate → do the
 * work in the server-only store (secrets encrypted there) → write an audit entry
 * with NO secret → revalidate + redirect back with a friendly msg/error.
 *
 * Three actions:
 *   • createPlaidLinkTokenAction     — mint a short-lived link_token for the
 *                                      browser to open Plaid Link. Transactions
 *                                      product, 730 days of history, webhook set.
 *   • exchangePlaidPublicTokenAction — after the user finishes Link, exchange the
 *                                      public_token → access_token (ENCRYPTED at
 *                                      rest by the store), record the item, then
 *                                      pull /accounts/get and record each account.
 *                                      Audit: plaid.item.linked.
 *   • assignPlaidAccountRoleAction   — owner tags an account main|atm|credit (or
 *                                      clears it). Validated + role-unique guarded
 *                                      by plaid-ui-core BEFORE writing.
 *                                      Audit: plaid.account.role_assigned.
 *   • setPlaidAccountNameAction      — owner types a friendly nickname for an
 *                                      account (or clears it). Normalized by
 *                                      plaid-ui-core BEFORE writing; never touches
 *                                      Plaid's own name. Audit: plaid.account.renamed.
 *
 * SECURITY: the Plaid secret lives only in getPlaidClient() (server). The
 * access_token is never returned to the browser and never logged — it goes
 * straight into upsertPlaidItem which encrypts it. Link tokens are safe to send
 * to the client (that is their purpose) and expire in ~4 hours.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CountryCode, Products } from "plaid";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { getPlaidClient } from "@/lib/plaid/client";
import { plaidCredentialSets } from "@/lib/plaid/env";
import { chooseSetForLink } from "@/lib/plaid/plaid-credentials-core";
import { plaidDollarsToCents, extractPlaidError, describeLinkTokenError } from "@/lib/plaid/plaid-core";
import { roleAssignmentCheck, normalizeCustomName } from "@/lib/plaid/plaid-ui-core";
import {
  validateOwnerCode,
  validateBooksEntity,
  ownerCodeLabel,
  booksEntityLabel,
} from "@/lib/plaid/account-classification-core";
import { runAllPlaidSync } from "@/lib/plaid/sync-server";
import { syncItemLiabilities } from "@/lib/plaid/liabilities-server";
import { syncItemInvestments } from "@/lib/plaid/investments-server";
import { removePlaidItem } from "@/lib/plaid/remove-server";
import {
  upsertPlaidItem,
  upsertPlaidAccount,
  listPlaidAccounts,
  setPlaidAccountRole,
  setPlaidAccountCustomName,
  setPlaidAccountOwner,
  setPlaidAccountBooks,
} from "@/lib/plaid/store";

const ROOT = "/admin/plaid";

/**
 * Days of transaction history to request up front. 730 is Plaid's DOCUMENTED
 * MAXIMUM for transactions.days_requested (verified in Plaid's OpenAPI spec:
 * LinkTokenTransactions.days_requested → maximum: 730). This is the furthest
 * back Plaid will backfill at Link time, so Michael gets the deepest history
 * Plaid allows (~24 months). This value can't be raised on an Item after
 * Transactions is added, so we request the max on the very first link.
 */
const TRANSACTIONS_DAYS_REQUESTED = 730;
const PLAID_MAX_DAYS_REQUESTED = 730; // hard ceiling per Plaid spec; keep in sync

function back(qs: { tab?: string; msg?: string; error?: string }): never {
  const p = new URLSearchParams({ tab: qs.tab ?? "connections" });
  if (qs.msg) p.set("msg", qs.msg);
  if (qs.error) p.set("error", qs.error);
  revalidatePath(ROOT);
  redirect(`${ROOT}?${p.toString()}`);
}

/** Public base URL for the webhook (mirror compliance-reminders.ts). */
function siteBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "https://greenwaymarijuana.com").replace(/\/$/, "");
}

/**
 * Mint a link_token for the browser. Returns the token to the client (safe) or a
 * friendly error string. This is called from the client PlaidLinkButton via a
 * server action, so it returns a value rather than redirecting.
 */
export async function createPlaidLinkTokenAction(
  credentialSetKey?: string,
): Promise<{ ok: true; linkToken: string } | { ok: false; error: string }> {
  const session = await requirePermission("finances.view");

  // Pick the credential set to link under (which person's Plaid account). The
  // picker only offers configured sets; we guard again here. Default primary.
  const set = chooseSetForLink(plaidCredentialSets, credentialSetKey);
  if (!set) {
    return { ok: false, error: "That Plaid account isn't configured yet. Add its keys in Vercel, then try again." };
  }

  const plaid = getPlaidClient(set.key);
  if (!plaid) {
    return { ok: false, error: "Plaid isn't configured yet. Add the Plaid keys in Vercel, then try again." };
  }

  const days = Math.min(TRANSACTIONS_DAYS_REQUESTED, PLAID_MAX_DAYS_REQUESTED);

  try {
    const resp = await plaid.linkTokenCreate({
      user: { client_user_id: session.profile.id },
      client_name: "Greenway Marijuana",
      products: [Products.Transactions],
      // Consent (not bill) to Liabilities + Investments up front so we can pull
      // mortgage detail (Sound CU) and, later, investment holdings (Fidelity)
      // WITHOUT re-linking. Per Plaid's personal-finance guidance: keep only
      // Transactions in `products` (max institution coverage), consent to the
      // rest, then call /liabilities/get and /investments/holdings/get post-link
      // — a call that doesn't apply to the Item simply fails and isn't billed.
      additional_consented_products: [Products.Liabilities, Products.Investments],
      transactions: { days_requested: days },
      country_codes: [CountryCode.Us],
      language: "en",
      webhook: `${siteBaseUrl()}/api/webhooks/plaid`,
    });
    const linkToken = resp.data.link_token;
    if (!linkToken) return { ok: false, error: "Plaid did not return a link token. Please try again." };
    return { ok: true, linkToken };
  } catch (err) {
    // Read Plaid's REAL error (code + technical message) and log it server-side
    // ONLY (never to the browser). The owner sees a specific, actionable hint
    // mapped from the code — no raw request context is exposed.
    const info = extractPlaidError(err);
    console.error(
      `[plaid] linkTokenCreate failed — code=${info.code ?? "(none)"} type=${info.type ?? "(none)"} request_id=${info.requestId ?? "(none)"} message=${info.message ?? "(none)"} webhook=${siteBaseUrl()}/api/webhooks/plaid`,
    );
    return { ok: false, error: describeLinkTokenError(info) };
  }
}

/**
 * Exchange the public_token the browser produced after a successful Link, store
 * the item (token encrypted), then pull the accounts and store them. Called from
 * the client on Link success (returns a result the client uses to refresh).
 */
export async function exchangePlaidPublicTokenAction(
  publicToken: string,
  credentialSetKey?: string,
): Promise<{ ok: true; accounts: number } | { ok: false; error: string }> {
  const session = await requirePermission("finances.view");

  const token = (publicToken ?? "").trim();
  if (!token) return { ok: false, error: "Missing connection token from Plaid. Please try connecting again." };

  // Must exchange + fetch accounts with the SAME set that minted the link token.
  const set = chooseSetForLink(plaidCredentialSets, credentialSetKey);
  if (!set) return { ok: false, error: "That Plaid account isn't configured yet." };

  const plaid = getPlaidClient(set.key);
  if (!plaid) return { ok: false, error: "Plaid isn't configured yet." };

  let accessToken: string;
  let itemId: string;
  try {
    const exch = await plaid.itemPublicTokenExchange({ public_token: token });
    accessToken = exch.data.access_token;
    itemId = exch.data.item_id;
  } catch {
    return { ok: false, error: "Couldn't finish connecting your bank. Please try again." };
  }
  if (!accessToken || !itemId) {
    return { ok: false, error: "Plaid returned an incomplete connection. Please try again." };
  }

  // Pull accounts (also gives us the institution + balances for the first render).
  let institutionId: string | null = null;
  let institutionName: string | null = null;
  let accounts: Awaited<ReturnType<typeof plaid.accountsGet>>["data"]["accounts"] = [];
  try {
    const acctResp = await plaid.accountsGet({ access_token: accessToken });
    accounts = acctResp.data.accounts ?? [];
    institutionId = acctResp.data.item?.institution_id ?? null;
    institutionName = acctResp.data.item?.institution_name ?? null;
  } catch {
    // Non-fatal: we still record the item so the connection isn't lost; accounts
    // will fill in on the first sync (P3) or a manual refresh.
    accounts = [];
  }

  // Record the item (access_token encrypted inside the store), tagged with the
  // credential set it was linked under + that set's owner label (for grouping).
  const itemResult = await upsertPlaidItem({
    itemId,
    accessToken,
    institutionId,
    institutionName,
    products: [Products.Transactions],
    credentialSet: set.key,
    owner: set.owner,
  });
  if (!itemResult.ok) return { ok: false, error: itemResult.error };

  // Record each account (balances in CENTS via the pure converter).
  let recorded = 0;
  for (const a of accounts) {
    const res = await upsertPlaidAccount({
      accountId: a.account_id,
      itemId,
      name: a.name ?? null,
      officialName: a.official_name ?? null,
      mask: a.mask ?? null,
      type: a.type ? String(a.type) : null,
      subtype: a.subtype ? String(a.subtype) : null,
      currentBalanceCents: plaidDollarsToCents(a.balances?.current ?? null),
      availableBalanceCents: plaidDollarsToCents(a.balances?.available ?? null),
      isoCurrencyCode: a.balances?.iso_currency_code ?? "USD",
    });
    if (res.ok) recorded += 1;
  }

  // Best-effort: pull mortgage detail (Plaid Liabilities) right after linking so
  // Sound CU's home loan shows up immediately, not only on the next "Sync now".
  // Accounts are recorded above first (the mortgage row FKs to an account).
  // Never throws; items without a mortgage / Liabilities consent store nothing.
  try {
    await syncItemLiabilities({ accessToken, credentialSet: set.key });
  } catch {
    /* best-effort enrichment; a failure here must not fail the link */
  }

  // Best-effort: pull investment holdings (Plaid Investments) right after
  // linking so a brokerage (Fidelity) shows its positions immediately, not
  // only on the next "Sync now". Never throws; non-brokerage items store nothing.
  try {
    await syncItemInvestments({ accessToken, credentialSet: set.key });
  } catch {
    /* best-effort enrichment; a failure here must not fail the link */
  }

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.profile.email,
    action: "plaid.item.linked",
    entityType: "plaid_item",
    entityId: itemId,
    after: {
      item_id: itemId,
      institution_id: institutionId,
      institution_name: institutionName,
      accounts_recorded: recorded,
      products: [Products.Transactions],
      credential_set: set.key,
      owner: set.owner,
    },
  });

  return { ok: true, accounts: recorded };
}

/**
 * Assign (or clear) an account's owner-chosen role. Validated + role-unique
 * guarded by the pure core BEFORE writing so a role can't be double-assigned.
 * Redirects back to the Health tab with a friendly result.
 */
export async function assignPlaidAccountRoleAction(formData: FormData): Promise<void> {
  const session = await requirePermission("finances.view");

  const accountId = String(formData.get("account_id") ?? "").trim();
  const requestedRole = String(formData.get("role") ?? "");
  if (!accountId) back({ tab: "health", error: "Missing account. Please try again." });

  // Load the current assignments so the guard can enforce one-account-per-role.
  const accounts = await listPlaidAccounts();
  const existing = accounts.map((a) => ({ accountId: a.accountId, role: a.role }));

  const check = roleAssignmentCheck(accountId, requestedRole, existing);
  if (!check.ok) back({ tab: "health", error: check.error });

  const result = await setPlaidAccountRole(accountId, check.role);
  if (!result.ok) back({ tab: "health", error: result.error });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.profile.email,
    action: "plaid.account.role_assigned",
    entityType: "plaid_account",
    entityId: accountId,
    after: { account_id: accountId, role: check.role },
  });

  back({
    tab: "health",
    msg: check.role ? `Account role set to "${check.role}".` : "Account role cleared.",
  });
}

/**
 * Set (or clear) an account's owner-assigned nickname so Michael can label each
 * connected account in plain English (e.g. "Timberland Checking", "Wife's Citi
 * Costco Visa"). The name is normalized in the PURE core (trimmed, whitespace
 * collapsed, length-capped, blank -> cleared) BEFORE it's written, and it never
 * touches Plaid's own `name` (a re-sync can't clobber it). Redirects back to the
 * Health tab with a friendly result. Audit: plaid.account.renamed.
 */
export async function setPlaidAccountNameAction(formData: FormData): Promise<void> {
  const session = await requirePermission("finances.view");

  const accountId = String(formData.get("account_id") ?? "").trim();
  if (!accountId) back({ tab: "health", error: "Missing account. Please try again." });

  const customName = normalizeCustomName(String(formData.get("custom_name") ?? ""));

  const result = await setPlaidAccountCustomName(accountId, customName);
  if (!result.ok) back({ tab: "health", error: result.error });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.profile.email,
    action: "plaid.account.renamed",
    entityType: "plaid_account",
    entityId: accountId,
    after: { account_id: accountId, custom_name: customName },
  });

  back({
    tab: "health",
    msg: customName ? `Account named "${customName}".` : "Account name cleared.",
  });
}

/**
 * Say WHOSE account this is (migration 0213, D-80).
 *
 * Owner is a fact about the account, not an accounting decision: it drives
 * reporting, net worth and knowing who to ask, and it deliberately has NO
 * effect on which ledger an entry lands in. Michael's Citi Mastercard is his
 * own card and belongs entirely to Greenway's books.
 */
export async function setPlaidAccountOwnerAction(formData: FormData): Promise<void> {
  const session = await requirePermission("finances.view");

  const accountId = String(formData.get("account_id") ?? "").trim();
  if (!accountId) back({ tab: "health", error: "Missing account. Please try again." });

  const checked = validateOwnerCode(String(formData.get("owner_code") ?? ""));
  if (!checked.ok) back({ tab: "health", error: checked.error });

  const result = await setPlaidAccountOwner(accountId, checked.owner);
  if (!result.ok) back({ tab: "health", error: result.error });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.profile.email,
    action: "plaid.account.owner_assigned",
    entityType: "plaid_account",
    entityId: accountId,
    after: { account_id: accountId, owner_code: checked.owner },
  });

  back({
    tab: "health",
    msg: checked.owner
      ? `Account marked as ${ownerCodeLabel(checked.owner)}'s.`
      : "Account owner cleared.",
  });
}

/**
 * Say WHICH SET OF BOOKS this account belongs to (migration 0213, D-80).
 *
 * This is the one that changes the numbers. Until books-101 the entity of a
 * posted expense came from the merchant rule, so the same Amazon charge landed
 * in Greenway whoever swiped. From here the ACCOUNT decides, and an account on
 * personal books never posts to a business ledger.
 *
 * Clearing is allowed and makes the account inert again: it keeps syncing and
 * stops posting, which is the safe direction to be wrong in.
 */
export async function setPlaidAccountBooksAction(formData: FormData): Promise<void> {
  const session = await requirePermission("finances.view");

  const accountId = String(formData.get("account_id") ?? "").trim();
  if (!accountId) back({ tab: "health", error: "Missing account. Please try again." });

  const checked = validateBooksEntity(String(formData.get("books_entity") ?? ""));
  if (!checked.ok) back({ tab: "health", error: checked.error });

  const result = await setPlaidAccountBooks(accountId, checked.books);
  if (!result.ok) back({ tab: "health", error: result.error });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.profile.email,
    action: "plaid.account.books_assigned",
    entityType: "plaid_account",
    entityId: accountId,
    after: { account_id: accountId, books_entity: checked.books },
  });

  back({
    tab: "health",
    msg: checked.books
      ? `Account set to the ${booksEntityLabel(checked.books)} books.`
      : "Account books cleared. It will keep syncing, but nothing from it will post.",
  });
}

/**
 * "Sync now" — manually pull the latest transactions for every linked bank
 * connection (bible §SLICE P3). Delegates to the server-only sync driver, which
 * is best-effort and NEVER throws to the UI: it returns a plain-English summary
 * (how many added / updated / removed) or a friendly problem message per item.
 * We surface that summary on the Health tab and record an audit entry.
 *
 * The driver already persists each connection's resume point (cursor) and any
 * error status in the store, so a partial failure still saves whatever synced.
 */
export async function runPlaidSyncNowAction(): Promise<void> {
  const session = await requirePermission("finances.view");

  const result = await runAllPlaidSync();

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.profile.email,
    action: "plaid.sync.manual",
    entityType: "plaid_sync",
    entityId: "manual",
    after: {
      ok: result.ok,
      items_synced: result.items.length,
      items: result.items.map((i) => ({
        item_id: i.itemId,
        institution_name: i.institutionName,
        ok: i.ok,
        added: i.counts.added,
        modified: i.counts.modified,
        removed: i.counts.removed,
        skipped: i.counts.skipped,
        error_code: i.errorCode ?? null,
      })),
    },
  });

  if (result.ok) back({ tab: "health", msg: result.message });
  back({ tab: "health", error: result.message });
}

/**
 * Remove (disconnect) a whole Plaid connection by its item_id. Revokes the
 * token at Plaid (best-effort), then deletes the local item — which CASCADES to
 * its accounts, transactions, mortgage detail, and holdings. Used to clean up a
 * duplicate re-link. Gated to owner/admin. Redirects back to the Connections
 * tab. Audit: plaid.item.removed.
 */
export async function removePlaidItemAction(formData: FormData): Promise<void> {
  const session = await requirePermission("finances.view");

  const itemId = String(formData.get("item_id") ?? "").trim();
  if (!itemId) back({ tab: "connections", error: "Missing connection. Please try again." });

  const result = await removePlaidItem(itemId);
  if (!result.ok) back({ tab: "connections", error: result.error });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.profile.email,
    action: "plaid.item.removed",
    entityType: "plaid_item",
    entityId: itemId,
    after: { item_id: itemId, revoked_at_plaid: result.revoked },
  });

  back({
    tab: "connections",
    msg: result.revoked
      ? "Connection removed and disconnected from Plaid."
      : "Connection removed. (Couldn't reach Plaid to revoke, but all local data was deleted.)",
  });
}
