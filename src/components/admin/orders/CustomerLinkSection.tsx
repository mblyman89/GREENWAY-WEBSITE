/**
 * CustomerLinkSection — Task T / PR 4 (server component).
 *
 * Staff-confirmed customer↔order linking on the order detail page. Online
 * pickup orders arrive as guest contact info; linking to a POS customer makes
 * loyalty accrue on completion (existing hook in orders-store). Candidates
 * are ranked by EXACT normalized phone/email match (customer-link-core), but
 * the link itself is always a human click — never automatic.
 */
import { findLinkCandidates, getLinkedCustomer } from "@/lib/orders/customer-link-store";
import { linkOrderCustomerAction, unlinkOrderCustomerAction } from "@/app/admin/orders/actions";
import type { OrderWithLines } from "@/lib/orders/types";

export async function CustomerLinkSection({ order }: { order: OrderWithLines }) {
  const isClosed =
    order.status === "completed" || order.status === "cancelled" || order.status === "no_show";
  const linked = await getLinkedCustomer(order.id);
  const candidates = !linked && !isClosed ? await findLinkCandidates(order) : [];

  // Nothing to show: closed order without a link, or no contact info to match.
  if (!linked && (isClosed || candidates.length === 0)) return null;

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/70">
          Member link
        </h2>
        {linked ? (
          <span className="rounded-full border border-[#7ed957]/50 bg-[#7ed957]/10 px-2.5 py-0.5 text-[0.65rem] font-black uppercase tracking-[0.1em] text-[#7ed957]">
            Linked
          </span>
        ) : (
          <span className="rounded-full border border-[#ff7f00]/50 bg-[#ff7f00]/10 px-2.5 py-0.5 text-[0.65rem] font-black uppercase tracking-[0.1em] text-[#ff7f00]">
            Possible match
          </span>
        )}
      </div>

      {linked ? (
        <div className="mt-3 space-y-2 text-sm">
          <p className="font-bold text-white/85">{linked.name}</p>
          <p className="text-xs text-white/50">
            {linked.loyaltyEnrolled
              ? `Loyalty member · ${linked.balancePoints.toLocaleString("en-US")} pts — points accrue when this order completes.`
              : "Customer record linked (not enrolled in loyalty)."}
          </p>
          {!isClosed ? (
            <form action={unlinkOrderCustomerAction}>
              <input type="hidden" name="id" value={order.id} />
              <button
                type="submit"
                className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-bold text-white/70 hover:bg-white/10"
              >
                Remove link
              </button>
            </form>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-xs leading-5 text-white/50">
            This order&apos;s contact info matches {candidates.length === 1 ? "a customer record" : `${candidates.length} customer records`}.
            Confirm the match so loyalty points accrue on completion — linking is a staff decision, never automatic.
          </p>
          <ul className="space-y-2">
            {candidates.map((m) => (
              <li
                key={m.customerId}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-white/85">{m.name}</p>
                  <p className="text-[0.66rem] font-black uppercase tracking-[0.1em] text-[#7ed957]">
                    {m.basisLabel}
                  </p>
                </div>
                <form action={linkOrderCustomerAction}>
                  <input type="hidden" name="id" value={order.id} />
                  <input type="hidden" name="customerId" value={m.customerId} />
                  <button
                    type="submit"
                    className="rounded-lg border border-[#7ed957]/40 bg-[#7ed957]/10 px-3 py-1.5 text-xs font-bold text-[#7ed957] hover:bg-[#7ed957]/20"
                  >
                    Link
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
