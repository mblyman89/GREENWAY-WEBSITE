"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useMockCart } from "@/components/cart/CartProvider";
import { formatMinorCurrency } from "@/lib/leafly/format";

const pickupSteps = [
  "Wait for a real order-ready message before visiting the store once live ordering exists.",
  "Bring a valid government-issued photo ID showing you are 21 or older.",
  "Final pricing, taxes, discounts, purchase limits, and payment rules must be confirmed by Greenway/POS staff.",
  "Inventory is not reserved by this preview and no Leafly order has been created.",
];

const integrationSteps = [
  "Complete Leafly Menu API certification with clean product, variant, inventory, and cannabinoid data.",
  "Coordinate approved Order API/POS workflow with Leafly after certification.",
  "Add real customer validation, order status handling, cancellation behavior, and staff notifications.",
  "Replace this mock receipt with a verified order number and customer messaging flow.",
];

export function CheckoutConfirmationPreview() {
  const { items, itemCount, subtotalMinorUnits } = useMockCart();
  const estimatedTaxMinorUnits = Math.round(subtotalMinorUnits * 0.1);
  const previewTotalMinorUnits = subtotalMinorUnits + estimatedTaxMinorUnits;
  const mockReference = useMemo(() => `GWY-PREVIEW-${String(Math.max(itemCount, 1)).padStart(2, "0")}`, [itemCount]);

  return (
    <section className="px-4 py-10 md:px-8 md:py-14">
      <div className="mx-auto max-w-7xl">
        <div className="overflow-hidden rounded-[2.5rem] border border-[var(--greenway)]/30 bg-[#0b0b0b] shadow-2xl">
          <div className="relative p-6 md:p-10">
            <div className="absolute inset-x-0 top-0 h-2 bg-gradient-to-r from-[var(--greenway)] via-[var(--orange)] to-[var(--gold)]" />
            <p className="mt-2 text-xs font-black uppercase tracking-[0.24em] text-[var(--greenway)]">Mock confirmation preview</p>
            <div className="mt-5 grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
              <div>
                <h1 className="text-4xl font-black tracking-tight text-white md:text-6xl">This is what confirmation could feel like.</h1>
                <p className="mt-5 max-w-3xl text-base leading-7 text-zinc-300">
                  This page previews a post-checkout handoff for Greenway customers without creating a Leafly order, reserving cannabis inventory, or touching a payment/POS system.
                </p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">Preview reference</p>
                <p className="mt-2 text-3xl font-black text-[var(--orange)]">{mockReference}</p>
                <p className="mt-3 text-sm leading-6 text-zinc-400">Not a live order number. For visual QA and workflow planning only.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <aside className="grid gap-6 lg:sticky lg:top-32 lg:self-start">
            <section className="rounded-[2rem] border border-white/10 bg-[#111] p-5 md:p-7">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--orange)]">Receipt preview</p>
              <h2 className="mt-2 text-3xl font-black text-white">Mock order summary</h2>
              {items.length > 0 ? (
                <div className="mt-6 grid gap-3">
                  {items.map((item) => (
                    <article key={item.lineId} className="rounded-3xl bg-black/45 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.14em] text-zinc-500">{item.brand}</p>
                          <h3 className="mt-1 font-black text-white">{item.productName}</h3>
                          <p className="mt-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--greenway)]">Qty {item.quantity} · {item.variantLabel}</p>
                        </div>
                        <p className="font-black text-[var(--orange)]">{formatMinorCurrency(item.priceMinorUnits * item.quantity)}</p>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="mt-6 rounded-3xl border border-white/10 bg-black/45 p-5">
                  <p className="font-black text-white">No mock cart items are available.</p>
                  <p className="mt-3 text-sm leading-6 text-zinc-400">That is okay for direct page review. Add products from the menu to see line items in this receipt preview.</p>
                </div>
              )}

              <dl className="mt-6 grid gap-3 border-t border-white/10 pt-5 text-sm">
                <SummaryRow label="Items" value={String(itemCount)} />
                <SummaryRow label="Subtotal" value={formatMinorCurrency(subtotalMinorUnits)} />
                <SummaryRow label="Estimated tax placeholder" value={formatMinorCurrency(estimatedTaxMinorUnits)} />
                <SummaryRow label="Preview total" value={formatMinorCurrency(previewTotalMinorUnits)} highlight />
              </dl>
            </section>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <Link href="/checkout" className="rounded-full border border-white/15 px-6 py-4 text-center text-sm font-black uppercase tracking-[0.16em] text-white transition hover:border-[var(--orange)] hover:text-[var(--orange)]">
                Back to checkout
              </Link>
              <Link href="/menu" className="rounded-full bg-[var(--orange)] px-6 py-4 text-center text-sm font-black uppercase tracking-[0.16em] text-black transition hover:bg-white">
                Continue shopping
              </Link>
            </div>
          </aside>

          <div className="grid gap-6">
            <section className="rounded-[2rem] border border-white/10 bg-[#111] p-5 md:p-7">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--greenway)]">Pickup instructions preview</p>
              <h2 className="mt-2 text-3xl font-black text-white">Customer handoff language</h2>
              <div className="mt-6 grid gap-3">
                {pickupSteps.map((step, index) => (
                  <div key={step} className="flex gap-4 rounded-3xl border border-white/10 bg-black/45 p-4">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--greenway)] text-sm font-black text-black">{index + 1}</span>
                    <p className="text-sm leading-6 text-zinc-200">{step}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[2rem] border border-[var(--orange)]/30 bg-[var(--orange)]/10 p-5 md:p-7">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--orange)]">Leafly/POS readiness</p>
              <h2 className="mt-2 text-3xl font-black text-white">What must happen before this becomes live</h2>
              <div className="mt-6 grid gap-3">
                {integrationSteps.map((step) => (
                  <div key={step} className="rounded-3xl border border-[var(--orange)]/20 bg-black/35 p-4 text-sm leading-6 text-zinc-200">
                    {step}
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[2rem] border border-white/10 bg-black p-5 md:p-7">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--greenway)]">Compliance guardrail</p>
              <p className="mt-3 text-sm leading-6 text-zinc-400">
                Production confirmation should only appear after a verified legal purchase flow. This mock page is intentionally worded as a planning artifact so customers and staff are not misled about order status, inventory reservation, or pickup readiness.
              </p>
            </section>
          </div>
        </div>
      </div>
    </section>
  );
}

function SummaryRow({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl bg-white/5 p-4">
      <dt className="font-bold text-zinc-300">{label}</dt>
      <dd className={highlight ? "text-xl font-black text-[var(--orange)]" : "font-black text-white"}>{value}</dd>
    </div>
  );
}
