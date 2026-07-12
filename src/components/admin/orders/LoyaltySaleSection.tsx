/**
 * LoyaltySaleSection — Task S-a (server component).
 *
 * The loyalty half of the order detail page (docs/LOYALTY_COMPLIANCE.md):
 *  - Nothing applied: enter the customer's redemption code (GW-XXXX-XXXX), or
 *    find the member and apply their TIER pricing. The section previews the
 *    tier savings and recommends the better option — best deal wins, never
 *    both (owner: "no discount stacking").
 *  - Applied: show what was applied, its value, and a remove button (codes
 *    are released back to the customer on removal / cancellation).
 *
 * Every reduction respects the statutory cannabis floor (RCW 69.50.357) and
 * the acquisition-cost floor (WAC 314-55-155(5)(g)) — enforced server-side by
 * the pure loyalty-sale-core. Degrades gracefully before migration 0116.
 */
import { getOrderLoyaltyContext, previewTierSavings } from "@/lib/loyalty/loyalty-sale-store";
import { listCustomers } from "@/lib/customers/store";
import { getAccountByCustomer } from "@/lib/loyalty/loyalty-store";
import {
  applyLoyaltyCodeAction,
  applyLoyaltyTierAction,
  removeLoyaltyAction,
} from "@/app/admin/orders/actions";
import type { OrderWithLines } from "@/lib/orders/types";

function money(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

export async function LoyaltySaleSection({
  order,
  searchQuery,
}: {
  order: OrderWithLines;
  searchQuery: string;
}) {
  const isClosed = order.status === "completed" || order.status === "cancelled" || order.status === "no_show";
  const ctx = await getOrderLoyaltyContext(order.id);

  // Linked member's tier preview (read-only; the action recomputes).
  const memberPreview =
    !ctx.kind && ctx.member && ctx.member.tierDiscountBps > 0
      ? await previewTierSavings(order.id, ctx.member.customerId)
      : null;

  // Member search (only when open + nothing applied + no linked member offer).
  let results: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    enrolled: boolean;
    balance: number;
  }[] = [];
  if (!isClosed && !ctx.kind && ctx.migrationApplied && searchQuery.trim()) {
    const customers = await listCustomers({ q: searchQuery, limit: 8 });
    results = await Promise.all(
      customers.map(async (c) => {
        const account = await getAccountByCustomer(c.id);
        return {
          id: c.id,
          name: `${c.first_name}${c.last_name ? ` ${c.last_name}` : ""}`,
          email: c.email,
          phone: c.phone,
          enrolled: !!account && account.is_active,
          balance: account?.balance_points ?? 0,
        };
      }),
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/70">Loyalty</h2>
        {ctx.kind === "code" ? (
          <span className="rounded-full border border-[#ffd700]/50 bg-[#ffd700]/10 px-2.5 py-0.5 text-[0.65rem] font-black uppercase tracking-[0.1em] text-[#ffd700]">
            Code applied
          </span>
        ) : ctx.kind === "tier" ? (
          <span className="rounded-full border border-[#7ed957]/50 bg-[#7ed957]/10 px-2.5 py-0.5 text-[0.65rem] font-black uppercase tracking-[0.1em] text-[#7ed957]">
            Member pricing
          </span>
        ) : (
          <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[0.65rem] font-black uppercase tracking-[0.1em] text-white/50">
            None applied
          </span>
        )}
      </div>

      {!ctx.migrationApplied ? (
        <p className="mt-3 rounded-lg border border-[#ffd700]/40 bg-[#ffd700]/10 p-3 text-xs leading-5 text-[#ffd700]">
          Migration 0116 (loyalty at sale) has not been applied yet — run it in the Supabase SQL
          editor to enable loyalty at the register.
        </p>
      ) : ctx.kind ? (
        // ── Applied state ────────────────────────────────────────────────────
        <div className="mt-4 space-y-3">
          <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-sm">
            {ctx.kind === "code" ? (
              <>
                <p className="font-black text-white">
                  Code <span className="font-mono">{ctx.code}</span>
                </p>
                <p className="mt-0.5 text-xs text-white/50">
                  {money(ctx.discountMinorUnits)} taken off this order. The code was consumed — the
                  customer&apos;s points were already deducted when it was issued.
                </p>
                {ctx.redemption && (ctx.redemption.status !== "redeemed" || ctx.redemption.redeemedOrderId !== order.id) ? (
                  <p className="mt-2 rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-200">
                    This code is no longer reserved for this order — completion is blocked. Remove
                    the loyalty discount and re-apply a valid code.
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <p className="font-black text-white">{ctx.tierLabel ?? "Member tier"} pricing</p>
                <p className="mt-0.5 text-xs text-white/50">
                  {money(ctx.discountMinorUnits)} additional savings. Each line kept the BETTER of
                  the promo price or the tier price — never both (no stacking).
                </p>
              </>
            )}
          </div>
          {!isClosed ? (
            <form action={removeLoyaltyAction}>
              <input type="hidden" name="id" value={order.id} />
              <button
                type="submit"
                className="rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-bold text-white hover:bg-white/10"
              >
                Remove loyalty discount
              </button>
              <p className="mt-1.5 text-[0.68rem] leading-4 text-white/35">
                Prices are restored{ctx.kind === "code" ? " and the code goes back to the customer" : ""}.
              </p>
            </form>
          ) : null}
        </div>
      ) : isClosed ? (
        <p className="mt-3 text-xs text-white/40">No loyalty was applied to this order.</p>
      ) : (
        // ── Nothing applied: code entry + member pricing ─────────────────────
        <div className="mt-4 space-y-4">
          <form action={applyLoyaltyCodeAction} className="space-y-2">
            <input type="hidden" name="id" value={order.id} />
            <label className="block text-[0.66rem] font-black uppercase tracking-[0.12em] text-white/40">
              Redemption code
            </label>
            <div className="flex gap-2">
              <input
                name="code"
                placeholder="GW-XXXX-XXXX"
                autoComplete="off"
                className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 font-mono text-sm text-white placeholder-white/25 focus:border-[#7ed957]/60 focus:outline-none"
              />
              <button
                type="submit"
                className="shrink-0 rounded-lg border border-[#7ed957]/50 bg-[#7ed957]/10 px-3.5 py-2 text-xs font-bold text-[#7ed957] hover:bg-[#7ed957]/20"
              >
                Apply code
              </button>
            </div>
            <p className="text-[0.68rem] leading-4 text-white/35">
              The code&apos;s full value comes off this order (spread across items, never below the
              legal price floors). One loyalty discount per order — no stacking.
            </p>
          </form>

          {ctx.member ? (
            <div className="rounded-lg border border-white/10 bg-black/30 p-3">
              <p className="text-[0.66rem] font-black uppercase tracking-[0.12em] text-white/40">
                Linked member
              </p>
              <p className="mt-1 text-sm text-white/80">
                {ctx.member.balancePoints.toLocaleString("en-US")} pts
                {ctx.member.tierName ? ` · ${ctx.member.tierName}` : " · no tier yet"}
              </p>
              {memberPreview && memberPreview.additionalSavingsMinorUnits > 0 ? (
                <form action={applyLoyaltyTierAction} className="mt-2">
                  <input type="hidden" name="id" value={order.id} />
                  <input type="hidden" name="customerId" value={ctx.member.customerId} />
                  <button
                    type="submit"
                    className="rounded-lg border border-[#7ed957]/50 bg-[#7ed957]/10 px-3.5 py-2 text-xs font-bold text-[#7ed957] hover:bg-[#7ed957]/20"
                  >
                    Apply {memberPreview.tierName} pricing (−{money(memberPreview.additionalSavingsMinorUnits)})
                  </button>
                </form>
              ) : ctx.member.tierDiscountBps > 0 ? (
                <p className="mt-2 text-xs text-white/40">
                  Today&apos;s promo prices already beat or match this member&apos;s tier pricing on
                  every item — they automatically keep the better deal.
                </p>
              ) : null}
            </div>
          ) : (
            <div>
              <p className="text-[0.66rem] font-black uppercase tracking-[0.12em] text-white/40">
                Find a member (tier pricing)
              </p>
              <form method="get" className="mt-2 flex gap-2">
                <input
                  name="loyq"
                  defaultValue={searchQuery}
                  placeholder="Name, phone, or email…"
                  autoComplete="off"
                  className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder-white/25 focus:border-[#7ed957]/60 focus:outline-none"
                />
                <button
                  type="submit"
                  className="shrink-0 rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-bold text-white hover:bg-white/10"
                >
                  Search
                </button>
              </form>
              {searchQuery.trim() ? (
                results.length === 0 ? (
                  <p className="mt-2 text-xs text-white/40">No customers match “{searchQuery}”.</p>
                ) : (
                  <div className="mt-2 space-y-1.5">
                    {results.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-white/85">{r.name}</p>
                          <p className="truncate text-xs text-white/40">
                            {[r.phone, r.email].filter(Boolean).join(" · ") || "—"}
                            {r.enrolled ? ` · ${r.balance.toLocaleString("en-US")} pts` : " · not enrolled"}
                          </p>
                        </div>
                        {r.enrolled ? (
                          <form action={applyLoyaltyTierAction}>
                            <input type="hidden" name="id" value={order.id} />
                            <input type="hidden" name="customerId" value={r.id} />
                            <button
                              type="submit"
                              className="shrink-0 rounded-lg border border-[#7ed957]/50 bg-[#7ed957]/10 px-3 py-1.5 text-xs font-bold text-[#7ed957] hover:bg-[#7ed957]/20"
                            >
                              Apply member pricing
                            </button>
                          </form>
                        ) : (
                          <span className="shrink-0 text-[0.66rem] text-white/30">Enroll on their profile</span>
                        )}
                      </div>
                    ))}
                  </div>
                )
              ) : null}
              <p className="mt-2 text-[0.68rem] leading-4 text-white/35">
                Member pricing gives each line the BETTER of the promo price or the tier price —
                never both. If a promo already wins everywhere, nothing changes.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
