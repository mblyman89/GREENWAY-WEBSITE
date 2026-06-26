"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useMockCart } from "@/components/cart/CartProvider";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { generateOrderNumber, persistCompletedOrder } from "@/lib/checkout/order";

type CustomerInfo = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  birthday: string;
};

const EMPTY_INFO: CustomerInfo = { firstName: "", lastName: "", email: "", phone: "", birthday: "" };

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function formatBirthday(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean);
  return parts.join("/");
}

function isValid(info: CustomerInfo) {
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(info.email.trim());
  const phoneOk = info.phone.replace(/\D/g, "").length === 10;
  const birthdayOk = /^\d{2}\/\d{2}\/\d{4}$/.test(info.birthday.trim());
  return Boolean(info.firstName.trim() && info.lastName.trim() && emailOk && phoneOk && birthdayOk);
}

export function CheckoutFlow() {
  const router = useRouter();
  const {
    items,
    itemCount,
    subtotalMinorUnits,
    savingsMinorUnits,
    estimatedTaxMinorUnits,
    totalMinorUnits,
    recordSale,
    clearCart,
  } = useMockCart();

  const [info, setInfo] = useState<CustomerInfo>(EMPTY_INFO);
  const [infoSaved, setInfoSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const valid = useMemo(() => isValid(info), [info]);

  function updateField<K extends keyof CustomerInfo>(key: K, value: string) {
    setInfoSaved(false);
    setInfo((current) => ({ ...current, [key]: value }));
  }

  function handleSaveInfo() {
    if (!valid) {
      setShowErrors(true);
      return;
    }
    setInfoSaved(true);
  }

  function handlePlaceOrder() {
    if (!valid) {
      setShowErrors(true);
      return;
    }
    if (items.length === 0 || submitting) return;
    setSubmitting(true);

    const orderNumber = generateOrderNumber();
    // Decrement on-page inventory as if these units left the shelf.
    recordSale(items.map((item) => ({ variantId: item.variantId, quantity: item.quantity })));
    persistCompletedOrder({
      orderNumber,
      placedAt: new Date().toISOString(),
      customerFirstName: info.firstName.trim(),
      lines: items.map((item) => ({
        productName: item.productName,
        brand: item.brand,
        variantLabel: item.variantLabel,
        quantity: item.quantity,
        priceMinorUnits: item.priceMinorUnits,
      })),
      subtotalMinorUnits,
      estimatedTaxMinorUnits,
      savingsMinorUnits,
      totalMinorUnits,
    });
    clearCart();
    router.push(`/checkout/confirmation?order=${encodeURIComponent(orderNumber)}`);
  }

  if (items.length === 0 && !submitting) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-16 md:px-8 md:py-24">
        <div className="rounded-[2rem] border border-white/10 bg-[#111] p-8 text-center shadow-2xl md:p-12">
          <h1 className="text-4xl font-black tracking-tight text-white md:text-5xl">Your cart is empty</h1>
          <p className="mx-auto mt-5 max-w-md text-base leading-7 text-zinc-400">
            Add a few products from the menu and they will appear here, ready for pickup at our Port Orchard store.
          </p>
          <Link href="/menu" className="mt-8 inline-flex rounded-full bg-[var(--orange)] px-8 py-4 text-sm font-black uppercase tracking-[0.16em] text-black transition hover:bg-white">
            Browse Menu
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="px-4 py-8 md:px-8 md:py-12">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-black tracking-tight text-white md:text-4xl">Secure Checkout</h1>

        {/* Customer Information */}
        <div className="mt-6 rounded-[1.6rem] border border-white/10 bg-[#111] p-5 shadow-2xl md:p-7">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--greenway)]" aria-hidden="true" />
            <h2 className="text-lg font-black uppercase tracking-[0.12em] text-white">Customer Information</h2>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field
              label="First Name"
              value={info.firstName}
              placeholder="Enter your first name"
              onChange={(v) => updateField("firstName", v)}
              error={showErrors && !info.firstName.trim() ? "Required" : undefined}
            />
            <Field
              label="Last Name"
              value={info.lastName}
              placeholder="Enter your last name"
              onChange={(v) => updateField("lastName", v)}
              error={showErrors && !info.lastName.trim() ? "Required" : undefined}
            />
            <div className="sm:col-span-2">
              <Field
                label="Email Address"
                type="email"
                value={info.email}
                placeholder="Enter your email address"
                onChange={(v) => updateField("email", v)}
                error={showErrors && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(info.email.trim()) ? "Enter a valid email" : undefined}
              />
            </div>
            <Field
              label="Phone Number"
              type="tel"
              value={info.phone}
              placeholder="(555) 123-4567"
              onChange={(v) => updateField("phone", formatPhone(v))}
              error={showErrors && info.phone.replace(/\D/g, "").length !== 10 ? "Enter a 10-digit phone" : undefined}
            />
            <Field
              label="Birthday"
              value={info.birthday}
              placeholder="MM/DD/YYYY"
              inputMode="numeric"
              onChange={(v) => updateField("birthday", formatBirthday(v))}
              error={showErrors && !/^\d{2}\/\d{2}\/\d{4}$/.test(info.birthday.trim()) ? "Use MM/DD/YYYY" : undefined}
            />
          </div>

          <button
            type="button"
            onClick={handleSaveInfo}
            className="mt-6 w-full rounded-full bg-[var(--orange)] px-6 py-3.5 text-sm font-black uppercase tracking-[0.14em] text-black transition hover:bg-white"
          >
            {infoSaved ? "Information Saved ✓" : "Save Information"}
          </button>
        </div>

        {/* Order Summary */}
        <div className="mt-5 overflow-hidden rounded-[1.6rem] border border-white/10 bg-[#111] shadow-2xl">
          <div className="relative border-b border-white/10 px-5 py-4 md:px-7">
            <h2 className="text-lg font-black uppercase tracking-[0.12em] text-white">Order Summary</h2>
            <span className="absolute right-5 top-1/2 -translate-y-1/2 rounded-full bg-[var(--greenway)] px-3 py-1 text-xs font-black text-black">
              {itemCount} {itemCount === 1 ? "item" : "items"}
            </span>
          </div>

          <div className="grid gap-3 px-5 py-5 md:px-7">
            {items.map((item) => {
              const hasSale = item.regularPriceMinorUnits > item.priceMinorUnits;
              return (
                <div key={item.lineId} className="flex items-start justify-between gap-4 rounded-2xl bg-black/40 p-4">
                  <div className="min-w-0">
                    <p className="text-[0.66rem] font-black uppercase tracking-[0.16em] text-zinc-500">{item.brand}</p>
                    <p className="mt-0.5 truncate text-base font-black text-white">{item.productName}</p>
                    <p className="mt-1 text-xs font-bold uppercase tracking-[0.1em] text-[var(--greenway)]">
                      Qty {item.quantity}{item.variantLabel ? ` · ${item.variantLabel}` : ""}
                    </p>
                  </div>
                  <div className="text-right leading-tight">
                    {hasSale ? (
                      <p className="text-xs font-black text-zinc-500 line-through">{formatMinorCurrency(item.regularPriceMinorUnits * item.quantity)}</p>
                    ) : null}
                    <p className="text-lg font-black text-[var(--orange)]">{formatMinorCurrency(item.priceMinorUnits * item.quantity)}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <dl className="grid gap-2.5 border-t border-white/10 px-5 py-5 md:px-7">
            <SummaryRow label={`Subtotal (${itemCount} ${itemCount === 1 ? "item" : "items"})`} value={formatMinorCurrency(subtotalMinorUnits)} />
            <SummaryRow label="Taxes (Est.)" value={formatMinorCurrency(estimatedTaxMinorUnits)} />
            {savingsMinorUnits > 0 ? (
              <SummaryRow label="Savings" value={`−${formatMinorCurrency(savingsMinorUnits)}`} accent />
            ) : null}
            <div className="mt-1 flex items-center justify-between gap-4 border-t border-white/10 pt-3">
              <dt className="text-base font-black uppercase tracking-[0.12em] text-white">Total</dt>
              <dd className="text-2xl font-black text-[var(--orange)]">{formatMinorCurrency(totalMinorUnits)}</dd>
            </div>
          </dl>
        </div>

        <button
          type="button"
          onClick={handlePlaceOrder}
          disabled={submitting}
          className="mt-5 w-full rounded-full bg-[var(--orange)] px-6 py-4 text-base font-black uppercase tracking-[0.16em] text-black transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-70"
        >
          {submitting ? "Placing Order…" : "Place Order"}
        </button>

        <Link
          href="/menu"
          className="mt-3 block w-full rounded-full border border-white/15 px-6 py-3 text-center text-xs font-black uppercase tracking-[0.14em] text-white transition hover:border-[var(--greenway)] hover:text-[var(--greenway)]"
        >
          Keep Shopping
        </Link>

        <p className="mx-auto mt-6 max-w-xl text-center text-[0.7rem] leading-5 text-zinc-500">
          This is a pickup order placed for in-store collection at Greenway Marijuana, 4851 Geiger Rd SE, Port Orchard, WA.
          You must be 21 or older with a valid government-issued photo ID at pickup. Taxes shown are estimated; final pricing,
          taxes, and purchase limits are confirmed in store. No payment is collected online — pay when you pick up.
        </p>
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  placeholder,
  onChange,
  type = "text",
  inputMode,
  error,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  type?: string;
  inputMode?: "text" | "numeric" | "tel" | "email";
  error?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-black uppercase tracking-[0.12em] text-zinc-400">{label}</span>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-2 w-full rounded-xl border bg-black/50 px-4 py-3 text-sm font-semibold text-white placeholder:text-zinc-600 outline-none transition focus:border-[var(--orange)] ${
          error ? "border-red-400/70" : "border-white/12"
        }`}
      />
      {error ? <span className="mt-1 block text-[0.68rem] font-bold text-red-300">{error}</span> : null}
    </label>
  );
}

function SummaryRow({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <dt className="font-bold text-zinc-300">{label}</dt>
      <dd className={`font-black ${accent ? "text-[var(--greenway)]" : "text-white"}`}>{value}</dd>
    </div>
  );
}
