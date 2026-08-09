import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BackLink } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui";
import { getPublishedVersion, getItemBySourceKey } from "@/lib/pos/menu-version";
import { getEnrichment, mediaUrlsForIds } from "@/lib/enrichment/store";
import { listAllBrands } from "@/lib/vendors/store";
// SLICE 77: enrichment ⇄ inventory cross-link — real lots behind this menu item.
import { listLotsForProductKey } from "@/lib/inventory/store";
import { listSuggestions, isAiConfigured } from "@/lib/ai/suggestions";
import { checkCompliance } from "@/lib/ai/compliance";
import { getEnrichmentCommandCenter } from "@/lib/enrichment/command-center";
import { checklistComplete } from "@/lib/enrichment/match-core";
import { isCrawlerConfigured } from "@/lib/ai/crawler-client";
import {
  buildWebSearchUrl,
  parseImageDraftLines,
  RESEARCH_IMAGES_FIELD,
} from "@/lib/enrichment/research-core";
import { buildEnrichmentLookupQuery } from "@/lib/enrichment/lookup-query-core";
import { EnrichmentAiLookupPanel } from "./EnrichmentAiLookupPanel";
import {
  updateProductEnrichment,
  setEnrichmentStatus,
  generateProductAi,
  acceptSuggestion,
  rejectSuggestion,
  applyMatchedText,
  attachMatchedMedia,
  importVendorImage,
  removeProductImage,
  setProductPrimaryImage,
  moveProductImage,
  researchProductAction,
  importResearchImage,
} from "../actions";

export const dynamic = "force-dynamic";
// SLICE 74: the web-research server action submitted from this page calls the
// crawl4ai worker for a SINGLE product page (fetch → GPT extract → verify →
// compliance). That's much quicker than a full-site crawl but still a real
// network round-trip, so give the action headroom on Vercel.
export const maxDuration = 300;

const field = "w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]";
const label = "mb-1 block text-xs font-medium text-white/50";

const TAG_OPTIONS = ["new-arrival", "best-seller", "staff-pick", "local", "high-cbd", "high-thc", "value", "limited"];

export default async function ProductEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ saved?: string; error?: string; ai?: string; back?: string; research?: string }>;
}) {
  const session = await requirePermission("products.enrich");
  const { key: rawKey } = await params;
  const key = decodeURIComponent(rawKey);
  const { saved, error, ai, back, research } = await searchParams;

  const published = await getPublishedVersion();
  if (!published) notFound();
  const item = await getItemBySourceKey(published.id, key);
  if (!item) notFound();

  const enrichment = await getEnrichment(key);
  const brands = await listAllBrands();
  // SLICE 77: inventory lots that share this product's POS key — the physical
  // stock behind the menu card, each linking to its lot detail page.
  const productLots = await listLotsForProductKey(key, 6);
  const allSuggestions = await listSuggestions("product", key, "pending");
  // SLICE 74: research_images drafts are reference data (image URL lists) —
  // they get their own visual review block instead of the plain-text one.
  const researchImageDrafts = allSuggestions.filter((s) => s.field_key === RESEARCH_IMAGES_FIELD);
  const suggestions = allSuggestions.filter((s) => s.field_key !== RESEARCH_IMAGES_FIELD);
  const crawlerOn = isCrawlerConfigured();
  const searchUrl = buildWebSearchUrl(item.name, item.brand_name);
  // SLICE 78 \u2014 the in-page Gemini look-up starts from a sharpened query:
  // brand + name + strain + category (blanks skipped, dupes de-duped). The
  // operator can edit it before running; nothing runs until they click.
  const lookupQuery = buildEnrichmentLookupQuery({
    name: item.name ?? "",
    brand: item.brand_name ?? "",
    category: item.category ?? "",
    strainName: item.strain_name ?? "",
  });
  const center = await getEnrichmentCommandCenter({ item });
  // SLICE 75 — the guidance panel is permanent; this flips it to its green
  // "fully enriched" state when every checklist row is done.
  const checklistDone = checklistComplete(center.checklist);

  // Resolve gallery image URLs.
  const galleryIds = enrichment?.image_media_ids ?? [];
  const urlMap = await mediaUrlsForIds(galleryIds);

  const currentTags = new Set(enrichment?.tags ?? []);
  const vis = enrichment?.hidden_override === null || enrichment?.hidden_override === undefined
    ? "inherit"
    : enrichment.hidden_override
      ? "hide"
      : "show";

  return (
    <div>
      <AdminPageHeader
        title={enrichment?.display_name || item.name}
        subtitle={`${item.brand_name || "—"} · ${item.category} · ${item.price_label} (POS-controlled)`}
        action={
          <BackLink fallback="/admin/products" back={back} className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 hover:border-[var(--admin-accent)] hover:text-white">
            ← All products
          </BackLink>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {saved && <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-2 text-sm text-[var(--admin-accent)]">Saved.</div>}
        {ai && <div className="rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 px-4 py-2 text-sm text-[var(--admin-gold)]">AI draft generated — review it below.</div>}
        {research && <div className="rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 px-4 py-2 text-sm text-[var(--admin-gold)]">{research}</div>}
        {error && <div className="rounded-lg border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 px-4 py-2 text-sm text-[var(--admin-orange)]">{error}</div>}

        {/* POS facts (read-only) */}
        <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4 text-xs text-white/55">
          <span className="font-semibold text-white/70">POS source (truth):</span>{" "}
          {item.name} · price {item.price_label} · {item.inventory_status} · strain {item.strain_type}
          {item.strain_name ? ` (${item.strain_name})` : ""} · THC {item.thc ?? "—"} · CBD {item.cbd ?? "—"}.
          <span className="ml-1 text-white/35">Price &amp; stock are never edited here.</span>
        </div>

        {/* SLICE 77: enrichment ⇄ inventory cross-link. The physical lots
            behind this menu item, so staff can jump straight from the menu
            card to the traceability record (vendor, COA, expiry, quantities). */}
        {productLots.length > 0 && (
          <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-white">Inventory lots for this product</p>
              <Link
                href={`/admin/inventory?q=${encodeURIComponent(key)}`}
                className="text-xs font-semibold text-[var(--admin-accent)] hover:underline"
              >
                Search in Inventory →
              </Link>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {productLots.map((lot) => (
                <li key={lot.id}>
                  <Link
                    href={`/admin/inventory/${lot.id}?back=${encodeURIComponent(`/admin/products/${rawKey}`)}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs hover:border-[var(--admin-accent)]/50"
                  >
                    <span className="min-w-0 flex-1 truncate text-white/80">
                      {lot.lot_code ?? lot.product_name ?? "Unnamed lot"}
                      {lot.vendor_name ? <span className="text-white/40"> · {lot.vendor_name}</span> : null}
                    </span>
                    <span className="shrink-0 text-white/40">
                      {lot.on_hand_qty} on hand · {lot.status}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* SLICE 38 — Command center: what the menu shows now + how to fix gaps */}
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          {/* Live menu image + provenance */}
          <div className="space-y-3 rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
            <p className="text-sm font-semibold text-white">On the menu right now</p>
            {center.liveImage ? (
              <>
                <div className="aspect-square overflow-hidden rounded-lg border border-white/10 bg-black">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={center.liveImage.url} alt="" className="h-full w-full object-cover" />
                </div>
                <p className="text-[11px] text-white/50">
                  {center.liveImage.isFallback ? (
                    <span className="rounded bg-[var(--admin-gold-soft)] px-1.5 py-0.5 font-semibold text-[var(--admin-gold)]">
                      Fallback: {center.liveImage.source.replace(/-/g, " ")}
                    </span>
                  ) : (
                    <span className="rounded bg-[var(--admin-accent-soft)] px-1.5 py-0.5 font-semibold text-[var(--admin-accent)]">
                      This product&apos;s own photo
                    </span>
                  )}
                </p>
              </>
            ) : (
              <p className="text-xs text-white/45">
                No image resolves for this product — the menu shows a generic mockup card.
              </p>
            )}
            {!center.gaps.hasImage && center.substitute && (
              <div className="flex items-center gap-2 border-t border-white/10 pt-3">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded border border-white/10 bg-black">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={center.substitute.url} alt="" className="h-full w-full object-cover" />
                </div>
                <p className="text-[11px] text-white/50">
                  Approved fallback for <span className="text-white/75">{center.substitute.key}</span> covers this card
                  automatically — no action needed unless you want a real photo.
                </p>
              </div>
            )}
          </div>

          {/* Guidance + KB knowledge */}
          <div className="space-y-4">
            {/* SLICE 75 — the panel is PERMANENT now (owner: "I would like for
                it to stay in the page forever"). It always shows the ✓/○
                scorecard; the how-to checklist + jump-to buttons appear only
                while something is still missing, and a green "fully enriched"
                line takes their place when everything is done. */}
            <div className="rounded-xl border border-[var(--admin-gold)]/25 bg-[var(--admin-gold)]/5 p-4">
              <p className="text-sm font-semibold text-[var(--admin-gold)]">How to finish enriching this product</p>
              <ul className="mt-2 space-y-1 text-xs">
                {center.checklist.map((c) => (
                  <li key={c.label} className="flex items-start gap-2">
                    <span
                      aria-hidden
                      className={`mt-px font-bold ${c.done ? "text-[var(--admin-accent)]" : "text-white/35"}`}
                    >
                      {c.done ? "✓" : "○"}
                    </span>
                    <span className={c.done ? "text-white/70" : "text-white/60"}>
                      <span className={`font-semibold ${c.done ? "text-white/80" : "text-[var(--admin-gold)]"}`}>{c.label}</span>
                      {" — "}
                      {c.detail}
                    </span>
                  </li>
                ))}
              </ul>
              {checklistDone ? (
                <p className="mt-3 border-t border-[var(--admin-gold)]/15 pt-3 text-xs font-semibold text-[var(--admin-accent)]">
                  ✓ Fully enriched — every detail is in place. This panel stays here so you can
                  see the scorecard at a glance; it will light up again if anything goes missing.
                </p>
              ) : (
                <>
                  {center.guidance.length > 0 && (
                    <ol className="mt-3 list-decimal space-y-1 border-t border-[var(--admin-gold)]/15 pl-5 pt-3 text-xs text-white/70">
                      {center.guidance.map((g) => (
                        <li key={g}>{g}</li>
                      ))}
                    </ol>
                  )}
                  {/* SLICE 73 — jump-to buttons: each guidance step gets a button
                      that takes you straight to WHERE that step happens (an admin
                      page or an anchor further down this page). */}
                  {center.guidanceActions.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--admin-gold)]/15 pt-3">
                      {center.guidanceActions.map((a) => (
                        <Link
                          key={a.href}
                          href={a.href}
                          title={a.hint}
                          className="rounded-lg border border-[var(--admin-gold)]/35 bg-black/30 px-2.5 py-1.5 text-[11px] font-semibold text-[var(--admin-gold)] transition-colors hover:bg-[var(--admin-gold)]/15"
                        >
                          {a.label} →
                        </Link>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* KB knowledge ladder result */}
            <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-white">Knowledge base</p>
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase text-white/60">
                  {center.knowledge.source === "none" ? "no match" : center.knowledge.source}
                </span>
              </div>
              {center.knowledge.source !== "none" ? (
                <div className="mt-3 space-y-3 text-xs text-white/70">
                  {center.knowledge.description && (
                    <div className="flex items-start justify-between gap-3">
                      <p className="whitespace-pre-wrap">{center.knowledge.description}</p>
                      {!enrichment?.description && (
                        <form action={applyMatchedText}>
                          <input type="hidden" name="key" value={key} />
                          <input type="hidden" name="field" value="description" />
                          <input type="hidden" name="value" value={center.knowledge.description} />
                          <input type="hidden" name="source" value={`kb:${center.knowledge.source}`} />
                          <Button type="submit" variant="confirm" size="sm">Use as description</Button>
                        </form>
                      )}
                    </div>
                  )}
                  {center.knowledge.shortDescription && (
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-white/55">{center.knowledge.shortDescription}</p>
                      {!enrichment?.short_description && (
                        <form action={applyMatchedText}>
                          <input type="hidden" name="key" value={key} />
                          <input type="hidden" name="field" value="short_description" />
                          <input type="hidden" name="value" value={center.knowledge.shortDescription} />
                          <input type="hidden" name="source" value={`kb:${center.knowledge.source}`} />
                          <Button type="submit" variant="neutral" size="sm">Use as short description</Button>
                        </form>
                      )}
                    </div>
                  )}
                  {(center.knowledge.aromaNotes.length > 0 ||
                    center.knowledge.flavorNotes.length > 0 ||
                    center.knowledge.terpenes.length > 0 ||
                    center.knowledge.effects.length > 0) && (
                    <div className="flex flex-wrap gap-1.5 border-t border-white/10 pt-2">
                      {center.knowledge.aromaNotes.map((n) => (
                        <span key={`a-${n}`} className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/60">aroma: {n}</span>
                      ))}
                      {center.knowledge.flavorNotes.map((n) => (
                        <span key={`f-${n}`} className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/60">flavor: {n}</span>
                      ))}
                      {center.knowledge.terpenes.map((n) => (
                        <span key={`t-${n}`} className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/60">terp: {n}</span>
                      ))}
                      {center.knowledge.effects.map((n) => (
                        <span key={`e-${n}`} className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/60">effect: {n}</span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-xs text-white/45">
                  Nothing validated in the KB matches this product yet. Publishing this enrichment will seed the KB
                  automatically.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Suggested matches (KB products / media library / vendor menus) */}
        {(center.kbSuggestions.length > 0 || center.mediaSuggestions.length > 0 || center.vendorSuggestions.length > 0) && (
          <div id="matches" className="scroll-mt-24 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
            <p className="text-sm font-semibold text-white">Suggested matches</p>
            <p className="mt-1 text-[11px] text-white/45">
              Conservative name + brand matching — every suggestion shows WHY it matched. Nothing is applied until you click.
            </p>

            {center.kbSuggestions.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-white/50">From the knowledge base</p>
                <ul className="mt-2 space-y-2">
                  {center.kbSuggestions.map((m) => (
                    <li key={m.candidate.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-black p-3">
                      {m.imageUrl && (
                        <div className="h-14 w-14 overflow-hidden rounded border border-white/10">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={m.imageUrl} alt="" className="h-full w-full object-cover" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-white/85">
                          {m.candidate.display_name}
                          <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/55">{Math.round(m.score * 100)}% match</span>
                        </p>
                        <p className="mt-0.5 text-[11px] text-white/45">{m.reasons.join(" ")}</p>
                      </div>
                      <div className="flex gap-2">
                        {m.primaryMediaId && !center.gaps.hasImage && (
                          <form action={attachMatchedMedia}>
                            <input type="hidden" name="key" value={key} />
                            <input type="hidden" name="mediaId" value={m.primaryMediaId} />
                            <input type="hidden" name="source" value="kb-product" />
                            <Button type="submit" variant="confirm" size="sm">Use image</Button>
                          </form>
                        )}
                        {m.description && !enrichment?.description && (
                          <form action={applyMatchedText}>
                            <input type="hidden" name="key" value={key} />
                            <input type="hidden" name="field" value="description" />
                            <input type="hidden" name="value" value={m.description} />
                            <input type="hidden" name="source" value="kb-product" />
                            <Button type="submit" variant="neutral" size="sm">Use description</Button>
                          </form>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {center.mediaSuggestions.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-white/50">From the media library</p>
                <ul className="mt-2 space-y-2">
                  {center.mediaSuggestions.map((m) => (
                    <li key={m.candidate.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-black p-3">
                      {m.url && (
                        <div className="h-14 w-14 overflow-hidden rounded border border-white/10">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={m.url} alt={m.candidate.alt_text ?? ""} className="h-full w-full object-cover" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-white/85">
                          {m.candidate.title || "(untitled image)"}
                          <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/55">{Math.round(m.score * 100)}% match</span>
                        </p>
                        <p className="mt-0.5 text-[11px] text-white/45">{m.reasons.join(" ")}</p>
                      </div>
                      <form action={attachMatchedMedia}>
                        <input type="hidden" name="key" value={key} />
                        <input type="hidden" name="mediaId" value={m.candidate.id} />
                        <input type="hidden" name="source" value="media-library" />
                        <Button type="submit" variant="confirm" size="sm">Attach image</Button>
                      </form>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {center.vendorSuggestions.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-white/50">From vendor menus</p>
                <ul className="mt-2 space-y-2">
                  {center.vendorSuggestions.map((m) => (
                    <li key={m.candidate.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-black p-3">
                      {m.savedMediaUrl && (
                        <div className="h-14 w-14 overflow-hidden rounded border border-white/10">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={m.savedMediaUrl} alt="" className="h-full w-full object-cover" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-white/85">
                          {m.candidate.name}
                          <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase text-white/55">{m.candidate.platform}</span>
                          <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/55">{Math.round(m.score * 100)}% match</span>
                        </p>
                        <p className="mt-0.5 text-[11px] text-white/45">{m.reasons.join(" ")}</p>
                      </div>
                      <div className="flex gap-2">
                        {m.candidate.media_asset_id ? (
                          <form action={attachMatchedMedia}>
                            <input type="hidden" name="key" value={key} />
                            <input type="hidden" name="mediaId" value={m.candidate.media_asset_id} />
                            <input type="hidden" name="source" value={`vendor:${m.candidate.platform}`} />
                            <Button type="submit" variant="confirm" size="sm">Use saved image</Button>
                          </form>
                        ) : m.candidate.image_url ? (
                          <form action={importVendorImage}>
                            <input type="hidden" name="key" value={key} />
                            <input type="hidden" name="imageUrl" value={m.candidate.image_url} />
                            <input type="hidden" name="label" value={m.candidate.name ?? item.name} />
                            <input type="hidden" name="platform" value={m.candidate.platform} />
                            <Button type="submit" variant="confirm" size="sm">Import image</Button>
                          </form>
                        ) : null}
                        {m.candidate.description && !enrichment?.description && (
                          <form action={applyMatchedText}>
                            <input type="hidden" name="key" value={key} />
                            <input type="hidden" name="field" value="description" />
                            <input type="hidden" name="value" value={m.candidate.description} />
                            <input type="hidden" name="source" value={`vendor:${m.candidate.platform}`} />
                            <Button type="submit" variant="neutral" size="sm">Use description</Button>
                          </form>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* SLICE 78 — Gemini AI product look-up (drafts only). Sits ABOVE the
            crawl4ai box: Gemini finds product + strain info AND the source URLs;
            a "Deep-read →" button hands any source straight to the crawler below
            (#research-url) so you never hunt a URL by hand. */}
        <div id="lookup" className="scroll-mt-24 rounded-xl border border-[var(--admin-gold)]/20 bg-[var(--admin-gold)]/5 p-5">
          <p className="text-sm font-semibold text-[var(--admin-gold)]">
            AI product look-up (Gemini) {isAiConfigured ? "" : "(disabled)"}
          </p>
          <p className="mt-1 text-[11px] text-white/45">
            Ask Gemini to research this product and its strain from the live web. Everything it finds
            arrives as an editable draft worksheet — keep what&apos;s right, discard the rest, then save.
            Nothing is applied automatically, and it never runs until you click. Great for Cultivera
            imports that skipped receiving. You can also point it at a specific strain name to pull in
            terpene &amp; aroma richness (adds the colorful pills to the product page — even for edibles).
          </p>
          <div className="mt-3">
            <EnrichmentAiLookupPanel
              productKey={key}
              productName={item.name ?? ""}
              vendorOrBrand={item.brand_name ?? ""}
              initialQuery={lookupQuery}
              aiEnabled={isAiConfigured}
              crawlerInputId="research-url"
              crawlerAnchorId="research"
            />
          </div>
        </div>

        {/* SLICE 74 — deep product web research (GPT + crawl4ai, drafts only) */}
        <div id="research" className="scroll-mt-24 rounded-xl border border-[var(--admin-gold)]/20 bg-[var(--admin-gold)]/5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-[var(--admin-gold)]">
              Web research {crawlerOn ? "" : "(crawler not set up)"}
            </p>
            <a
              href={searchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-white/15 px-2.5 py-1.5 text-[11px] font-semibold text-white/70 transition-colors hover:border-[var(--admin-gold)] hover:text-white"
              title="Opens a pre-filled web search for this product in a new tab — find the product's own page on the maker's site, then paste its URL below."
            >
              Search the web for this product ↗
            </a>
          </div>
          <p className="mt-1 text-[11px] text-white/45">
            Paste the product&apos;s own page URL (the maker&apos;s site works best). The crawler reads that
            ONE page politely, GPT extracts a description verified against the real page text, and any
            product photos it finds arrive as candidates — everything lands below as drafts for YOUR review.
            Nothing is applied automatically.
          </p>
          {crawlerOn ? (
            <form action={researchProductAction} className="mt-3 flex flex-wrap items-center gap-2">
              <input type="hidden" name="key" value={key} />
              <input type="hidden" name="posName" value={item.name} />
              <input
                id="research-url"
                name="url"
                type="url"
                required
                placeholder="https://the-makers-site.com/products/this-product"
                className="min-w-[260px] flex-1 rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-gold)]"
              />
              <Button type="submit" variant="confirm" size="sm">Research this page</Button>
            </form>
          ) : (
            <p className="mt-3 text-xs text-white/45">
              Set <code className="rounded bg-black/40 px-1">CRAWLER_BASE_URL</code> and{" "}
              <code className="rounded bg-black/40 px-1">CRAWLER_SHARED_SECRET</code> to enable one-click
              product research. The search link above still works.
            </p>
          )}

          {/* Researched image candidates — visual review, one-click import. */}
          {researchImageDrafts.length > 0 && (
            <div className="mt-4 space-y-3 border-t border-[var(--admin-gold)]/15 pt-3">
              <p className="text-xs font-semibold text-white/70">Researched image candidates</p>
              {researchImageDrafts.map((s) => (
                <div key={s.id} className="rounded-lg border border-white/10 bg-black p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-white/40">
                    <span className="rounded bg-white/10 px-1.5 py-0.5 uppercase">web research</span>
                    {s.source?.startsWith("crawl:") && (
                      <span className="break-all">{s.source.slice("crawl:".length)}</span>
                    )}
                    <span>· {new Date(s.created_at).toLocaleString()}</span>
                  </div>
                  <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {parseImageDraftLines(s.suggested_value).map((u) => (
                      <li key={u} className="overflow-hidden rounded-lg border border-white/10 bg-[#0a0a0a]">
                        <a href={u} target="_blank" rel="noopener noreferrer" title={u}>
                          <div className="aspect-square bg-black">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={u} alt="" loading="lazy" className="h-full w-full object-cover" />
                          </div>
                        </a>
                        <form action={importResearchImage} className="p-1.5">
                          <input type="hidden" name="key" value={key} />
                          <input type="hidden" name="imageUrl" value={u} />
                          <input type="hidden" name="label" value={item.name} />
                          <Button type="submit" variant="confirm" size="sm" className="w-full">
                            Import
                          </Button>
                        </form>
                      </li>
                    ))}
                  </ul>
                  <form action={rejectSuggestion} className="mt-2">
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="key" value={key} />
                    <Button type="submit" variant="neutral" size="sm">Dismiss these candidates</Button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* AI panel */}
        <div id="ai" className="scroll-mt-24 rounded-xl border border-[var(--admin-gold)]/20 bg-[var(--admin-gold)]/5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-[var(--admin-gold)]">AI assist {isAiConfigured ? "" : "(disabled)"}</p>
            {isAiConfigured && (
              <div className="flex gap-2">
                <form action={generateProductAi}>
                  <input type="hidden" name="key" value={key} />
                  <input type="hidden" name="kind" value="description" />
                  <input type="hidden" name="posName" value={item.name} />
                  <input type="hidden" name="posBrand" value={item.brand_name} />
                  <input type="hidden" name="posCategory" value={item.category} />
                  <input type="hidden" name="posStrainType" value={item.strain_type} />
                  <input type="hidden" name="posStrainName" value={item.strain_name ?? ""} />
                  <input type="hidden" name="posThc" value={item.thc ?? ""} />
                  <input type="hidden" name="posCbd" value={item.cbd ?? ""} />
                  <Button type="submit" variant="save" size="sm">
                    Draft description
                  </Button>
                </form>
                <form action={generateProductAi}>
                  <input type="hidden" name="key" value={key} />
                  <input type="hidden" name="kind" value="tags" />
                  <input type="hidden" name="posName" value={item.name} />
                  <input type="hidden" name="posCategory" value={item.category} />
                  <input type="hidden" name="posThc" value={item.thc ?? ""} />
                  <input type="hidden" name="posCbd" value={item.cbd ?? ""} />
                  <Button type="submit" variant="neutral" size="sm">
                    Suggest tags
                  </Button>
                </form>
                <form action={generateProductAi}>
                  <input type="hidden" name="key" value={key} />
                  <input type="hidden" name="kind" value="sensory" />
                  <input type="hidden" name="posName" value={item.name} />
                  <input type="hidden" name="posBrand" value={item.brand_name} />
                  <input type="hidden" name="posCategory" value={item.category} />
                  <input type="hidden" name="posStrainType" value={item.strain_type} />
                  <input type="hidden" name="posStrainName" value={item.strain_name ?? ""} />
                  <input type="hidden" name="posThc" value={item.thc ?? ""} />
                  <input type="hidden" name="posCbd" value={item.cbd ?? ""} />
                  <Button type="submit" variant="neutral" size="sm">
                    Draft aroma &amp; flavor
                  </Button>
                </form>
              </div>
            )}
          </div>

          {!isAiConfigured && (
            <p className="mt-2 text-xs text-white/45">Set an <code className="rounded bg-black/40 px-1">AI_API_KEY</code> env var to enable one-click drafting. All AI output is a draft you approve.</p>
          )}

          {suggestions.length > 0 ? (
            <ul className="mt-4 space-y-3">
              {suggestions.map((s) => {
                const flags = s.field_key === "description" ? checkCompliance(s.suggested_value ?? "").flags : [];
                return (
                  <li key={s.id} className="rounded-lg border border-white/10 bg-black p-3">
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-white/40">
                      <span className="rounded bg-white/10 px-1.5 py-0.5 uppercase">{s.field_key}</span>
                      {typeof s.confidence === "number" && (
                        <span
                          className={`rounded px-1.5 py-0.5 font-semibold ${s.confidence >= 0.75 ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]" : s.confidence >= 0.45 ? "bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]" : "bg-[var(--admin-orange-soft)] text-[var(--admin-orange)]"}`}
                          title="How well this draft is grounded in the product's facts"
                        >
                          {Math.round(s.confidence * 100)}% confident
                        </span>
                      )}
                      <span>{s.model}</span>
                      <span>· {new Date(s.created_at).toLocaleString()}</span>
                    </div>
                    <p className="text-sm text-white/85 whitespace-pre-wrap">{s.suggested_value}</p>
                    {flags.length > 0 && (
                      <p className="mt-2 rounded bg-[var(--admin-orange)]/10 px-2 py-1 text-[11px] text-[var(--admin-orange)]">
                        ⚠ Compliance check flagged: {flags.join(", ")}. Review carefully before accepting.
                      </p>
                    )}
                    <div className="mt-2 flex gap-2">
                      <form action={acceptSuggestion}>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="key" value={key} />
                        <Button type="submit" variant="confirm" size="sm">Accept</Button>
                      </form>
                      <form action={rejectSuggestion}>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="key" value={key} />
                        <Button type="submit" variant="neutral" size="sm">Reject</Button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            isAiConfigured && <p className="mt-3 text-xs text-white/45">No pending suggestions. Use the buttons above to draft copy.</p>
          )}
        </div>

        {/* Editor form */}
        <form action={updateProductEnrichment} encType="multipart/form-data" className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <input type="hidden" name="key" value={key} />
          <input type="hidden" name="posName" value={item.name} />
          <input type="hidden" name="posBrand" value={item.brand_name} />
          <input type="hidden" name="posCategory" value={item.category} />

          {/* Left: content */}
          <div className="space-y-4 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
            <p className="text-sm font-semibold text-white">Marketing content</p>
            <label className="block">
              <span className={label}>Display name (override POS name)</span>
              <input name="display_name" defaultValue={enrichment?.display_name ?? ""} placeholder={item.name} className={field} />
            </label>
            <label className="block">
              <span className={label}>Description</span>
              <textarea name="description" defaultValue={enrichment?.description ?? ""} rows={4} className={field} />
            </label>
            <label className="block">
              <span className={label}>Short description (cards/teasers)</span>
              <input name="short_description" defaultValue={enrichment?.short_description ?? ""} className={field} />
            </label>
            <label className="block">
              <span className={label}>Staff note (&ldquo;why we love it&rdquo;)</span>
              <input name="staff_note" defaultValue={enrichment?.staff_note ?? ""} className={field} />
            </label>

            <div id="tags" className="scroll-mt-24 border-t border-white/10 pt-4">
              <span className={label}>Tags</span>
              <div className="flex flex-wrap gap-2">
                {TAG_OPTIONS.map((t) => (
                  <label key={t} className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${currentTags.has(t) ? "border-[var(--admin-accent)] bg-[var(--admin-accent)]/10 text-[var(--admin-accent)]" : "border-white/15 text-white/60"}`}>
                    <input type="checkbox" name="tags" value={t} defaultChecked={currentTags.has(t)} className="mr-1 align-middle" />
                    {t}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid gap-4 border-t border-white/10 pt-4 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm text-white/80">
                <input type="checkbox" name="staff_pick" defaultChecked={enrichment?.staff_pick ?? false} /> Staff pick
              </label>
              <label className="flex items-center gap-2 text-sm text-white/80">
                <input type="checkbox" name="featured" defaultChecked={enrichment?.featured ?? false} /> Featured
              </label>
            </div>

            <div className="border-t border-white/10 pt-4">
              <span className={label}>SEO</span>
              <input name="seo_title" defaultValue={enrichment?.seo_title ?? ""} placeholder="SEO title" className={`${field} mb-2`} />
              <textarea name="seo_description" defaultValue={enrichment?.seo_description ?? ""} rows={2} placeholder="SEO meta description" className={field} />
            </div>
          </div>

          {/* Right: media, links, visibility, publish */}
          <div className="space-y-4">
            <div className="space-y-3 rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
              <p className="text-sm font-semibold text-white">Images</p>
              {/* SLICE 71 — gallery management: each image can be removed from
                  this product, promoted to cover, or nudged left/right. The
                  buttons use formAction so they post to their own server
                  action without nesting forms; removing an image never
                  deletes the file from the media library.
                  SLICE 75 fix: each button BINDS its media id as a server-action
                  argument (`action.bind(null, id)`). React 19 drops a submit
                  button's own name/value when the button carries a function
                  formAction, so the old name/value payload never reached the
                  action — that was the "Missing media id" error. */}
              {galleryIds.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {galleryIds.map((id, idx) => {
                    const url = urlMap.get(id);
                    const isCover = (enrichment?.primary_media_id ?? galleryIds[0]) === id;
                    return (
                      <div key={id} className="overflow-hidden rounded-lg border border-white/10 bg-black">
                        <div className="relative aspect-square">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {url && <img src={url} alt="" className="h-full w-full object-cover" />}
                          {isCover && (
                            <span className="absolute left-1 top-1 rounded bg-[var(--admin-accent)] px-1.5 py-0.5 text-[10px] font-semibold text-black">
                              Cover
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-1 border-t border-white/10 px-1.5 py-1">
                          <div className="flex items-center gap-1">
                            <button
                              type="submit"
                              formAction={moveProductImage.bind(null, `${id}|left`)}
                              disabled={idx === 0}
                              title="Move earlier in the gallery"
                              className="rounded px-1 text-xs text-white/60 hover:text-white disabled:opacity-25"
                            >
                              ←
                            </button>
                            <button
                              type="submit"
                              formAction={moveProductImage.bind(null, `${id}|right`)}
                              disabled={idx === galleryIds.length - 1}
                              title="Move later in the gallery"
                              className="rounded px-1 text-xs text-white/60 hover:text-white disabled:opacity-25"
                            >
                              →
                            </button>
                          </div>
                          <div className="flex items-center gap-1">
                            {!isCover && (
                              <button
                                type="submit"
                                formAction={setProductPrimaryImage.bind(null, id)}
                                title="Use as the cover image on the menu card"
                                className="rounded px-1 text-[10px] font-semibold text-[var(--admin-gold)] hover:brightness-125"
                              >
                                ★ Cover
                              </button>
                            )}
                            <button
                              type="submit"
                              formAction={removeProductImage.bind(null, id)}
                              title="Remove this image from this product (the media library keeps the file)"
                              className="rounded px-1 text-[10px] font-semibold text-[var(--admin-orange)] hover:brightness-125"
                            >
                              ✕ Remove
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-white/40">No images yet.</p>
              )}
              {galleryIds.length > 0 && (
                <p className="text-[11px] text-white/40">
                  The <span className="text-white/60">Cover</span> image is what shoppers see on the menu card.
                  Removing an image only takes it off this product — the file stays in the media library.
                </p>
              )}
              <label id="upload" className="block scroll-mt-24">
                <span className={label}>Add image</span>
                <input type="file" name="image" accept="image/png,image/jpeg,image/webp,image/gif" className="block w-full text-xs text-white/70 file:mr-2 file:rounded file:border-0 file:bg-[var(--admin-accent)] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-black" />
              </label>
            </div>

            <div id="brand" className="scroll-mt-24 space-y-3 rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
              <p className="text-sm font-semibold text-white">Brand link</p>
              <select name="brand_id" defaultValue={enrichment?.brand_id ?? ""} className={field}>
                <option value="">— not linked —</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.display_name}
                  </option>
                ))}
              </select>
              <input type="hidden" name="vendor_id" value={enrichment?.vendor_id ?? ""} />
            </div>

            <div className="space-y-2 rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
              <p className="text-sm font-semibold text-white">Visibility</p>
              <select name="visibility" defaultValue={vis} className={field}>
                <option value="inherit">Inherit POS ({item.hidden ? "hidden" : "visible"})</option>
                <option value="show">Always show</option>
                <option value="hide">Always hide</option>
              </select>
              <input name="hidden_reason" defaultValue={enrichment?.hidden_reason ?? ""} placeholder="Reason if hidden" className={field} />
            </div>

            <Button type="submit" variant="confirm" fullWidth>
              Save enrichment
            </Button>
          </div>
        </form>

        {/* Publish controls */}
        <form action={setEnrichmentStatus} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
          <input type="hidden" name="key" value={key} />
          <span className="text-xs font-medium text-white/50">
            Enrichment status: <span className="font-semibold text-white/80">{enrichment?.status ?? "none"}</span> · controlled by {session.profile.full_name}
          </span>
          <div className="ml-auto flex gap-2">
            <Button type="submit" name="status" value="published" variant="confirm" size="sm">Publish to site</Button>
            <Button type="submit" name="status" value="draft" variant="neutral" size="sm">Unpublish (draft)</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
