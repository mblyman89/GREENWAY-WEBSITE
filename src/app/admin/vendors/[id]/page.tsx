import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { getVendorById, listBrandsForVendor, publicMediaUrl } from "@/lib/vendors/store";
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
  researchBrandAction,
  acceptBrandSuggestionAction,
  rejectBrandSuggestionAction,
  crawlVendorAction,
  crawlBrandAction,
  crawlVendorSocialAction,
  crawlBrandSocialAction,
} from "../actions";
import { isCrawlerConfigured, crawlerHealth } from "@/lib/ai/crawler-client";

export const dynamic = "force-dynamic";

const field = "rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]";
const label = "text-xs font-medium text-white/60";

const FIELD_LABELS: Record<string, string> = {
  mission_statement: "Mission statement",
  about: "About",
  product_philosophy: "Product philosophy",
};

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
  searchParams: Promise<{ error?: string; saved?: string; note?: string }>;
}) {
  await requirePermission("vendors.manage");
  const { id } = await params;
  const sp = await searchParams;
  const crawlerOn = isCrawlerConfigured();
  // Social (DF-9) is enabled only when the worker reports a Meta Graph token.
  // Probe health once (short timeout); falls back to false if the worker is down.
  const crawlerStatus = crawlerOn ? await crawlerHealth() : { ok: false, socialConfigured: false };
  const socialOn = Boolean(crawlerStatus.ok && crawlerStatus.socialConfigured);

  const vendor = await getVendorById(id);
  if (!vendor) notFound();
  const [brands, vendorLogo, pendingSuggestions] = await Promise.all([
    listBrandsForVendor(id),
    logoUrlForMediaId(vendor.logo_media_id),
    listSuggestions("vendor", id, "pending"),
  ]);

  const brandLogos = new Map<string, string | null>();
  for (const b of brands) brandLogos.set(b.id, await logoUrlForMediaId(b.logo_media_id));

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
        action={
          <Link href="/admin/vendors" className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/80 hover:border-[#7ed957] hover:text-white">
            ← All vendors
          </Link>
        }
      />

      <div className="px-5 py-6 sm:px-8">
        {sp.error && (
          <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{decodeURIComponent(sp.error)}</div>
        )}
        {sp.saved && (
          <div className="mb-6 rounded-lg border border-[#7ed957]/40 bg-[#7ed957]/10 px-4 py-3 text-sm text-[#7ed957]">
            {sp.note ? decodeURIComponent(sp.note) : "Saved."}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          {/* LEFT: editing */}
          <div className="space-y-8">
            {/* Publish toggle */}
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
              <div>
                <h2 className="text-sm font-semibold text-white">Status: <span className={vendor.status === "published" ? "text-[#7ed957]" : "text-[#ff7f00]"}>{vendor.status}</span></h2>
                <p className="text-xs text-white/40">Published vendors appear on the public vendors page.</p>
              </div>
              <form action={setVendorStatus}>
                <input type="hidden" name="id" value={vendor.id} />
                <input type="hidden" name="status" value={vendor.status === "published" ? "draft" : "published"} />
                <button type="submit" className={`rounded-full px-5 py-2 text-sm font-bold transition hover:brightness-110 ${vendor.status === "published" ? "border border-white/20 text-white" : "bg-[#7ed957] text-black"}`}>
                  {vendor.status === "published" ? "Unpublish" : "Publish vendor"}
                </button>
              </form>
            </section>

            {/* Research with AI */}
            <section id="ai-drafts" className="space-y-4 rounded-xl border border-[#7ed957]/20 bg-[#7ed957]/[0.03] p-5">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                  <span>✨ Research with AI</span>
                  {!isAiConfigured && (
                    <span className="rounded-full border border-[#ffd700]/40 bg-[#ffd700]/10 px-2 py-0.5 text-[10px] font-semibold text-[#ffd700]">
                      Not set up
                    </span>
                  )}
                </h2>
                <p className="mt-1 text-xs text-white/50">
                  Drafts a mission statement + about paragraph as a <strong>suggestion</strong>. Nothing is saved until
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
                  <button type="submit" className="rounded-full bg-[#7ed957] px-5 py-2 text-sm font-bold text-black transition hover:brightness-110">
                    ✨ Draft profile with AI
                  </button>
                </form>
              ) : (
                <p className="rounded-lg border border-[#ffd700]/20 bg-[#ffd700]/5 px-3 py-2 text-xs text-[#ffd700]">
                  Add an <code className="rounded bg-black/40 px-1">AI_API_KEY</code> to enable AI drafting (see the email/AI setup docs).
                </p>
              )}

              {/* Research with the crawler (DF-6): grounded drafts from a real page */}
              <div className="rounded-lg border border-sky-400/25 bg-sky-400/[0.04] p-4">
                <h3 className="flex items-center gap-2 text-xs font-semibold text-sky-200">
                  <span>🔎 Research with the crawler</span>
                  {!crawlerOn && (
                    <span className="rounded-full border border-[#ffd700]/40 bg-[#ffd700]/10 px-2 py-0.5 text-[10px] font-semibold text-[#ffd700]">
                      Not set up
                    </span>
                  )}
                </h3>
                <p className="mt-1 text-[11px] text-white/50">
                  Paste this vendor&rsquo;s official site (or an about page). The crawler reads the page,
                  extracts only what it can <strong>verify on the page</strong>, runs the same compliance
                  checks, and adds <strong>drafts</strong> below for your review. Nothing is published.
                </p>
                {crawlerOn ? (
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
                    <button type="submit" className="shrink-0 rounded-full bg-sky-400 px-5 py-2 text-sm font-bold text-black transition hover:brightness-110">
                      🔎 Research
                    </button>
                  </form>
                ) : (
                  <p className="mt-2 rounded-lg border border-[#ffd700]/20 bg-[#ffd700]/5 px-3 py-2 text-[11px] text-[#ffd700]">
                    Set <code className="rounded bg-black/40 px-1">CRAWLER_BASE_URL</code> and{" "}
                    <code className="rounded bg-black/40 px-1">CRAWLER_SHARED_SECRET</code> to enable web research
                    (see <code className="rounded bg-black/40 px-1">crawler/docs/RUNBOOK.md</code>).
                  </p>
                )}
              </div>

              {/* Pull from social (DF-9): sanctioned Instagram Business Discovery */}
              <div className="rounded-lg border border-fuchsia-400/25 bg-fuchsia-400/[0.04] p-4">
                <h3 className="flex items-center gap-2 text-xs font-semibold text-fuchsia-200">
                  <span>📸 Pull from Instagram</span>
                  {!socialOn && (
                    <span className="rounded-full border border-[#ffd700]/40 bg-[#ffd700]/10 px-2 py-0.5 text-[10px] font-semibold text-[#ffd700]">
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
                    <button type="submit" className="shrink-0 rounded-full bg-fuchsia-400 px-5 py-2 text-sm font-bold text-black transition hover:brightness-110">
                      📸 Pull
                    </button>
                  </form>
                ) : (
                  <p className="mt-2 rounded-lg border border-[#ffd700]/20 bg-[#ffd700]/5 px-3 py-2 text-[11px] text-[#ffd700]">
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
                      value={s.suggested_value}
                      model={s.model}
                      source={s.source}
                      confidence={s.confidence}
                      acceptAction={acceptVendorSuggestionAction}
                      rejectAction={rejectVendorSuggestionAction}
                      hiddenFields={{ suggestionId: s.id, vendorId: vendor.id }}
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
                  <input name="logo" type="file" accept="image/*" className={`${field} file:mr-2 file:rounded file:border-0 file:bg-[#7ed957] file:px-2 file:py-1 file:text-xs file:font-bold file:text-black`} />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1"><span className={label}>Display name</span><input name="display_name" defaultValue={vendor.display_name} className={field} /></label>
                <label className="flex flex-col gap-1"><span className={label}>Legal name</span><input name="legal_name" defaultValue={vendor.legal_name ?? ""} className={field} /></label>
                <label className="flex flex-col gap-1"><span className={label}>Website</span><input name="website" defaultValue={vendor.website ?? ""} placeholder="https://" className={field} /></label>
                <label className="flex flex-col gap-1"><span className={label}>Email</span><input name="email" defaultValue={vendor.email ?? ""} className={field} /></label>
                <label className="flex flex-col gap-1"><span className={label}>Phone</span><input name="phone" defaultValue={vendor.phone ?? ""} className={field} /></label>
                <label className="flex flex-col gap-1"><span className={label}>Instagram</span><input name="instagram" defaultValue={vendor.social_json?.instagram ?? ""} placeholder="@handle or URL" className={field} /></label>
                <label className="flex flex-col gap-1"><span className={label}>Facebook</span><input name="facebook" defaultValue={vendor.social_json?.facebook ?? ""} className={field} /></label>
              </div>

              <label className="flex flex-col gap-1"><span className={label}>Mission statement</span><textarea name="mission_statement" defaultValue={vendor.mission_statement ?? ""} rows={2} className={field} /></label>
              <label className="flex flex-col gap-1"><span className={label}>About</span><textarea name="about" defaultValue={vendor.about ?? ""} rows={4} className={field} /></label>
              <label className="flex flex-col gap-1"><span className={label}>Vendor-day notes (internal)</span><input name="vendor_day_notes" defaultValue={vendor.vendor_day_notes ?? ""} className={field} /></label>
              <label className="flex flex-col gap-1"><span className={label}>Internal notes (never public)</span><textarea name="internal_notes" defaultValue={vendor.internal_notes ?? ""} rows={2} className={field} /></label>

              <button type="submit" className="rounded-full bg-[#ff7f00] px-6 py-2.5 text-sm font-bold text-black transition hover:brightness-110">Save profile</button>
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
                    <label className="flex flex-col gap-1"><span className={label}>Brand logo</span><input name="logo" type="file" accept="image/*" className={`${field} file:mr-2 file:rounded file:border-0 file:bg-[#7ed957] file:px-2 file:py-1 file:text-xs file:font-bold file:text-black`} /></label>
                  </div>
                  <label className="flex flex-col gap-1"><span className={label}>Mission statement</span><textarea name="mission_statement" defaultValue={b.mission_statement ?? ""} rows={2} className={field} /></label>
                  <label className="flex flex-col gap-1"><span className={label}>About</span><textarea name="about" defaultValue={b.about ?? ""} rows={2} className={field} /></label>
                  <label className="flex flex-col gap-1"><span className={label}>Product philosophy</span><textarea name="product_philosophy" defaultValue={b.product_philosophy ?? ""} rows={2} className={field} /></label>
                  <button type="submit" className="rounded-full border border-white/20 px-5 py-2 text-sm font-bold text-white transition hover:border-[#7ed957]">Save brand</button>

                  {/* Brand-level Research with AI */}
                  <div className="mt-2 space-y-3 rounded-lg border border-[#7ed957]/20 bg-[#7ed957]/[0.03] p-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white">✨ Research this brand with AI</span>
                      {!isAiConfigured && (
                        <span className="rounded-full border border-[#ffd700]/40 bg-[#ffd700]/10 px-2 py-0.5 text-[10px] font-semibold text-[#ffd700]">Not set up</span>
                      )}
                    </div>
                    <p className="text-[11px] text-white/45">
                      Drafts a mission, about, and product-philosophy paragraph as <strong>suggestions</strong>. Nothing
                      saves until you Accept. Always read and edit before publishing.
                    </p>
                    {isAiConfigured && (
                      <div className="flex flex-wrap items-end gap-2">
                        <input form={`brand-ai-${b.id}`} name="instruction" placeholder="Optional hint (e.g. organic outdoor flower)" className={`${field} min-w-[14rem] flex-1`} />
                        <button form={`brand-ai-${b.id}`} type="submit" className="rounded-full bg-[#7ed957] px-4 py-2 text-xs font-bold text-black transition hover:brightness-110">
                          ✨ Draft brand profile
                        </button>
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
                            value={s.suggested_value}
                            model={s.model}
                            source={s.source}
                            confidence={s.confidence}
                            acceptAction={acceptBrandSuggestionAction}
                            rejectAction={rejectBrandSuggestionAction}
                            hiddenFields={{ suggestionId: s.id, brandId: b.id, vendorId: vendor.id }}
                            acceptLabel="✓ Accept"
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Brand-level Research with the crawler (DF-6): grounded drafts from a real page */}
                  <div className="mt-2 space-y-3 rounded-lg border border-[#5ec1ff]/20 bg-[#5ec1ff]/[0.03] p-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white">🔎 Research this brand with the crawler</span>
                      {!crawlerOn && (
                        <span className="rounded-full border border-[#ffd700]/40 bg-[#ffd700]/10 px-2 py-0.5 text-[10px] font-semibold text-[#ffd700]">Not set up</span>
                      )}
                    </div>
                    <p className="text-[11px] text-white/45">
                      Reads the brand&rsquo;s official page and drafts <strong>only</strong> what the page actually says
                      (about, mission, product philosophy). Every field is verified against the source and
                      compliance-checked. Nothing saves until you Accept.
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
                        <button form={`brand-crawl-${b.id}`} type="submit" className="rounded-full bg-[#5ec1ff] px-4 py-2 text-xs font-bold text-black transition hover:brightness-110">
                          🔎 Research
                        </button>
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
                  <div className="mt-2 space-y-3 rounded-lg border border-fuchsia-400/20 bg-fuchsia-400/[0.03] p-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white">📸 Pull this brand from Instagram</span>
                      {!socialOn && (
                        <span className="rounded-full border border-[#ffd700]/40 bg-[#ffd700]/10 px-2 py-0.5 text-[10px] font-semibold text-[#ffd700]">Not set up</span>
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
                        <button form={`brand-social-${b.id}`} type="submit" className="rounded-full bg-fuchsia-400 px-4 py-2 text-xs font-bold text-black transition hover:brightness-110">
                          📸 Pull
                        </button>
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
          </aside>
        </div>
      </div>
    </div>
  );
}
