/**
 * /admin/crypto — Crypto Portfolio back office. Slice C3: the page skeleton +
 * watch-only wallet connect + honest empty/valuation states.
 *
 * Owner (Michael, Greenway Marijuana) connects his OWN crypto wallets here by
 * PUBLIC address only — read-only, watch-only. This page is the single home for
 * the crypto portfolio, built to mirror the Bank Feeds (Plaid) page:
 *   Tab 1 — Portfolio (opens first): total USD value + per-chain breakdown.
 *           HONEST totals: only priced holdings are summed; held-but-unpriced
 *           holdings are shown as "awaiting price", never a guessed $0.
 *   Tab 2 — Wallets: the "Add wallet (watch-only)" form (address validated for
 *           its chain) + the list of connected wallets.
 *   Tab 3 — Health: watch-only assurance, database/pricing posture, and each
 *           wallet's sync status in plain English.
 *
 * Gate: settings.manage = owner + admin only (same as Banking / Bank Feeds).
 * Renders even when the DB isn't configured (unconfigured-friendly), so the site
 * keeps building/deploying before the service credentials are set.
 *
 * SECURITY: only PUBLIC addresses are stored — there are no private keys and
 * nothing here can move funds. Balances and transaction history are populated by
 * the connector slices ahead (XRPL → Ethereum → Flare → Coreum), valued in USD
 * by the pricing slice, then rolled into IRS cost-basis / gain-loss reports.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  listCryptoWallets,
  listCryptoBalances,
  listCryptoAssets,
  getCryptoSyncState,
} from "@/lib/crypto/crypto-store";
import { getAsset } from "@/lib/crypto/crypto-core";
import {
  resolveCryptoTab,
  cryptoTabLabel,
  CRYPTO_TABS,
  chainSelectOptions,
  buildWalletRow,
  computePortfolioSummary,
  cryptoPosture,
  buildSyncHealth,
  formatCentsUsd,
  formatHeldAmount,
  type CryptoTab,
  type SummaryBalanceInput,
} from "@/lib/crypto/crypto-ui-core";
import { addCryptoWalletAction } from "./actions";

export const dynamic = "force-dynamic";

const cardCls = "rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-5";
const inputCls =
  "w-full rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-emerald-400/50 focus:outline-none";
const labelCls = "mb-1 block text-xs font-semibold uppercase tracking-wide text-white/50";
const btnPrimary =
  "rounded-[var(--admin-radius)] bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400";

function tabCls(active: boolean): string {
  return `rounded-[var(--admin-radius)] px-4 py-2 text-sm font-semibold ${
    active ? "bg-emerald-500 text-emerald-950" : "border border-white/15 text-white/70 hover:bg-white/[0.06]"
  }`;
}

function chipCls(tone: "neutral" | "green" | "orange" | "red"): string {
  if (tone === "green") return "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-300";
  if (tone === "orange") return "border-amber-500/40 bg-amber-500/[0.08] text-amber-300";
  if (tone === "red") return "border-red-500/30 bg-red-500/[0.06] text-red-300";
  return "border-white/15 bg-white/[0.04] text-white/70";
}

export default async function CryptoPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; msg?: string; error?: string }>;
}) {
  await requirePermission("settings.manage");
  const sp = await searchParams;
  const tab: CryptoTab = resolveCryptoTab(sp.tab);

  const dbReady = isSupabaseServiceConfigured;
  // USD pricing (CoinGecko) arrives in a later slice (C9). Until then we never
  // fabricate a dollar figure — holdings show "value pending".
  const pricingConfigured = false;

  const [wallets, balances, assets] = await Promise.all([
    dbReady ? listCryptoWallets() : Promise.resolve([]),
    dbReady ? listCryptoBalances() : Promise.resolve([]),
    dbReady ? listCryptoAssets() : Promise.resolve([]),
  ]);

  // Index assets so a balance row can resolve its symbol + decimals for display.
  const assetById = new Map(assets.map((a) => [a.id, a]));

  // Portfolio summary — HONEST (only priced holdings sum; unpriced counted apart).
  const summaryInput: SummaryBalanceInput[] = balances.map((b) => {
    const hasAmount =
      (b.amountRaw !== null && b.amountRaw !== "" && b.amountRaw !== "0") ||
      (b.amountDecimal !== null && b.amountDecimal !== "" && Number(b.amountDecimal) !== 0);
    // Chain comes from the asset (balances reference an asset which carries chain).
    const asset = assetById.get(b.assetId) ?? getAsset(b.assetId);
    const chain = asset?.chain ?? "ethereum";
    return { chain, usdValueCents: b.usdValueCents, hasAmount };
  });
  const summary = computePortfolioSummary(summaryInput);

  // Wallet rows for the Wallets + Health tabs.
  const walletRows = wallets.map(buildWalletRow);

  // Health tab: each wallet's sync status (only load when on Health).
  const syncByWallet = new Map<string, Awaited<ReturnType<typeof getCryptoSyncState>>>();
  if (tab === "health" && dbReady) {
    await Promise.all(
      wallets.map(async (w) => {
        syncByWallet.set(w.id, await getCryptoSyncState(w.id));
      }),
    );
  }

  const posture = cryptoPosture({ dbReady, walletCount: wallets.length, pricingConfigured });

  // Balances grouped by wallet for the Portfolio holdings list.
  const balancesByWallet = new Map<string, typeof balances>();
  for (const b of balances) {
    const list = balancesByWallet.get(b.walletId) ?? [];
    list.push(b);
    balancesByWallet.set(b.walletId, list);
  }

  return (
    <div>
      <AdminPageHeader
        title="Crypto Portfolio"
        subtitle="Watch your crypto wallets by public address — read-only. Balances and full history are captured, valued in USD, and turned into IRS-ready cost-basis and gain/loss records. Nothing here can move funds. Owner/admin eyes only."
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Crypto Portfolio" }]} />}
        help={
          <HelpPanel
            id="crypto-home"
            title="How the Crypto Portfolio works"
            steps={[
              "On the Wallets tab, add each wallet by pasting its PUBLIC address and picking the blockchain. We check the address looks right for that chain before saving.",
              "It's watch-only. We only ever store the public address — there are no passwords or keys here, and nothing can send or spend your crypto.",
              "Once connected, the app pulls the wallet's full history, values every transaction in USD, and keeps a permanent, auditable record.",
              "The Portfolio tab totals only what we can actually price. Anything we hold but haven't valued yet is shown as \u201cawaiting price\u201d \u2014 never guessed \u2014 so the number you see is always honest.",
              "Later, this becomes your IRS-ready cost-basis and gain/loss report \u2014 turning the crypto tax headache into a clean, defensible paper trail.",
            ]}
          >
            <p>
              Built the same way as Bank Feeds: read-only, honest about what it knows, and audited on
              every change. Flare (where most DeFi and liquidity-pool activity happens) gets the
              heaviest, most careful treatment when its connector arrives, because that&apos;s where the
              real taxable events are.
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
          {posture.map((item) => (
            <span
              key={item.label}
              title={item.detail}
              className={`inline-flex cursor-help items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
                item.ok
                  ? "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-300"
                  : "border-amber-500/40 bg-amber-500/[0.08] text-amber-300"
              }`}
            >
              {item.ok ? "✓" : "⚠"} {item.label}
            </span>
          ))}
        </div>

        {/* Unconfigured-friendly card */}
        {!dbReady ? (
          <div className="mb-6 rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            <p className="font-semibold">The database isn&apos;t connected yet.</p>
            <p className="mt-1 opacity-90">
              Add the Supabase service credentials in Vercel → Settings → Environment Variables, then
              reload this page. Until then, the page renders but wallets can&apos;t be saved.
            </p>
          </div>
        ) : null}

        {/* Tabs — Portfolio opens first */}
        <div className="mb-6 flex flex-wrap gap-2">
          {CRYPTO_TABS.map((t) => (
            <Link key={t} href={`/admin/crypto?tab=${t}`} className={tabCls(tab === t)}>
              {cryptoTabLabel(t)}
              {t === "wallets" ? ` (${wallets.length})` : ""}
            </Link>
          ))}
        </div>

        {/* ------------------------------------------------------- PORTFOLIO */}
        {tab === "portfolio" ? (
          <div className="space-y-6">
            {/* Value StatCards */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-[var(--admin-radius)] border border-emerald-500/20 bg-emerald-500/[0.05] p-4">
                <p className="text-xs text-white/50">Total value (priced)</p>
                <p className="mt-1 text-2xl font-semibold text-emerald-300">{summary.totalValuedText}</p>
                <p className="mt-1 text-xs text-white/40">
                  {summary.pricedCount} holding{summary.pricedCount === 1 ? "" : "s"} priced
                </p>
              </div>
              <div className={cardCls}>
                <p className="text-xs text-white/50">Awaiting price</p>
                <p className="mt-1 text-2xl font-semibold text-white/85">{summary.pendingCount}</p>
                <p className="mt-1 text-xs text-white/40">
                  Held but not yet valued — never counted as $0.
                </p>
              </div>
              <div className={cardCls}>
                <p className="text-xs text-white/50">Chains with holdings</p>
                <p className="mt-1 text-2xl font-semibold text-white/85">{summary.chainsWithHoldings}</p>
                <p className="mt-1 text-xs text-white/40">{wallets.length} wallet{wallets.length === 1 ? "" : "s"} connected</p>
              </div>
            </div>

            {summary.isEmpty ? (
              <div className={cardCls}>
                <p className="text-sm text-white/60">
                  No holdings yet. Add a wallet on the{" "}
                  <Link href="/admin/crypto?tab=wallets" className="font-semibold text-emerald-300 hover:underline">
                    Wallets
                  </Link>{" "}
                  tab, and once it syncs your balances and their value will show up here.
                </p>
              </div>
            ) : (
              <>
                {/* Per-chain breakdown */}
                <div className={cardCls}>
                  <h2 className="mb-1 text-sm font-semibold text-white">Value by blockchain</h2>
                  <p className="mb-4 text-xs text-white/50">{summary.headline}</p>
                  <ul className="space-y-2">
                    {summary.perChain.map((c) => (
                      <li
                        key={c.chain}
                        className="flex flex-wrap items-center justify-between gap-2 border-t border-white/5 py-2 text-sm"
                      >
                        <span className="font-semibold text-white/90">{c.chainText}</span>
                        <span className="text-white/70">
                          {c.valuedText}
                          {c.pendingCount > 0 ? (
                            <span className="ml-2 rounded-full border border-amber-500/40 bg-amber-500/[0.08] px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                              {c.pendingCount} awaiting price
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Holdings per wallet */}
                <div className={cardCls}>
                  <h2 className="mb-1 text-sm font-semibold text-white">Holdings</h2>
                  <p className="mb-4 text-xs text-white/50">
                    Exact quantities, straight from the chain. USD value fills in as pricing is applied.
                  </p>
                  <div className="space-y-4">
                    {walletRows.map((w) => {
                      const held = (balancesByWallet.get(w.id) ?? []).filter(
                        (b) =>
                          (b.amountRaw !== null && b.amountRaw !== "" && b.amountRaw !== "0") ||
                          (b.amountDecimal !== null && b.amountDecimal !== "" && Number(b.amountDecimal) !== 0),
                      );
                      if (held.length === 0) return null;
                      return (
                        <div key={w.id} className="rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-4">
                          <p className="text-sm font-semibold text-white">
                            {w.displayName} <span className="text-white/40">· {w.chainText} · {w.addressShort}</span>
                          </p>
                          <ul className="mt-2 space-y-1">
                            {held.map((b) => {
                              const asset = assetById.get(b.assetId) ?? getAsset(b.assetId);
                              const qty = formatHeldAmount({
                                amountRaw: b.amountRaw,
                                amountDecimal: b.amountDecimal,
                                decimals: asset?.decimals ?? b.decimalsAtRead ?? null,
                              });
                              return (
                                <li
                                  key={b.id}
                                  className="flex flex-wrap items-center justify-between gap-2 border-t border-white/5 py-1.5 text-sm"
                                >
                                  <span className="text-white/85">
                                    {qty} <span className="text-white/50">{asset?.symbol ?? b.assetId}</span>
                                  </span>
                                  <span className="text-white/60">
                                    {b.usdValueCents !== null ? (
                                      formatCentsUsd(b.usdValueCents)
                                    ) : (
                                      <span className="text-amber-300/80">value pending</span>
                                    )}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        ) : null}

        {/* --------------------------------------------------------- WALLETS */}
        {tab === "wallets" ? (
          <div className="space-y-6">
            <div className={cardCls}>
              <h2 className="text-sm font-semibold text-white">Add a wallet (watch-only)</h2>
              <p className="mt-1 mb-4 text-sm text-white/60">
                Paste the wallet&apos;s <span className="font-semibold text-white">public address</span> and pick its
                blockchain. We only store the public address — never a password or key. We check the address looks
                right for the chain before saving.
              </p>
              {dbReady ? (
                <form action={addCryptoWalletAction} className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_10rem_auto]">
                  <div>
                    <label htmlFor="chain" className={labelCls}>
                      Blockchain
                    </label>
                    <select id="chain" name="chain" defaultValue="ethereum" className={inputCls}>
                      {chainSelectOptions().map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="address" className={labelCls}>
                      Public address
                    </label>
                    <input
                      id="address"
                      name="address"
                      type="text"
                      required
                      placeholder="0x… or r… or core1…"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label htmlFor="label" className={labelCls}>
                      Label (optional)
                    </label>
                    <input id="label" name="label" type="text" maxLength={60} placeholder="e.g. DeFi wallet" className={inputCls} />
                  </div>
                  <div className="flex items-end">
                    <button type="submit" className={btnPrimary}>
                      Add wallet
                    </button>
                  </div>
                </form>
              ) : (
                <p className="text-sm text-white/40">Connect the database to enable adding wallets.</p>
              )}
            </div>

            <div className={cardCls}>
              <h2 className="mb-3 text-sm font-semibold text-white">Connected wallets</h2>
              {walletRows.length === 0 ? (
                <p className="text-sm text-white/50">No wallets yet. Use the form above to add one.</p>
              ) : (
                <ul className="space-y-2">
                  {walletRows.map((w) => (
                    <li
                      key={w.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-3 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="block font-semibold text-white">{w.displayName}</span>
                        <span className="block text-xs text-white/40">
                          {w.chainText} · <span title={w.addressFull}>{w.addressShort}</span>
                        </span>
                      </span>
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-1 text-xs font-semibold text-emerald-300">
                        ● Watching
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}

        {/* ---------------------------------------------------------- HEALTH */}
        {tab === "health" ? (
          <div className="space-y-6">
            <div className={cardCls}>
              <h2 className="mb-1 text-sm font-semibold text-white">Watch-only — your funds can&apos;t move</h2>
              <p className="text-sm text-white/60">
                This feature stores only public wallet addresses. It reads balances and history; it has no keys
                and can never send, spend, or withdraw. The badges below tell the truth about what&apos;s ready.
              </p>
              <div className="mt-3 space-y-1">
                {posture.map((p) => (
                  <p key={p.label} className="text-xs text-white/60">
                    <span className={p.ok ? "font-semibold text-emerald-300" : "font-semibold text-amber-300"}>
                      {p.ok ? "✓" : "⚠"} {p.label}:
                    </span>{" "}
                    {p.detail}
                  </p>
                ))}
              </div>
            </div>

            <div className={cardCls}>
              <h2 className="mb-1 text-sm font-semibold text-white">Wallet sync status</h2>
              <p className="mb-4 text-sm text-white/60">
                Each wallet&apos;s history-sync status in plain English. Syncing turns on with the connector slices
                ahead; until then wallets read as &ldquo;not synced yet&rdquo;.
              </p>
              {walletRows.length === 0 ? (
                <p className="text-sm text-white/50">No wallets yet — add one on the Wallets tab.</p>
              ) : (
                <ul className="space-y-2">
                  {walletRows.map((w) => {
                    const health = buildSyncHealth(syncByWallet.get(w.id) ?? null);
                    return (
                      <li key={w.id} className="rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-white">
                            {w.displayName} <span className="text-white/40">· {w.chainText}</span>
                          </span>
                          <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${chipCls(health.tone)}`}>
                            ● {health.label}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-white/60">{health.message}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
