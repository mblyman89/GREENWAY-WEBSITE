"use client";

/**
 * HoldingsTable — the Portfolio page's per-wallet, expandable holdings table
 * (AREA 4). Click a wallet's header (its address) to open a clean table of every
 * coin it holds: native coin pinned first, then the discovered alt coins.
 *
 * Enterprise columns shown TODAY (all provable, never guessed):
 *   Asset · Amount · Value (USD, or an honest "value pending") · Contract ·
 *   Explorer link · Decimals + a "verified" check · Hide.
 * Priced columns (price / % of portfolio / 24h / cost basis / gain-loss) arrive
 * with USD valuation (roadmap R3); we deliberately don't show a wall of dashes.
 *
 * SCAM CONTROL: each row has a Hide button. Hiding moves the token into a
 * "Hidden tokens" reviewer at the bottom of that wallet — the token stays in the
 * database for provability and is one click from being unhidden. Nothing is ever
 * deleted. Hide/unhide submits the existing server action (owner/admin only,
 * audited); this component only owns the open/closed UI state.
 *
 * The whole shape is built server-side by the pure buildHoldingsTable core and
 * passed in as plain data, so this file contains ZERO business logic.
 */
import { useState } from "react";
import { setCryptoAssetHiddenAction } from "./actions";
import type { WalletHoldings, HoldingRow } from "@/lib/crypto/crypto-holdings-table-core";

function chevron(open: boolean): string {
  return open ? "rotate-90" : "";
}

function HideButton({ assetId, hidden }: { assetId: string; hidden: boolean }) {
  return (
    <form action={setCryptoAssetHiddenAction} className="inline">
      <input type="hidden" name="assetId" value={assetId} />
      <input type="hidden" name="hidden" value={hidden ? "0" : "1"} />
      <button
        type="submit"
        title={hidden ? "Unhide — show this token in your portfolio again" : "Hide this token from your portfolio (kept in your records)"}
        className={
          hidden
            ? "rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] px-2 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/[0.12]"
            : "rounded-md border border-white/15 bg-white/[0.03] px-2 py-1 text-xs font-semibold text-white/70 hover:bg-white/[0.08] hover:text-white"
        }
      >
        {hidden ? "Unhide" : "Hide"}
      </button>
    </form>
  );
}

function TokenRow({ row }: { row: HoldingRow }) {
  return (
    <tr className="border-t border-white/5 align-middle">
      {/* Asset */}
      <td className="py-2 pr-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-white/90">{row.symbol}</span>
          {row.native ? (
            <span className="rounded-full border border-sky-500/40 bg-sky-500/[0.08] px-1.5 py-0.5 text-[10px] font-semibold text-sky-300">
              native
            </span>
          ) : null}
          {!row.verified ? (
            <span
              title="We haven't verified this token's precision from a first-party source yet."
              className="cursor-help rounded-full border border-amber-500/40 bg-amber-500/[0.08] px-1.5 py-0.5 text-[10px] font-semibold text-amber-300"
            >
              unverified
            </span>
          ) : null}
        </div>
        <div className="text-xs text-white/40">{row.name}</div>
      </td>

      {/* Amount */}
      <td className="py-2 pr-3 text-right font-mono text-white/85">{row.amountText}</td>

      {/* Value (USD) — honest pending until priced */}
      <td className="py-2 pr-3 text-right">
        {row.valueText !== null ? (
          <span className="text-white/80">{row.valueText}</span>
        ) : (
          <span className="text-amber-300/80">value pending</span>
        )}
      </td>

      {/* % of portfolio — only when priced (never a fabricated share) */}
      <td className="py-2 pr-3 text-right">
        {row.percentText !== null ? (
          <span className="text-white/60">{row.percentText}</span>
        ) : (
          <span className="text-white/25">—</span>
        )}
      </td>

      {/* Contract */}
      <td className="py-2 pr-3 font-mono text-xs text-white/50">
        {row.contractShort ?? <span className="text-white/30">native coin</span>}
      </td>

      {/* Explorer */}
      <td className="py-2 pr-3 text-xs">
        {row.explorerUrl ? (
          <a
            href={row.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-emerald-300 hover:underline"
          >
            View ↗
          </a>
        ) : (
          <span className="text-white/30">—</span>
        )}
      </td>

      {/* Decimals */}
      <td className="py-2 pr-3 text-right text-xs">
        {row.decimals !== null ? (
          <span className="text-white/60">
            {row.decimals}
            {row.verified ? <span className="ml-1 text-emerald-400" title="Verified from the chain">✓</span> : null}
          </span>
        ) : (
          <span className="text-white/30">—</span>
        )}
      </td>

      {/* Hide / Unhide */}
      <td className="py-2 text-right">
        <HideButton assetId={row.assetId} hidden={row.hidden} />
      </td>
    </tr>
  );
}

function WalletCard({ wallet }: { wallet: WalletHoldings }) {
  const [open, setOpen] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  return (
    <div className="rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02]">
      {/* Header — click to expand */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">
            {wallet.displayName}{" "}
            <span className="font-normal text-white/40">· {wallet.chainText} · {wallet.addressShort}</span>
          </p>
          <p className="mt-0.5 text-xs text-white/40">
            {wallet.visibleCount} coin{wallet.visibleCount === 1 ? "" : "s"}
            {wallet.hiddenCount > 0 ? ` · ${wallet.hiddenCount} hidden` : ""}
            {wallet.valuedCents > 0 ? ` · ${wallet.valuedText}` : ""}
          </p>
        </div>
        <span className={`shrink-0 text-white/40 transition-transform ${chevron(open)}`} aria-hidden="true">
          ▶
        </span>
      </button>

      {/* Body — the holdings table */}
      {open ? (
        <div className="border-t border-white/5 px-4 pb-4 pt-2">
          {wallet.visible.length === 0 ? (
            <p className="py-2 text-sm text-white/50">All of this wallet&apos;s tokens are hidden.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-white/40">
                    <th className="pb-2 pr-3 font-semibold">Asset</th>
                    <th className="pb-2 pr-3 text-right font-semibold">Amount</th>
                    <th className="pb-2 pr-3 text-right font-semibold">Value (USD)</th>
                    <th className="pb-2 pr-3 text-right font-semibold">% Portfolio</th>
                    <th className="pb-2 pr-3 font-semibold">Contract</th>
                    <th className="pb-2 pr-3 font-semibold">Explorer</th>
                    <th className="pb-2 pr-3 text-right font-semibold">Decimals</th>
                    <th className="pb-2 text-right font-semibold">Hide</th>
                  </tr>
                </thead>
                <tbody>
                  {wallet.visible.map((row) => (
                    <TokenRow key={row.balanceId} row={row} />
                  ))}
                </tbody>
                {wallet.valuedCents > 0 ? (
                  <tfoot>
                    <tr className="border-t border-white/10 text-[13px]">
                      <td className="pt-2 pr-3 font-semibold text-white/70">Wallet total</td>
                      <td className="pt-2 pr-3" />
                      <td className="pt-2 pr-3 text-right font-semibold text-emerald-300">
                        {wallet.valuedText}
                      </td>
                      <td className="pt-2 pr-3" />
                      <td className="pt-2 pr-3" />
                      <td className="pt-2 pr-3" />
                      <td className="pt-2 pr-3" />
                      <td className="pt-2" />
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          )}

          {/* Hidden tokens reviewer — kept for provability, one click to unhide */}
          {wallet.hidden.length > 0 ? (
            <div className="mt-4 rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.015] p-3">
              <button
                type="button"
                onClick={() => setShowHidden((v) => !v)}
                aria-expanded={showHidden}
                className="flex w-full items-center justify-between text-left text-xs font-semibold text-white/60 hover:text-white/80"
              >
                <span>
                  Hidden tokens ({wallet.hidden.length}) — kept in your records, hidden from view
                </span>
                <span className={`text-white/40 transition-transform ${chevron(showHidden)}`} aria-hidden="true">
                  ▶
                </span>
              </button>
              {showHidden ? (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-white/40">
                        <th className="pb-2 pr-3 font-semibold">Asset</th>
                        <th className="pb-2 pr-3 text-right font-semibold">Amount</th>
                        <th className="pb-2 pr-3 text-right font-semibold">Value (USD)</th>
                        <th className="pb-2 pr-3 text-right font-semibold">% Portfolio</th>
                        <th className="pb-2 pr-3 font-semibold">Contract</th>
                        <th className="pb-2 pr-3 font-semibold">Explorer</th>
                        <th className="pb-2 pr-3 text-right font-semibold">Decimals</th>
                        <th className="pb-2 text-right font-semibold">Unhide</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wallet.hidden.map((row) => (
                        <TokenRow key={row.balanceId} row={row} />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function HoldingsTable({ wallets }: { wallets: WalletHoldings[] }) {
  if (wallets.length === 0) return null;
  return (
    <div className="space-y-3">
      {wallets.map((w) => (
        <WalletCard key={w.walletId} wallet={w} />
      ))}
    </div>
  );
}
