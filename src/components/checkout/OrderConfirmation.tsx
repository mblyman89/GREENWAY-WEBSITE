"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { greenwayBusiness } from "@/content/business";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { readCompletedOrder, type CompletedOrder } from "@/lib/checkout/order";

export function OrderConfirmation() {
  const searchParams = useSearchParams();
  const orderFromUrl = searchParams.get("order") ?? undefined;
  const [order, setOrder] = useState<CompletedOrder | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setOrder(readCompletedOrder());
    setHydrated(true);
  }, []);

  const orderNumber = order?.orderNumber ?? orderFromUrl;

  return (
    <section className="px-4 py-10 md:px-8 md:py-16">
      <div className="mx-auto max-w-xl">
        <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[#0d0d0d] p-7 text-center shadow-2xl shadow-black/50 md:p-10">
          {/* Checkmark */}
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#e9e3cf] text-black shadow-lg">
            <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m5 12.5 4.2 4.2L19 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>

          <h1 className="mt-6 text-3xl font-black uppercase leading-tight tracking-tight text-[var(--orange)] md:text-4xl">
            Order Confirmed
          </h1>

          {orderNumber ? (
            <p className="mt-3 text-base font-bold text-white">
              Order <span className="text-white">#{orderNumber}</span>
            </p>
          ) : null}

          <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-zinc-300">
            Thank you{order?.customerFirstName ? `, ${order.customerFirstName}` : ""}! Your pickup order has been received.
            A confirmation has been sent to your email — if you don&apos;t see it, please check your spam folder.
          </p>

          {/* Receipt */}
          {hydrated && order && order.lines.length > 0 ? (
            <div className="mt-6 rounded-2xl border border-white/10 bg-black/40 p-5 text-left">
              <div className="grid gap-2.5">
                {order.lines.map((line, index) => (
                  <div key={`${line.productName}-${index}`} className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-white">{line.productName}</p>
                      <p className="text-[0.66rem] font-bold uppercase tracking-[0.12em] text-zinc-500">
                        {line.brand} · Qty {line.quantity}{line.variantLabel ? ` · ${line.variantLabel}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right leading-tight">
                      {typeof line.regularPriceMinorUnits === "number" && line.regularPriceMinorUnits > line.priceMinorUnits ? (
                        <p className="text-[0.7rem] font-black text-zinc-500 line-through">
                          {formatMinorCurrency(line.regularPriceMinorUnits * line.quantity)}
                        </p>
                      ) : null}
                      <p className="text-sm font-black text-[var(--orange)]">
                        {formatMinorCurrency(line.priceMinorUnits * line.quantity)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <dl className="mt-4 grid gap-2 border-t border-white/10 pt-4 text-sm">
                <ReceiptRow label="Subtotal" value={formatMinorCurrency(order.subtotalMinorUnits)} />
                <ReceiptRow label="Taxes (Est.)" value={formatMinorCurrency(order.estimatedTaxMinorUnits)} />
                {order.savingsMinorUnits > 0 ? (
                  <ReceiptRow label="Savings" value={`−${formatMinorCurrency(order.savingsMinorUnits)}`} accent />
                ) : null}
                <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-2.5">
                  <dt className="text-sm font-black uppercase tracking-[0.1em] text-white">Total</dt>
                  <dd className="text-xl font-black text-[var(--orange)]">{formatMinorCurrency(order.totalMinorUnits)}</dd>
                </div>
              </dl>
            </div>
          ) : null}

          <p className="mx-auto mt-6 max-w-md text-[0.72rem] leading-5 text-zinc-500">
            Bring a valid government-issued photo ID showing you are 21 or older. Pickup at {greenwayBusiness.address.full}.
            Final pricing, taxes, and purchase limits are confirmed in store, and no payment is collected online — pay when you pick up.
          </p>

          <Link
            href="/menu"
            className="mt-7 inline-flex w-full items-center justify-center rounded-full bg-[var(--orange)] px-7 py-4 text-sm font-black uppercase tracking-[0.16em] text-black transition hover:bg-white"
          >
            Continue Shopping
          </Link>

          <p className="mt-5 text-[0.7rem] font-black uppercase tracking-[0.18em] text-zinc-600">
            {greenwayBusiness.name} · {greenwayBusiness.address.city}, {greenwayBusiness.address.state}
          </p>
        </div>
      </div>
    </section>
  );
}

function ReceiptRow({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="font-bold text-zinc-400">{label}</dt>
      <dd className={`font-black ${accent ? "text-[var(--greenway)]" : "text-white"}`}>{value}</dd>
    </div>
  );
}
