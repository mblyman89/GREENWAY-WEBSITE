"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CART_MAX_QTY, formatCents } from "@/lib/catalog-core";
import { cart, useCart } from "./cart-store";

type Line = { handle: string; variantId: number; qty: number; title: string; category: string; image: string; color: string; size: string; unitCents: number; lineCents: number };
type Preview = { lines: Line[]; subtotalCents: number; shippingCents: number | null; freeOverCents: number; problems: string[]; checkoutOpen: boolean };

export function CartView({ canceled }: { canceled: boolean }) {
  const lines = useCart();
  const key = JSON.stringify(lines);
  const [preview, setPreview] = useState<{ key: string; data: Preview } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/cart-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: key === "[]" ? '{"lines":[]}' : `{"lines":${key}}` })
      .then((r) => r.json() as Promise<Preview>)
      .then((data) => {
        if (!live) return;
        setPreview({ key, data });
        // Drop lines the server no longer sells (sold out / removed).
        if (data.problems.length) cart.replace(data.lines.map((l) => ({ handle: l.handle, variantId: l.variantId, qty: l.qty })));
      })
      .catch(() => { if (live) setError("Couldn't load your cart. Refresh to try again."); });
    return () => { live = false; };
  }, [key]);

  async function checkout() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines }) });
      const d = (await r.json()) as { url?: string; error?: string };
      if (d.url) { window.location.assign(d.url); return; }
      setError(d.error ?? "Checkout failed. Please try again.");
    } catch {
      setError("Checkout failed. Please try again.");
    }
    setBusy(false);
  }

  const data = preview?.key === key ? preview.data : null;
  const loading = !data && lines.length > 0;

  if (!lines.length) {
    return (
      <div className="rounded-3xl border border-dashed border-white/20 bg-zinc-950 p-10 text-center">
        {canceled ? <p className="mb-3 text-sm font-bold text-[var(--orange)]">Checkout was canceled - nothing was charged.</p> : null}
        <p className="text-2xl font-black text-white">Your cart is empty.</p>
        <Link href="/" className="mt-6 inline-flex rounded-full bg-[var(--orange)] px-6 py-3 text-xs font-black uppercase tracking-[0.16em] text-black">Shop merch</Link>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
      <div className="grid gap-3">
        {canceled ? <p className="rounded-2xl border border-[var(--orange)]/40 bg-[var(--orange)]/10 px-4 py-3 text-sm font-bold text-white">Checkout was canceled - nothing was charged. Your cart is saved.</p> : null}
        {data?.problems.map((p) => <p key={p} className="rounded-2xl border border-[var(--orange)]/40 bg-[var(--orange)]/10 px-4 py-3 text-sm font-bold text-white">{p}</p>)}
        {loading ? <p className="rounded-2xl border border-white/10 bg-zinc-950 p-6 text-sm text-zinc-400">Loading your cart…</p> : null}
        {data?.lines.map((l) => (
          <div key={`${l.handle}-${l.variantId}`} className="grid grid-cols-[5.5rem_1fr] gap-4 rounded-2xl border border-white/10 bg-zinc-950 p-3 sm:grid-cols-[6.5rem_1fr_auto] sm:items-center">
            <Link href={`/${l.category}/${l.handle}`} className="block h-[5.5rem] overflow-hidden bg-white sm:h-[6.5rem]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={l.image} alt="" className="h-full w-full object-cover" />
            </Link>
            <div className="min-w-0">
              <Link href={`/${l.category}/${l.handle}`} className="line-clamp-2 font-black text-white hover:text-[var(--greenway)]">{l.title}</Link>
              <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-zinc-400">{l.color} · {l.size}</p>
              <p className="mt-1 text-sm text-zinc-300">{formatCents(l.unitCents)} each</p>
            </div>
            <div className="col-span-2 flex items-center justify-between gap-3 sm:col-span-1 sm:flex-col sm:items-end">
              <div className="grid grid-cols-[2.5rem_2.5rem_2.5rem] border border-white/18 bg-[#111] text-center">
                <button type="button" onClick={() => (l.qty > 1 ? cart.setQty(l.handle, l.variantId, l.qty - 1) : cart.remove(l.handle, l.variantId))} className="h-10 text-xl font-black text-white hover:bg-white hover:text-black" aria-label={`Decrease ${l.title}`}>-</button>
                <span className="flex h-10 items-center justify-center border-x border-white/18 font-black text-white">{l.qty}</span>
                <button type="button" disabled={l.qty >= CART_MAX_QTY} onClick={() => cart.setQty(l.handle, l.variantId, l.qty + 1)} className="h-10 text-xl font-black text-white hover:bg-white hover:text-black disabled:opacity-40" aria-label={`Increase ${l.title}`}>+</button>
              </div>
              <div className="text-right">
                <p className="font-black text-white">{formatCents(l.lineCents)}</p>
                <button type="button" onClick={() => cart.remove(l.handle, l.variantId)} className="text-[0.68rem] font-black uppercase tracking-[0.12em] text-zinc-500 hover:text-[var(--orange)]">Remove</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <aside className="rounded-3xl border border-white/10 bg-zinc-950 p-5 lg:sticky lg:top-24">
        <h2 className="text-sm font-black uppercase tracking-[0.18em] text-white">Order summary</h2>
        <dl className="mt-4 grid gap-2 text-sm">
          <div className="flex justify-between text-zinc-300"><dt>Subtotal</dt><dd className="font-black text-white">{data ? formatCents(data.subtotalCents) : "…"}</dd></div>
          <div className="flex justify-between text-zinc-300"><dt>Shipping</dt><dd className="font-black text-white">{data?.shippingCents == null ? "At checkout" : data.shippingCents === 0 ? "Free" : formatCents(data.shippingCents)}</dd></div>
          <div className="flex justify-between text-zinc-300"><dt>Sales tax</dt><dd className="text-zinc-400">At checkout</dd></div>
        </dl>
        {data && data.freeOverCents > 0 && data.subtotalCents < data.freeOverCents ? (
          <p className="mt-3 rounded-xl bg-[var(--greenway)]/10 px-3 py-2 text-xs font-bold text-[var(--greenway)]">Add {formatCents(data.freeOverCents - data.subtotalCents)} more for free shipping.</p>
        ) : null}
        <button type="button" onClick={checkout} disabled={busy || !data || !data.lines.length || !data.checkoutOpen}
          className="mt-5 flex h-14 w-full items-center justify-center rounded-md bg-[var(--greenway)] px-5 text-[0.82rem] font-black uppercase tracking-[0.12em] text-black transition hover:bg-[#6bc746] disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400">
          {busy ? "Opening secure checkout…" : data && !data.checkoutOpen ? "Checkout opening soon" : "Secure checkout"}
        </button>
        {error ? <p className="mt-3 text-sm font-bold text-[var(--orange)]" role="alert">{error}</p> : null}
        <p className="mt-4 text-[0.72rem] leading-5 text-zinc-500">
          Payment is handled by Stripe - we never see your card number. Sold by Greenway Merchandising LLC. By paying you agree to our <Link href="/terms" className="underline">terms</Link> and <Link href="/returns" className="underline">returns policy</Link>.
        </p>
      </aside>
    </div>
  );
}
