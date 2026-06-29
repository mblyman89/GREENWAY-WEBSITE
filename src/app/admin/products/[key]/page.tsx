import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { getPublishedVersion, getItemBySourceKey } from "@/lib/pos/menu-version";
import { getEnrichment, mediaUrlsForIds } from "@/lib/enrichment/store";
import { listAllBrands } from "@/lib/vendors/store";
import { listSuggestions, isAiConfigured } from "@/lib/ai/suggestions";
import { checkCompliance } from "@/lib/ai/compliance";
import {
  updateProductEnrichment,
  setEnrichmentStatus,
  generateProductAi,
  acceptSuggestion,
  rejectSuggestion,
} from "../actions";

export const dynamic = "force-dynamic";

const field = "w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]";
const label = "mb-1 block text-xs font-medium text-white/50";

const TAG_OPTIONS = ["new-arrival", "best-seller", "staff-pick", "local", "high-cbd", "high-thc", "value", "limited"];

export default async function ProductEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ saved?: string; error?: string; ai?: string }>;
}) {
  const session = await requirePermission("products.enrich");
  const { key: rawKey } = await params;
  const key = decodeURIComponent(rawKey);
  const { saved, error, ai } = await searchParams;

  const published = await getPublishedVersion();
  if (!published) notFound();
  const item = await getItemBySourceKey(published.id, key);
  if (!item) notFound();

  const enrichment = await getEnrichment(key);
  const brands = await listAllBrands();
  const suggestions = await listSuggestions("product", key, "pending");

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
          <Link href="/admin/products" className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 hover:border-[#7ed957] hover:text-white">
            ← All products
          </Link>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {saved && <div className="rounded-lg border border-[#7ed957]/40 bg-[#7ed957]/10 px-4 py-2 text-sm text-[#7ed957]">Saved.</div>}
        {ai && <div className="rounded-lg border border-[#ffd700]/40 bg-[#ffd700]/10 px-4 py-2 text-sm text-[#ffd700]">AI draft generated — review it below.</div>}
        {error && <div className="rounded-lg border border-[#ff7f00]/40 bg-[#ff7f00]/10 px-4 py-2 text-sm text-[#ff7f00]">{error}</div>}

        {/* POS facts (read-only) */}
        <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4 text-xs text-white/55">
          <span className="font-semibold text-white/70">POS source (truth):</span>{" "}
          {item.name} · price {item.price_label} · {item.inventory_status} · strain {item.strain_type}
          {item.strain_name ? ` (${item.strain_name})` : ""} · THC {item.thc ?? "—"} · CBD {item.cbd ?? "—"}.
          <span className="ml-1 text-white/35">Price &amp; stock are never edited here.</span>
        </div>

        {/* AI panel */}
        <div id="ai" className="rounded-xl border border-[#ffd700]/20 bg-[#ffd700]/5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-[#ffd700]">AI assist {isAiConfigured ? "" : "(disabled)"}</p>
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
                  <button className="rounded-full bg-[#ffd700] px-3 py-1.5 text-xs font-semibold text-black hover:bg-[#e6c200]">
                    Draft description
                  </button>
                </form>
                <form action={generateProductAi}>
                  <input type="hidden" name="key" value={key} />
                  <input type="hidden" name="kind" value="tags" />
                  <input type="hidden" name="posName" value={item.name} />
                  <input type="hidden" name="posCategory" value={item.category} />
                  <input type="hidden" name="posThc" value={item.thc ?? ""} />
                  <input type="hidden" name="posCbd" value={item.cbd ?? ""} />
                  <button className="rounded-full border border-[#ffd700]/50 px-3 py-1.5 text-xs font-semibold text-[#ffd700] hover:bg-[#ffd700]/10">
                    Suggest tags
                  </button>
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
                  <button className="rounded-full border border-[#ffd700]/50 px-3 py-1.5 text-xs font-semibold text-[#ffd700] hover:bg-[#ffd700]/10">
                    Draft aroma &amp; flavor
                  </button>
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
                      <p className="mt-2 rounded bg-[#ff7f00]/10 px-2 py-1 text-[11px] text-[#ff7f00]">
                        ⚠ Compliance check flagged: {flags.join(", ")}. Review carefully before accepting.
                      </p>
                    )}
                    <div className="mt-2 flex gap-2">
                      <form action={acceptSuggestion}>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="key" value={key} />
                        <button className="rounded-full bg-[#7ed957] px-3 py-1 text-xs font-semibold text-black hover:bg-[#6cc746]">Accept</button>
                      </form>
                      <form action={rejectSuggestion}>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="key" value={key} />
                        <button className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white/70 hover:border-white/40">Reject</button>
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

            <div className="border-t border-white/10 pt-4">
              <span className={label}>Tags</span>
              <div className="flex flex-wrap gap-2">
                {TAG_OPTIONS.map((t) => (
                  <label key={t} className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${currentTags.has(t) ? "border-[#7ed957] bg-[#7ed957]/10 text-[#7ed957]" : "border-white/15 text-white/60"}`}>
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
              {galleryIds.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {galleryIds.map((id) => {
                    const url = urlMap.get(id);
                    return (
                      <div key={id} className="aspect-square overflow-hidden rounded-lg border border-white/10 bg-black">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {url && <img src={url} alt="" className="h-full w-full object-cover" />}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-white/40">No images yet.</p>
              )}
              <label className="block">
                <span className={label}>Add image</span>
                <input type="file" name="image" accept="image/png,image/jpeg,image/webp,image/gif" className="block w-full text-xs text-white/70 file:mr-2 file:rounded file:border-0 file:bg-[#7ed957] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-black" />
              </label>
            </div>

            <div className="space-y-3 rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
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

            <button type="submit" className="w-full rounded-full bg-[#7ed957] px-5 py-2.5 text-sm font-semibold text-black hover:bg-[#6cc746]">
              Save enrichment
            </button>
          </div>
        </form>

        {/* Publish controls */}
        <form action={setEnrichmentStatus} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
          <input type="hidden" name="key" value={key} />
          <span className="text-xs font-medium text-white/50">
            Enrichment status: <span className="font-semibold text-white/80">{enrichment?.status ?? "none"}</span> · controlled by {session.profile.full_name}
          </span>
          <div className="ml-auto flex gap-2">
            <button name="status" value="published" className="rounded-full bg-[#7ed957] px-4 py-1.5 text-xs font-semibold text-black hover:bg-[#6cc746]">Publish to site</button>
            <button name="status" value="draft" className="rounded-full border border-white/20 px-4 py-1.5 text-xs font-semibold text-white/80 hover:border-white/40">Unpublish (draft)</button>
          </div>
        </form>
      </div>
    </div>
  );
}
