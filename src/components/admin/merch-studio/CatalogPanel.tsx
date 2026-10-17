"use client";

/**
 * R70 S1 - Merch Studio "Garments" tab: the curated Printful-backed blanks,
 * their colours, sizes/base prices and print placements (inches, methods,
 * Printful placement keys and upcharges, cited source).
 */
import { useMemo } from "react";
import {
  BLANKS, METHOD_LABEL, PRINTFUL_SNAPSHOT_DATE, colorsFor, formatCents, isDarkColor, methodsFor, sizesFor,
  type Blank, type Category, type DimsSource,
} from "@/lib/merch-studio/garment-catalog-core";
import { studioLabel } from "@/components/admin/banner-studio/controls";

export const CATEGORY_LABEL: Record<Category, string> = {
  tee: "Tee", longsleeve: "Long sleeve", hoodie: "Hoodie", crew: "Crewneck", zip: "Zip hoodie",
  jacket: "Jacket", snapback: "Snapback", dad: "Dad hat", trucker: "Trucker", beanie: "Beanie",
};
const SOURCE_LABEL: Record<DimsSource, string> = {
  "printful-tee-guide": "Printful tee placement guide",
  "printful-hat-guide": "Printful hat logo guide",
  "printful-hoodie-guide": "Printful hoodie placement guide",
  "industry-chart": "Industry chart (R69)",
  "studio-default": "Studio default - confirm on Printful's template",
};

export function CatalogPanel({ blankId, colorHex, onBlank, onColor }: {
  blankId: string; colorHex: string; onBlank: (id: string) => void; onColor: (hex: string, name: string) => void;
}) {
  const blank = BLANKS.find((b) => b.id === blankId) ?? BLANKS[0];
  const groups = useMemo(() => {
    const g = { Tops: [] as Blank[], Headwear: [] as Blank[] };
    for (const b of BLANKS) (b.headwear ? g.Headwear : g.Tops).push(b);
    return g;
  }, []);
  const colors = colorsFor(blank);
  const sizes = sizesFor(blank);

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <div className="space-y-3">
        {Object.entries(groups).map(([g, list]) => (
          <div key={g}>
            <span className={studioLabel}>{g}</span>
            <div className="space-y-1">
              {list.map((b) => (
                <button key={b.id} type="button" onClick={() => onBlank(b.id)}
                  className={`w-full rounded-[var(--admin-radius-sm)] border px-3 py-2 text-left text-sm transition ${b.id === blank.id ? "border-[var(--admin-accent)] bg-[var(--admin-accent-soft)] text-white" : "border-[var(--admin-border)] text-white/75 hover:border-white/30"}`}>
                  <span className="block font-semibold">{b.brand} {b.model}</span>
                  <span className="block text-[0.72rem] text-white/55">{CATEGORY_LABEL[b.category]} - {b.title} - from {formatCents(Math.min(...sizesFor(b).map((s) => s[1])))}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        <p className="text-[0.7rem] text-white/40">Colours, sizes and base prices come from Printful&apos;s public catalog (snapshot {PRINTFUL_SNAPSHOT_DATE}). Printful prices change; the live order estimate is the source of truth.</p>
      </div>

      <div className="space-y-4">
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-lg font-bold text-white">{blank.brand} {blank.model} <span className="font-normal text-white/60">- {blank.title}</span></h3>
            <span className="text-xs text-white/50">Printful product #{blank.printfulId}</span>
          </div>
          <p className="mt-1 text-sm text-white/70">{blank.premiumNote}</p>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
            <div><dt className={studioLabel}>Fabric</dt><dd className="text-white/85">{blank.fabric}</dd></div>
            <div><dt className={studioLabel}>Weight</dt><dd className="text-white/85">{blank.weightOz ? `${blank.weightOz} oz/yd²` : "Not stated (headwear)"}</dd></div>
            <div><dt className={studioLabel}>Methods</dt><dd className="text-white/85">{methodsFor(blank).map((m) => METHOD_LABEL[m]).join(", ")}{blank.puffAvailable ? " + 3D puff" : ""}</dd></div>
          </dl>
        </div>

        <div>
          <span className={studioLabel}>Colours ({colors.length}) - click to preview</span>
          <div className="flex flex-wrap gap-1.5">
            {colors.map(([name, hex]) => (
              <button key={name} type="button" title={`${name} ${hex}${isDarkColor(hex) ? " (dark - white underbase for DTG)" : ""}`} onClick={() => onColor(hex, name)}
                className={`h-8 w-8 rounded-full border-2 ${hex.toLowerCase() === colorHex.toLowerCase() ? "border-[var(--admin-accent)] ring-2 ring-[var(--admin-accent)]/40" : "border-white/20"}`}
                style={{ background: hex }} aria-label={name} />
            ))}
          </div>
          <p className="mt-1 text-xs text-white/55">Selected: {colors.find((c) => c[1].toLowerCase() === colorHex.toLowerCase())?.[0] ?? "-"} {colorHex}. Screen swatches are approximate; Printful notes some two-tone hats share one swatch colour. Order a sample for true colour.</p>
        </div>

        <div>
          <span className={studioLabel}>Sizes + Printful base price (one unit, before placements & shipping)</span>
          <div className="flex flex-wrap gap-2">
            {sizes.map(([s, c]) => (
              <span key={s} className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] px-2 py-1 text-xs text-white/80"><b className="text-white">{s}</b> {formatCents(c)}</span>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <span className={studioLabel}>Print placements</span>
          <table className="w-full min-w-[40rem] text-left text-xs">
            <thead className="text-white/50"><tr><th className="py-1 pr-2">Placement</th><th className="pr-2">Max area</th><th className="pr-2">Methods (Printful key, upcharge)</th><th className="pr-2">Watch out for</th><th>Source</th></tr></thead>
            <tbody>
              {blank.placements.map((p) => (
                <tr key={p.id} className="border-t border-[var(--admin-border)] align-top text-white/80">
                  <td className="py-1.5 pr-2 font-semibold text-white">{p.label}<span className="block font-normal text-white/45">{p.view} view</span></td>
                  <td className="pr-2">{p.widthIn}&quot; x {p.heightIn}&quot;</td>
                  <td className="pr-2">{p.methods.map((m) => <span key={m} className="block">{METHOD_LABEL[m]} <code className="text-white/45">{p.printfulKey[m]}</code> {p.upchargeCents[m] ? `+${formatCents(p.upchargeCents[m]!)}` : "included"}</span>)}</td>
                  <td className="pr-2">{p.obstacles.length ? p.obstacles.map((o) => <span key={o.label} className={`block ${o.severity === "blocker" ? "text-[var(--admin-danger)]" : "text-[var(--admin-gold)]"}`}>{o.label}</span>) : <span className="text-white/40">-</span>}{p.note ? <span className="block text-white/50">{p.note}</span> : null}</td>
                  <td className={p.dimsSource === "studio-default" ? "text-[var(--admin-gold)]" : "text-white/55"}>{SOURCE_LABEL[p.dimsSource]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
