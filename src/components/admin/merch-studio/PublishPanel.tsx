"use client";

/**
 * R71 S4 - "Publish & Ads" tab. Two separate jobs, deliberately kept apart:
 *
 *  A. Greenway Goods redirect ad (on the CANNABIS site). One content block
 *     (merch.ad): on/off, ONE https address on the separate merch domain,
 *     marketing words and up to 4 pictures. No product data at all - no
 *     prices, sizes, SKUs, ids or per-product links (owner rule: "A pure
 *     redirect button, that's it"). Draft -> publish, audited, revisioned.
 *
 *  B. Listing package (for the SEPARATE merch site, Slice 5). Pick a saved
 *     design, colours, sizes and a retail price; download one JSON file the
 *     merch site will import. It is generated in this browser and downloaded
 *     - never saved to the cannabis database and never shown on the cannabis
 *     site.
 */
import { useState } from "react";
import { colorsFor, formatCents, getBlank, sizesFor } from "@/lib/merch-studio/garment-catalog-core";
import { buildListingPackage, listingFilename, LISTING_LIMITS } from "@/lib/merch-studio/listing-package-core";
import type { MerchDesign } from "@/lib/merch-studio/merch-design-core";
import type { Issue } from "@/lib/merch-studio/print-rules-core";
import {
  MERCH_AD_BLOCK, MERCH_AD_LIMITS, MERCH_AD_MAX_CARDS, MERCH_AD_MAX_TILES, MERCH_SITE_ORIGIN, STANDARD_MERCH_AD_CARDS, merchAdIssues, merchAdViewOf, merchCardHref, normalizeMerchAd, parseMerchAd, safeAdImage, safeCardPath, safeMerchUrl, serializeMerchAd, type MerchAd, type MerchAdCard,
} from "@/lib/merch/merch-ad-core";
import { MerchRedirectAdView } from "@/components/merch/MerchRedirectAdView";
import { ContentImageField, type MediaChoice } from "@/components/admin/ContentImageField";
import { Row, Toggle, studioInput, studioLabel } from "@/components/admin/banner-studio/controls";
import { IssueList } from "./IssueList";
import { loadDesigns } from "./merch-assets";
import { downloadBytes } from "./print-export";
import { publishMerchAdAction, saveMerchAdDraftAction } from "@/app/admin/merch-studio/ad-actions";

const btn = "rounded-[var(--admin-radius-sm)] px-3 py-1.5 text-xs font-bold disabled:opacity-40";

export interface MerchAdBlockVM { draft: string | null; published: string | null; status: string; available: boolean }

export function PublishPanel({ adBlock, mediaChoices }: { adBlock: MerchAdBlockVM; mediaChoices: MediaChoice[] }) {
  return (
    <div className="space-y-8">
      <AdEditor adBlock={adBlock} mediaChoices={mediaChoices} />
      <ListingBuilder />
    </div>
  );
}

// ---------------------------------------------------------------------------
// A. The redirect ad
// ---------------------------------------------------------------------------
function AdEditor({ adBlock, mediaChoices }: { adBlock: MerchAdBlockVM; mediaChoices: MediaChoice[] }) {
  const start = adBlock.draft || adBlock.published;
  const [ad, setAd] = useState<MerchAd>(() => parseMerchAd(start));
  const value = serializeMerchAd(ad);
  const savedDraft = serializeMerchAd(parseMerchAd(start));
  const livePublished = adBlock.status === "published" ? serializeMerchAd(parseMerchAd(adBlock.published)) : serializeMerchAd(parseMerchAd(""));
  const dirty = value !== savedDraft;
  const live = livePublished === value;
  const liveAd = parseMerchAd(adBlock.status === "published" ? adBlock.published : "");
  const issues = merchAdIssues(ad);
  const blockers = issues.filter((i) => i.level === "blocker");
  const cleanUrl = safeMerchUrl(ad.url);
  const set = (patch: Partial<MerchAd>) => setAd((a) => normalizeMerchAd({ ...a, ...patch }));
  const setTile = (i: number, patch: Partial<MerchAd["tiles"][number]>) => setAd((a) => ({ ...a, tiles: a.tiles.map((t, n) => (n === i ? { ...t, ...patch, caption: (patch.caption ?? t.caption).slice(0, MERCH_AD_LIMITS.caption) } : t)) }));
  const [newTile, setNewTile] = useState("");
  const previewView = cleanUrl ? merchAdViewOf(ad, cleanUrl) : null;
  const setCard = (i: number, patch: Partial<MerchAdCard>) => setAd((a) => ({ ...a, cards: a.cards.map((c, n) => (n === i ? { ...c, ...patch } : c)) }));
  const [newCard, setNewCard] = useState<{ path: string; label: string; image: string }>({ path: "", label: "", image: "" });
  const missingStandard = STANDARD_MERCH_AD_CARDS.filter((c) => !ad.cards.some((x) => x.path === c.path));

  return (
    <section aria-labelledby="merch-ad-h" className="space-y-4">
      <div>
        <h3 id="merch-ad-h" className="text-base font-bold text-white">A. Greenway Goods ad on the cannabis website</h3>
        <p className="mt-1 max-w-3xl text-sm text-white/70">
          One advert at the bottom of the Shop page and every shop category page (/menu, /menu/flower, ...), that sends customers to the separate Greenway Goods website in a new tab.
          It carries <b className="text-white">no product data</b>: no prices, sizes, stock, SKUs or per-product links - just your words, up to {MERCH_AD_MAX_TILES} pictures and one address. Prices, carts and card checkout live only on the merch website.
        </p>
      </div>

      {!adBlock.available ? (
        <p className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-gold)]/60 bg-[var(--admin-gold)]/10 p-3 text-sm text-white/85">The database isn&apos;t reachable on this deployment, so the ad can&apos;t be saved here.</p>
      ) : null}

      <p className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${liveAd.enabled && safeMerchUrl(liveAd.url) ? "bg-[var(--admin-accent)]/15 text-[var(--admin-accent)]" : "bg-white/10 text-white/70"}`}>
        {liveAd.enabled && safeMerchUrl(liveAd.url) ? `Live now - links to ${new URL(safeMerchUrl(liveAd.url)).hostname}` : "Not showing on the website"}
        {dirty ? " - unsaved changes" : !live ? " - draft not published yet" : ""}
      </p>

      <div className="grid gap-5 xl:grid-cols-[26rem_1fr]">
        <form className="space-y-3">
          <input type="hidden" name="block_key" value={MERCH_AD_BLOCK} />
          <input type="hidden" name="draft_value" value={value} />
          <Toggle label="Show the ad on the cannabis website" checked={ad.enabled} onChange={(v) => set({ enabled: v })} />
          <Row label="Greenway Goods website address" hint={`The separate domain only (${MERCH_SITE_ORIGIN}) - https, no ?parameters or #tags, never greenwaymarijuana.com.`}>
            <input className={studioInput} value={ad.url} maxLength={MERCH_AD_LIMITS.url} placeholder={MERCH_SITE_ORIGIN} inputMode="url" autoComplete="off" spellCheck={false} onChange={(e) => set({ url: e.target.value })} />
          </Row>
          {!ad.url ? <button type="button" className={`${btn} -mt-2 border border-white/20 text-white/80`} onClick={() => set({ url: MERCH_SITE_ORIGIN })}>Use {MERCH_SITE_ORIGIN}</button> : null}
          {ad.url && cleanUrl ? <p className="-mt-2 text-[0.7rem] text-white/55">Links to <code className="text-white/80">{cleanUrl}</code></p> : null}
          <Row label={`Small label (${MERCH_AD_LIMITS.eyebrow})`}><input className={studioInput} value={ad.eyebrow} maxLength={MERCH_AD_LIMITS.eyebrow} onChange={(e) => set({ eyebrow: e.target.value })} /></Row>
          <Row label={`Heading (${MERCH_AD_LIMITS.heading})`}><input className={studioInput} value={ad.heading} maxLength={MERCH_AD_LIMITS.heading} onChange={(e) => set({ heading: e.target.value })} /></Row>
          <Row label={`Short intro (${MERCH_AD_LIMITS.intro})`}><textarea className={studioInput} rows={3} value={ad.intro} maxLength={MERCH_AD_LIMITS.intro} onChange={(e) => set({ intro: e.target.value })} /></Row>
          <Row label={`Button words (${MERCH_AD_LIMITS.button})`}><input className={studioInput} value={ad.button} maxLength={MERCH_AD_LIMITS.button} onChange={(e) => set({ button: e.target.value })} /></Row>

          <div>
            <span className={studioLabel}>Pictures ({ad.tiles.length}/{MERCH_AD_MAX_TILES}) - lifestyle or mockup photos, no price tags</span>
            <ul className="space-y-2">
              {ad.tiles.map((t, i) => (
                <li key={`${t.image}-${i}`} className="flex items-start gap-2 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- admin thumbnail of an owner-picked picture */}
                  <img src={t.image} alt="" className="h-14 w-14 shrink-0 rounded object-cover" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <input className={studioInput} value={t.caption} maxLength={MERCH_AD_LIMITS.caption} placeholder="Caption (optional)" onChange={(e) => setTile(i, { caption: e.target.value })} />
                    <div className="flex gap-1">
                      <button type="button" className={`${btn} border border-white/20 text-white/80`} disabled={i === 0} onClick={() => setAd((a) => { const n = [...a.tiles]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return { ...a, tiles: n }; })}>Up</button>
                      <button type="button" className={`${btn} border border-white/20 text-white/80`} disabled={i === ad.tiles.length - 1} onClick={() => setAd((a) => { const n = [...a.tiles]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return { ...a, tiles: n }; })}>Down</button>
                      <button type="button" className={`${btn} border border-[var(--admin-danger)]/60 text-white/80`} onClick={() => setAd((a) => ({ ...a, tiles: a.tiles.filter((_, n) => n !== i) }))}>Remove</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {ad.tiles.length < MERCH_AD_MAX_TILES ? (
              <div className="mt-2 space-y-2 rounded-[var(--admin-radius-sm)] border border-dashed border-[var(--admin-border)] p-2">
                <ContentImageField value={newTile} onChange={setNewTile} mediaChoices={mediaChoices.filter((m) => !m.mimeType || m.mimeType.startsWith("image/"))} />
                <button type="button" className={`${btn} bg-[var(--admin-accent)] text-black`} disabled={!safeAdImage(newTile)} onClick={() => { const img = safeAdImage(newTile); if (!img) return; setAd((a) => normalizeMerchAd({ ...a, tiles: [...a.tiles, { image: img, caption: "" }] })); setNewTile(""); }}>Add picture</button>
                {newTile && !safeAdImage(newTile) ? <p className="text-[0.7rem] text-[var(--admin-danger)]">Use a picture from the Media Library, a /site path, or an https:// address.</p> : null}
              </div>
            ) : null}
          </div>

          <div>
            <span className={studioLabel}>Category cards ({ad.cards.length}/{MERCH_AD_MAX_CARDS}) - shown when a shopper picks &ldquo;Greenway Merch&rdquo; in the shop filter bar</span>
            <p className="mb-2 text-[0.7rem] text-white/55">Each card links to one category page on the merch site, e.g. <code className="text-white/80">{(cleanUrl || MERCH_SITE_ORIGIN) + "/tees"}</code>. No prices - just a picture, a name and a short line.</p>
            {missingStandard.length ? (
              <button type="button" className={`${btn} mb-2 bg-[var(--admin-accent)] text-black`} onClick={() => setAd((a) => normalizeMerchAd({ ...a, cards: [...a.cards, ...missingStandard] }))}>
                Add the standard category cards ({missingStandard.map((c) => c.label).join(", ")})
              </button>
            ) : null}
            <ul className="space-y-2">
              {ad.cards.map((c, i) => (
                <li key={c.path} className="flex items-start gap-2 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- admin thumbnail of an owner-picked picture */}
                  <img src={c.image} alt="" className="h-14 w-14 shrink-0 rounded object-cover" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex gap-1">
                      <input className={studioInput} value={c.label} maxLength={MERCH_AD_LIMITS.label} aria-label="Card name" onChange={(e) => setCard(i, { label: e.target.value })} />
                      <code className="shrink-0 self-center text-[0.65rem] text-white/55">/{c.path}</code>
                    </div>
                    <input className={studioInput} value={c.text} maxLength={MERCH_AD_LIMITS.cardText} placeholder="Short line (optional)" aria-label="Card words" onChange={(e) => setCard(i, { text: e.target.value })} />
                    <div className="flex gap-1">
                      <button type="button" className={`${btn} border border-white/20 text-white/80`} disabled={i === 0} onClick={() => setAd((a) => { const n = [...a.cards]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return { ...a, cards: n }; })}>Up</button>
                      <button type="button" className={`${btn} border border-white/20 text-white/80`} disabled={i === ad.cards.length - 1} onClick={() => setAd((a) => { const n = [...a.cards]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return { ...a, cards: n }; })}>Down</button>
                      <button type="button" className={`${btn} border border-[var(--admin-danger)]/60 text-white/80`} onClick={() => setAd((a) => ({ ...a, cards: a.cards.filter((_, n) => n !== i) }))}>Remove</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {ad.cards.length < MERCH_AD_MAX_CARDS ? (
              <div className="mt-2 space-y-2 rounded-[var(--admin-radius-sm)] border border-dashed border-[var(--admin-border)] p-2">
                <div className="flex gap-1">
                  <input className={studioInput} value={newCard.label} maxLength={MERCH_AD_LIMITS.label} placeholder="Name, e.g. Long Sleeves" onChange={(e) => setNewCard((n) => ({ ...n, label: e.target.value }))} />
                  <input className={studioInput} value={newCard.path} maxLength={MERCH_AD_LIMITS.path} placeholder="page, e.g. long-sleeves" onChange={(e) => setNewCard((n) => ({ ...n, path: e.target.value }))} />
                </div>
                <ContentImageField value={newCard.image} onChange={(v) => setNewCard((n) => ({ ...n, image: v }))} mediaChoices={mediaChoices.filter((m) => !m.mimeType || m.mimeType.startsWith("image/"))} />
                <button type="button" className={`${btn} bg-[var(--admin-accent)] text-black`} disabled={!safeCardPath(newCard.path) || !safeAdImage(newCard.image) || ad.cards.some((c) => c.path === safeCardPath(newCard.path))} onClick={() => { setAd((a) => normalizeMerchAd({ ...a, cards: [...a.cards, { path: newCard.path, label: newCard.label, image: newCard.image, text: "" }] })); setNewCard({ path: "", label: "", image: "" }); }}>Add card</button>
                {newCard.path && !safeCardPath(newCard.path) ? <p className="text-[0.7rem] text-[var(--admin-danger)]">The page must be one word: lowercase letters, numbers and dashes (it becomes {MERCH_SITE_ORIGIN}/<i>page</i>).</p> : null}
                {newCard.path && safeCardPath(newCard.path) && cleanUrl ? <p className="text-[0.7rem] text-white/55">Links to <code className="text-white/80">{merchCardHref(cleanUrl, newCard.path)}</code></p> : null}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--admin-border)] pt-3">
            <button type="submit" formAction={saveMerchAdDraftAction} disabled={!adBlock.available} className={`${btn} border border-white/25 text-white`}>Save draft</button>
            <button type="submit" formAction={publishMerchAdAction} disabled={!adBlock.available || (ad.enabled && blockers.length > 0) || live} className={`${btn} bg-[var(--admin-accent)] text-black`}>
              {ad.enabled ? "Publish to the website" : "Publish (ad hidden)"}
            </button>
            <span className="text-xs text-white/55">{ad.enabled && blockers.length ? "Fix the blockers to publish." : live ? "The website already shows exactly this." : "Publish saves and makes this live on every shop page at once."}</span>
          </div>
        </form>

        <div className="space-y-3">
          <span className={studioLabel}>Live preview (exactly what customers will see)</span>
          <div className="overflow-hidden rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-black py-4" onClickCapture={(e) => { if ((e.target as HTMLElement).closest("a")) e.preventDefault(); }}>
            {previewView ? <MerchRedirectAdView view={previewView} /> : <p className="p-6 text-center text-sm text-white/55">Add a valid https address on the separate merch domain to see the preview. Until then nothing shows on the website.</p>}
          </div>
          {previewView && previewView.cards.length ? (
            <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-black p-3" onClickCapture={(e) => { if ((e.target as HTMLElement).closest("a")) e.preventDefault(); }}>
              <span className={studioLabel}>Shop filter &ldquo;Greenway Merch&rdquo; shows these cards</span>
              <ul className="grid grid-cols-2 gap-2 md:grid-cols-3">
                {previewView.cards.map((c) => (
                  <li key={c.href} className="overflow-hidden rounded-xl border border-white/10 bg-zinc-950">
                    {/* eslint-disable-next-line @next/next/no-img-element -- preview of an owner-picked picture */}
                    <img src={c.image} alt="" className="aspect-[4/3] w-full object-cover" />
                    <div className="p-2"><p className="text-sm font-black text-white">{c.label}</p><p className="truncate text-[0.65rem] text-white/55">{c.href}</p></div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {!ad.enabled && previewView ? <p className="text-xs text-white/55">The ad is switched off, so customers won&apos;t see it even after publishing.</p> : null}
          <AdIssues issues={issues} />
          <p className="text-[0.7rem] text-white/45">Links open in a new tab with no referrer and no tracking parameters - the merch website receives no data from the cannabis website. Clicks are counted only in this site&apos;s own click analytics (placement &ldquo;other&rdquo;, slot &ldquo;greenway-goods&rdquo;).</p>
        </div>
      </div>
    </section>
  );
}

function AdIssues({ issues }: { issues: ReturnType<typeof merchAdIssues> }) {
  if (!issues.length) return <p className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-3 text-sm text-white/70">{"\u2705"} Ready - no product details, one clean address.</p>;
  return (
    <ul className="space-y-1.5">
      {issues.map((i, n) => (
        <li key={`${i.field}-${n}`} className={`rounded-[var(--admin-radius-sm)] border p-2 text-sm text-white/85 ${i.level === "blocker" ? "border-[var(--admin-danger)]/60 bg-[var(--admin-danger)]/10" : "border-[var(--admin-gold)]/60 bg-[var(--admin-gold)]/10"}`}>
          {i.level === "blocker" ? "\u26d4" : "\u26a0\ufe0f"} {i.text}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// B. Listing package for the separate merch site
// ---------------------------------------------------------------------------
const toCents = (s: string) => { const n = Number.parseFloat(s.replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? Math.round(n * 100) : 0; };

function ListingBuilder() {
  // This panel only mounts client-side after MerchStudio's restore, so reading localStorage in the initializer is hydration-safe (same as ProofPanel).
  const [designs] = useState<MerchDesign[]>(() => loadDesigns());
  const [designId, setDesignId] = useState(designs[0]?.id ?? "");
  const design = designs.find((d) => d.id === designId) ?? null;
  const blank = design ? getBlank(design.blankId) : undefined;
  const [title, setTitle] = useState(design?.name ?? "");
  const [description, setDescription] = useState("");
  const [colors, setColors] = useState<string[]>(() => {
    const b = design ? getBlank(design.blankId) : undefined;
    const c = b ? colorsFor(b).find((x) => x[1].toLowerCase() === design!.colorHex.toLowerCase()) : undefined;
    return c ? [c[0]] : [];
  });
  const [sizes, setSizes] = useState<string[]>(() => {
    const b = design ? getBlank(design.blankId) : undefined;
    return b ? sizesFor(b).map((s) => s[0]) : [];
  });
  const [retail, setRetail] = useState("35");
  const [passUp, setPassUp] = useState(true);
  const [done, setDone] = useState<string | null>(null);

  const pick = (id: string) => {
    const d = designs.find((x) => x.id === id) ?? null;
    setDesignId(id);
    setDone(null);
    setTitle(d?.name ?? "");
    const b = d ? getBlank(d.blankId) : undefined;
    const c = b ? colorsFor(b).find((x) => x[1].toLowerCase() === d!.colorHex.toLowerCase()) : undefined;
    setColors(c ? [c[0]] : []);
    setSizes(b ? sizesFor(b).map((s) => s[0]) : []);
  };
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  if (!designs.length) {
    return (
      <section className="space-y-2">
        <h3 className="text-base font-bold text-white">B. Listing package for the Greenway Goods website</h3>
        <p className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-3 text-sm text-white/70">No saved designs in this browser yet. Make one on the Design tab, then come back.</p>
      </section>
    );
  }

  const built = design ? buildListingPackage({ design, title, description, colors, sizes, retailCents: toCents(retail), passSizeUpcharge: passUp, generatedAt: "" }) : null;
  const issues: Issue[] = built?.issues ?? [];
  const blocked = issues.some((i) => i.level === "blocker");
  const pkg = built?.pkg ?? null;
  const v = pkg?.variants ?? [];
  const minProfit = v.length ? Math.min(...v.map((x) => x.profitCents)) : 0;
  const maxProfit = v.length ? Math.max(...v.map((x) => x.profitCents)) : 0;

  return (
    <section aria-labelledby="merch-listing-h" className="space-y-4 border-t border-[var(--admin-border)] pt-6">
      <div>
        <h3 id="merch-listing-h" className="text-base font-bold text-white">B. Listing package for the Greenway Goods website</h3>
        <p className="mt-1 max-w-3xl text-sm text-white/70">
          Turns a finished design into one file the separate merch website imports (Slice 5): title, colours, sizes, Printful variant ids, your retail prices with profit per variant, the print files and their exact print positions. It is built and downloaded <b className="text-white">in this browser only</b> - nothing is saved to or shown on the cannabis website.
        </p>
      </div>
      <div className="grid gap-5 xl:grid-cols-[26rem_1fr]">
        <div className="space-y-3">
          <Row label="Design"><select className={studioInput} value={designId} onChange={(e) => pick(e.target.value)}>{designs.map((d) => <option key={d.id} value={d.id}>{d.name} - {getBlank(d.blankId)?.brand ?? "?"} {getBlank(d.blankId)?.model ?? ""}</option>)}</select></Row>
          <Row label={`Product title (${LISTING_LIMITS.title})`}><input className={studioInput} value={title} maxLength={LISTING_LIMITS.title} onChange={(e) => { setTitle(e.target.value); setDone(null); }} /></Row>
          <Row label={`Description (${LISTING_LIMITS.description})`}><textarea className={studioInput} rows={3} value={description} maxLength={LISTING_LIMITS.description} onChange={(e) => { setDescription(e.target.value); setDone(null); }} /></Row>
          {blank ? (
            <>
              <div>
                <span className={studioLabel}>Colours ({colors.length})</span>
                <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
                  {colorsFor(blank).map(([name, hex]) => (
                    <button key={name} type="button" aria-pressed={colors.includes(name)} onClick={() => { setColors((c) => toggle(c, name)); setDone(null); }}
                      className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.7rem] ${colors.includes(name) ? "border-[var(--admin-accent)] text-white" : "border-white/15 text-white/55"}`}>
                      <span className="inline-block h-3 w-3 rounded-full border border-white/30" style={{ background: hex }} />{name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className={studioLabel}>Sizes ({sizes.length})</span>
                <div className="flex flex-wrap gap-1">
                  {sizesFor(blank).map(([s, c]) => (
                    <button key={s} type="button" aria-pressed={sizes.includes(s)} onClick={() => { setSizes((x) => toggle(x, s)); setDone(null); }}
                      className={`rounded-full border px-2 py-0.5 text-[0.7rem] ${sizes.includes(s) ? "border-[var(--admin-accent)] text-white" : "border-white/15 text-white/55"}`}>{s} <span className="text-white/45">{formatCents(c)}</span></button>
                  ))}
                </div>
              </div>
            </>
          ) : null}
          <Row label="Retail price, smallest size (USD)"><input className={studioInput} inputMode="decimal" value={retail} onChange={(e) => { setRetail(e.target.value); setDone(null); }} /></Row>
          <Toggle label="Add Printful's bigger-size upcharge (e.g. 2XL) to the price" checked={passUp} onChange={(x) => { setPassUp(x); setDone(null); }} />
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--admin-border)] pt-3">
            <button type="button" className={`${btn} bg-[var(--admin-accent)] text-black`} disabled={!pkg || blocked}
              onClick={() => {
                if (!design || !pkg) return;
                // Rebuild with the real timestamp at click time (render stays pure).
                const fresh = buildListingPackage({ design, title, description, colors, sizes, retailCents: toCents(retail), passSizeUpcharge: passUp, generatedAt: new Date().toISOString() }).pkg;
                if (!fresh) return;
                const name = listingFilename(fresh);
                downloadBytes(name, JSON.stringify(fresh, null, 2), "application/json");
                setDone(name);
              }}>
              Download listing package (.json)
            </button>
            {done ? <span className="text-xs text-[var(--admin-accent)]">Downloaded {done}</span> : <span className="text-xs text-white/55">{blocked ? "Fix the blockers first." : "Keep it with the Proof & Export ZIP for this design."}</span>}
          </div>
        </div>
        <div className="space-y-3">
          {v.length ? (
            <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 text-sm">
              <p className="mb-2 text-white/80"><b className="text-white">{v.length}</b> variant{v.length === 1 ? "" : "s"} - profit per unit {formatCents(minProfit)}{maxProfit !== minProfit ? ` to ${formatCents(maxProfit)}` : ""} after the Printful estimate and the Stripe fee (shipping passed through, sales tax excluded).</p>
              <div className="max-h-72 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-white/50"><tr><th className="py-1">Colour</th><th>Size</th><th className="text-right">Printful</th><th className="text-right">Retail</th><th className="text-right">Fee</th><th className="text-right">Profit</th><th className="text-right">Margin</th></tr></thead>
                  <tbody>
                    {v.map((x) => (
                      <tr key={x.printfulVariantId} className={`border-t border-[var(--admin-border)] ${x.inStock ? "" : "opacity-50"}`}>
                        <td className="py-0.5 text-white/80">{x.color}{x.inStock ? "" : " (out of stock)"}</td><td className="text-white/80">{x.size}</td>
                        <td className="text-right text-white/80">{formatCents(x.printfulCents)}</td><td className="text-right text-white">{formatCents(x.retailCents)}</td>
                        <td className="text-right text-white/70">{formatCents(x.cardFeeCents)}</td>
                        <td className={`text-right font-semibold ${x.profitCents > 0 ? "text-[var(--admin-accent)]" : "text-[var(--admin-danger)]"}`}>{formatCents(x.profitCents)}</td>
                        <td className="text-right text-white/70">{(x.marginBps / 100).toFixed(0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          <IssueList issues={issues} />
          <p className="text-[0.7rem] text-white/45">
            Why a file and not a button that creates the Printful product: Printful&apos;s store-product (sync) API does not accept a print position, so a product created that way would print where Printful decides, not where you designed it. The package carries the exact position for each order instead (the same order item the Proof tab shows). Prices are the catalog-snapshot estimate; Printful&apos;s order estimate is the final word.
          </p>
        </div>
      </div>
    </section>
  );
}
