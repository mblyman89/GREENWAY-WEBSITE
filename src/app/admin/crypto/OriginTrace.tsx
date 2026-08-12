/**
 * OriginTrace (R1-G4) — the "Origin Trace" tab's discovered-wallet review queue.
 *
 * When a coin's back-trace reaches an OUTSIDE wallet we don't yet trust, the
 * trace surfaces that address HERE instead of guessing it's Michael's. Each row
 * asks one plain-English question — "Is this wallet yours?" — with two audited
 * choices:
 *
 *   - "Yes, it's mine" (confirm): on the next trace we carry Michael's cost
 *     basis through it (a non-taxable move) and look one hop further back.
 *   - "No, not mine" (reject): we remember the decision and stop re-suggesting
 *     it; that receipt then needs a manual basis instead.
 *
 * This is a server component: it renders plain <form>s that post to the audited
 * confirmOwnerWalletAction. No client state needed — the whole flow is a simple
 * confirm/reject POST, exactly like the wallet-transfer reconcile screen.
 */
import { confirmOwnerWalletAction } from "./actions";
import type { TraceView } from "@/lib/crypto/crypto-trace-view-core";

export function OriginTrace({ view }: { view: TraceView }) {
  if (view.pendingCount === 0) {
    return (
      <p className="text-sm text-white/50">
        No wallets to review right now. As you sync more wallets and the trace follows your coins
        back toward where they started, any upstream wallet we can&rsquo;t place yet will show up
        here for you to confirm.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {view.pending.map((row) => (
        <div key={`${row.chain}:${row.address}`} className="border-t border-white/5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-sm text-white">{row.addressShort}</p>
              <p className="text-xs text-white/50">
                {row.chainLabel} &middot; {row.referenceText} traced back here
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <form action={confirmOwnerWalletAction}>
                <input type="hidden" name="address" value={row.address} />
                <input type="hidden" name="chain" value={row.chain} />
                <input type="hidden" name="referenceCount" value={String(row.referenceCount)} />
                <input type="hidden" name="status" value="confirmed" />
                <button
                  type="submit"
                  className="rounded-md border border-emerald-500/40 bg-emerald-500/[0.08] px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/[0.15]"
                >
                  Yes, it&rsquo;s mine
                </button>
              </form>

              <form action={confirmOwnerWalletAction}>
                <input type="hidden" name="address" value={row.address} />
                <input type="hidden" name="chain" value={row.chain} />
                <input type="hidden" name="referenceCount" value={String(row.referenceCount)} />
                <input type="hidden" name="status" value="rejected" />
                <button
                  type="submit"
                  className="rounded-md border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/[0.08]"
                >
                  No, not mine
                </button>
              </form>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
