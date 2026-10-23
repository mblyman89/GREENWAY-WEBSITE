import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Button } from "@/components/admin/ui";
import { PromotionForm } from "@/components/admin/promotions/PromotionForm";
import {
  getPromotion,
  listMenuBrands,
  listMenuProducts,
  listSavedAudiences,
  previewAffectedProductsWithImages,
} from "@/lib/promotions/promotions-store";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { SaleBadgePreview } from "@/components/admin/promotions/SaleBadgePreview";
import { sampleDiscount } from "@/lib/promotions/sample-discount";
import {
  updatePromotionAction,
  setPromotionStatusAction,
  deletePromotionAction,
  hidePromotionBlockersAction,
} from "../actions";
import type { PostStatus } from "@/lib/promotions/types";
import { isAiConfigured } from "@/lib/promotions/ai-copy";
import { guardPromotionPublish } from "@/lib/promotions/promo-guard";
import { formatMoneyMinor } from "@/lib/promotions/discount-engine-core";
import { guardSkipNote, MAX_HIDE_PER_PRESS } from "@/lib/promotions/promo-fix-core";

export const dynamic = "force-dynamic";

const NEXT_STATUS: {
  label: string;
  value: PostStatus;
  variant: "neutral" | "save" | "confirm";
}[] = [
  { label: "Save as draft", value: "draft", variant: "neutral" },
  { label: "Schedule", value: "scheduled", variant: "save" },
  { label: "Publish (go live)", value: "published", variant: "confirm" },
  { label: "Archive", value: "archived", variant: "neutral" },
];

export default async function EditPromotionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; status?: string; fix?: string; fixTone?: string }>;
}) {
  await requirePermission("promotions.manage");
  const { id } = await params;
  const { error, saved, status, fix, fixTone } = await searchParams;

  const promotion = await getPromotion(id);
  if (!promotion) notFound();

  const [brands, products, audiences, affected, guard] = await Promise.all([
    listMenuBrands(),
    listMenuProducts(),
    listSavedAudiences(),
    previewAffectedProductsWithImages(promotion),
    guardPromotionPublish(promotion),
  ]);
  const guardBelowCost = guard.findings.filter((f) => f.reason === "below_cost");
  const guardCostUnknown = guard.findings.filter((f) => f.reason === "cost_unknown");
  const guardRegularBelow = guard.findings.filter((f) => f.reason === "regular_below_cost");
  // R74 S22: what the guard left out (hidden cards, never-discount products).
  const guardSkipped = guardSkipNote(guard.hiddenSkipped, guard.neverSkipped);

  // Pick a representative product (or a sensible default) for the live badge preview.
  const sample = affected[0] ?? null;
  const samplePrice = sample?.priceMinorUnits ?? 3500; // $35.00 default illustration

  return (
    <div>
      <AdminPageHeader
        title={promotion.title}
        subtitle={`Status: ${promotion.status} · ${affected.length} product(s) affected in the live menu`}
      />
      <div className="px-5 py-6 sm:px-8">
        {error && (
          <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
        {fix && (
          <div
            data-testid="promo-fix-banner"
            className={`mb-4 rounded-lg border px-4 py-2 text-sm ${
              fixTone === "error"
                ? "border-red-500/40 bg-red-500/10 text-red-300"
                : "border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 text-[var(--admin-accent)]"
            }`}
          >
            {fix}
          </div>
        )}
        {saved && (
          <div className="mb-4 rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-2 text-sm text-[var(--admin-accent)]">
            Saved.
          </div>
        )}
        {status && (
          <div className="mb-4 rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-2 text-sm text-[var(--admin-accent)]">
            Status set to {status}.
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div>
            <PromotionForm
              action={updatePromotionAction}
              promotion={promotion}
              brands={brands}
              products={products}
              audiences={audiences}
              submitLabel="Save changes"
              aiEnabled={isAiConfigured}
            />
          </div>

          {/* Right rail: preview-before-publish + status controls */}
          <aside className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-white/40">
                Publish status
              </h3>
              <div className="mt-3 space-y-2">
                {NEXT_STATUS.map((s) => (
                  <form key={s.value} action={setPromotionStatusAction}>
                    <input type="hidden" name="id" value={promotion.id} />
                    <input type="hidden" name="status" value={s.value} />
                    <Button
                      type="submit"
                      disabled={promotion.status === s.value}
                      variant={s.variant}
                      size="sm"
                      fullWidth
                    >
                      {s.label}
                      {promotion.status === s.value ? " (current)" : ""}
                    </Button>
                  </form>
                ))}
              </div>
              <p className="mt-3 text-xs text-white/40">
                Publishing takes an audit snapshot of the rules + affected products, and is
                HARD-BLOCKED if any product&apos;s worst case would fall below its acquisition cost
                (CCRS).
              </p>
            </div>

            {/* CCRS cost-floor pre-publish check */}
            <div
              id="cost-floor"
              className={`rounded-xl border p-4 ${
                guard.blocked
                  ? "border-[#ff6b6b]/40 bg-[#ff6b6b]/10"
                  : "border-[var(--admin-accent)]/25 bg-[var(--admin-accent)]/[0.05]"
              }`}
            >
              <h3
                className={`text-sm font-semibold uppercase tracking-wide ${
                  guard.blocked ? "text-[#ff6b6b]" : "text-[var(--admin-accent)]"
                }`}
              >
                🛡 CCRS cost-floor check
              </h3>
              {guard.blocked ? (
                <>
                  <p className="mt-1 text-xs text-[#ffb0b0]">
                    Publish will be BLOCKED: {guardBelowCost.length} product
                    {guardBelowCost.length === 1 ? "" : "s"} would be discounted below the cost of
                    acquisition in the worst case. Soften the discount, raise the price, or exclude
                    the product.
                  </p>
                  <p className="mt-2 text-xs text-white/60">
                    Bad apple from the import? Hide it from the menu: a hidden product is not sold
                    on the website or the register, so it cannot break this deal, and Publish
                    works right away. Undo any time on the product page (Visibility: Inherit POS).
                  </p>
                  <form action={hidePromotionBlockersAction} className="mt-2">
                    <input type="hidden" name="id" value={promotion.id} />
                    <input type="hidden" name="all" value="1" />
                    <Button type="submit" variant="danger" size="sm" fullWidth data-testid="promo-hide-all">
                      Hide {Math.min(guardBelowCost.length, MAX_HIDE_PER_PRESS) === 1 ? "this product" : `all ${Math.min(guardBelowCost.length, MAX_HIDE_PER_PRESS)} products`} from the menu
                    </Button>
                  </form>
                  <ul className="mt-2 max-h-72 space-y-1.5 overflow-y-auto" data-testid="promo-blockers">
                    {guardBelowCost.slice(0, 50).map((f) => (
                      <li key={f.key} className="rounded-md bg-black/30 px-2 py-1.5 text-xs text-[#ffb0b0]/90">
                        <div>
                          <a
                            href={`/admin/products/${encodeURIComponent(f.key)}`}
                            className="text-white/80 underline decoration-white/20 hover:decoration-white/60"
                          >
                            {f.name}
                          </a>{" "}
                          — price {formatMoneyMinor(f.priceMinorUnits)}, worst case{" "}
                          {formatMoneyMinor(f.worstCasePriceMinorUnits)} {"<"} floor{" "}
                          {formatMoneyMinor(f.floorMinorUnits)}
                        </div>
                        <form action={hidePromotionBlockersAction} className="mt-1">
                          <input type="hidden" name="id" value={promotion.id} />
                          <input type="hidden" name="key" value={f.key} />
                          <button
                            type="submit"
                            className="rounded border border-[#ff6b6b]/40 px-2 py-0.5 text-[11px] text-[#ffb0b0] hover:bg-[#ff6b6b]/15"
                          >
                            Hide from menu
                          </button>
                        </form>
                      </li>
                    ))}
                    {guardBelowCost.length > 50 && (
                      <li className="text-xs text-[#ffb0b0]/60">
                        …and {guardBelowCost.length - 50} more (Hide all covers up to {MAX_HIDE_PER_PRESS} per press).
                      </li>
                    )}
                  </ul>
                </>
              ) : (
                <p className="mt-1 text-xs text-white/60">
                  Worst case checked against {guard.affectedCount} affected product
                  {guard.affectedCount === 1 ? "" : "s"}: no price can fall below its acquisition
                  cost. The register also clamps every ticket at the floor (defense in depth).
                </p>
              )}
              {guardSkipped && (
                <p data-testid="promo-guard-skipped" className="mt-2 text-xs text-white/50">
                  {guardSkipped}
                </p>
              )}
              {(guardCostUnknown.length > 0 || guardRegularBelow.length > 0) && (
                <p className="mt-2 text-xs text-[var(--admin-gold)]/90">
                  {guardCostUnknown.length > 0 && (
                    <>
                      {guardCostUnknown.length} product
                      {guardCostUnknown.length === 1 ? "" : "s"} have no cost on file (statutory
                      floor only until a costed lot exists).{" "}
                    </>
                  )}
                  {guardRegularBelow.length > 0 && (
                    <>
                      {guardRegularBelow.length} product
                      {guardRegularBelow.length === 1 ? " is" : "s are"} already priced at/below the
                      cost floor at regular price — no discount can apply there.
                    </>
                  )}
                </p>
              )}
            </div>

            <SaleBadgePreview
              title={promotion.title}
              sampleName={sample?.name ?? "Sample product"}
              sampleBrand={sample?.brand ?? "Brand"}
              samplePriceMinorUnits={samplePrice}
              sampleImageUrl={sample?.imageUrl ?? null}
              discountType={promotion.discount_type}
              discountPercent={promotion.discount_percent}
              discountFixed={promotion.discount_fixed}
              multiItemPercent={promotion.multi_item_percent}
              bonusNote={promotion.bonus_note}
            />

            <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-white/40">
                Affected products ({affected.length})
              </h3>
              <p className="mt-1 text-xs text-white/40">
                Resolved against the currently published menu. Review before publishing.
              </p>
              <div className="mt-3 max-h-80 space-y-1 overflow-y-auto">
                {affected.length === 0 && (
                  <p className="text-xs text-white/40">
                    No live-menu matches yet (or no menu version is published). The deal will apply
                    once matching products are live.
                  </p>
                )}
                {affected.slice(0, 60).map((p) => {
                  const d = sampleDiscount(p.priceMinorUnits, {
                    discountType: promotion.discount_type,
                    discountPercent: promotion.discount_percent,
                    discountFixed: promotion.discount_fixed,
                    multiItemPercent: promotion.multi_item_percent,
                  });
                  return (
                    <div
                      key={p.key}
                      className="flex items-center justify-between gap-2 rounded-md bg-black/40 px-2 py-1 text-xs"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded border border-white/10 bg-black">
                          {p.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <span className="text-[11px] text-white/30">🌿</span>
                          )}
                        </span>
                        <span className="truncate text-white/70">
                          {p.brand ? `${p.brand} · ` : ""}
                          {p.name}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-baseline gap-1.5">
                        {d.showsPrice ? (
                          <>
                            <span className="text-[var(--admin-accent)]">{formatMinorCurrency(d.saleMinorUnits)}</span>
                            <span className="text-white/30 line-through">{formatMinorCurrency(p.priceMinorUnits)}</span>
                          </>
                        ) : (
                          <span className="text-white/40">{formatMinorCurrency(p.priceMinorUnits)}</span>
                        )}
                      </span>
                    </div>
                  );
                })}
                {affected.length > 60 && (
                  <p className="text-xs text-white/40">…and {affected.length - 60} more.</p>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-red-500/20 bg-[#0a0a0a] p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-red-400/70">
                Danger zone
              </h3>
              <form action={deletePromotionAction} className="mt-2">
                <input type="hidden" name="id" value={promotion.id} />
                <Button type="submit" variant="danger" size="sm" fullWidth>
                  Delete promotion
                </Button>
              </form>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
