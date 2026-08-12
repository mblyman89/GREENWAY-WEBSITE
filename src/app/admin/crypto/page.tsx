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
 *   Tab 3 — Health: "Sync now" trigger (pulls balances + history for every
 *           connected wallet), watch-only assurance, database/pricing posture,
 *           and each wallet's sync status in plain English.
 *
 * Gate: settings.manage = owner + admin only (same as Banking / Bank Feeds).
 * Renders even when the DB isn't configured (unconfigured-friendly), so the site
 * keeps building/deploying before the service credentials are set.
 *
 * SECURITY: only PUBLIC addresses are stored — there are no private keys and
 * nothing here can move funds. Balances and transaction history are populated by
 * the connector slices (XRPL C4/C5, EVM C6/C6b — wired by C6c's "Sync now"), valued in USD
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
  listCryptoTransactions,
  getCryptoSyncState,
} from "@/lib/crypto/crypto-store";
import { listCryptoClassifications } from "@/lib/crypto/crypto-classification-store";
import { getAsset } from "@/lib/crypto/crypto-core";
import { buildHoldingsTable } from "@/lib/crypto/crypto-holdings-table-core";
import {
  buildClassifyView,
  type ClassifyTxInput,
  type ClassifyDirection,
} from "@/lib/crypto/crypto-classify-view-core";
import { HoldingsTable } from "./HoldingsTable";
import { ClassifyTable } from "./ClassifyTable";
import {
  resolveCryptoTab,
  cryptoTabLabel,
  CRYPTO_TABS,
  chainSelectOptions,
  buildWalletRow,
  computePortfolioSummary,
  cryptoPosture,
  buildSyncHealth,
  buildWalletProgress,
  formatHeldAmount,
  type CryptoTab,
  type SummaryBalanceInput,
} from "@/lib/crypto/crypto-ui-core";
import { addCryptoWalletAction, runCryptoSyncNowAction } from "./actions";

export const dynamic = "force-dynamic";

const cardCls = "rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-5";
const inputCls =
  "w-full rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-emerald-400/50 focus:outline-none";
const labelCls = "mb-1 block text-xs font-semibold uppercase tracking-wide text-white/50";
const btnPrimary =
  "rounded-[var(--admin-radius)] bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400";
const btnGhost =
  "rounded-[var(--admin-radius)] border border-white/15 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.08]";

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
  // USD pricing (R3) runs on every sync using the free, keyless CoinGecko +
  // GeckoTerminal feeds \u2014 no extra credentials to configure. So pricing is
  // "ready" as soon as the database is connected (that's where synced balances
  // and their computed usd_value_cents live). Unpriced coins still show "no
  // market price" honestly \u2014 we never fabricate a dollar figure.
  const pricingConfigured = dbReady;

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

  // AREA 4 — per-wallet expandable holdings table view-model (native pinned,
  // alt coins, hidden scam tokens split out). Built by the pure core.
  const holdingsTable = buildHoldingsTable({ wallets, balances, assetById });

  // R1-E CLASSIFY tab. Only load the (potentially large) transaction history +
  // its saved classifications when Michael is actually on this tab. We read every
  // wallet's transactions, pair each with its owner classification (if any), turn
  // the raw amounts into clean display strings, and hand the whole thing to the
  // pure view-model. The page itself carries NO tax logic.
  const classifyView =
    tab === "classify" && dbReady
      ? await (async () => {
          const [txLists, classifications] = await Promise.all([
            Promise.all(wallets.map((w) => listCryptoTransactions(w.id))),
            listCryptoClassifications(),
          ]);
          const classifiedByTxId = new Map<string, string>();
          for (const c of classifications) {
            classifiedByTxId.set(c.transactionId, c.tagKey);
          }
          const txInputs: ClassifyTxInput[] = [];
          for (const list of txLists) {
            for (const t of list) {
              const asset = t.assetId ? assetById.get(t.assetId) ?? getAsset(t.assetId) : null;
              const decimals = t.decimalsAtEvent ?? asset?.decimals ?? null;
              txInputs.push({
                id: t.id,
                assetId: t.assetId,
                direction: (t.direction ?? null) as ClassifyDirection,
                isSwap: t.txType === "swap",
                amountDisplay: formatHeldAmount({
                  amountRaw: t.amountRaw,
                  amountDecimal: t.amountDecimal,
                  decimals,
                }),
                assetLabel: asset?.symbol ?? "",
                whenDisplay: t.blockTime ? t.blockTime.slice(0, 10) : "",
                txRef: t.txHash,
              });
            }
          }
          return buildClassifyView(txInputs, classifiedByTxId);
        })()
      : null;

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
              {t === "classify" && classifyView && classifyView.unclassifiedCount > 0
                ? ` (${classifyView.unclassifiedCount})`
                : ""}
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

                {/* Holdings per wallet — click a wallet to expand its coins */}
                <div className={cardCls}>
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-white">Holdings</h2>
                    {holdingsTable.hiddenTotal > 0 ? (
                      <span className="rounded-full border border-white/15 bg-white/[0.03] px-2 py-0.5 text-[11px] font-semibold text-white/50">
                        {holdingsTable.hiddenTotal} token{holdingsTable.hiddenTotal === 1 ? "" : "s"} hidden
                      </span>
                    ) : null}
                  </div>
                  <p className="mb-4 text-xs text-white/50">
                    Click a wallet to open its coins. Exact quantities come straight from the chain;
                    USD value fills in as pricing is applied. Use <span className="font-semibold text-white/70">Hide</span> on any
                    scam or junk token — it stays in your records and can be unhidden anytime.
                  </p>
                  {holdingsTable.wallets.length === 0 ? (
                    <p className="text-sm text-white/50">
                      No coins to show yet. Once a wallet syncs, its balances appear here.
                    </p>
                  ) : (
                    <HoldingsTable wallets={holdingsTable.wallets} />
                  )}
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

        {/* -------------------------------------------------------- CLASSIFY */}
        {tab === "classify" ? (
          <div className="space-y-6">
            <div className={cardCls}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="mb-1 text-sm font-semibold text-white">
                    Classify your transactions
                  </h2>
                  <p className="text-sm text-white/60">
                    Tell the app what each transaction really was &mdash; a purchase, a reward, a
                    gift, a sale. This is what turns your history into an accurate, defensible tax
                    report. Every row starts on a safe default and is flagged{" "}
                    <span className="font-semibold text-amber-300">needs review</span> until you
                    confirm it &mdash; we never guess income for you.
                  </p>
                </div>
                {classifyView ? (
                  <span
                    className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${
                      classifyView.unclassifiedCount > 0
                        ? "border-amber-500/40 bg-amber-500/[0.08] text-amber-300"
                        : "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-300"
                    }`}
                  >
                    {classifyView.progressText}
                  </span>
                ) : null}
              </div>
            </div>

            <div className={cardCls}>
              {!dbReady ? (
                <p className="text-sm text-white/50">
                  Connect the database first, then sync a wallet &mdash; your transactions will appear
                  here to classify.
                </p>
              ) : (
                <ClassifyTable rows={classifyView ? classifyView.rows : []} />
              )}
            </div>
          </div>
        ) : null}

        {/* ---------------------------------------------------------- HEALTH */}
        {tab === "health" ? (
          <div className="space-y-6">
            <div className={cardCls}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="mb-1 text-sm font-semibold text-white">Pull latest activity</h2>
                  <p className="text-sm text-white/60">
                    Fetch balances and transaction history for every connected wallet. The first sync
                    pulls full history (this can take a moment for active wallets); later syncs pick
                    up only new activity. Each wallet saves its own resume point, so a partial
                    run &mdash; or a timeout &mdash; just continues next time.
                  </p>
                </div>
                <form action={runCryptoSyncNowAction}>
                  <button type="submit" className={btnGhost}>
                    Sync now
                  </button>
                </form>
              </div>
            </div>

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
                Each wallet&apos;s history-sync status in plain English. Use &ldquo;Sync now&rdquo; above to pull
                balances and transactions. The first sync backfills full history; later syncs pick up
                only new activity.
              </p>
              {walletRows.length === 0 ? (
                <p className="text-sm text-white/50">No wallets yet — add one on the Wallets tab.</p>
              ) : (
                <ul className="space-y-2">
                  {walletRows.map((w) => {
                    const state = syncByWallet.get(w.id) ?? null;
                    const health = buildSyncHealth(state);
                    const progress = buildWalletProgress(w.chain, state);
                    return (
                      <li key={w.id} className="rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-white">
                            {w.displayName} <span className="text-white/40">· {w.chainText}</span>
                          </span>
                          <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${chipCls(progress.tone)}`}>
                            ● {progress.label}
                          </span>
                        </div>

                        {/* Progress bar — a TRUE percentage only when honestly
                            computable (EVM with a known chain tip). For
                            opaque-cursor chains we show an indeterminate
                            activity bar instead, never a fabricated number. */}
                        {progress.movement === "progressing" || progress.movement === "stalled" || progress.movement === "complete" ? (
                          <div className="mt-2">
                            <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
                              {progress.hasPercent && progress.percent !== null ? (
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    progress.movement === "complete"
                                      ? "bg-emerald-500"
                                      : progress.movement === "stalled"
                                        ? "bg-amber-400"
                                        : "bg-emerald-400"
                                  }`}
                                  style={{ width: `${progress.percent}%` }}
                                />
                              ) : (
                                <div
                                  className={`h-full w-1/3 rounded-full ${
                                    progress.movement === "stalled" ? "bg-amber-400/70" : "bg-emerald-400/60"
                                  }`}
                                />
                              )}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/45">
                              <span>
                                {progress.hasPercent && progress.percent !== null
                                  ? `${progress.percent}% synced`
                                  : "Syncing history"}
                                {progress.reachedText ? ` · reached ${progress.reachedText}` : ""}
                              </span>
                              {progress.transactionsTotal !== null ? (
                                <span>
                                  {progress.transactionsTotal.toLocaleString()} transaction
                                  {progress.transactionsTotal === 1 ? "" : "s"} captured
                                </span>
                              ) : null}
                            </div>
                          </div>
                        ) : null}

                        <p className="mt-2 text-xs text-white/60">{progress.detail}</p>
                        {/* Keep the original health line as a subtle secondary
                            note (last-refreshed / retry guidance). */}
                        {health.message && health.message !== progress.detail ? (
                          <p className="mt-1 text-[11px] text-white/35">{health.message}</p>
                        ) : null}
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
