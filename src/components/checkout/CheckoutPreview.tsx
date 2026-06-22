"use client";

import Link from "next/link";
import { useMockCart } from "@/components/cart/CartProvider";
import { formatMinorCurrency } from "@/lib/leafly/format";

const readinessItems = [
  "Government-issued photo ID ready at pickup",
  "Customer is 21+ and purchasing for personal use",
  "Phone number and name will be validated in the live flow",
  "Inventory is not reserved until an approved order workflow exists",
];

export function CheckoutPreview() {
  const { items, itemCount, subtotalMinorUnits, clearCart } = useMockCart();
  const estimatedTaxMinorUnits = Math.round(subtotalMinorUnits * 0.1);
  const previewTotalMinorUnits = subtotalMinorUnits + estimatedTaxMinorUnits;

  if (items.length === 0) {
    return (
      <section className="mx-auto max-w-5xl px-4 py-14 md:px-8 md:py-20">
        <div className="rounded-[2rem] border border-white/10 bg-[#111] p-8 text-center shadow-2xl md:p-12">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-[var(--greenway)]">Checkout preview</p>
          <h1 className="mt-4 text-4xl font-black tracking-tight text-white md:text-6xl">Your mock cart is empty.</h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-zinc-400">
            Add a product variant from the menu to test the preview checkout flow. Nothing here creates a live order, reserves inventory, or contacts Leafly.
          </p>
          <Link href="/menu" className="mt-8 inline-flex rounded-full bg-[var(--orange)] px-7 py-4 text-sm font-black uppercase tracking-[0.16em] text-black transition hover:bg-white">
            Browse menu
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="px-4 py-10 md:px-8 md:py-14">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-[2.5rem] border border-[var(--greenway)]/25 bg-[radial-gradient(circle_at_top_left,rgba(126,217,87,0.18),transparent_34%),#0b0b0b] p-6 shadow-2xl md:p-10">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-[var(--greenway)]">Non-live checkout preview</p>
          <div className="mt-4 grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
            <div>
              <h1 className="text-4xl font-black tracking-tight text-white md:text-6xl">Review your pickup preview.</h1>
              <p className="mt-5 max-w-3xl text-base leading-7 text-zinc-300">
                This screen models the customer review step Greenway can use after Leafly Menu API certification and approved order integration planning. It currently uses in-browser mock cart data only.
              </p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-black/55 p-5">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-black uppercase tracking-[0.16em] text-zinc-400">Preview items</span>
                <span className="rounded-full bg-[var(--greenway)] px-4 py-2 text-sm font-black text-black">{itemCount}</span>
              </div>
              <p className="mt-4 text-sm leading-6 text-zinc-400">Pickup at Greenway Marijuana in Port Orchard, WA. Final pickup window, order number, payment rules, and POS confirmation are future live-order work.</p>
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="grid gap-6">
            <section className="rounded-[2rem] border border-white/10 bg-[#111] p-5 md:p-7">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--orange)]">Cart review</p>
                  <h2 className="mt-2 text-3xl font-black text-white">Selected products</h2>
                </div>
                <Link href="/menu" className="rounded-full border border-white/15 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-white transition hover:border-[var(--orange)] hover:text-[var(--orange)]">
                  Keep shopping
                </Link>
              </div>

              <div className="mt-6 grid gap-4">
                {items.map((item) => (
                  <article key={item.lineId} className="rounded-3xl border border-white/10 bg-black/45 p-4 md:p-5">
                    <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-start">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">{item.brand}</p>
                        <h3 className="mt-1 text-2xl font-black text-white">{item.productName}</h3>
                        <p className="mt-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--greenway)]">{item.category} · {item.strainType} · {item.variantLabel}</p>
                        <p className="mt-3 break-all text-[0.72rem] font-bold text-zinc-600">Leafly-style variant ID: {item.variantId}</p>
                      </div>
                      <div className="rounded-2xl bg-white/5 p-4 text-right">
                        <p className="text-xs font-black uppercase tracking-[0.14em] text-zinc-500">Qty {item.quantity}</p>
                        <p className="mt-1 text-2xl font-black text-[var(--orange)]">{formatMinorCurrency(item.priceMinorUnits * item.quantity)}</p>
                        <p className="mt-1 text-xs text-zinc-500">{formatMinorCurrency(item.priceMinorUnits)} each</p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="rounded-[2rem] border border-white/10 bg-[#111] p-5 md:p-7">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--greenway)]">Customer readiness preview</p>
              <h2 className="mt-2 text-3xl font-black text-white">Pickup details to collect later</h2>
              <div className="mt-6 grid gap-3 md:grid-cols-2">
                <PreviewField label="Full name" value="Collected in live checkout" />
                <PreviewField label="Mobile phone" value="Collected in live checkout" />
                <PreviewField label="Pickup method" value="In-store pickup preview" />
                <PreviewField label="Payment" value="Confirm in store / POS workflow" />
              </div>
              <div className="mt-6 rounded-3xl border border-[var(--greenway)]/30 bg-[var(--greenway)]/10 p-5">
                <p className="text-sm font-black uppercase tracking-[0.16em] text-[var(--greenway)]">Readiness checklist</p>
                <ul className="mt-4 grid gap-3 text-sm leading-6 text-zinc-200">
                  {readinessItems.map((item) => (
                    <li key={item} className="flex gap-3">
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--greenway)]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </div>

          <aside className="grid gap-6 lg:sticky lg:top-32 lg:self-start">
            <section className="rounded-[2rem] border border-white/10 bg-[#111] p-5 shadow-2xl md:p-7">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--orange)]">Order summary</p>
              <h2 className="mt-2 text-3xl font-black text-white">Preview totals</h2>
              <dl className="mt-6 grid gap-4 text-sm">
                <SummaryRow label="Subtotal" value={formatMinorCurrency(subtotalMinorUnits)} />
                <SummaryRow label="Estimated tax placeholder" value={formatMinorCurrency(estimatedTaxMinorUnits)} />
                <SummaryRow label="Discounts / deals" value="Not applied" />
              </dl>
              <div className="mt-6 flex items-center justify-between gap-4 border-t border-white/10 pt-5">
                <span className="text-sm font-black uppercase tracking-[0.16em] text-zinc-400">Preview total</span>
                <span className="text-3xl font-black text-[var(--orange)]">{formatMinorCurrency(previewTotalMinorUnits)}</span>
              </div>
              <button type="button" disabled className="mt-6 w-full cursor-not-allowed rounded-full bg-zinc-700 px-6 py-4 text-sm font-black uppercase tracking-[0.16em] text-zinc-400">
                Live order disabled
              </button>
              <Link href="/checkout/confirmation" className="mt-3 block w-full rounded-full bg-[var(--orange)] px-6 py-4 text-center text-sm font-black uppercase tracking-[0.16em] text-black transition hover:bg-white">
                Preview confirmation screen
              </Link>
              <button type="button" onClick={clearCart} className="mt-3 w-full rounded-full border border-white/15 px-6 py-3 text-xs font-black uppercase tracking-[0.14em] text-zinc-300 transition hover:border-red-300 hover:text-red-200">
                Clear mock cart
              </button>
            </section>

            <section className="rounded-[2rem] border border-[var(--orange)]/30 bg-[var(--orange)]/10 p-5 md:p-7">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--orange)]">Leafly certification note</p>
              <p className="mt-3 text-sm leading-6 text-zinc-200">
                Live order creation is intentionally blocked. Leafly Order API access must wait until Menu API certification is complete and Greenway has an approved POS/order workflow with Leafly.
              </p>
            </section>

            <section className="rounded-[2rem] border border-white/10 bg-black p-5 md:p-7">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--greenway)]">Compliance preview</p>
              <p className="mt-3 text-sm leading-6 text-zinc-400">
                Future production checkout should include age gate enforcement, Washington cannabis disclaimers, pickup availability rules, and clear inventory-reservation language before any real order action.
              </p>
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
}

function PreviewField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/45 p-4">
      <p className="text-[0.68rem] font-black uppercase tracking-[0.16em] text-zinc-500">{label}</p>
      <p className="mt-2 font-bold text-white">{value}</p>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl bg-white/5 p-4">
      <dt className="font-bold text-zinc-300">{label}</dt>
      <dd className="font-black text-white">{value}</dd>
    </div>
  );
}
