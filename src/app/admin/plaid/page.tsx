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
 * Gate: settings.manage = owner + admin only (same as Banking / ATM / Payroll).
 * Renders even when Plaid or the DB isn't configured (unconfigured-friendly
 * card), so the site keeps building/deploying before the keys are set.
 *
 * SECURITY: bank passwords are entered inside Plaid's own secure modal — we
 * never see them. The access_token is exchanged and encrypted server-side and
 * is NEVER sent to the browser (see actions.ts / store.ts). Everything the page
 * renders is non-sensitive (institution name, last-4 mask, balances, role).
 *
 * Slices ahead: P3 pulls transactions on a schedule, P4 adds the webhook, P5
 * builds the four money-view tabs, P6 reconciles against payroll/vendor payments.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { isPlaidConfigured, plaidEnv } from "@/lib/plaid/env";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { isAtRestEncryptionConfigured } from "@/lib/security/at-rest-crypto";
import { listPlaidItems, listPlaidAccounts } from "@/lib/plaid/store";
import {
  resolvePlaidTab,
  buildItemStatusView,
  buildAccountSummary,
  type PlaidTab,
  type ChipTone,
} from "@/lib/plaid/plaid-ui-core";
import { PlaidLinkButton } from "./PlaidLinkButton";
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

function chipCls(tone: ChipTone): string {
  if (tone === "green") return "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-300";
  if (tone === "orange") return "border-amber-500/40 bg-amber-500/[0.08] text-amber-300";
  if (tone === "red") return "border-red-500/30 bg-red-500/[0.06] text-red-300";
  return "border-white/15 bg-white/[0.04] text-white/70";
}

export default async function PlaidPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; msg?: string; error?: string }>;
}) {
  await requirePermission("settings.manage");
  const sp = await searchParams;
  const tab: PlaidTab = resolvePlaidTab(sp.tab);

  const dbReady = isSupabaseServiceConfigured;
  const plaidReady = isPlaidConfigured;
  const encryptionOn = isAtRestEncryptionConfigured();

  const items = dbReady ? await listPlaidItems() : [];
  const accounts = dbReady ? await listPlaidAccounts() : [];

  // Group accounts under their item for display.
  const accountsByItem = new Map<string, typeof accounts>();
  for (const a of accounts) {
    const list = accountsByItem.get(a.itemId) ?? [];
    list.push(a);
    accountsByItem.set(a.itemId, list);
  }

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

        {/* Tabs — Connections opens first */}
        <div className="mb-6 flex flex-wrap gap-2">
          <Link href="/admin/plaid?tab=connections" className={tabCls(tab === "connections")}>
            Connections
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
                <PlaidLinkButton />
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
                            <p className="text-sm font-semibold text-white">
                              {item.institutionName ?? "Bank connection"}
                            </p>
                            <p className="text-xs text-white/40">
                              {itemAccounts.length} account{itemAccounts.length === 1 ? "" : "s"}
                              {item.lastSuccessfulSync ? ` · last sync ${new Date(item.lastSuccessfulSync).toLocaleString()}` : " · not synced yet"}
                            </p>
                          </div>
                          <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${chipCls(chip.tone)}`}>
                            ● {chip.label}
                          </span>
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
                              defaultValue={a.role ?? ""}
                              className={selectCls}
                            >
                              <option value="">Unassigned</option>
                              <option value="main">Main operating</option>
                              <option value="atm">ATM deposits</option>
                              <option value="credit">Credit card</option>
                            </select>
                            <button type="submit" className={btnGhost}>
                              Save role
                            </button>
                          </form>
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
