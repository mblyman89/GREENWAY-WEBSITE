"use client";

/**
 * R70 S1 - "Fulfillment & Pricing" tab: the just-in-time pipeline (where and
 * how each sale gets made), plus a per-unit margin calculator in cents using
 * the Printful base price, placement upcharges and Stripe's standard fee.
 */
import { useState } from "react";
import { basePriceCents, formatCents, getBlank, sizesFor, placementsFor, METHOD_LABEL, type Method, type UsedPlacement } from "@/lib/merch-studio/garment-catalog-core";
import { JIT_PIPELINE, STRIPE_DISPUTE_CENTS, suggestRetailCents, unitEconomics } from "@/lib/merch-studio/fulfillment-core";
import { NumberSlider, Row, Toggle, studioInput, studioLabel } from "@/components/admin/banner-studio/controls";

const toCents = (s: string) => { const n = Number(s.replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? Math.round(n * 100) : 0; };

export function FulfillmentPanel({ blankId }: { blankId: string }) {
  const blank = getBlank(blankId)!;
  const sizes = sizesFor(blank);
  const [size, setSize] = useState(sizes[Math.min(1, sizes.length - 1)]?.[0] ?? "");
  const sz = sizes.some((s) => s[0] === size) ? size : sizes[0]?.[0] ?? "";
  const [used, setUsed] = useState<Record<string, Method | "">>({});
  const [puff, setPuff] = useState(false);
  const [retail, setRetail] = useState("45.00");
  const [shipCharged, setShipCharged] = useState("0.00");
  const [shipCost, setShipCost] = useState("0.00");
  const [target, setTarget] = useState(50);

  const usedList: UsedPlacement[] = Object.entries(used).filter(([, m]) => m).map(([placementId, m]) => ({ placementId, method: m as Method }));
  const est = basePriceCents(blank, sz, usedList, puff);
  const econ = est ? unitEconomics({ retailCents: toCents(retail), printfulCents: est.cents, shippingChargedCents: toCents(shipCharged), shippingCostCents: toCents(shipCost) }) : null;

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-base font-bold text-white">How one sale gets made (just-in-time, zero inventory)</h3>
        <ol className="grid gap-2 md:grid-cols-3">
          {JIT_PIPELINE.map((s, i) => (
            <li key={s.id} className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 text-sm">
              <p className="font-semibold text-white">{i + 1}. {s.title}</p>
              <p className="text-[0.7rem] uppercase tracking-wide text-white/45">{s.who} - {s.slice <= 2 ? "in the studio now" : `arrives in Slice ${s.slice}`}</p>
              <p className="mt-1 text-white/70">{s.what}</p>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-white/55">Why Printful: it prints in its own facilities (consistent quality), offers DTG, DTFlex (its most wash-durable print), embroidery and 3D puff on premium blanks, custom inside/outside labels, and a full order API for one-at-a-time drafts. VistaPrint has no print-on-demand order API. Full reasoning: docs/roadmap/R70-MERCH-STUDIO.md.</p>
      </section>

      <section className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-3">
          <h3 className="text-base font-bold text-white">Unit economics - {blank.brand} {blank.model}</h3>
          <Row label="Size"><select className={studioInput} value={sz} onChange={(e) => setSize(e.target.value)}>{sizes.map(([s, c]) => <option key={s} value={s}>{s} - {formatCents(c)}</option>)}</select></Row>
          <div>
            <span className={studioLabel}>Placements printed</span>
            <div className="space-y-1">
              {placementsFor(blank).map((p) => (
                <label key={p.id} className="flex items-center justify-between gap-2 text-xs text-white/80">
                  <span>{p.label}</span>
                  <select className="rounded border border-[var(--admin-border)] bg-black/40 px-1 py-0.5 text-xs text-white" value={used[p.id] ?? ""} onChange={(e) => setUsed((u) => ({ ...u, [p.id]: e.target.value as Method | "" }))}>
                    <option value="">none</option>
                    {p.methods.map((m) => <option key={m} value={m}>{METHOD_LABEL[m].split(" (")[0]} {p.upchargeCents[m] ? `+${formatCents(p.upchargeCents[m]!)}` : ""}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </div>
          {blank.puffAvailable ? <Toggle label="3D puff (+$1.50)" checked={puff} onChange={setPuff} /> : null}
          <Row label="Retail price (USD)"><input className={studioInput} inputMode="decimal" value={retail} onChange={(e) => setRetail(e.target.value)} /></Row>
          <Row label="Shipping charged to customer"><input className={studioInput} inputMode="decimal" value={shipCharged} onChange={(e) => setShipCharged(e.target.value)} /></Row>
          <Row label="Printful shipping cost" hint="From Printful's shipping-rates API at checkout (Slice 4). Enter an estimate for now."><input className={studioInput} inputMode="decimal" value={shipCost} onChange={(e) => setShipCost(e.target.value)} /></Row>
        </div>
        <div className="space-y-3">
          {est && econ ? (
            <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4 text-sm">
              <table className="w-full">
                <tbody>
                  {est.lines.map((l) => <tr key={l.label}><td className="py-0.5 text-white/75">{l.label}</td><td className="text-right text-white">{formatCents(l.cents)}</td></tr>)}
                  <tr className="border-t border-[var(--admin-border)]"><td className="py-1 font-semibold text-white">Printful wholesale (est.)</td><td className="text-right font-semibold text-white">{formatCents(est.cents)}</td></tr>
                  <tr><td className="text-white/75">Printful shipping</td><td className="text-right text-white">{formatCents(toCents(shipCost))}</td></tr>
                  <tr><td className="text-white/75">Card fee (Stripe 2.9% + 30¢ on {formatCents(econ.chargeCents)})</td><td className="text-right text-white">{formatCents(econ.cardFeeCents)}</td></tr>
                  <tr className="border-t border-[var(--admin-border)]"><td className="py-1 font-bold text-white">Profit per unit</td><td className={`text-right font-bold ${econ.profitCents >= 0 ? "text-[var(--admin-accent)]" : "text-[var(--admin-danger)]"}`}>{formatCents(econ.profitCents)} ({(econ.marginBps / 100).toFixed(1)}% of retail)</td></tr>
                </tbody>
              </table>
              <p className="mt-2 text-xs text-white/50">Excludes sales tax (collected and remitted separately by Greenway Merchandising LLC), returns/reprints and the ${(STRIPE_DISPUTE_CENTS / 100).toFixed(0)} Stripe dispute fee. Printful&apos;s order estimate is the final word on cost.</p>
            </div>
          ) : <p className="text-sm text-white/60">Pick a size.</p>}
          {est ? (
            <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-4">
              <NumberSlider label="Target margin (of retail)" value={target} min={10} max={80} step={5} unit="%" onChange={setTarget} />
              <p className="mt-2 text-sm text-white/80">Lowest whole-dollar price for {target}%: <b className="text-white">{formatCents(suggestRetailCents(est.cents, target * 100))}</b> (or {formatCents(suggestRetailCents(est.cents, target * 100, "99"))}). Shipping passed through at cost.</p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
