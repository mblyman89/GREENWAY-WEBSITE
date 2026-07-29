import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, StickyActionBar } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui";
import { vendorListBackHref } from "@/lib/vendors/list-state-core";
import { getVendorById, listBrandsForVendor, publicMediaUrl } from "@/lib/vendors/store";
// SLICE 77: vendors ⇄ inventory cross-link — recent lots from this vendor.
import { listLotsForVendor } from "@/lib/inventory/store";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Brand } from "@/lib/vendors/types";
import { vendorCompleteness } from "@/lib/vendors/completeness";
import { CompletenessMeter } from "@/components/admin/vendors/CompletenessMeter";
import { VendorCardPreview } from "@/components/admin/vendors/VendorCardPreview";
import { listSuggestions, isAiConfigured } from "@/lib/ai/suggestions";
import type { AiSuggestion } from "@/lib/enrichment/types";
import { AiDraftCard } from "@/components/admin/ai/AiDraftCard";
import {
  updateVendor,
  setVendorStatus,
  updateBrand,
  researchVendorAction,
  acceptVendorSuggestionAction,
  rejectVendorSuggestionAction,
  acceptSocialDraftAction,
  researchBrandAction,
  acceptBrandSuggestionAction,
  rejectBrandSuggestionAction,
  crawlVendorAction,
  crawlBrandAction,
  crawlVendorSocialAction,
  crawlBrandSocialAction,
  importHarvestImageAction,
} from "../actions";
import { HarvestImagePicker, parseImageLines } from "@/components/admin/ai/HarvestImagePicker";
import { isCrawlerConfigured, crawlerHealth, getCrawlResumeState } from "@/lib/ai/crawler-client";

export const dynamic = "force-dynamic";
// Deep crawler research reads several pages politely (robots + per-domain
// delays), which can take a few minutes; the crawl server actions submitted
// from this page inherit this budget on Vercel.
export const maxDuration = 300;

const field = "rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]";
const label = "text-xs font-medium text-white/60";

const FIELD_LABELS: Record<string, string> = {
  mission_statement: "Mission statement",
  about: "About",
  product_philosophy: "Product philosophy",
  research_products: "Product lineup found on their site (reference)",
  research_images: "Image candidates found on their site (reference)",
  research_logos: "Logo candidates found on their site (pick one)",
  research_discovery: "Candidate websites found by search (review before crawling)",
  research_coverage: "Crawl coverage report — did we get everything? (reference)",
  research_text: "Text found on their site — best paragraph per page (reference)",
};

/** Crawler research drafts that are reference-only: staff read/copy from them,
 * they can never be accepted into a profile field. */
const REFERENCE_FIELDS = new Set(["research_products", "research_images", "research_logos", "research_discovery", "research_coverage", "research_text"]);

/** SLICE 88: profile-field drafts staff can EDIT on the page before accepting.
 *  Matches the accept actions' allowlists — research_social saves structured
 *  handles (not prose) and image/reference drafts never write a field. */
const EDITABLE_FIELDS = new Set(["mission_statement", "about", "product_philosophy"]);

/** Crawler drafts that get the visual picker (Slice H3): thumbnails with
 * one-click Save / Set-as-logo instead of a wall of URLs. */
const IMAGE_FIELDS = new Set(["research_images", "research_logos"]);

async function logoUrlForMediaId(mediaId: string | null): Promise<string | null> {
  if (!mediaId) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("media_assets").select("storage_key").eq("id", mediaId).maybeSingle();
  return publicMediaUrl((data as { storage_key: string } | null)?.storage_key ?? null);
}

export default async function VendorEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; note?: string; from?: string }>;
}) {
  await requirePermission("vendors.manage");
  const { id } = await params;
  const sp = await searchParams;
  // Task E: the list page encodes its active filter/sort/page state into a
  // `from` token so we can return the owner to the exact same filtered view.
  const backHref = vendorListBackHref(sp.from);
  const crawlerOn = isCrawlerConfigured();
  // Social (DF-9) is enabled only when the worker reports a Meta Graph token.
  // Probe health once (short timeout); falls back to false if the worker is down.
  const crawlerStatus = crawlerOn ? await crawlerHealth() : { ok: false, socialConfigured: false };
  const socialOn = Boolean(crawlerStatus.ok && crawlerStatus.socialConfigured);

  const vendor = await getVendorById(id);
  if (!vendor) notFound();
  const [brands, vendorLogo, pendingSuggestions, vendorLots] = await Promise.all([
    listBrandsForVendor(id),
    logoUrlForMediaId(vendor.logo_media_id),
    listSuggestions("vendor", id, "pending"),
    // SLICE 77: recent inventory lots from this vendor for the cross-link panel.
    listLotsForVendor(id, 8),
  ]);

  const brandLogos = new Map<string, string | null>();
  for (const b of brands) brandLogos.set(b.id, await logoUrlForMediaId(b.logo_media_id));

  // R1: does this vendor's site have a saved, continuable crawl frontier?
  // Cheap read-only lookup; found:false on any worker hiccup (button hides).
  const resumeState =
    crawlerOn && vendor.website
      ? await getCrawlResumeState({ url: vendor.website, entityType: "vendor", entityId: id })
      : { found: false, pending: 0, visited: 0, runs: 0, totalPages: 0, updatedAt: 0 };

  // Pending AI drafts per brand (so each brand card can show its own review list).
  const brandSuggestions = new Map<string, AiSuggestion[]>();
  await Promise.all(
    brands.map(async (b) => {
      brandSuggestions.set(b.id, await listSuggestions("brand", b.id, "pending"));
    }),
  );

  const completeness = vendorCompleteness(vendor, Boolean(vendorLogo));

  return (
    <div>
      <AdminPageHeader
        title={vendor.display_name}
        subtitle={`${vendor.brand_count} brands · ${vendor.product_count} products · ${vendor.status}`}
        breadcrumbs={
          <Breadcrumbs
            items={[
              // Both crumbs carry the active list filters so either one returns
              // the owner to the exact same filtered/sorted/paged view.
              { label: "Vendors & Brands", href: backHref },
              { label: vendor.display_name },
            ]}
          />
        }
        action={
          <Link href={backHref} className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/80 hover:border-[var(--admin-accent)] hover:text-white">
            ← All vendors
          </Link>
        }
      />

      <div className="px-5 py-6 sm:px-8">
        {sp.error && (
          <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{decodeURIComponent(sp.error)}</div>
        )}
        {sp.saved && (
          <div className="mb-6 rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-accent)]">
            {sp.note ? decodeURIComponent(sp.note) : "Saved."}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          {/* LEFT: editing */}
          <div className="space-y-8">
            {/* Publish toggle */}
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
              <div>
                <h2 className="text-sm font-semibold text-white">Status: <span className={vendor.status === "published" ? "text-[var(--admin-accent)]" : "text-[var(--admin-orange)]"}>{vendor.status}</span></h2>
                <p className="text-xs text-white/40">Published vendors appear on the public vendors page.</p>
              </div>
              <form action={setVendorStatus}>
                <input type="hidden" name="id" value={vendor.id} />
                <input type="hidden" name="status" value={vendor.status === "published" ? "draft" : "published"} />
                <Button type="submit" variant={vendor.status === "published" ? "neutral" : "confirm"}>
                  {vendor.status === "published" ? "Unpublish" : "Publish vendor"}
                </Button>
              </form>
            </section>

            {/* Research with AI */}
            <section id="ai-drafts" className="space-y-4 rounded-xl border border-[var(--admin-accent)]/20 bg-[var(--admin-accent)]/[0.03] p-5">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                  <span>✨ Research with AI</span>
                  {!isAiConfigured && (
                    <span className="rounded-full border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--admin-gold)]">
                      Not set up
                    </span>
                  )}
                </h2>
                <p className="mt-1 text-xs text-white/50">
                  Drafts a mission statement, about, and product-philosophy paragraph as <strong>suggestions</strong>. Nothing is saved until
                  you click <em>Accept</em>. The AI writes a tasteful starting point from the name — always read and edit
                  it before publishing.
                </p>
              </div>

              {isAiConfigured ? (
                <form action={researchVendorAction} className="space-y-3">
                  <input type="hidden" name="id" value={vendor.id} />
                  <label className="flex flex-col gap-1">
                    <span className={label}>Optional hint (e.g. &quot;family-owned Spokane farm, organic flower&quot;)</span>
                    <input name="instruction" placeholder="Anything you know about them…" className={field} />
                  </label>
                  <Button type="submit" variant="special">
                    ✨ Draft profile with AI
                  </Button>
                </form>
              ) : (
                <p className="rounded-lg border border-[var(--admin-gold)]/20 bg-[var(--admin-gold)]/5 px-3 py-2 text-xs text-[var(--admin-gold)]">
                  Add an <code className="rounded bg-black/40 px-1">AI_API_KEY</code> to enable AI drafting (see the email/AI setup docs).
                </p>
              )}

              {/* Research with the crawler (DF-6): grounded drafts from a real page */}
              <div className="rounded-lg border border-[var(--admin-purple)]/25 bg-[var(--admin-purple)]/[0.04] p-4">
                <h3 className="flex items-center gap-2 text-xs font-semibold text-[var(--admin-purple)]">
                  <span>🔎 Research with the crawler</span>
                  {!crawlerOn && (
                    <span className="rounded-full border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--admin-gold)]">
                      Not set up
                    </span>
                  )}
                </h3>
                <p className="mt-1 text-[11px] text-white/50">
                  Paste this vendor&rsquo;s official site. The crawler walks the <strong>whole site</strong> in
                  the background (a few minutes), extracts only what it can <strong>verify on the page</strong>,
                  runs the same compliance checks, and adds <strong>drafts</strong> below for your review.
                  You&rsquo;ll be taken to the Harvest Console to watch progress. Nothing is published.
                </p>
                {crawlerOn ? (
                  <>
                    <form action={crawlVendorAction} className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <input type="hidden" name="id" value={vendor.id} />
                      <input
                        name="url"
                        type="url"
                        required
                        placeholder="https://vendor-website.com/about"
                        className={`${field} flex-1`}
                        defaultValue={vendor.website ?? ""}
                      />
                      <Button type="submit" variant="special" className="shrink-0">
                        🔎 Research
                      </Button>
                    </form>
                    {/* R1: the crawl stopped at the page budget with pages still
                        queued — offer to CONTINUE it. Already-read pages are
                        skipped, so no time or credits are wasted re-crawling. */}
                    {resumeState.found && resumeState.pending > 0 && vendor.website && (
                      <form action={crawlVendorAction} className="mt-2">
                        <input type="hidden" name="id" value={vendor.id} />
                        <input type="hidden" name="url" value={vendor.website} />
                        <input type="hidden" name="continue" value="1" />
                        <Button
                          type="submit"
                          variant="save"
                          size="sm"
                          title={`${resumeState.totalPages} page(s) read across ${resumeState.runs} run(s); ${resumeState.pending} discovered page(s) still unread. Continuing never re-fetches what was already read.`}
                        >
                          ⏩ Continue crawl — {resumeState.pending} page{resumeState.pending === 1 ? "" : "s"} left ({resumeState.totalPages} read so far)
                        </Button>
                      </form>
                    )}
                  </>
                ) : (
                  <p className="mt-2 rounded-lg border border-[var(--admin-gold)]/20 bg-[var(--admin-gold)]/5 px-3 py-2 text-[11px] text-[var(--admin-gold)]">
                    Set <code className="rounded bg-black/40 px-1">CRAWLER_BASE_URL</code> and{" "}
                    <code className="rounded bg-black/40 px-1">CRAWLER_SHARED_SECRET</code> to enable web research
                    (see <code className="rounded bg-black/40 px-1">crawler/docs/RUNBOOK.md</code>).
                  </p>
                )}
              </div>

              {/* Pull from social (DF-9): sanctioned Instagram Business Discovery */}
              <div className="rounded-lg border border-[var(--admin-purple)]/25 bg-[var(--admin-purple)]/[0.04] p-4">
                <h3 className="flex items-center gap-2 text-xs font-semibold text-[var(--admin-purple)]">
                  <span>📸 Pull from Instagram</span>
                  {!socialOn && (
                    <span className="rounded-full border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--admin-gold)]">
                      Not set up
                    </span>
                  )}
                </h3>
                <p className="mt-1 text-[11px] text-white/50">
                  For vendors that live on social. Reads their <strong>public</strong> Instagram business
                  profile through Meta&rsquo;s official API and drafts an <strong>about</strong> from their bio +
                  image candidates — verified and compliance-checked, drafts only. No logins, no fake accounts.
                </p>
                {socialOn ? (
                  <form action={crawlVendorSocialAction} className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input type="hidden" name="id" value={vendor.id} />
                    <input
                      name="handle"
                      type="text"
                      required
                      placeholder="@vendor_handle"
                      className={`${field} flex-1`}
                    />
                    <Button type="submit" variant="special" className="shrink-0">
                      📸 Pull
                    </Button>
                  </form>
                ) : (
                  <p className="mt-2 rounded-lg border border-[var(--admin-gold)]/20 bg-[var(--admin-gold)]/5 px-3 py-2 text-[11px] text-[var(--admin-gold)]">
                    Set up a Greenway Instagram <strong>Business</strong> account + Meta token to enable
                    (see <code className="rounded bg-black/40 px-1">crawler/docs/SOCIAL_SETUP.md</code>).
                  </p>
                )}
              </div>

              {/* Pending AI suggestions to review */}
              {pendingSuggestions.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-white/40">
                    {pendingSuggestions.length} draft{pendingSuggestions.length === 1 ? "" : "s"} awaiting your review
                  </p>
                  {pendingSuggestions.map((s) => (
                    <AiDraftCard
                      key={s.id}
                      fieldLabel={FIELD_LABELS[s.field_key] ?? s.field_key}
                      value={IMAGE_FIELDS.has(s.field_key) ? null : s.suggested_value}
                      model={s.model}
                      source={s.source}
                      confidence={s.confidence}
                      acceptAction={s.field_key === "research_social" ? acceptSocialDraftAction : acceptVendorSuggestionAction}
                      rejectAction={rejectVendorSuggestionAction}
                      hiddenFields={{ suggestionId: s.id, vendorId: vendor.id }}
                      acceptLabel={s.field_key === "research_social" ? "✓ Save handles to profile" : undefined}
                      referenceOnly={REFERENCE_FIELDS.has(s.field_key)}
                      editable={EDITABLE_FIELDS.has(s.field_key)}
                      footer={
                        IMAGE_FIELDS.has(s.field_key) ? (
                          <HarvestImagePicker
                            items={parseImageLines(s.suggested_value)}
                            entityType="vendor"
                            entityId={vendor.id}
                            vendorId={vendor.id}
                            importAction={importHarvestImageAction}
                          />
                        ) : undefined
                      }
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Profile form */}
            <form action={updateVendor} className="space-y-5 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
              <input type="hidden" name="id" value={vendor.id} />
              <h2 className="text-sm font-semibold text-white">Vendor profile</h2>

              <div className="flex items-center gap-4">
                <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black">
                  {vendorLogo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={vendorLogo} alt="" className="h-full w-full object-contain" />
                  ) : (
                    <span className="text-2xl font-bold text-white/30">{vendor.display_name.charAt(0)}</span>
                  )}
                </div>
                <label className="flex flex-col gap-1">
                  <span className={label}>Logo (PNG/JPG/WEBP/SVG, max 5MB)</span>
                  <input name="logo" type="file" accept="image/*" className={`${field} file:mr-2 file:rounded file:border-0 file:bg-[var(--admin-accent)] file:px-2 file:py-1 file:text-xs file:font-bold file:text-black`} />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1"><span className={label}>Display name</span><input name="display_name" defaultValue={vendor.display_name} className={field} /></label>
                <label className="flex flex-col gap-1"><span className={label}>Legal name</span><input name="legal_name" defaultValue={vendor.legal_name ?? ""} className={field} /></label>
                <label className="flex flex-col gap-1"><span className={label}>DBA (doing business as)</span><input name="dba" defaultValue={vendor.dba ?? ""} className={field} /></label>
                <label className="flex flex-col gap-1"><span className={label}>Vendor number</span><input name="vendor_number" defaultValue={vendor.vendor_number ?? ""} placeholder="Cultivera VendorNo" className={field} /></label>
                <label className="flex flex-col gap-1"><span className={label}>WA license number</span><input name="license_number" defaultValue={vendor.license_number ?? ""} placeholder="Origin licensee number (auto-fills manifests)" className={field} /></label>
                <label className="flex flex-col gap-1"><span className={label}>Website</span><input name="website" defaultValue={vendor.website ?? ""} placeholder="https://" className={field} /></label>
                <label className="flex flex-col gap-1"><span className={label}>Email</span><input name="email" defaultValue={vendor.email ?? ""} className={field} /></label>
                <label className="flex flex-col gap-1"><span className={label}>Phone</span><input name="phone" defaultValue={vendor.phone ?? ""} className={field} /></label>
                <label className="flex flex-col gap-1"><span className={label}>Instagram</span><input name="instagram" defaultValue={vendor.social_json?.instagram ?? ""} placeholder="@handle or URL" className={field} /></label>
                <label className="flex flex-col gap-1"><span className={label}>Facebook</span><input name="facebook" defaultValue={vendor.social_json?.facebook ?? ""} className={field} /></label>
                {/* H12a: the full typed platform set. The profile save rebuilds
                    social_json from these inputs, so every platform the
                    research_social accept can write MUST round-trip here or it
                    would be wiped on the next save. */}
                <label className="flex flex-col gap-1"><span className={label}>Twitter / X</span><input name="twitter" defaultValue={vendor.social_json?.twitter ?? ""} placeholder="@handle or URL" className={field} /></label>
                <label className="flex flex-col gap-1"><span className={label}>TikTok</span><input name="tiktok" defaultValue={vendor.social_json?.tiktok ?? ""} placeholder="@handle or URL" className={field} /></label>
                <label className="flex flex-col gap-1"><span className={label}>YouTube</span><input name="youtube" defaultValue={vendor.social_json?.youtube ?? ""} placeholder="channel URL" className={field} /></label>
                <label className="flex flex-col gap-1"><span className={label}>LinkedIn</span><input name="linkedin" defaultValue={vendor.social_json?.linkedin ?? ""} placeholder="company URL" className={field} /></label>
              </div>

              <label className="flex flex-col gap-1"><span className={label}>Mission statement</span><textarea name="mission_statement" defaultValue={vendor.mission_statement ?? ""} rows={2} className={field} /></label>
              <label className="flex flex-col gap-1"><span className={label}>About</span><textarea name="about" defaultValue={vendor.about ?? ""} rows={4} className={field} /></label>
              <label className="flex flex-col gap-1"><span className={label}>Product philosophy</span><textarea name="product_philosophy" defaultValue={vendor.product_philosophy ?? ""} rows={2} className={field} /></label>
              {/* Shipping address */}
              <div className="rounded-lg border border-white/10 p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/50">Shipping address</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 sm:col-span-2"><span className={label}>Address line 1</span><input name="shipping_address1" defaultValue={vendor.shipping_address1 ?? ""} className={field} /></label>
                  <label className="flex flex-col gap-1 sm:col-span-2"><span className={label}>Address line 2</span><input name="shipping_address2" defaultValue={vendor.shipping_address2 ?? ""} className={field} /></label>
                  <label className="flex flex-col gap-1"><span className={label}>City</span><input name="shipping_city" defaultValue={vendor.shipping_city ?? ""} className={field} /></label>
                  <label className="flex flex-col gap-1"><span className={label}>State</span><input name="shipping_state" defaultValue={vendor.shipping_state ?? ""} className={field} /></label>
                  <label className="flex flex-col gap-1"><span className={label}>ZIP</span><input name="shipping_zip" defaultValue={vendor.shipping_zip ?? ""} className={field} /></label>
                </div>
              </div>

              {/* Billing address */}
              <div className="rounded-lg border border-white/10 p-4">
                <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/50">
                  Billing address
                  {vendor.billing_same_as_shipping ? <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium normal-case text-white/60">same as shipping</span> : null}
                </h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 sm:col-span-2"><span className={label}>Address line 1</span><input name="billing_address1" defaultValue={vendor.billing_address1 ?? ""} className={field} /></label>
                  <label className="flex flex-col gap-1 sm:col-span-2"><span className={label}>Address line 2</span><input name="billing_address2" defaultValue={vendor.billing_address2 ?? ""} className={field} /></label>
                  <label className="flex flex-col gap-1"><span className={label}>City</span><input name="billing_city" defaultValue={vendor.billing_city ?? ""} className={field} /></label>
                  <label className="flex flex-col gap-1"><span className={label}>State</span><input name="billing_state" defaultValue={vendor.billing_state ?? ""} className={field} /></label>
                  <label className="flex flex-col gap-1"><span className={label}>ZIP</span><input name="billing_zip" defaultValue={vendor.billing_zip ?? ""} className={field} /></label>
                </div>
              </div>

              {/* Ops facts (read-only, from the POS export) */}
              {(vendor.is_active !== null || vendor.total_accepted_ytd_cents !== null || vendor.last_accepted_at) ? (
                <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-white/10 p-4 text-xs text-white/60">
                  {vendor.is_active !== null ? <span>Status: <span className={vendor.is_active ? "text-[var(--admin-accent)]" : "text-white/40"}>{vendor.is_active ? "Active" : "Inactive"}</span></span> : null}
                  {vendor.total_accepted_ytd_cents !== null ? <span>Accepted YTD: <span className="text-white">${(vendor.total_accepted_ytd_cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span> : null}
                  {vendor.last_accepted_at ? <span>Last accepted: <span className="text-white">{new Date(vendor.last_accepted_at).toLocaleDateString()}</span></span> : null}
                </div>
              ) : null}

              <label className="flex flex-col gap-1"><span className={label}>Sage 50 Vendor ID</span><input name="sage_vendor_id" defaultValue={vendor.sage_vendor_id ?? ""} placeholder="e.g. 01-TWO HEADS" className={field} /><span className="text-[10px] text-white/35">Must match this vendor&apos;s ID in your Sage 50 company. Required for Purchases/Payments exports on the Accounting tab.</span></label>
              <label className="flex flex-col gap-1"><span className={label}>Vendor-day notes (internal)</span><input name="vendor_day_notes" defaultValue={vendor.vendor_day_notes ?? ""} className={field} /></label>
              <label className="flex flex-col gap-1"><span className={label}>Internal notes (never public)</span><textarea name="internal_notes" defaultValue={vendor.internal_notes ?? ""} rows={2} className={field} /></label>

              {/* GW-035: pinned save — on this long profile form the button
                  stays reachable without scrolling back down. */}
              <StickyActionBar status="Edits are not saved until you press Save profile" statusTone="warning">
                <Button type="submit" variant="primary">Save profile</Button>
              </StickyActionBar>
            </form>

            {/* Brands */}
            <section className="space-y-4">
              <h2 className="text-sm font-semibold text-white">Brands ({brands.length})</h2>
              {brands.map((b: Brand) => (
                <form key={b.id} id={`brand-${b.id}`} action={updateBrand} className="space-y-4 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
                  <input type="hidden" name="id" value={b.id} />
                  <input type="hidden" name="vendorId" value={vendor.id} />
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black">
                      {brandLogos.get(b.id) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={brandLogos.get(b.id)!} alt="" className="h-full w-full object-contain" />
                      ) : (
                        <span className="text-sm font-bold text-white/30">{b.display_name.charAt(0)}</span>
                      )}
                    </div>
                    <div className="flex-1">
                      <input name="display_name" defaultValue={b.display_name} className={`${field} w-full font-semibold`} />
                    </div>
                    <select name="status" defaultValue={b.status} className={field}>
                      <option value="draft">Draft</option>
                      <option value="published">Published</option>
                    </select>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="flex flex-col gap-1"><span className={label}>Website</span><input name="website" defaultValue={b.website ?? ""} className={field} /></label>
                    <label className="flex flex-col gap-1"><span className={label}>Brand logo</span><input name="logo" type="file" accept="image/*" className={`${field} file:mr-2 file:rounded file:border-0 file:bg-[var(--admin-accent)] file:px-2 file:py-1 file:text-xs file:font-bold file:text-black`} /></label>
                  </div>
                  <label className="flex flex-col gap-1"><span className={label}>Mission statement</span><textarea name="mission_statement" defaultValue={b.mission_statement ?? ""} rows={2} className={field} /></label>
                  <label className="flex flex-col gap-1"><span className={label}>About</span><textarea name="about" defaultValue={b.about ?? ""} rows={2} className={field} /></label>
                  <label className="flex flex-col gap-1"><span className={label}>Product philosophy</span><textarea name="product_philosophy" defaultValue={b.product_philosophy ?? ""} rows={2} className={field} /></label>
                  <Button type="submit" variant="neutral">Save brand</Button>

                  {/* Brand-level Research with AI */}
                  <div className="mt-2 space-y-3 rounded-lg border border-[var(--admin-accent)]/20 bg-[var(--admin-accent)]/[0.03] p-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white">✨ Research this brand with AI</span>
                      {!isAiConfigured && (
                        <span className="rounded-full border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--admin-gold)]">Not set up</span>
                      )}
                    </div>
                    <p className="text-[11px] text-white/45">
                      Drafts a mission, about, and product-philosophy paragraph as <strong>suggestions</strong>. Nothing
                      saves until you Accept. Always read and edit before publishing.
                    </p>
                    {isAiConfigured && (
                      <div className="flex flex-wrap items-end gap-2">
                        <input form={`brand-ai-${b.id}`} name="instruction" placeholder="Optional hint (e.g. organic outdoor flower)" className={`${field} min-w-[14rem] flex-1`} />
                        <Button form={`brand-ai-${b.id}`} type="submit" variant="special" size="sm">
                          ✨ Draft brand profile
                        </Button>
                      </div>
                    )}
                    {(brandSuggestions.get(b.id)?.length ?? 0) > 0 && (
                      <div className="space-y-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
                          {brandSuggestions.get(b.id)!.length} draft{brandSuggestions.get(b.id)!.length === 1 ? "" : "s"} awaiting review
                        </p>
                        {brandSuggestions.get(b.id)!.map((s) => (
                          <AiDraftCard
                            key={s.id}
                            fieldLabel={FIELD_LABELS[s.field_key] ?? s.field_key}
                            value={IMAGE_FIELDS.has(s.field_key) ? null : s.suggested_value}
                            model={s.model}
                            source={s.source}
                            confidence={s.confidence}
                            acceptAction={s.field_key === "research_social" ? acceptSocialDraftAction : acceptBrandSuggestionAction}
                            rejectAction={rejectBrandSuggestionAction}
                            hiddenFields={{ suggestionId: s.id, brandId: b.id, vendorId: vendor.id }}
                            acceptLabel={s.field_key === "research_social" ? "✓ Save handles to profile" : "✓ Accept"}
                            referenceOnly={REFERENCE_FIELDS.has(s.field_key)}
                            editable={EDITABLE_FIELDS.has(s.field_key)}
                            footer={
                              IMAGE_FIELDS.has(s.field_key) ? (
                                <HarvestImagePicker
                                  items={parseImageLines(s.suggested_value)}
                                  entityType="brand"
                                  entityId={b.id}
                                  vendorId={vendor.id}
                                  importAction={importHarvestImageAction}
                                />
                              ) : undefined
                            }
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Brand-level Research with the crawler (DF-6): grounded drafts from a real page */}
                  <div className="mt-2 space-y-3 rounded-lg border border-[var(--admin-purple)]/20 bg-[var(--admin-purple)]/[0.03] p-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white">🔎 Research this brand with the crawler</span>
                      {!crawlerOn && (
                        <span className="rounded-full border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--admin-gold)]">Not set up</span>
                      )}
                    </div>
                    <p className="text-[11px] text-white/45">
                      Walks the brand&rsquo;s official site in the background (a few minutes) and drafts
                      <strong> only</strong> what the pages actually say (about, mission, product philosophy).
                      Every field is verified against the source and compliance-checked. You&rsquo;ll be taken to
                      the Harvest Console to watch progress; nothing saves until you Accept.
                    </p>
                    {crawlerOn ? (
                      <div className="flex flex-wrap items-end gap-2">
                        <input
                          form={`brand-crawl-${b.id}`}
                          name="url"
                          type="url"
                          defaultValue={b.website ?? ""}
                          placeholder="https://brand-official-site.com"
                          className={`${field} min-w-[16rem] flex-1`}
                        />
                        <Button form={`brand-crawl-${b.id}`} type="submit" variant="special" size="sm">
                          🔎 Research
                        </Button>
                      </div>
                    ) : (
                      <p className="text-[11px] text-white/40">
                        Set <code className="rounded bg-black/40 px-1">CRAWLER_BASE_URL</code> and{" "}
                        <code className="rounded bg-black/40 px-1">CRAWLER_SHARED_SECRET</code> to enable
                        (see <code className="rounded bg-black/40 px-1">crawler/docs/RUNBOOK.md</code>).
                      </p>
                    )}
                  </div>

                  {/* Brand-level Pull from Instagram (DF-9): sanctioned Business Discovery */}
                  <div className="mt-2 space-y-3 rounded-lg border border-[var(--admin-purple)]/20 bg-[var(--admin-purple)]/[0.03] p-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white">📸 Pull this brand from Instagram</span>
                      {!socialOn && (
                        <span className="rounded-full border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--admin-gold)]">Not set up</span>
                      )}
                    </div>
                    <p className="text-[11px] text-white/45">
                      Reads the brand&rsquo;s <strong>public</strong> Instagram business profile via Meta&rsquo;s official
                      API and drafts an <strong>about</strong> from the bio plus image candidates. Verified +
                      compliance-checked, drafts only. No logins, no fake accounts.
                    </p>
                    {socialOn ? (
                      <div className="flex flex-wrap items-end gap-2">
                        <input
                          form={`brand-social-${b.id}`}
                          name="handle"
                          type="text"
                          placeholder="@brand_handle"
                          className={`${field} min-w-[14rem] flex-1`}
                        />
                        <Button form={`brand-social-${b.id}`} type="submit" variant="special" size="sm">
                          📸 Pull
                        </Button>
                      </div>
                    ) : (
                      <p className="text-[11px] text-white/40">
                        Needs a Greenway IG <strong>Business</strong> account + Meta token
                        (see <code className="rounded bg-black/40 px-1">crawler/docs/SOCIAL_SETUP.md</code>).
                      </p>
                    )}
                  </div>
                </form>
              ))}
              {/* Standalone forms for the brand-AI buttons (can't nest <form> inside the brand <form>). */}
              {brands.map((b: Brand) => (
                <form key={`brand-ai-${b.id}`} id={`brand-ai-${b.id}`} action={researchBrandAction} className="hidden">
                  <input type="hidden" name="brandId" value={b.id} />
                  <input type="hidden" name="vendorId" value={vendor.id} />
                </form>
              ))}
              {/* Standalone forms for the brand crawler buttons (can't nest <form> inside the brand <form>). */}
              {crawlerOn && brands.map((b: Brand) => (
                <form key={`brand-crawl-${b.id}`} id={`brand-crawl-${b.id}`} action={crawlBrandAction} className="hidden">
                  <input type="hidden" name="brandId" value={b.id} />
                  <input type="hidden" name="vendorId" value={vendor.id} />
                </form>
              ))}
              {/* Standalone forms for the brand social buttons. */}
              {socialOn && brands.map((b: Brand) => (
                <form key={`brand-social-${b.id}`} id={`brand-social-${b.id}`} action={crawlBrandSocialAction} className="hidden">
                  <input type="hidden" name="brandId" value={b.id} />
                  <input type="hidden" name="vendorId" value={vendor.id} />
                </form>
              ))}
              {brands.length === 0 && <p className="text-sm text-white/50">No brands linked to this vendor.</p>}
            </section>
          </div>

          {/* RIGHT: completeness + live preview */}
          <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            <CompletenessMeter result={completeness} />
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">Public card preview</p>
              <VendorCardPreview vendor={vendor} logoUrl={vendorLogo} />
            </div>

            {/* SLICE 77: vendors ⇄ inventory cross-link. Recent lots received
                from this vendor, each linking to its lot detail page, plus a
                one-click filtered view of everything in Inventory. */}
            <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-white">Inventory from this vendor</h2>
                <Link
                  href={`/admin/inventory?vendor=${vendor.id}`}
                  className="text-xs font-semibold text-[var(--admin-accent)] hover:underline"
                >
                  View all in Inventory →
                </Link>
              </div>
              {vendorLots.length === 0 ? (
                <p className="text-xs text-white/45">
                  No inventory lots are linked to this vendor yet. Lots get linked automatically
                  when a vendor manifest is accepted, or by hand on any lot&rsquo;s detail page.
                </p>
              ) : (
                <ul className="space-y-2">
                  {vendorLots.map((lot) => (
                    <li key={lot.id}>
                      <Link
                        href={`/admin/inventory/${lot.id}?back=/admin/vendors/${vendor.id}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs hover:border-[var(--admin-accent)]/50"
                      >
                        <span className="min-w-0 flex-1 truncate text-white/80">
                          {lot.product_name ?? lot.lot_code ?? "Unnamed lot"}
                        </span>
                        <span className="shrink-0 text-white/40">
                          {lot.on_hand_qty} on hand · {lot.status}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
