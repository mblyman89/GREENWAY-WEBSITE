/**
 * /admin/plaid — Bank Feeds (Plaid) back office. Slice P2: the Connect flow +
 * page skeleton + Health v0.
 *
 * Owner (Michael, Greenway Marijuana) connects his OWN business bank + credit
 * accounts here (first-party, read-only bookkeeping). This page is the single
 * home for those connections:
 *   Tab 1 — Connections (opens first): the "Connect a bank account" button
 *           (Plaid Link) + the list of linked institutions and their accounts.
 *   Tab 2 — Health: per-item status (plain English) + the role picker
 *           (tag each account main | atm | credit, one account per role).
 *
 * Gate: finances.view = OWNER ONLY (slice books-06). Was settings.manage
 * (owner+admin) until migration 0190 re-gated the six plaid_* tables behind this
 * page from is_staff() to is_owner(). plaid_items holds the Plaid ACCESS TOKEN,
 * which is a key, not a report -- it was the single most exposed row in the app.
 * Renders even when Plaid or the DB isn't configured (unconfigured-friendly
 * card), so the site keeps building/deploying before the keys are set.
 *
 * SECURITY: bank passwords are entered inside Plaid's own secure modal — we
 * never see them. The access_token is exchanged and encrypted server-side and
 * is NEVER sent to the browser (see actions.ts / store.ts). Everything the page
 * renders is non-sensitive (institution name, last-4 mask, balances, role).
 *
 * Slices ahead: P3 pulls transactions on a schedule, P4 adds the webhook.
 *
 * Slice P5 (this file) adds a third tab — Money — a master–detail screen: a
 * LEFT sidebar lists every account grouped by institution (nickname + balance),
 * and the RIGHT detail panel shows the selected account's four money views:
 *   Activity (statement) · Money in & out (net) · Where it goes (categories) ·
 *   Pending. All money math lives in the PURE plaid-money-core (cents, Plaid
 *   sign preserved). The owner (Michael/Wife) grouping level drops in above
 *   institution when the 2nd-Plaid-API slice adds that tag — no rework here.
 *
 * P6 will reconcile against payroll/vendor payments and roll NET up to income.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { isPlaidConfigured, plaidEnv, plaidCredentialSets } from "@/lib/plaid/env";
import { linkSetOptions, multipleSetsConfigured } from "@/lib/plaid/plaid-credentials-core";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { isAtRestEncryptionConfigured } from "@/lib/security/at-rest-crypto";
import { listPlaidItems, listPlaidAccounts, listPlaidTransactions, listPlaidMortgages, listPlaidHoldings } from "@/lib/plaid/store";
import { buildMortgageView, type MortgageView } from "@/lib/plaid/liabilities-core";
import { buildHoldingsAccountView, type HoldingRecord, type HoldingsAccountView } from "@/lib/plaid/investments-core";
import {
  resolvePlaidTab,
  buildItemStatusView,
  buildAccountSummary,
  roleLabel,
  ACCOUNT_ROLE_OPTIONS,
  type PlaidTab,
  type ChipTone,
} from "@/lib/plaid/plaid-ui-core";
import {
  groupAccountsByInstitution,
  groupAccountsByOwnerAndInstitution,
  distinctOwnerCount,
  resolveSelectedAccountId,
  resolveMoneyView,
  moneyViewLabel,
  resolveMoneyRange,
  moneyRangeLabel,
  moneyRangeBounds,
  filterTxnsInRange,
  computeMoneyFlow,
  computeCategoryBreakdown,
  buildActivityRows,
  buildPendingRows,
  type GroupableAccount,
  type MoneyTxn,
  type MoneyView,
  type MoneyRangeKey,
} from "@/lib/plaid/plaid-money-core";
import { ACCOUNT_ROLES } from "@/lib/plaid/plaid-core";
import { PlaidLinkButton } from "./PlaidLinkButton";
import { RemoveConnectionButton } from "./RemoveConnectionButton";
import { assignPlaidAccountRoleAction, runPlaidSyncNowAction, setPlaidAccountNameAction } from "./actions";

export const dynamic = "force-dynamic";

const cardCls = "rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-5";
const selectCls =
  "rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white focus:border-emerald-400/50 focus:outline-none";
const btnGhost =
  "rounded-[var(--admin-radius)] border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/[0.06]";

function tabCls(active: boolean): string {
  return `rounded-[var(--admin-radius)] px-4 py-2 text-sm font-semibold ${
    active ? "bg-emerald-500 text-emerald-950" : "border border-white/15 text-white/70 hover:bg-white/[0.06]"
  }`;
}

/** Today's date as "YYYY-MM-DD" (UTC), the reference for money-range bounds. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Sub-tab pill for the money detail panel (Activity / Money in & out / …). */
function subTabCls(active: boolean): string {
  return `rounded-full px-3 py-1.5 text-xs font-semibold ${
    active ? "bg-emerald-500 text-emerald-950" : "border border-white/15 text-white/70 hover:bg-white/[0.06]"
  }`;
}

function chipCls(tone: ChipTone): string {
  if (tone === "green") return "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-300";
  if (tone === "orange") return "border-amber-500/40 bg-amber-500/[0.08] text-amber-300";
  if (tone === "red") return "border-red-500/30 bg-red-500/[0.06] text-red-300";
  return "border-white/15 bg-white/[0.04] text-white/70";
}

export default async function PlaidPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    msg?: string;
    error?: string;
    account?: string;
    view?: string;
    range?: string;
  }>;
}) {
  await requirePermission("finances.view");
  const sp = await searchParams;
  const tab: PlaidTab = resolvePlaidTab(sp.tab);

  const dbReady = isSupabaseServiceConfigured;
  const plaidReady = isPlaidConfigured;
  const encryptionOn = isAtRestEncryptionConfigured();

  const items = dbReady ? await listPlaidItems() : [];
  const accounts = dbReady ? await listPlaidAccounts() : [];
  const mortgages = dbReady ? await listPlaidMortgages() : [];

  // Per-account mortgage detail view (Plaid Liabilities). The remaining
  // principal is the account's current balance; the rest comes from the
  // mortgage record. Keyed by account_id so the detail card can look it up.
  const mortgageViewByAccount = new Map<string, MortgageView>();
  for (const m of mortgages) {
    const acct = accounts.find((a) => a.accountId === m.accountId);
    mortgageViewByAccount.set(
      m.accountId,
      buildMortgageView({ ...m, principalCents: acct?.currentBalanceCents ?? null }),
    );
  }

  // Per-account investment holdings view (Plaid Investments). Group the stored
  // positions by account_id, then build the value-sorted view for each. Keyed
  // by account_id so the detail card can look it up (e.g. Fidelity).
  const holdings = dbReady ? await listPlaidHoldings() : [];
  const holdingsByAccount = new Map<string, HoldingRecord[]>();
  for (const h of holdings) {
    const list = holdingsByAccount.get(h.accountId) ?? [];
    list.push({
      accountId: h.accountId,
      securityId: h.securityId,
      securityName: h.securityName,
      tickerSymbol: h.tickerSymbol,
      securityType: h.securityType,
      quantityMicros: h.quantityMicros,
      institutionPriceCents: h.institutionPriceCents,
      institutionValueCents: h.institutionValueCents,
      costBasisCents: h.costBasisCents,
      isoCurrencyCode: h.isoCurrencyCode,
    });
    holdingsByAccount.set(h.accountId, list);
  }
  const holdingsViewByAccount = new Map<string, HoldingsAccountView>();
  for (const [accountId, recs] of holdingsByAccount) {
    holdingsViewByAccount.set(accountId, buildHoldingsAccountView(recs));
  }

  // Group accounts under their item for display.
  const accountsByItem = new Map<string, typeof accounts>();
  for (const a of accounts) {
    const list = accountsByItem.get(a.itemId) ?? [];
    list.push(a);
    accountsByItem.set(a.itemId, list);
  }

  // ---- Money tab prep (master–detail) -------------------------------------
  // The institution name lives on the ITEM; join it onto each account so the
  // sidebar can group by bank. buildAccountSummary resolves nickname → name.
  const institutionByItem = new Map<string, string | null>();
  const ownerByItem = new Map<string, string | null>();
  for (const it of items) {
    institutionByItem.set(it.itemId, it.institutionName);
    ownerByItem.set(it.itemId, it.owner);
  }

  const groupableAccounts: GroupableAccount[] = accounts.map((a) => {
    const v = buildAccountSummary(a);
    return {
      accountId: a.accountId,
      institutionName: institutionByItem.get(a.itemId) ?? null,
      displayName: v.displayName,
      maskText: v.maskText,
      currentText: v.currentText,
      currentBalanceCents: a.currentBalanceCents,
      role: a.role,
      owner: ownerByItem.get(a.itemId) ?? null,
    };
  });
  const accountGroups = groupAccountsByInstitution(groupableAccounts);
  // When accounts belong to more than one owner (Michael + Wife via the 2nd
  // Plaid API), the sidebar adds an owner header level above the banks.
  const ownerGroups = groupAccountsByOwnerAndInstitution(groupableAccounts);
  const showOwnerLevel = distinctOwnerCount(groupableAccounts) > 1;
  // Configured link sets → one "Connect" button each (owner-labeled). The
  // picker only appears when 2+ sets are configured; otherwise it's the plain
  // single button exactly as before.
  const linkOptions = linkSetOptions(plaidCredentialSets);
  const showLinkPicker = multipleSetsConfigured(plaidCredentialSets);

  const moneyView: MoneyView = resolveMoneyView(sp.view);
  const moneyRange: MoneyRangeKey = resolveMoneyRange(sp.range);
  const selectedAccountId =
    tab === "money" ? resolveSelectedAccountId(sp.account, accountGroups) : null;

  // Load only the selected account's transactions (indexed account_id+date desc).
  const selectedTxns: MoneyTxn[] =
    tab === "money" && selectedAccountId
      ? (await listPlaidTransactions(selectedAccountId)).map((t) => ({
          transactionId: t.transactionId,
          accountId: t.accountId,
          amountCents: t.amountCents,
          date: t.date,
          name: t.name,
          merchantName: t.merchantName,
          categoryPrimary: t.categoryPrimary,
          categoryDetailed: t.categoryDetailed,
          pending: t.pending,
          paymentChannel: t.paymentChannel,
        }))
      : [];

  const selectedAccount = selectedAccountId
    ? groupableAccounts.find((a) => a.accountId === selectedAccountId) ?? null
    : null;

  // Range-filtered views (activity/pending show ALL history; flow/categories
  // respect the range picker so the totals answer "for this period").
  const rangeBounds = moneyRangeBounds(moneyRange, todayIso());
  const rangedTxns = filterTxnsInRange(selectedTxns, rangeBounds.start, rangeBounds.end);
  const flow = computeMoneyFlow(rangedTxns);
  const categories = computeCategoryBreakdown(rangedTxns);
  const activityRows = buildActivityRows(selectedTxns);
  const pendingRows = buildPendingRows(selectedTxns);

  // Helper to build a money-tab link that preserves account + view + range.
  const moneyHref = (over: { account?: string; view?: MoneyView; range?: MoneyRangeKey }) => {
    const account = over.account ?? selectedAccountId ?? "";
    const view = over.view ?? moneyView;
    const range = over.range ?? moneyRange;
    const q = new URLSearchParams({ tab: "money" });
    if (account) q.set("account", account);
    q.set("view", view);
    q.set("range", range);
    return `/admin/plaid?${q.toString()}`;
  };

  // One institution block in the Money sidebar (bank header + its accounts).
  // Reused by both the flat (single-owner) and owner-grouped layouts so the
  // account row markup stays identical everywhere.
  const renderInstitutionGroup = (group: (typeof accountGroups)[number]) => (
    <div key={group.key}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-white/40">
          {group.institutionName}
        </span>
        <span className="text-xs text-white/40">{group.subtotalText}</span>
      </div>
      <ul className="space-y-1">
        {group.accounts.map((a) => {
          const active = a.accountId === selectedAccountId;
          return (
            <li key={a.accountId}>
              <Link
                href={moneyHref({ account: a.accountId })}
                className={`flex items-center justify-between gap-2 rounded-[var(--admin-radius)] border px-3 py-2 text-sm ${
                  active
                    ? "border-emerald-500/40 bg-emerald-500/[0.08] text-white"
                    : "border-white/10 bg-white/[0.02] text-white/80 hover:bg-white/[0.05]"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{a.displayName}</span>
                  <span className="block text-xs text-white/40">
                    {a.maskText} · {roleLabel(a.role)}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-semibold text-white/70">{a.currentText}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <div>
      <AdminPageHeader
        title="Bank Feeds"
        subtitle="Securely connect your business bank and credit accounts so the app can keep your books automatically. You link accounts you own; nothing here moves money. Owner/admin eyes only."
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Bank Feeds" }]} />}
        help={
          <HelpPanel
            id="plaid-home"
            title="How Bank Feeds work"
            steps={[
              'Click "Connect a bank account". A secure window from Plaid opens — you pick your bank and sign in THERE. We never see your bank username or password.',
              "Once connected, the accounts under that login appear below with their balances and last-4 numbers.",
              'On the Health tab, tag each account with its job: Main operating, ATM deposits, or Credit card. Each job can belong to only one account.',
              "In the next steps the app will pull your transactions on a schedule and match them against payroll and vendor payments — closing the loop automatically.",
              "This only reads your accounts. It cannot send payments. Your connection tokens are encrypted before they're stored and are never shown on screen.",
            ]}
          >
            <p>
              Built the same way as the Banking vault: read-only, encrypted at rest, audited on every
              change, and no secret ever returned to the browser. You&apos;re connecting first-party
              accounts (your own Timberland operating/ATM accounts and the Citi card) for bookkeeping.
            </p>
          </HelpPanel>
        }
      />

      <div className="px-5 py-6 sm:px-8">
        {sp.msg ? (
          <div className="mb-4 rounded-[var(--admin-radius)] border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 text-sm font-semibold text-emerald-300">
            {sp.msg}
          </div>
        ) : null}
        {sp.error ? (
          <div className="mb-4 rounded-[var(--admin-radius)] border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm font-semibold text-red-300">
            {sp.error}
          </div>
        ) : null}

        {/* Honest posture strip */}
        <div className="mb-6 flex flex-wrap gap-2">
          <span
            title={plaidReady ? `Plaid keys are set (${plaidEnv} environment).` : "Add PLAID_CLIENT_ID and PLAID_SECRET in Vercel."}
            className={`inline-flex cursor-help items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
              plaidReady
                ? "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-300"
                : "border-amber-500/40 bg-amber-500/[0.08] text-amber-300"
            }`}
          >
            {plaidReady ? "✓" : "⚠"} Plaid {plaidReady ? `connected · ${plaidEnv}` : "not configured"}
          </span>
          <span
            title={encryptionOn ? "Connection tokens are encrypted at rest." : "Set the at-rest encryption key so tokens are encrypted."}
            className={`inline-flex cursor-help items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
              encryptionOn
                ? "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-300"
                : "border-amber-500/40 bg-amber-500/[0.08] text-amber-300"
            }`}
          >
            {encryptionOn ? "✓" : "⚠"} At-rest encryption {encryptionOn ? "on" : "off"}
          </span>
        </div>

        {/* Unconfigured-friendly card */}
        {!plaidReady ? (
          <div className="mb-6 rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            <p className="font-semibold">Plaid isn&apos;t connected yet.</p>
            <p className="mt-1 opacity-90">
              Add <code>PLAID_CLIENT_ID</code> and <code>PLAID_SECRET</code> (and{" "}
              <code>PLAID_ENV</code>) in Vercel → Settings → Environment Variables, then reload this
              page. Until then, the connect button is hidden so nothing fails silently.
            </p>
          </div>
        ) : null}
        {plaidReady && !dbReady ? (
          <div className="mb-6 rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t connected yet, so connections can&apos;t be saved.
          </div>
        ) : null}

        {/* Tabs — Connections opens first; Money is the master–detail screen. */}
        <div className="mb-6 flex flex-wrap gap-2">
          <Link href="/admin/plaid?tab=connections" className={tabCls(tab === "connections")}>
            Connections
          </Link>
          <Link href="/admin/plaid?tab=money" className={tabCls(tab === "money")}>
            Money
          </Link>
          <Link href="/admin/plaid?tab=health" className={tabCls(tab === "health")}>
            Health
          </Link>
        </div>

        {tab === "connections" ? (
          <div className="space-y-6">
            <div className={cardCls}>
              <h2 className="text-sm font-semibold text-white">Connect a bank account</h2>
              <p className="mt-1 mb-4 text-sm text-white/60">
                Opens Plaid&apos;s secure window. Choose your bank, sign in there, and pick the
                accounts to share. Repeat for each login (e.g. Timberland, then Citi).
              </p>
              {plaidReady && dbReady ? (
                showLinkPicker ? (
                  <div className="space-y-3">
                    <p className="text-xs text-white/50">
                      You have two Plaid accounts connected. Pick whose account this bank belongs to.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      {linkOptions.map((opt) => (
                        <PlaidLinkButton
                          key={opt.key}
                          credentialSetKey={opt.key}
                          label={`Connect a bank for ${opt.owner}`}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <PlaidLinkButton
                    credentialSetKey={linkOptions[0]?.key ?? "primary"}
                  />
                )
              ) : (
                <p className="text-sm text-white/40">Connect Plaid and the database to enable this.</p>
              )}
            </div>

            <div className={cardCls}>
              <h2 className="mb-3 text-sm font-semibold text-white">Linked connections</h2>
              {items.length === 0 ? (
                <p className="text-sm text-white/50">No connections yet. Use the button above to add one.</p>
              ) : (
                <div className="space-y-4">
                  {items.map((item) => {
                    const chip = buildItemStatusView(item.errorCode);
                    const itemAccounts = accountsByItem.get(item.itemId) ?? [];
                    return (
                      <div key={item.itemId} className="rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white">
                              {item.institutionName ?? "Bank connection"}
                              {showOwnerLevel && item.owner ? (
                                <span className="rounded-full border border-white/15 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/60">
                                  {item.owner}
                                </span>
                              ) : null}
                            </p>
                            <p className="text-xs text-white/40">
                              {itemAccounts.length} account{itemAccounts.length === 1 ? "" : "s"}
                              {item.lastSuccessfulSync ? ` · last sync ${new Date(item.lastSuccessfulSync).toLocaleString()}` : " · not synced yet"}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${chipCls(chip.tone)}`}>
                              ● {chip.label}
                            </span>
                            <RemoveConnectionButton
                              itemId={item.itemId}
                              institutionName={item.institutionName ?? "Bank connection"}
                            />
                          </div>
                        </div>
                        {itemAccounts.length > 0 ? (
                          <ul className="mt-3 space-y-1">
                            {itemAccounts.map((a) => {
                              const v = buildAccountSummary(a);
                              return (
                                <li key={a.accountId} className="flex flex-wrap items-center justify-between gap-2 border-t border-white/5 py-1.5 text-sm">
                                  <span className="text-white/80">
                                    {v.displayName} <span className="text-white/40">{v.maskText}</span>
                                  </span>
                                  <span className="text-white/50">
                                    {v.roleText} · {v.currentText}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {tab === "money" ? (
          accounts.length === 0 ? (
            <div className={cardCls}>
              <p className="text-sm text-white/60">
                No accounts yet. Connect a bank on the <span className="font-semibold text-white">Connections</span> tab,
                then your accounts and their money will show up here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
              {/* LEFT: master — accounts grouped by institution */}
              <aside className={`${cardCls} h-fit`}>
                <h2 className="mb-1 text-sm font-semibold text-white">Accounts</h2>
                <p className="mb-4 text-xs text-white/50">
                  {showOwnerLevel ? "Grouped by owner, then bank. Pick one to see its money." : "Grouped by bank. Pick one to see its money."}
                </p>
                {showOwnerLevel ? (
                  <div className="space-y-6">
                    {ownerGroups.map((owner) => (
                      <div key={owner.key}>
                        <div className="mb-2 flex items-baseline justify-between gap-2 border-b border-white/10 pb-1.5">
                          <span className="text-sm font-semibold text-white">{owner.owner}</span>
                          <span className="text-xs text-white/40">{owner.subtotalText}</span>
                        </div>
                        <div className="space-y-4">
                          {owner.institutions.map((group) => renderInstitutionGroup(group))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {accountGroups.map((group) => renderInstitutionGroup(group))}
                  </div>
                )}
              </aside>

              {/* RIGHT: detail — selected account's four money views */}
              <section className="space-y-6">
                {selectedAccount ? (
                  <>
                    <div className={cardCls}>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div>
                          <h2 className="text-base font-semibold text-white">{selectedAccount.displayName}</h2>
                          <p className="text-xs text-white/40">
                            {selectedAccount.maskText} · {roleLabel(selectedAccount.role)}
                            {showOwnerLevel && selectedAccount.owner ? ` · ${selectedAccount.owner}` : ""}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-semibold text-white">{selectedAccount.currentText}</p>
                          <p className="text-xs text-white/40">Current balance</p>
                        </div>
                      </div>

                      {/* Money-view sub-tabs */}
                      <div className="mt-4 flex flex-wrap gap-2">
                        {(["activity", "flow", "categories", "pending"] as MoneyView[]).map((mv) => (
                          <Link key={mv} href={moneyHref({ view: mv })} className={subTabCls(moneyView === mv)}>
                            {moneyViewLabel(mv)}
                          </Link>
                        ))}
                      </div>
                    </div>

                    {/* Mortgage details (Plaid Liabilities) — only for a loan
                        account we have mortgage detail for (e.g. Sound CU). */}
                    {(() => {
                      const mv = selectedAccountId ? mortgageViewByAccount.get(selectedAccountId) : undefined;
                      if (!mv) return null;
                      const rows: Array<[string, string]> = [
                        ["Remaining principal", mv.balanceText],
                        ["Interest rate", mv.rateText],
                        ["Next payment", mv.nextPaymentText],
                        ["Escrow balance", mv.escrowText],
                        ["Original loan", mv.originationText],
                        ["Term", mv.termText],
                        ["Payoff date", mv.maturityText],
                        ["Paid this year", mv.ytdText],
                        ["Mortgage insurance (PMI)", mv.pmiText],
                        ["Property", mv.addressText],
                      ];
                      return (
                        <div className={cardCls}>
                          <h3 className="mb-1 text-sm font-semibold text-white">Mortgage details</h3>
                          <p className="mb-3 text-xs text-white/40">
                            Pulled from your lender via Plaid. Refreshes about once a day; use “Sync now” to refresh.
                          </p>
                          <dl className="divide-y divide-white/5">
                            {rows.map(([label, value]) => (
                              <div key={label} className="flex items-baseline justify-between gap-3 py-2">
                                <dt className="text-xs text-white/40">{label}</dt>
                                <dd className="text-right text-sm text-white/90">{value}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      );
                    })()}

                    {/* Investment holdings (Plaid Investments) — only for a
                        brokerage account we have positions for (e.g. Fidelity). */}
                    {(() => {
                      const hv = selectedAccountId ? holdingsViewByAccount.get(selectedAccountId) : undefined;
                      if (!hv || hv.positionCount === 0) return null;
                      return (
                        <div className={cardCls}>
                          <div className="mb-1 flex items-baseline justify-between gap-3">
                            <h3 className="text-sm font-semibold text-white">Holdings</h3>
                            <span className="text-sm font-semibold text-white/90">{hv.totalValueText}</span>
                          </div>
                          <p className="mb-3 text-xs text-white/40">
                            {hv.positionCount} position{hv.positionCount === 1 ? "" : "s"}, pulled from your brokerage via
                            Plaid. Refreshes about once a day; use &ldquo;Sync now&rdquo; to refresh.
                          </p>
                          <ul className="divide-y divide-white/5">
                            {hv.rows.map((r) => (
                              <li key={r.securityId} className="flex items-baseline justify-between gap-3 py-2">
                                <span className="min-w-0">
                                  <span className="block truncate text-sm text-white/90">{r.displayName}</span>
                                  <span className="block truncate text-xs text-white/40">
                                    {r.quantityText} {r.tickerText !== "—" ? `· ${r.tickerText}` : ""} · cost {r.costBasisText}
                                  </span>
                                </span>
                                <span className="shrink-0 text-right">
                                  <span className="block text-sm text-white/90">{r.valueText}</span>
                                  <span
                                    className={
                                      r.gainLossCents !== null && r.gainLossCents >= 0
                                        ? "block text-xs text-emerald-300"
                                        : "block text-xs text-amber-300"
                                    }
                                  >
                                    {r.gainLossText}
                                  </span>
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })()}

                    {/* Range picker — used by Money in & out + Where it goes */}
                    {moneyView === "flow" || moneyView === "categories" ? (
                      <div className="flex flex-wrap gap-2">
                        {(["this_month", "last_month", "this_year", "all"] as MoneyRangeKey[]).map((rk) => (
                          <Link key={rk} href={moneyHref({ range: rk })} className={subTabCls(moneyRange === rk)}>
                            {moneyRangeLabel(rk)}
                          </Link>
                        ))}
                      </div>
                    ) : null}

                    {/* VIEW 1: Activity (statement) */}
                    {moneyView === "activity" ? (
                      <div className={cardCls}>
                        <h3 className="mb-1 text-sm font-semibold text-white">Activity</h3>
                        <p className="mb-4 text-xs text-white/50">Your statement — newest first. Money in is green, money out is white.</p>
                        {activityRows.length === 0 ? (
                          <p className="text-sm text-white/50">No transactions yet. Use “Sync now” on the Health tab to pull activity.</p>
                        ) : (
                          <ul className="divide-y divide-white/5">
                            {activityRows.map((r) => (
                              <li key={r.transactionId} className="flex items-center justify-between gap-3 py-2 text-sm">
                                <span className="min-w-0">
                                  <span className="block truncate text-white/90">
                                    {r.description}
                                    {r.pending ? (
                                      <span className="ml-2 rounded-full border border-amber-500/40 bg-amber-500/[0.08] px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                                        Pending
                                      </span>
                                    ) : null}
                                  </span>
                                  <span className="block text-xs text-white/40">
                                    {r.date} · {r.categoryText}
                                  </span>
                                </span>
                                <span className={`shrink-0 font-semibold ${r.direction === "in" ? "text-emerald-300" : "text-white/80"}`}>
                                  {r.amountText}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : null}

                    {/* VIEW 2: Money in & out (net) */}
                    {moneyView === "flow" ? (
                      <div className={cardCls}>
                        <h3 className="mb-1 text-sm font-semibold text-white">Money in &amp; out</h3>
                        <p className="mb-4 text-xs text-white/50">{moneyRangeLabel(moneyRange)} · {flow.count} transaction{flow.count === 1 ? "" : "s"}.</p>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <div className="rounded-[var(--admin-radius)] border border-emerald-500/20 bg-emerald-500/[0.05] p-4">
                            <p className="text-xs text-white/50">Money in</p>
                            <p className="mt-1 text-lg font-semibold text-emerald-300">{flow.inflowText}</p>
                          </div>
                          <div className="rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-4">
                            <p className="text-xs text-white/50">Money out</p>
                            <p className="mt-1 text-lg font-semibold text-white/85">{flow.outflowText}</p>
                          </div>
                          <div className="rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-4">
                            <p className="text-xs text-white/50">Net</p>
                            <p className={`mt-1 text-lg font-semibold ${flow.netCents >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                              {flow.netText}
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {/* VIEW 3: Where it goes (categories) */}
                    {moneyView === "categories" ? (
                      <div className={cardCls}>
                        <h3 className="mb-1 text-sm font-semibold text-white">Where the money goes</h3>
                        <p className="mb-4 text-xs text-white/50">Spending by category, biggest first · {moneyRangeLabel(moneyRange)}.</p>
                        {categories.length === 0 ? (
                          <p className="text-sm text-white/50">No spending in this period.</p>
                        ) : (
                          <ul className="space-y-2">
                            {categories.map((c) => (
                              <li key={c.category}>
                                <div className="flex items-center justify-between gap-3 text-sm">
                                  <span className="text-white/90">{c.category}</span>
                                  <span className="text-white/70">
                                    {c.amountText} <span className="text-white/40">· {c.percent}%</span>
                                  </span>
                                </div>
                                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                                  <div className="h-full rounded-full bg-emerald-500/60" style={{ width: `${c.percent}%` }} />
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : null}

                    {/* VIEW 4: Pending */}
                    {moneyView === "pending" ? (
                      <div className={cardCls}>
                        <h3 className="mb-1 text-sm font-semibold text-white">Pending</h3>
                        <p className="mb-4 text-xs text-white/50">Transactions that haven’t cleared yet.</p>
                        {pendingRows.length === 0 ? (
                          <p className="text-sm text-white/50">Nothing pending — everything has cleared.</p>
                        ) : (
                          <ul className="divide-y divide-white/5">
                            {pendingRows.map((r) => (
                              <li key={r.transactionId} className="flex items-center justify-between gap-3 py-2 text-sm">
                                <span className="min-w-0">
                                  <span className="block truncate text-white/90">{r.description}</span>
                                  <span className="block text-xs text-white/40">
                                    {r.date} · {r.categoryText}
                                  </span>
                                </span>
                                <span className={`shrink-0 font-semibold ${r.direction === "in" ? "text-emerald-300" : "text-white/80"}`}>
                                  {r.amountText}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className={cardCls}>
                    <p className="text-sm text-white/60">Pick an account on the left to see its money.</p>
                  </div>
                )}
              </section>
            </div>
          )
        ) : null}

        {tab === "health" ? (
          <div className="space-y-6">
            <div className={cardCls}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="mb-1 text-sm font-semibold text-white">Pull latest transactions</h2>
                  <p className="text-sm text-white/60">
                    Fetch new, changed, and removed transactions for every connected bank. This runs
                    on its own too &mdash; use this button any time you want the newest activity now.
                  </p>
                </div>
                <form action={runPlaidSyncNowAction}>
                  <button type="submit" className={btnGhost}>
                    Sync now
                  </button>
                </form>
              </div>
            </div>

            <div className={cardCls}>
              <h2 className="mb-1 text-sm font-semibold text-white">Connection health</h2>
              <p className="mb-4 text-sm text-white/60">
                Each connection&apos;s status in plain English. If one needs your attention, the
                message says exactly what to do.
              </p>
              {items.length === 0 ? (
                <p className="text-sm text-white/50">No connections yet.</p>
              ) : (
                <ul className="space-y-2">
                  {items.map((item) => {
                    const chip = buildItemStatusView(item.errorCode);
                    return (
                      <li key={item.itemId} className="rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-white">
                            {item.institutionName ?? "Bank connection"}
                          </span>
                          <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${chipCls(chip.tone)}`}>
                            ● {chip.label}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-white/60">{chip.message}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className={cardCls}>
              <h2 className="mb-1 text-sm font-semibold text-white">Accounts — names &amp; roles</h2>
              <p className="mb-4 text-sm text-white/60">
                Give each account a friendly name (e.g. &ldquo;Timberland Checking&rdquo; or
                &ldquo;Wife&apos;s Citi Costco Visa&rdquo;) so the back office is easy to read, and
                tell the app what each account is for. Reconciliation uses the roles; each role can
                belong to only one account. Leave the name blank to use the bank&apos;s own name.
              </p>
              {accounts.length === 0 ? (
                <p className="text-sm text-white/50">No accounts yet — connect a bank first.</p>
              ) : (
                <div className="space-y-2">
                  {accounts.map((a) => {
                    const v = buildAccountSummary(a);
                    return (
                      <div
                        key={a.accountId}
                        className="rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-[12rem]">
                            <p className="text-sm font-semibold text-white">
                              {v.displayName} <span className="text-white/40">{v.maskText}</span>
                            </p>
                            <p className="text-xs text-white/40">
                              {v.typeText} · {v.currentText}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            {/* Pick one of the built-in roles. */}
                            <form
                              action={assignPlaidAccountRoleAction}
                              className="flex items-center gap-2"
                            >
                              <input type="hidden" name="account_id" value={a.accountId} />
                              <label className="sr-only" htmlFor={`role-${a.accountId}`}>
                                Role for {v.displayName}
                              </label>
                              <select
                                id={`role-${a.accountId}`}
                                name="role"
                                defaultValue={
                                  a.role && (ACCOUNT_ROLES as readonly string[]).includes(a.role)
                                    ? a.role
                                    : ""
                                }
                                className={selectCls}
                              >
                                <option value="">Unassigned</option>
                                {ACCOUNT_ROLE_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                              <button type="submit" className={btnGhost}>
                                Save role
                              </button>
                            </form>
                            {/* Or type your own role name (one account per role still applies). */}
                            <form
                              action={assignPlaidAccountRoleAction}
                              className="flex items-center gap-2"
                            >
                              <input type="hidden" name="account_id" value={a.accountId} />
                              <label className="sr-only" htmlFor={`customrole-${a.accountId}`}>
                                Custom role for {v.displayName}
                              </label>
                              <input
                                id={`customrole-${a.accountId}`}
                                name="role"
                                type="text"
                                maxLength={32}
                                placeholder="or type a role…"
                                defaultValue={
                                  a.role && !(ACCOUNT_ROLES as readonly string[]).includes(a.role)
                                    ? a.role
                                    : ""
                                }
                                className={selectCls}
                              />
                              <button type="submit" className={btnGhost}>
                                Save name
                              </button>
                            </form>
                          </div>
                        </div>
                        <form
                          action={setPlaidAccountNameAction}
                          className="mt-2 flex flex-wrap items-center gap-2 border-t border-white/5 pt-2"
                        >
                          <input type="hidden" name="account_id" value={a.accountId} />
                          <label className="sr-only" htmlFor={`name-${a.accountId}`}>
                            Custom name for {v.displayName}
                          </label>
                          <input
                            id={`name-${a.accountId}`}
                            name="custom_name"
                            type="text"
                            maxLength={60}
                            defaultValue={v.customName}
                            placeholder="Type a name for this account…"
                            className={`${selectCls} min-w-[16rem] flex-1`}
                          />
                          <button type="submit" className={btnGhost}>
                            Save name
                          </button>
                        </form>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
