/**
 * /admin/knowledge-base/campaigns/images — Image Catalog (D220 S6).
 *
 * Owner: "tag and label and catalog everything so it is easy to match images
 * to product cards."
 *
 * Every image a campaign found, with everything known about it: the page it
 * came from, alt/caption/heading/JSON-LD name, the role (product shot,
 * packaging, logo…), the AI label (product, strain, size, printed packaging
 * text, colours, tags) and the best product-card matches with scores and the
 * reason. Confirm puts the image on the product card (Media Library draft,
 * pending license review); reject means it is never suggested again.
 */
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Badge, Button } from "@/components/admin/ui";
import { KbFlash } from "../../KbFlash";
import {
  catalogCounts,
  getCampaignSite,
  IMAGES_PER_PAGE,
  listCatalogImages,
  productNames,
  vendorProductOptions,
} from "@/lib/kb/crawl-campaigns";
import { parseImageFilters, PRODUCT_IMAGE_ROLES, ROLE_LABEL } from "@/lib/kb/crawl-campaigns-core";
import { CampaignTabs, MigrationNote } from "../CampaignTabs";
import { confirmImageMatchAction, rejectImageMatchAction, rematchSiteAction } from "../actions";

export const dynamic = "force-dynamic";

const MATCH_TONE: Record<string, "green" | "gold" | "danger" | "neutral"> = {
  confirmed: "green",
  suggested: "gold",
  rejected: "danger",
  unmatched: "neutral",
};

function qs(base: Record<string, string | null | undefined>, over: Record<string, string | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "?";
}

export default async function ImageCatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePermission("media.manage");
  const sp = await searchParams;
  const f = parseImageFilters(sp);
  const [list, counts, site] = await Promise.all([
    listCatalogImages(f),
    catalogCounts(),
    f.siteId ? getCampaignSite(f.siteId) : Promise.resolve(null),
  ]);
  const ids = list.rows.flatMap((r) => [r.matched_kb_product_id ?? "", ...(r.match_candidates ?? []).map((c) => c.id)]);
  const names = await productNames(ids);
  // Manual product picker: only when the page is scoped to one vendor (bounded list).
  const scopedVendor = f.vendorId ?? site?.vendor_id ?? null;
  const options = scopedVendor ? await vendorProductOptions(scopedVendor) : [];
  const keep = {
    role: f.role,
    match: f.match,
    vendor: f.vendorId,
    site: f.siteId,
    q: f.q || null,
  };
  const pages = Math.max(1, Math.ceil(list.total / IMAGES_PER_PAGE));
  const backHere = `/admin/knowledge-base/campaigns/images${qs(keep, { page: f.page > 1 ? String(f.page) : null })}`;

  return (
    <div>
      <AdminPageHeader
        title="Image catalog"
        subtitle="Every image the crawler found — tagged, AI-labelled and matched to product cards"
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Knowledge Base", href: "/admin/knowledge-base" },
              { label: "Crawl Campaigns", href: "/admin/knowledge-base/campaigns" },
              { label: "Image catalog" },
            ]}
          />
        }
      />
      <div className="space-y-5 px-5 py-6 sm:px-8">
        <CampaignTabs active="images" />
        <KbFlash msg={sp.msg} error={sp.error} />
        {!list.ready && <MigrationNote />}

        {/* Counters / quick filters */}
        <div className="flex flex-wrap gap-2 text-[11px]">
          <a href={qs(keep, { match: null, page: null })} className={`rounded-full border px-3 py-1 ${!f.match ? "border-[var(--admin-accent)] text-[var(--admin-accent)]" : "border-white/15 text-white/60"}`}>
            All {counts.total.toLocaleString()}
          </a>
          {(["suggested", "confirmed", "unmatched", "rejected"] as const).map((m) => (
            <a
              key={m}
              href={qs(keep, { match: m, page: null })}
              className={`rounded-full border px-3 py-1 ${f.match === m ? "border-[var(--admin-accent)] text-[var(--admin-accent)]" : "border-white/15 text-white/60"}`}
            >
              {m === "suggested" ? "To review" : m} {(counts.byMatch[m] ?? 0).toLocaleString()}
            </a>
          ))}
        </div>
        <form className="flex flex-wrap items-center gap-2 text-xs">
          {f.vendorId && <input type="hidden" name="vendor" value={f.vendorId} />}
          {f.siteId && <input type="hidden" name="site" value={f.siteId} />}
          {f.match && <input type="hidden" name="match" value={f.match} />}
          <select name="role" defaultValue={f.role ?? ""} className="rounded border border-white/15 bg-black px-2 py-1.5 text-white">
            <option value="">All roles</option>
            {Object.entries(ROLE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v} ({(counts.byRole[k] ?? 0).toLocaleString()})
              </option>
            ))}
          </select>
          <input
            name="q"
            defaultValue={f.q}
            placeholder="Search product, strain, alt text, packaging text…"
            className="w-72 rounded border border-white/15 bg-black px-2 py-1.5 text-white"
          />
          <Button type="submit" variant="neutral" size="sm">
            Filter
          </Button>
          {site && (
            <span className="ml-2 flex items-center gap-2 text-white/60">
              Site: <strong className="text-white">{site.display_name}</strong> ({site.host})
              <a href={qs({ ...keep, site: null }, { page: null })} className="underline">
                clear
              </a>
              {(site.status === "complete" || site.status === "partial") && (
                <form action={rematchSiteAction} className="inline">
                  <input type="hidden" name="siteId" value={site.id} />
                  <input type="hidden" name="back" value={backHere} />
                  <button type="submit" className="underline hover:text-white">
                    re-match against current product cards
                  </button>
                </form>
              )}
            </span>
          )}
        </form>

        <p className="text-[11px] text-white/40">
          {list.total.toLocaleString()} images · page {f.page} of {pages}
          {!scopedVendor && " · open a site (from the Campaigns tab) to pick any of that vendor's products by hand"}
        </p>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {list.rows.map((img) => {
            const matched = img.matched_kb_product_id ? names.get(img.matched_kb_product_id) : undefined;
            const productLike = PRODUCT_IMAGE_ROLES.has(img.role) || img.role === "unknown" || img.role === "other";
            const decided = img.match_status === "confirmed" || img.match_status === "rejected";
            return (
              <div key={img.id} className="flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0a]">
                <a href={img.image_url} target="_blank" rel="noreferrer" className="flex h-48 items-center justify-center bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img loading="lazy" decoding="async" src={img.image_url} alt={img.alt ?? ""} className="max-h-full max-w-full object-contain" referrerPolicy="no-referrer" />
                </a>
                <div className="flex flex-1 flex-col gap-2 p-3 text-[11px]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={productLike ? "green" : "neutral"}>{ROLE_LABEL[img.role] ?? img.role}</Badge>
                    {img.role_confidence !== null && (
                      <span className="text-[10px] text-white/35">{Math.round((img.role_confidence ?? 0) * 100)}%</span>
                    )}
                    <Badge tone={MATCH_TONE[img.match_status] ?? "neutral"}>{img.match_status}</Badge>
                    {img.vision_model && <span className="text-[10px] text-[var(--admin-gold)]">AI ✓</span>}
                    <span className="text-[10px] text-white/35">{img.source}</span>
                  </div>
                  <div className="space-y-0.5 text-white/70">
                    {(img.product_name || img.jsonld_name) && (
                      <div className="font-semibold text-white">{img.product_name || img.jsonld_name}</div>
                    )}
                    <div className="text-white/50">
                      {[img.strain_name, img.category, img.variant_label, img.brand_name].filter(Boolean).join(" · ")}
                    </div>
                    {img.packaging_text && <div className="italic text-white/45">“{img.packaging_text.slice(0, 140)}”</div>}
                    {img.alt && img.alt !== img.product_name && <div className="text-white/40">alt: {img.alt.slice(0, 100)}</div>}
                    {(img.tags?.length ?? 0) + (img.colors?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {[...(img.tags ?? []), ...(img.colors ?? [])].slice(0, 10).map((t) => (
                          <span key={t} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-white/50">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                    <a href={img.page_url} target="_blank" rel="noreferrer" className="block truncate text-[10px] text-white/30 hover:underline">
                      from {img.page_url.replace(/^https?:\/\//, "")}
                    </a>
                  </div>

                  <div className="mt-auto space-y-2 border-t border-white/5 pt-2">
                    {matched ? (
                      <div>
                        <span className="text-white/45">{img.match_status === "confirmed" ? "On card:" : "Best match:"}</span>{" "}
                        <span className="font-semibold text-white">
                          {matched.name}
                          {matched.variant ? ` · ${matched.variant}` : ""}
                        </span>
                        {img.match_score !== null && (
                          <span className="ml-1 tabular-nums text-white/40">{Math.round((img.match_score ?? 0) * 100)}%</span>
                        )}
                        {!matched.hasImage && img.match_status !== "confirmed" && (
                          <span className="ml-1 text-[var(--admin-gold)]">· card has no photo yet</span>
                        )}
                        {img.match_reason && <div className="text-[10px] text-white/35">{img.match_reason}</div>}
                      </div>
                    ) : (
                      <div className="text-white/35">No product match.</div>
                    )}
                    {!decided && (
                      <form action={confirmImageMatchAction} className="space-y-1.5">
                        <input type="hidden" name="imageId" value={img.id} />
                        <input type="hidden" name="back" value={backHere} />
                        {(img.match_candidates?.length ?? 0) > 1 || options.length > 0 ? (
                          <select
                            name="productId"
                            defaultValue={img.matched_kb_product_id ?? ""}
                            className="w-full rounded border border-white/15 bg-black px-2 py-1 text-[11px] text-white"
                          >
                            <option value="">— pick the product —</option>
                            {(img.match_candidates ?? []).map((c) => (
                              <option key={c.id} value={c.id}>
                                {Math.round(c.score * 100)}% · {names.get(c.id)?.name ?? c.name}
                                {names.get(c.id)?.variant ? ` · ${names.get(c.id)?.variant}` : ""}
                              </option>
                            ))}
                            {options.length > 0 && <option disabled>──────── all products</option>}
                            {options
                              .filter((o) => !(img.match_candidates ?? []).some((c) => c.id === o.id))
                              .map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.label}
                                </option>
                              ))}
                          </select>
                        ) : (
                          <input type="hidden" name="productId" value={img.matched_kb_product_id ?? ""} />
                        )}
                        {!productLike && (
                          <label className="flex items-center gap-1 text-[10px] text-white/45">
                            <input type="checkbox" name="force" value="true" className="accent-[var(--admin-accent)]" />
                            it really is a product photo
                          </label>
                        )}
                        <div className="flex gap-2">
                          <Button type="submit" variant="confirm" size="sm" disabled={!img.matched_kb_product_id && options.length === 0 && (img.match_candidates?.length ?? 0) === 0}>
                            ✓ Put on card
                          </Button>
                          <button
                            type="submit"
                            formAction={rejectImageMatchAction}
                            className="rounded-full border border-white/15 px-3 text-[10px] font-semibold uppercase text-white/60 hover:text-white"
                          >
                            ✕ Wrong
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-center gap-3 text-xs">
            {f.page > 1 && (
              <a href={qs(keep, { page: String(f.page - 1) })} className="underline">
                ← Prev
              </a>
            )}
            <span className="text-white/50">
              {f.page} / {pages}
            </span>
            {f.page < pages && (
              <a href={qs(keep, { page: String(f.page + 1) })} className="underline">
                Next →
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
