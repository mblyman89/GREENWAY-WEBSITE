import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { CHIP_ACTION, CHIP_NEUTRAL } from "@/components/admin/ui";
import { isAiConfigured } from "@/lib/ai/provider";
import { loadKitSession } from "@/lib/enrichment/vendor-kit-server";
import { vendorOptionLabel } from "@/lib/enrichment/worklist-core";
import {
  KIT_AI_CHECK_MAX,
  decodeKitVerdicts,
  kitDefaultSelected,
  kitUrl,
  parseKitGroupBy,
} from "@/lib/enrichment/vendor-kit-core";
import { kitApplyAction, kitCheckAction } from "./actions";
import { getMedia } from "@/lib/media/store";
import { KitPhotoGrid, type KitGridPhoto } from "./KitPhotoGrid";
import { mediaPublicUrl, textEraseReady } from "@/lib/enrichment/text-erase-server";
import { FACTS_FIRST_HINT } from "@/lib/enrichment/text-erase-core";

export const dynamic = "force-dynamic";
// "Ask the AI" runs up to KIT_AI_CHECK_MAX vision calls inside the request.
export const maxDuration = 120;

/**
 * D244 R-8: Vendor kits. Owner (round 3): "Many vendors use the same non
 * labeled images for all their like kind products. I want to be able to sort
 * the vendors by type/ category so I can pick a generic on brand image and
 * add it to all their like kind products that would use this image. I want
 * the ai to help with this."
 */
export default async function VendorKitsPage({
  searchParams,
}: {
  searchParams: Promise<{ vendor?: string; by?: string; group?: string; photo?: string; chk?: string; saved?: string; note?: string; error?: string }>;
}) {
  await requirePermission("products.enrich");
  const sp = await searchParams;
  const vendor = String(sp.vendor ?? "").trim().slice(0, 100);
  const by = parseKitGroupBy(sp.by);
  const group = String(sp.group ?? "").trim().slice(0, 200);
  const chk = typeof sp.chk === "string" ? sp.chk.slice(0, 2000) : "";
  const verdicts = decodeKitVerdicts(chk);
  const note = typeof sp.note === "string" ? sp.note.trim().slice(0, 400) : "";
  const s = await loadKitSession({ vendor, by, group, verdicts });

  const header = (
    <AdminPageHeader
      title="Vendor kits"
      subtitle="One generic, on-brand photo for all of a vendor's like-kind products. Pick the vendor, the type, the photo, then the products."
      breadcrumbs={<Breadcrumbs items={[{ label: "Product Intake", href: "/admin/catalog" }, { label: "Product Enrichment", href: "/admin/products" }, { label: "Vendor kits" }]} />}
      help={
        <HelpPanel
          id="vendor-kits"
          title="How vendor kits work"
          steps={[
            "Pick a vendor. Its products are sorted into like-kind groups by category, or by the POS category the vendor uses (for example Live Resin Cart).",
            "Open a group. The products with no photo are listed first and ticked for you.",
            "The photos are ranked for a generic, on-brand picture: this vendor's own photos, product or package shots, the same type, and no single strain name printed on it.",
            `Press “Ask the AI” to have the photo reader look at the top ${KIT_AI_CHECK_MAX} photos and say which ones name one product. It only looks; it never attaches.`,
            "Photos with a strain name printed on them? Press \u201c\u2702 Remove text\u201d on any photo (as many as you like, 12 at a time), drag a box over the text on each, and press Remove text once: FLUX cleans them one after the next. Press \u201cUse as the kit photo\u201d on the clean one.",
            "Facts and AI first, photo last: a product with a photo goes live and leaves the worklists (by design). Attach any facts, or run the AI drafts, before you press Apply.",
            "Pick the photo, check the ticks, and press Apply. Each product gets the photo (as the cover when it has none), and a product with a photo goes live.",
          ]}
        />
      }
    />
  );
  const flash = (
    <>
      {sp.saved && (
        <div data-testid="saved-banner" className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-2 text-sm text-[var(--admin-accent)]">
          {note ? `Saved. ${note}` : "Saved."}
        </div>
      )}
      {sp.error && <div className="rounded-lg border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 px-4 py-2 text-sm text-[var(--admin-orange)]">{sp.error}</div>}
    </>
  );

  if (!s.ok) {
    return (
      <div>
        {header}
        <div className="space-y-3 p-6">
          {flash}
          <p className="text-sm text-white/60">{s.reason}</p>
        </div>
      </div>
    );
  }

  const picker = (
    <form method="get" action="/admin/products/vendor-kits" className="flex flex-wrap items-center gap-2" data-testid="kit-vendor-picker">
      <label htmlFor="kit-vendor" className="text-sm text-white/70">
        Vendor
      </label>
      <select id="kit-vendor" name="vendor" defaultValue={s.vendorId} className="rounded border border-white/15 bg-black px-2 py-1 text-sm text-white">
        <option value="">Choose a vendor…</option>
        {s.vendors.map((p) => (
          <option key={p.id} value={p.id}>
            {vendorOptionLabel(p)} · {p.onHandMissingPhoto} on hand without a photo
          </option>
        ))}
      </select>
      <label htmlFor="kit-by" className="text-sm text-white/70">
        Sort by
      </label>
      <select id="kit-by" name="by" defaultValue={by} className="rounded border border-white/15 bg-black px-2 py-1 text-sm text-white">
        <option value="category">Category</option>
        <option value="pos-category">POS category (finer)</option>
      </select>
      <button type="submit" className={CHIP_ACTION}>
        Show groups
      </button>
    </form>
  );

  const g = s.group;
  // D244 R-11: a photo just cleaned by the Remove-text queue may not rank yet; read it directly.
  const photoId = typeof sp.photo === "string" && /^[0-9a-f-]{8,64}$/i.test(sp.photo) ? sp.photo : "";
  const fresh = g && photoId && !s.photos.some((p) => p.id === photoId) ? await getMedia(photoId).catch(() => null) : null;
  const freshPick = fresh ? { id: fresh.id, url: mediaPublicUrl(fresh), label: fresh.title || fresh.filename || "Cleaned photo", reasons: ["Cleaned with Remove text."] } : null;
  const selected: { id: string; url: string | null; label: string; reasons: string[] } | null = g ? (freshPick ?? s.photos.find((p) => p.id === photoId) ?? s.photos[0] ?? null) : null;
  const ready = g ? await textEraseReady() : { vision: false, flux: false };
  // D244 R-21: every ranked photo (not just the first 12) can go to Remove text.
  const gridPhotos: KitGridPhoto[] = g
    ? s.photos.map((p) => ({
        id: p.id,
        url: p.url,
        label: p.label,
        score: p.score,
        chips: p.chips,
        reasons: p.reasons,
        warn: Boolean(p.namesProduct || p.verdict?.generic === "no"),
        href: kitUrl({ vendor: s.vendorId, by, group: g.key, photo: p.id, chk, hash: "products" }),
      }))
    : [];
  const ctxHidden = (
    <>
      <input type="hidden" name="vendor" value={s.vendorId} />
      <input type="hidden" name="by" value={by} />
      <input type="hidden" name="group" value={g?.key ?? ""} />
      <input type="hidden" name="chk" value={chk} />
      <input type="hidden" name="vendorLabel" value={s.vendorLabel} />
      <input type="hidden" name="groupLabel" value={g?.label ?? ""} />
    </>
  );

  return (
    <div>
      {header}
      <div className="space-y-5 p-4 sm:p-6">
        {flash}
        {picker}

        {s.vendorId && (
          <section data-testid="kit-groups" aria-label="Like-kind groups">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">{s.vendorLabel}: like-kind groups</h2>
            {s.groups.length ? (
              <div className="flex flex-wrap gap-2">
                {s.groups.map((x) => (
                  <Link
                    key={x.key}
                    href={kitUrl({ vendor: s.vendorId, by, group: x.key, hash: "photos" })}
                    className={`rounded-lg border px-3 py-2 text-left text-sm ${x.key === g?.key ? "border-[var(--admin-accent)] bg-[var(--admin-accent)]/10 text-white" : "border-white/15 text-white/80 hover:border-white/40"}`}
                  >
                    <span className="block font-semibold">{x.label}</span>
                    <span className="block text-xs text-white/50">
                      {x.total} products · {x.withPhoto} with a photo
                      {x.onHandNoPhoto ? <span className="text-[var(--admin-gold)]"> · {x.onHandNoPhoto} on hand need one</span> : null}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-white/50">This vendor has no products on the live menu.</p>
            )}
          </section>
        )}
        {!s.vendorId && <p className="text-sm text-white/60">Pick a vendor to see its products sorted into like-kind groups.</p>}

        {g && (
          <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
            <section id="photos" data-testid="kit-photos" aria-label="Generic photos">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-white/50">
                  Generic photos for {g.label} ({s.photos.length})
                </h2>
                <form action={kitCheckAction} className="flex items-center gap-2">
                  {ctxHidden}
                  {s.photos.slice(0, KIT_AI_CHECK_MAX).map((p) => (
                    <input key={p.id} type="hidden" name="mediaId" value={p.id} />
                  ))}
                  {s.cards.slice(0, 12).map((c) => (
                    <input key={c.key} type="hidden" name="product" value={c.name} />
                  ))}
                  <button
                    type="submit"
                    className={CHIP_NEUTRAL}
                    disabled={!isAiConfigured || s.photos.length === 0}
                    data-testid="kit-ai-check"
                    title={isAiConfigured ? `The photo reader looks at the top ${KIT_AI_CHECK_MAX} photos for a printed product name` : "AI is not configured"}
                  >
                    ✨ Ask the AI which is generic
                  </button>
                </form>
              </div>
              {s.photos.length ? (
                // D244 R-21 (owner: "I do not want two sections of images"): one grid; every photo can be picked as the kit photo AND sent to Remove text.
                <KitPhotoGrid
                  photos={gridPhotos}
                  selectedId={selected?.id ?? null}
                  vendorId={s.vendorId}
                  product={{ name: `${s.vendorLabel} ${g.label}`.trim(), brand: s.vendorLabel || null, strainName: null, vendor: s.vendorLabel || null, category: g.label || null }}
                  visionReady={ready.vision}
                  fluxReady={ready.flux}
                  pickHref={kitUrl({ vendor: s.vendorId, by, group: g.key, photo: "__MEDIA__", chk, hash: "products" })}
                />
              ) : (
                <p className="text-sm text-white/50">
                  No photo of this vendor fits yet. Upload the vendor&rsquo;s generic picture on Content → Media and file it under this vendor, then come back.
                </p>
              )}
            </section>

            <section id="products" data-testid="kit-products" aria-label="Products to apply to">
              <p className="mb-2 rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 px-3 py-2 text-xs text-[var(--admin-gold)]" data-testid="facts-first-hint">
                {FACTS_FIRST_HINT}
              </p>
              <form action={kitApplyAction} className="space-y-3 rounded-lg border border-white/10 p-3">
                {ctxHidden}
                <input type="hidden" name="mediaId" value={selected?.id ?? ""} />
                <div className="flex items-center gap-3">
                  {selected?.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={selected.url} alt={selected.label} className="h-16 w-16 rounded object-cover" />
                  ) : (
                    <div className="h-16 w-16 rounded bg-white/5" />
                  )}
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold text-white">{selected ? selected.label : "Pick a photo on the left"}</p>
                    <p className="text-xs text-white/50">{selected ? selected.reasons[0] ?? "" : ""}</p>
                  </div>
                </div>
                <fieldset className="flex flex-wrap gap-3 text-xs text-white/70">
                  <label className="flex items-center gap-1">
                    <input type="radio" name="mode" value="add" defaultChecked /> Add it; the cover only when a product has none
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" name="mode" value="cover" /> Make it the cover on every ticked product
                  </label>
                </fieldset>
                <ul className="max-h-[28rem] space-y-1 overflow-auto text-sm" data-testid="kit-product-list">
                  {s.cards.map((c) => {
                    const photo = c.galleryIds.length > 0 || Boolean(c.coverId);
                    const has = Boolean(selected && (c.galleryIds.includes(selected.id) || c.coverId === selected.id));
                    return (
                      <li key={c.key} className="flex items-start gap-2">
                        <input id={`k-${c.key}`} type="checkbox" name="key" value={c.key} defaultChecked={kitDefaultSelected(c) && !has} className="mt-1" />
                        <label htmlFor={`k-${c.key}`} className="min-w-0 flex-1">
                          <span className="block truncate text-white/85">{c.name}</span>
                          <span className="block text-[0.65rem] text-white/45">
                            {c.onHand ? "On hand" : "Not on hand"} · {photo ? "has a photo" : "no photo"}
                            {has ? " · already has this one" : ""}
                            {c.status === "published" ? " · live" : ""}
                          </span>
                        </label>
                        <Link href={`/admin/products/${encodeURIComponent(c.key)}`} className="text-[0.65rem] text-[var(--admin-accent)] hover:underline">
                          open
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                <button type="submit" className={CHIP_ACTION} disabled={!selected} data-testid="kit-apply">
                  Apply this photo to the ticked products
                </button>
                <p className="text-[0.65rem] text-white/40">
                  Nothing changes until you press Apply. The AI only ranks and checks the photos. Each product keeps its other photos.
                </p>
              </form>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
