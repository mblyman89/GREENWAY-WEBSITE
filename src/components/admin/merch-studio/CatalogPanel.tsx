"use client";
/* eslint-disable @next/next/no-img-element -- Printful CDN garment photos (files.cdn.printful.com), previews only */

/**
 * R70 S1 - Merch Studio "Garments" tab: the curated Printful-backed blanks,
 * their colours, sizes/base prices and print placements (inches, methods,
 * Printful placement keys and upcharges, cited source).
 *
 * D266 - graphical: garment photo cards, a large preview of Printful's own
 * photo of the picked colour, two-tone swatches (Printful `color_code2`),
 * multi-colour selection (carried into Publish's colour list) and a browser
 * for Printful's full public catalog.
 */
import { useEffect, useMemo, useState } from "react";
import { listSavedGarmentsAction, removeSavedGarmentAction, saveGarmentAction } from "@/app/admin/merch-studio/saved-garments-actions";
import { defaultGarmentName, type SavedGarment } from "@/lib/merch-studio/saved-garments-core";
import { STUDIO_DEFAULT_STATUS, type PlacementCompare } from "@/lib/merch-studio/printfile-check-core";
import { printfileSizesAction } from "@/app/admin/merch-studio/pricing-actions";
import { printfulCatalogAction, printfulProductColorsAction } from "@/app/admin/merch-studio/printful-catalog-actions";
import {
  BLANKS, METHOD_LABEL, PRINTFUL_SNAPSHOT_DATE, formatCents, isDarkColor, methodsFor, sizesFor,
  type Blank, type Category, type DimsSource,
} from "@/lib/merch-studio/garment-catalog-core";
import {
  colorInfoFor, filterCatalog, isTwoTone, productImageFor, swatchBackground, toggleColor,
  type CatalogItem, type ColorInfo,
} from "@/lib/merch-studio/garment-preview-core";
import { studioLabel } from "@/components/admin/banner-studio/controls";

export const CATEGORY_LABEL: Record<Category, string> = {
  tee: "Tee", longsleeve: "Long sleeve", hoodie: "Hoodie", crew: "Crewneck", zip: "Zip hoodie",
  jacket: "Jacket", snapback: "Snapback", dad: "Dad hat", trucker: "Trucker", beanie: "Beanie",
  quarterzip: "Quarter-zip", vest: "Vest", buttonshirt: "Button shirt", pants: "Sweatpants", socks: "Socks", booney: "Booney hat",
};
const SOURCE_LABEL: Record<DimsSource, string> = {
  "printful-tee-guide": "Printful tee placement guide",
  "printful-hat-guide": "Printful hat logo guide",
  "printful-hoodie-guide": "Printful hoodie placement guide",
  "printful-file-guidelines": "Printful product File guidelines (exact)",
  "industry-chart": "Industry chart (R69)",
  // D232 M-8 (G-92): samples approved (Q-11-6 "Q6: yes."), not measured yet - never "confirmed".
  "studio-default": "Studio estimate - awaiting sample measurement",
};

type ToneFilter = "all" | "solid" | "two";

export function CatalogPanel({ blankId, colorHex, onBlank, onColor, picked = [], onPicked }: {
  blankId: string; colorHex: string; onBlank: (id: string) => void; onColor: (hex: string, name: string) => void;
  /** D266: colour names chosen for the product (multi-select). */
  picked?: string[]; onPicked?: (names: string[], forBlank?: string) => void;
}) {
  const blank = BLANKS.find((b) => b.id === blankId) ?? BLANKS[0];
  const groups = useMemo(() => {
    const g = { Tops: [] as Blank[], "Jackets & vests": [] as Blank[], "Bottoms & socks": [] as Blank[], Headwear: [] as Blank[] };
    for (const b of BLANKS) {
      if (b.headwear) g.Headwear.push(b);
      else if (b.category === "pants" || b.category === "socks") g["Bottoms & socks"].push(b);
      else if (b.category === "jacket" || b.category === "vest") g["Jackets & vests"].push(b);
      else g.Tops.push(b);
    }
    return g;
  }, []);
  const colors = useMemo(() => colorInfoFor(blank.printfulId), [blank.printfulId]);
  const order = useMemo(() => colors.map((c) => c.name), [colors]);
  const sizes = sizesFor(blank);
  const [activeName, setActiveName] = useState<string>("");
  const [tone, setTone] = useState<ToneFilter>("all");
  const [q, setQ] = useState("");
  // Two-tone hats share one hex with their solid sibling, so the name wins when we have it.
  const active = colors.find((c) => c.name === activeName && c.hex === colorHex.toLowerCase())
    ?? colors.find((c) => c.hex === colorHex.toLowerCase()) ?? colors[0];
  const twoCount = colors.filter(isTwoTone).length;
  const shown = colors.filter((c) => (tone === "all" || (tone === "two") === isTwoTone(c)) && (!q || c.name.toLowerCase().includes(q.toLowerCase())));
  const pickedSet = new Set(picked);
  const preview = (c: ColorInfo) => { setActiveName(c.name); onColor(c.hex, c.name); };
  const togglePick = (name: string) => onPicked?.(toggleColor(picked, name, order));

  return (
    <div className="space-y-5">
      <SavedGarmentsBar blank={blank} colorHex={active?.hex ?? colorHex} colorName={active?.name ?? ""} picked={picked}
        onLoad={(g) => { if (!g.blankId) return; onBlank(g.blankId); if (g.colorHex) { const c = colorInfoFor(getBlankPrintfulId(g.blankId)).find((x) => x.hex === g.colorHex); setActiveName(c?.name ?? ""); onColor(g.colorHex, c?.name ?? ""); } const names = new Set(colorInfoFor(getBlankPrintfulId(g.blankId)).map((x) => x.name)); onPicked?.(g.picked.filter((n) => names.has(n)), g.blankId); }} />
      {/* Garment cards */}
      <div className="space-y-3">
        {Object.entries(groups).map(([g, list]) => (
          <div key={g}>
            <span className={studioLabel}>{g}</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
              {list.map((b) => {
                const img = colorInfoFor(b.printfulId).find((c) => c.name === "Black")?.image || productImageFor(b.printfulId);
                const sel = b.id === blank.id;
                return (
                  <button key={b.id} type="button" onClick={() => onBlank(b.id)} aria-pressed={sel}
                    className={`group overflow-hidden rounded-[var(--admin-radius-sm)] border text-left transition ${sel ? "border-[var(--admin-accent)] ring-2 ring-[var(--admin-accent)]/40" : "border-[var(--admin-border)] hover:border-white/30"}`}>
                    <span className="block aspect-square bg-white/95">
                      {img ? <img src={img} alt="" loading="lazy" className="h-full w-full object-contain p-1 transition group-hover:scale-105" /> : null}
                    </span>
                    <span className="block px-2 py-1.5">
                      <span className="block truncate text-xs font-semibold text-white">{b.brand} {b.model}</span>
                      <span className="block truncate text-[0.68rem] text-white/55">{CATEGORY_LABEL[b.category]} - {colorInfoFor(b.printfulId).length} colours - from {formatCents(Math.min(...sizesFor(b).map((s) => s[1])))}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(16rem,24rem)_1fr]">
        {/* Large preview */}
        <div className="space-y-2">
          <div className="relative overflow-hidden rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white">
            {active?.image
              ? <img key={active.image} src={active.image} alt={`${blank.brand} ${blank.model} in ${active.name}`} className="aspect-square w-full object-contain" />
              : <div className="aspect-square w-full" style={{ background: swatchBackground(active?.hex ?? colorHex, active?.hex2 ?? null) }} />}
            <span className="absolute bottom-2 left-2 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1 text-xs text-white">
              <span className="inline-block h-4 w-4 rounded-full border border-white/40" style={{ background: swatchBackground(active?.hex ?? colorHex, active?.hex2 ?? null) }} />
              {active?.name ?? colorHex}{active && isTwoTone(active) ? " (two-tone)" : ""}
            </span>
          </div>
          <p className="text-[0.7rem] text-white/45">Photo: Printful&apos;s catalog picture of this exact colour. Screens vary; order a sample for true colour.{active && isDarkColor(active.hex) ? " Dark garment - DTG prints a white underbase." : ""}</p>
          {picked.length ? (
            <div>
              <span className={studioLabel}>Selected for the product ({picked.length})</span>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-4">
                {picked.map((n) => {
                  const c = colors.find((x) => x.name === n);
                  if (!c) return null;
                  return (
                    <button key={n} type="button" title={`${n} - click to preview`} onClick={() => preview(c)}
                      className={`overflow-hidden rounded border bg-white ${c.name === active?.name ? "border-[var(--admin-accent)]" : "border-white/15"}`}>
                      {c.image ? <img src={c.image} alt={n} loading="lazy" className="aspect-square w-full object-contain" /> : <span className="block aspect-square" style={{ background: swatchBackground(c.hex, c.hex2) }} />}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-lg font-bold text-white">{blank.brand} {blank.model} <span className="font-normal text-white/60">- {blank.title}</span></h3>
              <span className="text-xs text-white/50">Printful product #{blank.printfulId}</span>
            </div>
            <p className="mt-1 text-sm text-white/70">{blank.premiumNote}</p>
            {blank.orderWarning ? <p className="mt-2 rounded-[var(--admin-radius-sm)] border border-[var(--admin-gold)]/50 bg-[var(--admin-gold)]/10 p-2 text-xs text-white/85">{"\u26a0"} {blank.orderWarning}</p> : null}
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
              <div><dt className={studioLabel}>Fabric</dt><dd className="text-white/85">{blank.fabric}</dd></div>
              <div><dt className={studioLabel}>Weight</dt><dd className="text-white/85">{blank.weightOz ? `${blank.weightOz} oz/yd²` : "Not stated (headwear)"}</dd></div>
              <div><dt className={studioLabel}>Methods</dt><dd className="text-white/85">{methodsFor(blank).map((m) => METHOD_LABEL[m]).join(", ")}{blank.puffAvailable ? " + 3D puff" : ""}</dd></div>
            </dl>
          </div>

          {/* Colours: click = preview, tick = add to the product */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={studioLabel}>Colours ({colors.length}{twoCount ? `, ${twoCount} two-tone` : ""}) - click to preview, tick to add to the product</span>
              <span className="flex flex-wrap items-center gap-1 text-[0.7rem]">
                {twoCount ? (["all", "solid", "two"] as ToneFilter[]).map((t) => (
                  <button key={t} type="button" onClick={() => setTone(t)} className={`rounded-full border px-2 py-0.5 ${tone === t ? "border-[var(--admin-accent)] text-white" : "border-white/15 text-white/55"}`}>{t === "all" ? "All" : t === "solid" ? "Solid" : "Two-tone"}</button>
                )) : null}
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find colour" className="w-28 rounded-full border border-white/15 bg-transparent px-2 py-0.5 text-white placeholder:text-white/35" />
                {onPicked ? <>
                  <button type="button" onClick={() => onPicked(order.filter((n) => pickedSet.has(n) || shown.some((x) => x.name === n)))} className="rounded-full border border-white/15 px-2 py-0.5 text-white/70 hover:text-white">Tick shown</button>
                  <button type="button" onClick={() => onPicked([])} className="rounded-full border border-white/15 px-2 py-0.5 text-white/70 hover:text-white">Clear</button>
                </> : null}
              </span>
            </div>
            <div className="mt-1 grid grid-cols-3 gap-1.5 sm:grid-cols-5 md:grid-cols-6 xl:grid-cols-8">
              {shown.map((c) => {
                const on = c.name === active?.name;
                const ticked = pickedSet.has(c.name);
                return (
                  <div key={c.name} className={`relative overflow-hidden rounded-[var(--admin-radius-sm)] border ${on ? "border-[var(--admin-accent)] ring-2 ring-[var(--admin-accent)]/40" : ticked ? "border-[var(--admin-accent)]/60" : "border-white/15"}`}>
                    <button type="button" onClick={() => preview(c)} title={`${c.name} ${c.hex}${c.hex2 ? ` + ${c.hex2}` : ""}`} className="block w-full text-left">
                      <span className="relative block aspect-square bg-white">
                        {c.image ? <img src={c.image} alt={c.name} loading="lazy" className="h-full w-full object-contain" /> : <span className="block h-full w-full" style={{ background: swatchBackground(c.hex, c.hex2) }} />}
                        <span className="absolute bottom-1 left-1 inline-block h-4 w-4 rounded-full border border-black/30 shadow" style={{ background: swatchBackground(c.hex, c.hex2) }} />
                      </span>
                      <span className="block truncate px-1 py-0.5 text-[0.65rem] text-white/80">{c.name}</span>
                    </button>
                    {onPicked ? (
                      <label className="absolute right-1 top-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded bg-black/60" title={ticked ? "Remove from the product" : "Add to the product"}>
                        <input type="checkbox" checked={ticked} onChange={() => togglePick(c.name)} className="h-3.5 w-3.5 accent-[var(--admin-accent)]" aria-label={`Add ${c.name} to the product`} />
                      </label>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-white/55">Ticked colours become the colour list on Publish & Ads for this garment (you can still change it there). Two-tone swatches show both Printful colour codes.</p>
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
            <PrintfileCheck key={blank.id} blankId={blank.id} hasEstimates={blank.placements.some((p) => p.dimsSource === "studio-default")} />
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
          <p className="text-[0.7rem] text-white/40">Colours, photos, sizes and base prices come from Printful&apos;s public catalog (snapshot {PRINTFUL_SNAPSHOT_DATE}). Printful prices change; the live order estimate is the source of truth.</p>
        </div>
      </div>

      <PrintfulBrowser ourIds={new Set(BLANKS.map((b) => b.printfulId))} onOpen={(id) => { const b = BLANKS.find((x) => x.printfulId === id); if (b) onBlank(b.id); }} />
      <p className="text-[0.7rem] text-white/45">Not in the studio on purpose: Printful&apos;s All-Over Print Boxer Briefs (#428) are cut-and-sew - the whole fabric is printed edge to edge (legs 49&quot; x 17&quot;, crotch/pouch 13&quot; x 17&quot;, inside label 2.5&quot; x 1&quot;) from full-bleed panel files, not a logo placed on a blank, so the studio&apos;s DTG / DTF / embroidery placement tools can&apos;t make a correct file. Design those in Printful&apos;s own designer. You can still save them to My garments from the catalog below.</p>
    </div>
  );
}

/** D266: Printful's full public catalog (garments), read-only. */
function PrintfulBrowser({ ourIds, onOpen }: { ourIds: Set<number>; onOpen: (printfulId: number) => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<CatalogItem | null>(null);
  const [selColors, setSelColors] = useState<ColorInfo[] | null>(null);
  const [selImg, setSelImg] = useState("");
  const [saveMsg, setSaveMsg] = useState("");
  const load = () => {
    setOpen(true);
    if (items) return;
    setMsg("Loading Printful's catalog...");
    printfulCatalogAction().then((r) => { if (r.ok) { setItems(r.items); setMsg(""); } else setMsg(r.error); }).catch(() => setMsg("Couldn't reach Printful."));
  };
  const pick = (it: CatalogItem) => {
    if (ourIds.has(it.id)) { onOpen(it.id); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    setSel(it); setSelColors(null); setSelImg(it.image); setSaveMsg("");
    printfulProductColorsAction({ id: it.id }).then((r) => setSelColors(r.ok ? r.colors : [])).catch(() => setSelColors([]));
  };
  const list = items ? filterCatalog(items, q, 80) : [];
  return (
    <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-white">Printful catalog {items ? <span className="font-normal text-white/50">({items.length} garments)</span> : null}</span>
        {open ? <button type="button" onClick={() => setOpen(false)} className="text-xs text-white/60 hover:text-white">Hide</button>
          : <button type="button" onClick={load} className="text-xs text-[var(--admin-accent)] underline">Browse Printful&apos;s full garment catalog</button>}
      </div>
      {open ? (
        <div className="mt-2 space-y-2">
          {msg ? <p className="text-xs text-white/60">{msg}</p> : null}
          {items ? <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: brand, model, hoodie, 5000..." className="w-full rounded border border-white/15 bg-transparent px-2 py-1 text-sm text-white placeholder:text-white/35" /> : null}
          {sel ? (
            <div className="rounded border border-white/15 p-2">
              <div className="flex flex-wrap items-start gap-3">
                {selImg ? <img src={selImg} alt={sel.title} className="h-40 w-40 rounded bg-white object-contain" /> : null}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white">{sel.title} <span className="font-normal text-white/50">#{sel.id}</span></p>
                  <p className="text-xs text-white/55">{sel.type} - {sel.variants} variants</p>
                  <p className="mt-1 text-xs text-[var(--admin-gold)]">Preview only. To design and sell this garment, ask the developer to add it as a studio blank (print areas and placements are measured per garment). Save it to My garments so it&apos;s on your shortlist.</p>
                  <button type="button" disabled={saveMsg === "Saving..."} onClick={() => {
                    setSaveMsg("Saving...");
                    saveGarmentAction({ id: `pf-${sel.id}`, name: sel.title.slice(0, 80), blankId: null, printfulId: sel.id, colorHex: "", picked: [], title: sel.title, image: sel.image })
                      .then((r) => setSaveMsg(r.ok ? "Saved to My garments (shortlist) - reload the tab to see it at the top." : r.error)).catch(() => setSaveMsg("Couldn't save."));
                  }} className="mt-1 mr-3 text-xs text-[var(--admin-accent)] underline disabled:opacity-40">Save to My garments</button>
                  {saveMsg ? <span className="text-xs text-white/60">{saveMsg}</span> : null}
                  <button type="button" onClick={() => setSel(null)} className="mt-1 text-xs text-white/60 underline">Back to the list</button>
                </div>
              </div>
              {selColors === null ? <p className="mt-2 text-xs text-white/55">Loading colours...</p> : (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selColors.map((c) => (
                    <button key={c.name} type="button" title={`${c.name}${isTwoTone(c) ? " (two-tone)" : ""}`} onClick={() => c.image && setSelImg(c.image)}
                      className="h-7 w-7 rounded-full border-2 border-white/20" style={{ background: swatchBackground(c.hex, c.hex2) }} aria-label={c.name} />
                  ))}
                  {!selColors.length ? <span className="text-xs text-white/55">No colours listed.</span> : null}
                </div>
              )}
            </div>
          ) : items ? (
            <div className="grid max-h-[32rem] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4 lg:grid-cols-6">
              {list.map((it) => (
                <button key={it.id} type="button" onClick={() => pick(it)} className="overflow-hidden rounded border border-white/15 text-left hover:border-white/40">
                  <span className="block aspect-square bg-white">{it.image ? <img src={it.image} alt="" loading="lazy" className="h-full w-full object-contain" /> : null}</span>
                  <span className="block px-1.5 py-1">
                    <span className="line-clamp-2 text-[0.68rem] text-white/85">{it.title}</span>
                    {ourIds.has(it.id) ? <span className="text-[0.62rem] font-semibold text-[var(--admin-accent)]">In the studio</span> : null}
                  </span>
                </button>
              ))}
              {!list.length ? <p className="col-span-full text-xs text-white/55">Nothing matches.</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * D232 M-8 (G-92): Printful's own print-file size next to each studio-default
 * box (GET /mockup-generator/printfiles/{id}). Read-only; nothing is changed.
 */
function PrintfileCheck({ blankId, hasEstimates }: { blankId: string; hasEstimates: boolean }) {
  const [rows, setRows] = useState<PlacementCompare[] | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const run = () => {
    setBusy(true); setMsg("");
    printfileSizesAction({ blankId }).then((r) => { if (r.ok) setRows(r.rows); else setMsg(r.error); }).catch(() => setMsg("Couldn't reach Printful.")).finally(() => setBusy(false));
  };
  return (
    <div className="my-2 rounded-[var(--admin-radius-sm)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/5 p-2 text-xs text-white/80">
      <p>{hasEstimates ? <>Gold rows are studio estimates. {STUDIO_DEFAULT_STATUS}. Measure the sample with a ruler, then tell the developer the real width and height. </> : null}Printful rejects an order when the print area&apos;s shape is more than 2% off its print file - run this after Printful changes a product.{" "}
        <button type="button" disabled={busy} className="text-[var(--admin-accent)] underline disabled:opacity-40" onClick={run}>{busy ? "Asking Printful..." : "Compare every placement with Printful's print files (size + ratio)"}</button>
      </p>
      {msg ? <p className="mt-1 text-[var(--admin-danger)]">{msg}</p> : null}
      {rows ? (
        <ul className="mt-1 space-y-0.5">
          {rows.map((r) => <li key={r.placementId} className={r.verdict === "bigger" || r.verdict === "ratio" ? "text-[var(--admin-danger)]" : r.verdict === "no-file" ? "text-[var(--admin-gold)]" : "text-white/80"}><b>{r.label}:</b> {r.text}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

const getBlankPrintfulId = (id: string) => BLANKS.find((b) => b.id === id)?.printfulId ?? 0;

/**
 * D278 - "My garments": save the garment you're looking at (garment + preview
 * colour + ticked colours) under a name, and load it again later on any
 * computer (site_settings, see saved-garments-core).
 */
function SavedGarmentsBar({ blank, colorHex, colorName, picked, onLoad }: {
  blank: Blank; colorHex: string; colorName: string; picked: string[]; onLoad: (g: SavedGarment) => void;
}) {
  const [list, setList] = useState<SavedGarment[] | null>(null);
  const [msg, setMsg] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    listSavedGarmentsAction().then((r) => { if (!live) return; if (r.ok) setList(r.list); else { setList([]); setMsg(r.error); } }).catch(() => { if (live) { setList([]); setMsg("Couldn't load your saved garments."); } });
    return () => { live = false; };
  }, []);
  const done = (r: { ok: true; list: SavedGarment[] } | { ok: false; error: string }, ok: string) => { if (r.ok) { setList(r.list); setMsg(ok); } else setMsg(r.error); };
  const save = () => {
    const n = (name.trim() || defaultGarmentName(blank.brand, blank.model, colorName)).slice(0, 80);
    const same = list?.find((g) => g.name.toLowerCase() === n.toLowerCase());
    setBusy(true);
    saveGarmentAction({ id: same?.id ?? `g-${Date.now().toString(36)}`, name: n, blankId: blank.id, printfulId: blank.printfulId, colorHex, picked })
      .then((r) => { done(r, same ? `Updated "${n}".` : `Saved "${n}".`); if (r.ok) setName(""); }).catch(() => setMsg("Couldn't save.")).finally(() => setBusy(false));
  };
  const remove = (g: SavedGarment) => {
    if (!window.confirm(`Remove "${g.name}" from My garments?`)) return;
    setBusy(true);
    removeSavedGarmentAction({ id: g.id }).then((r) => done(r, `Removed "${g.name}".`)).catch(() => setMsg("Couldn't remove.")).finally(() => setBusy(false));
  };
  return (
    <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-white">My garments</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={defaultGarmentName(blank.brand, blank.model, colorName)}
          className="min-w-[14rem] flex-1 rounded border border-white/15 bg-transparent px-2 py-1 text-sm text-white placeholder:text-white/35" aria-label="Name for this saved garment" />
        <button type="button" disabled={busy || list === null} onClick={save} className="rounded-[var(--admin-radius-sm)] bg-[var(--admin-accent)] px-3 py-1 text-xs font-semibold text-black disabled:opacity-40">Save this garment</button>
      </div>
      <p className="mt-1 text-[0.7rem] text-white/45">Saves the garment, the colour you&apos;re previewing and the colours you ticked ({picked.length}). Saved on the server - every computer signed in to the admin sees the same list. Same name = update it.</p>
      {msg ? <p className="mt-1 text-xs text-white/70">{msg}</p> : null}
      {list === null ? <p className="mt-1 text-xs text-white/55">Loading...</p> : list.length ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {list.map((g) => {
            const b = g.blankId ? BLANKS.find((x) => x.id === g.blankId) : undefined;
            return (
              <li key={g.id} className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${g.blankId === blank.id ? "border-[var(--admin-accent)]" : "border-white/15"}`}>
                {g.colorHex ? <span className="inline-block h-3 w-3 rounded-full border border-white/30" style={{ background: g.colorHex }} /> : null}
                {b ? (
                  <button type="button" disabled={busy} onClick={() => { onLoad(g); setMsg(`Loaded "${g.name}".`); }} className="text-white hover:underline" title={`${b.brand} ${b.model} - ${g.picked.length} colour(s) ticked`}>{g.name}</button>
                ) : (
                  <span className="text-white/60" title={`Printful #${g.printfulId} - not a studio blank yet (ask the developer to add it)`}>{g.name} <span className="text-[var(--admin-gold)]">(shortlist)</span></span>
                )}
                <button type="button" disabled={busy} onClick={() => remove(g)} className="text-white/40 hover:text-[var(--admin-danger)]" aria-label={`Remove ${g.name}`}>{"\u00d7"}</button>
              </li>
            );
          })}
        </ul>
      ) : <p className="mt-1 text-xs text-white/55">Nothing saved yet.</p>}
    </div>
  );
}
