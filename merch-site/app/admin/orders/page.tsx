/**
 * /admin/orders - the owner's order desk (Greenway Merchandising LLC only).
 * Lists Printful orders straight from Printful (GET /orders?status=...), shows
 * what the customer paid vs. what Printful charges, and confirms drafts.
 * Only confirmed orders are produced + charged by Printful.
 */
import type { Metadata } from "next";
import { isAdmin } from "@/lib/admin";
import { formatCents } from "@/lib/catalog-core";
import { printful, printfulConfigured } from "@/lib/fulfillment";
import { ADMIN_STATUS_FILTERS, summarizeOrder, type AdminOrderRow } from "@/lib/orders-core";
import { confirmOrder, login, logout } from "./actions";

export const metadata: Metadata = { title: "Order desk", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const money = (c: number | null) => (c == null ? "-" : formatCents(c));
const BTN = "rounded-full px-4 py-2 text-[11px] font-black uppercase tracking-[0.14em]";

export default async function OrdersDesk({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const keySet = (process.env.MERCH_ADMIN_KEY ?? "").trim().length >= 16;

  if (!(await isAdmin())) {
    return (
      <main className="mx-auto w-full max-w-sm px-4 py-20">
        <h1 className="text-2xl font-black text-white">Order desk</h1>
        {!keySet ? (
          <p className="mt-4 text-sm text-zinc-400">Set <code>MERCH_ADMIN_KEY</code> (16+ characters, ideally 32+ random) in Vercel to open the order desk.</p>
        ) : (
          <form action={login} className="mt-6 grid gap-3">
            <label className="text-xs font-black uppercase tracking-[0.16em] text-zinc-400" htmlFor="key">Admin key</label>
            <input id="key" name="key" type="password" autoComplete="current-password" required className="rounded-xl border border-white/15 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-[var(--greenway)]" />
            {one("e") ? <p className="text-sm text-red-400">That key didn&apos;t match.</p> : null}
            <button className={`${BTN} bg-[var(--greenway)] text-black`}>Open</button>
          </form>
        )}
      </main>
    );
  }

  const status = (ADMIN_STATUS_FILTERS as readonly string[]).includes(one("status")) ? one("status") : "draft";
  const res = printfulConfigured() ? await printful<unknown[]>(`/orders?status=${status}&limit=100`) : null;
  const rows = (res?.ok && Array.isArray(res.result) ? res.result : []).map(summarizeOrder).filter((r): r is AdminOrderRow => !!r);
  const ours = rows.filter((r) => r.ours);
  const totals = ours.reduce((t, r) => ({ retail: t.retail + (r.retailCents ?? 0), cost: t.cost + (r.costCents ?? 0) }), { retail: 0, cost: 0 });

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--greenway)]">Greenway Merchandising LLC</p>
          <h1 className="text-3xl font-black text-white">Order desk</h1>
        </div>
        <form action={logout}><button className={`${BTN} border border-white/15 text-zinc-300`}>Sign out</button></form>
      </div>

      <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
        Paid orders arrive here as Printful <b className="text-white">drafts</b>. Printful only prints and charges for confirmed orders - check the
        address and items, then press Confirm. Orders also stay visible in Printful &gt; Orders and Stripe &gt; Payments (search the gm- number).
      </p>
      {one("msg") ? <p role="status" className="mt-4 rounded-xl border border-[var(--greenway)]/40 bg-[var(--greenway)]/10 px-4 py-3 text-sm text-white">{one("msg")}</p> : null}

      <nav className="mt-6 flex flex-wrap gap-2" aria-label="Order status">
        {ADMIN_STATUS_FILTERS.map((s) => (
          <a key={s} href={`/admin/orders?status=${s}`} aria-current={s === status ? "page" : undefined}
            className={`${BTN} border ${s === status ? "border-[var(--greenway)] bg-[var(--greenway)] text-black" : "border-white/15 text-zinc-300 hover:border-white/40"}`}>{s}</a>
        ))}
      </nav>

      {!printfulConfigured() ? (
        <p className="mt-8 text-sm text-amber-300">PRINTFUL_API_TOKEN isn&apos;t set in this Vercel project yet.</p>
      ) : !res?.ok ? (
        <p className="mt-8 text-sm text-red-400">Printful error: {res?.error ?? "unknown"}</p>
      ) : !rows.length ? (
        <p className="mt-8 text-sm text-zinc-400">No {status} orders.</p>
      ) : (
        <>
          <div className="mt-6 overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="bg-zinc-950 text-[11px] uppercase tracking-[0.14em] text-zinc-400">
                <tr><th className="p-3">Order</th><th className="p-3">Placed</th><th className="p-3">Customer</th><th className="p-3">Items</th><th className="p-3 text-right">Paid</th><th className="p-3 text-right">Printful cost</th><th className="p-3 text-right">Margin</th><th className="p-3" /></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-white/10 text-zinc-200">
                    <td className="p-3 font-black text-white">{r.orderRef || `#${r.id}`}{!r.ours ? <span className="ml-2 text-[10px] font-bold uppercase text-zinc-500">not from site</span> : null}</td>
                    <td className="p-3 whitespace-nowrap">{r.createdSec ? new Date(r.createdSec * 1000).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" }) : "-"}</td>
                    <td className="p-3">{r.customer || "-"}<span className="block text-xs text-zinc-500">{r.shipTo}</span></td>
                    <td className="p-3">{r.itemCount}</td>
                    <td className="p-3 text-right">{money(r.retailCents)}</td>
                    <td className="p-3 text-right">{money(r.costCents)}</td>
                    <td className={`p-3 text-right font-black ${r.marginCents != null && r.marginCents < 0 ? "text-red-400" : "text-[var(--greenway)]"}`}>{money(r.marginCents)}</td>
                    <td className="p-3 text-right">
                      {r.confirmable && r.ours ? (
                        <form action={confirmOrder}>
                          <input type="hidden" name="id" value={r.id} /><input type="hidden" name="ref" value={r.orderRef} /><input type="hidden" name="status" value={status} />
                          <button className={`${BTN} bg-[var(--orange)] text-black`}>Confirm</button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            Site orders on this page: paid {formatCents(totals.retail)} / Printful cost {formatCents(totals.cost)}. Margin is before Stripe fees and
            sales tax remittance; Printful&apos;s cost can be blank until it prices a draft. Showing up to 100{res.paging?.total ? ` of ${res.paging.total}` : ""}.
          </p>
        </>
      )}
    </main>
  );
}
