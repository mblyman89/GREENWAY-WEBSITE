"use server";

/**
 * /admin/plaid server actions — Plaid Slice P2 (Connect flow).
 *
 * Gate: requirePermission("settings.manage") (owner + admin only — same as
 * Banking / ATM / Payroll). Mirrors src/app/admin/atm/actions.ts: gate → do the
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
import { plaidDollarsToCents } from "@/lib/plaid/plaid-core";
import { roleAssignmentCheck } from "@/lib/plaid/plaid-ui-core";
import {
  upsertPlaidItem,
  upsertPlaidAccount,
  listPlaidAccounts,
  setPlaidAccountRole,
} from "@/lib/plaid/store";

const ROOT = "/admin/plaid";

/** Days of transaction history to request up front (bible §SLICE P2). */
const TRANSACTIONS_DAYS_REQUESTED = 730;

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
export async function createPlaidLinkTokenAction(): Promise<
  { ok: true; linkToken: string } | { ok: false; error: string }
> {
  const session = await requirePermission("settings.manage");

  const plaid = getPlaidClient();
  if (!plaid) {
    return { ok: false, error: "Plaid isn't configured yet. Add the Plaid keys in Vercel, then try again." };
  }

  try {
    const resp = await plaid.linkTokenCreate({
      user: { client_user_id: session.profile.id },
      client_name: "Greenway Marijuana",
      products: [Products.Transactions],
      transactions: { days_requested: TRANSACTIONS_DAYS_REQUESTED },
      country_codes: [CountryCode.Us],
      language: "en",
      webhook: `${siteBaseUrl()}/api/webhooks/plaid`,
    });
    const linkToken = resp.data.link_token;
    if (!linkToken) return { ok: false, error: "Plaid did not return a link token. Please try again." };
    return { ok: true, linkToken };
  } catch {
    // Never surface the raw Plaid error (may echo request context); keep it friendly.
    return { ok: false, error: "Couldn't start the bank connection. Please try again in a moment." };
  }
}

/**
 * Exchange the public_token the browser produced after a successful Link, store
 * the item (token encrypted), then pull the accounts and store them. Called from
 * the client on Link success (returns a result the client uses to refresh).
 */
export async function exchangePlaidPublicTokenAction(
  publicToken: string,
): Promise<{ ok: true; accounts: number } | { ok: false; error: string }> {
  const session = await requirePermission("settings.manage");

  const token = (publicToken ?? "").trim();
  if (!token) return { ok: false, error: "Missing connection token from Plaid. Please try connecting again." };

  const plaid = getPlaidClient();
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

  // Record the item (access_token encrypted inside the store).
  const itemResult = await upsertPlaidItem({
    itemId,
    accessToken,
    institutionId,
    institutionName,
    products: [Products.Transactions],
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
  const session = await requirePermission("settings.manage");

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
