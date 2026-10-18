/**
 * R73 S1 - the details page for one Greenway Merch order (greenwaymerch.com,
 * fulfilled by Printful). Opened from the "Greenway Merch orders" panel, the
 * last panel on /admin/orders, exactly like our own and Leafly's orders: the
 * row only shows; the steps are done here.
 *
 * Steps (merch-actions.ts): Confirm a draft (Printful charges the LLC's card
 * and starts production) and Cancel (drafts / pending only). Shipping and the
 * customer's tracking email are automatic (the Printful webhook on
 * greenwaymerch.com), so this page shows them rather than asking for them.
 */
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BackLink } from "@/components/admin/ux";
import { Card, CardHeader } from "@/components/admin/ui/Card";
import { OrderStatusPill } from "@/components/admin/orders/OrderStatusPill";
import { OrderStatusFlow } from "@/components/admin/orders/OrderStatusFlow";
import { SaveButton } from "@/components/admin/orders/SaveButton";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { getMerchOrder } from "@/lib/orders/merch-orders-server";
import { merchOrderHandle, merchStatusLabel, type MerchMoney } from "@/lib/orders/merch-orders-core";
import { cancelMerchOrderAction, confirmMerchOrderAction } from "../../merch-actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SearchParams = { back?: string; merchMsg?: string; merchErr?: string };

const money = (c: number | null) => (c === null ? "—" : formatMinorCurrency(c));
const BOX = "rounded-2xl border border-white/10 bg-[#0d0d0d] p-5";
const H2 = "text-sm font-black uppercase tracking-[0.14em] text-white/70";

function MoneyTable({ paid, cost }: { paid: MerchMoney; cost: MerchMoney }) {
  const rows: [string, keyof MerchMoney][] = [
    ["Subtotal", "subtotal"],
    ["Discount", "discount"],
    ["Shipping", "shipping"],
    ["Sales tax", "tax"],
    ["Total", "total"],
  ];
  return (
    <table className="mt-3 w-full text-sm">
      <thead>
        <tr className="text-left text-[0.65rem] uppercase tracking-wide text-[var(--admin-text-faint)]">
          <th className="py-1 font-semibold" />
          <th className="py-1 text-right font-semibold">Customer paid</th>
          <th className="py-1 text-right font-semibold">Printful charges us</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, k]) => (
          <tr key={k} className={k === "total" ? "border-t border-white/10 font-bold" : ""}>
            <td className="py-1 text-[var(--admin-text-muted)]">{label}</td>
            <td className="py-1 text-right tabular-nums">{money(paid[k])}</td>
            <td className="py-1 text-right tabular-nums">{money(cost[k])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function MerchOrderDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  await requirePermission("orders.view");
  const { ref: raw } = await params;
  const sp: SearchParams = searchParams ? await searchParams : {};
  let handle = raw;
  try {
    handle = decodeURIComponent(raw);
  } catch {
    /* malformed escape -> not found below */
  }

  const read = await getMerchOrder(handle);
  if (!read.ok && read.notFound) notFound();

  const header = (title: string, subtitle: string) => (
    <AdminPageHeader
      title={title}
      subtitle={subtitle}
      action={
        <BackLink
          fallback="/admin/orders#merch-orders"
          back={sp.back}
          className="rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-bold text-white hover:bg-white/10"
        >
          Back to orders
        </BackLink>
      }
    />
  );

  if (!read.ok) {
    return (
      <div>
        {header("Merch order", "Couldn't load this order from Printful.")}
        <div className="px-5 py-6 sm:px-8">
          <p className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-4 py-3 text-sm text-[var(--admin-danger)]">
            {read.error}
          </p>
        </div>
      </div>
    );
  }

  const o = read.order;
  const h = merchOrderHandle(o);
  const placed = o.placedAt ? new Date(o.placedAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" }) : "—";

  return (
    <div>
      {header(
        `Merch order ${o.ours ? o.ref : `#${o.id}`}`,
        `Greenway Merch (greenwaymerch.com) · placed ${placed} PT · Printful #${o.id}`,
      )}
      <div className="space-y-5 px-5 py-6 sm:px-8">
        {sp.merchMsg ? (
          <p role="status" className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm font-semibold text-[var(--admin-accent)]">
            {sp.merchMsg}
          </p>
        ) : null}
        {sp.merchErr ? (
          <p role="alert" className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-4 py-3 text-sm font-semibold text-[var(--admin-danger)]">
            {sp.merchErr}
          </p>
        ) : null}

        <div className={BOX}>
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusPill status={o.status} label={merchStatusLabel(o.printfulStatus)} title={`Printful status: ${o.printfulStatus}`} />
            {!o.ours ? <span className="text-xs text-[var(--admin-text-faint)]">Not placed by greenwaymerch.com (no gm- reference).</span> : null}
          </div>
          <div className="mt-4">
            <OrderStatusFlow status={o.status} size="md" />
          </div>

          <h2 className={`${H2} mt-6`}>Merch steps</h2>
          {o.confirmable ? (
            <form action={confirmMerchOrderAction} className="mt-3 space-y-2">
              <input type="hidden" name="handle" value={h} />
              <input type="hidden" name="back" value={sp.back ?? ""} />
              <p className="text-sm text-[var(--admin-text-muted)]">
                This order is paid and waiting as a Printful <strong>draft</strong>. Check the items and address below,
                then confirm. Printful charges the LLC&apos;s card on file and starts production.
              </p>
              <SaveButton label="Confirm and send to production" busyLabel="Confirming with Printful…" variant="confirm" size="md" />
            </form>
          ) : o.printfulStatus === "failed" || o.printfulStatus === "onhold" ? (
            <p className="mt-3 text-sm text-[var(--admin-gold)]">
              Printful flagged this order ({merchStatusLabel(o.printfulStatus)}). Open it in your Printful dashboard to see why
              and fix it there (usually an address or print-file problem).
            </p>
          ) : (
            <p className="mt-3 text-sm text-[var(--admin-text-muted)]">
              Nothing to do here: Printful is handling it. When it ships, the customer is emailed tracking automatically.
            </p>
          )}
          <p className="mt-3 text-xs">
            <a href="https://www.printful.com/dashboard/default/orders" target="_blank" rel="noopener noreferrer" className="font-bold text-[var(--admin-accent)] underline underline-offset-2">
              Open Printful orders dashboard ↗
            </a>
            <span className="mx-2 text-white/20">|</span>
            <a href="https://dashboard.stripe.com/payments" target="_blank" rel="noopener noreferrer" className="font-bold text-[var(--admin-accent)] underline underline-offset-2">
              Open Stripe payments ↗
            </a>
            <span className="ml-2 text-[var(--admin-text-faint)]">(search for {o.ours ? o.ref : `#${o.id}`})</span>
          </p>

          {o.cancellable ? (
            <details className="mt-5 rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/30 p-3">
              <summary className="cursor-pointer text-xs font-bold text-[var(--admin-danger)]">Cancel this order…</summary>
              <form action={cancelMerchOrderAction} className="mt-3 space-y-2">
                <input type="hidden" name="handle" value={h} />
                <input type="hidden" name="back" value={sp.back ?? ""} />
                <p className="text-xs text-[var(--admin-text-muted)]">
                  Cancels it at Printful (any Printful charge is returned to the LLC&apos;s card). This does <strong>not</strong>{" "}
                  refund the customer: refund them in Stripe as well.
                </p>
                <SaveButton label="Yes, cancel at Printful" busyLabel="Cancelling…" variant="danger" />
              </form>
            </details>
          ) : null}
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card padding="sm" className="sm:p-5">
            <CardHeader title="Customer & shipping" icon="📦" />
            <dl className="mt-3 space-y-1 text-sm">
              <div><dt className="inline text-[var(--admin-text-faint)]">Name: </dt><dd className="inline">{o.name || "—"}</dd></div>
              <div><dt className="inline text-[var(--admin-text-faint)]">Email: </dt><dd className="inline">{o.email ? <a className="underline" href={`mailto:${o.email}`}>{o.email}</a> : "—"}</dd></div>
              <div><dt className="inline text-[var(--admin-text-faint)]">Phone: </dt><dd className="inline">{o.phone || "—"}</dd></div>
              <div>
                <dt className="inline text-[var(--admin-text-faint)]">Ship to: </dt>
                <dd className="inline">
                  {[o.address.line1, o.address.line2, `${o.address.city}${o.address.city ? ", " : ""}${o.address.state} ${o.address.zip}`.trim(), o.address.country].filter(Boolean).join(" · ") || "—"}
                </dd>
              </div>
              <div><dt className="inline text-[var(--admin-text-faint)]">Method: </dt><dd className="inline">{o.shippingMethod || "—"}</dd></div>
            </dl>
            {o.shipments.length ? (
              <div className="mt-4">
                <h3 className={H2}>Shipments</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {o.shipments.map((s, i) => (
                    <li key={`${s.trackingNumber}-${i}`}>
                      {s.carrier} {s.service} · {s.shipDate || "date n/a"} ·{" "}
                      {s.trackingUrl ? (
                        <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer" className="underline">{s.trackingNumber || "track"}</a>
                      ) : (
                        s.trackingNumber || "no tracking yet"
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>

          <Card padding="sm" className="sm:p-5">
            <CardHeader title="Money" icon="💵" />
            <MoneyTable paid={o.paid} cost={o.cost} />
            <p className="mt-2 text-sm font-bold">
              Margin: <span className="tabular-nums">{money(o.marginCents)}</span>
              {o.marginCents === null ? <span className="ml-2 text-xs font-normal text-[var(--admin-text-faint)]">(Printful prices a draft once it can calculate it)</span> : null}
            </p>
            <p className="mt-1 text-xs text-[var(--admin-text-faint)]">
              &ldquo;Sales tax&rdquo; under Customer paid is what the customer was charged and the LLC owes Washington DOR. Printful does not remit it for us.
            </p>
          </Card>
        </div>

        <Card padding="sm" className="sm:p-5">
          <CardHeader title={`Items (${o.itemCount})`} icon="👕" />
          <ul className="mt-3 divide-y divide-white/10">
            {o.items.map((it, i) => (
              <li key={`${it.variantId ?? it.sku}-${i}`} className="flex items-center gap-3 py-2 text-sm">
                {it.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Printful CDN preview, admin only
                  <img src={it.thumbnail} alt="" width={48} height={48} className="h-12 w-12 rounded object-cover" loading="lazy" referrerPolicy="no-referrer" />
                ) : (
                  <span className="h-12 w-12 rounded bg-white/5" aria-hidden />
                )}
                <span className="flex-1">
                  {it.name}
                  {it.sku ? <span className="ml-2 font-mono text-xs text-[var(--admin-text-faint)]">{it.sku}</span> : null}
                </span>
                <span className="tabular-nums">×{it.quantity}</span>
                <span className="w-20 text-right tabular-nums">{money(it.retailCents)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
