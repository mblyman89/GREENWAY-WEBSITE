import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { PromotionForm } from "@/components/admin/promotions/PromotionForm";
import {
  getPromotion,
  listMenuBrands,
  previewAffectedProductsWithImages,
} from "@/lib/promotions/promotions-store";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { SaleBadgePreview } from "@/components/admin/promotions/SaleBadgePreview";
import { sampleDiscount } from "@/lib/promotions/sample-discount";
import {
  updatePromotionAction,
  setPromotionStatusAction,
  deletePromotionAction,
} from "../actions";
import type { PostStatus } from "@/lib/promotions/types";

export const dynamic = "force-dynamic";

const NEXT_STATUS: { label: string; value: PostStatus; style: string }[] = [
  { label: "Save as draft", value: "draft", style: "border-white/20 text-white/70" },
  { label: "Schedule", value: "scheduled", style: "border-[#ffd700]/40 text-[#ffd700]" },
  { label: "Publish (go live)", value: "published", style: "border-[#7ed957]/50 text-[#7ed957]" },
  { label: "Archive", value: "archived", style: "border-white/10 text-white/40" },
];

export default async function EditPromotionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; status?: string }>;
}) {
  await requirePermission("promotions.manage");
  const { id } = await params;
  const { error, saved, status } = await searchParams;

  const promotion = await getPromotion(id);
  if (!promotion) notFound();

  const [brands, affected] = await Promise.all([
    listMenuBrands(),
    previewAffectedProductsWithImages(promotion),
  ]);

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
        {saved && (
          <div className="mb-4 rounded-lg border border-[#7ed957]/40 bg-[#7ed957]/10 px-4 py-2 text-sm text-[#7ed957]">
            Saved.
          </div>
        )}
        {status && (
          <div className="mb-4 rounded-lg border border-[#7ed957]/40 bg-[#7ed957]/10 px-4 py-2 text-sm text-[#7ed957]">
            Status set to {status}.
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div>
            <PromotionForm
              action={updatePromotionAction}
              promotion={promotion}
              brands={brands}
              submitLabel="Save changes"
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
                    <button
                      type="submit"
                      disabled={promotion.status === s.value}
                      className={`w-full rounded-lg border px-3 py-2 text-sm font-medium transition hover:bg-white/5 disabled:opacity-40 ${s.style}`}
                    >
                      {s.label}
                      {promotion.status === s.value ? " (current)" : ""}
                    </button>
                  </form>
                ))}
              </div>
              <p className="mt-3 text-xs text-white/40">
                Publishing takes an audit snapshot of the rules + affected products.
              </p>
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
                            <span className="text-[#7ed957]">{formatMinorCurrency(d.saleMinorUnits)}</span>
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
                <button
                  type="submit"
                  className="w-full rounded-lg border border-red-500/40 px-3 py-2 text-sm text-red-300 transition hover:bg-red-500/10"
                >
                  Delete promotion
                </button>
              </form>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
