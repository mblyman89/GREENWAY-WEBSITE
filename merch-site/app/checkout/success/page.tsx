import type { Metadata } from "next";
import Link from "next/link";
import { ClearCart } from "@/components/ClearCart";
import { formatCents } from "@/lib/catalog-core";
import { STRIPE_API_VERSION } from "@/lib/checkout-core";
import { contact } from "@/lib/site";

export const metadata: Metadata = { title: "Thank you", robots: { index: false } };
export const dynamic = "force-dynamic";

type Session = { id: string; payment_status?: string; amount_total?: number; client_reference_id?: string; customer_details?: { email?: string } };

async function loadSession(id: string): Promise<Session | null> {
  const key = (process.env.STRIPE_SECRET_KEY ?? "").trim();
  if (!key || !/^cs_(live|test)_[A-Za-z0-9]+$/.test(id)) return null;
  const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${id}`, {
    headers: { Authorization: `Bearer ${key}`, "Stripe-Version": STRIPE_API_VERSION }, cache: "no-store",
  }).catch(() => null);
  return r?.ok ? ((await r.json()) as Session) : null;
}

export default async function SuccessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const s = await loadSession(typeof sp.session_id === "string" ? sp.session_id : "");
  const paid = s?.payment_status === "paid" || s?.payment_status === "no_payment_required";
  const email = contact().email;
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-14 text-center md:px-8">
      {paid ? <ClearCart /> : null}
      <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--greenway)]">{paid ? "Order confirmed" : "Thanks!"}</p>
      <h1 className="mt-2 text-[2.15rem] font-black leading-[0.96] tracking-[-0.045em] text-white md:text-5xl">{paid ? "Thank you for your order." : "We're confirming your payment."}</h1>
      {s ? (
        <div className="mx-auto mt-8 grid max-w-md gap-2 rounded-3xl border border-white/10 bg-zinc-950 p-6 text-left text-sm">
          {s.client_reference_id ? <p className="flex justify-between text-zinc-300">Order <span className="font-black text-white">{s.client_reference_id}</span></p> : null}
          {typeof s.amount_total === "number" ? <p className="flex justify-between text-zinc-300">Total <span className="font-black text-white">{formatCents(s.amount_total)}</span></p> : null}
          {s.customer_details?.email ? <p className="flex justify-between gap-3 text-zinc-300">Receipt to <span className="truncate font-black text-white">{s.customer_details.email}</span></p> : null}
        </div>
      ) : null}
      <p className="mx-auto mt-6 max-w-lg text-sm leading-6 text-zinc-400">
        {paid
          ? "Your gear is printed to order. We'll email you a tracking link as soon as it ships."
          : "If you completed payment you'll get a receipt email from Stripe shortly. If anything looks wrong, contact us and include your order number."}
        {email ? <> Questions? <a href={`mailto:${email}`} className="text-[var(--greenway)] underline">{email}</a></> : null}
      </p>
      <Link href="/" className="mt-8 inline-flex rounded-full bg-[var(--orange)] px-6 py-3 text-xs font-black uppercase tracking-[0.16em] text-black">Keep shopping</Link>
    </main>
  );
}
