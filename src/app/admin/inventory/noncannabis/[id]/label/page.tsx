/**
 * /admin/inventory/noncannabis/[id]/label — Label Studio for one other-
 * inventory item (glass, papers, merch…) (D177).
 *
 * Replaces the fixed 2.25×1.25 SKU label. Same route and `back` param, so the
 * Other Inventory list and catalogue links keep working; the 2.25×1.25 stays
 * the default size. The barcode carries the store SKU (or the manufacturer
 * UPC when it has one) — both are what the register indexes for these items
 * (mergeNcBarcodes).
 *
 * Non-cannabis items are NOT reported to CCRS; this is purely a price/SKU
 * label so staff can scan them at the register.
 */
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { BackLink } from "@/components/admin/ux";
import { getNonCannabisProduct } from "@/lib/noncannabis/store";
import { getStoreProfile } from "@/lib/admin/store-profile-store";
import { pacificToday } from "@/lib/reports/timezone";
import { ncSubject } from "@/lib/printing/label-layout-core";
import { ncSourceFromRow } from "@/lib/printing/label-studio-core";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { LabelStudio } from "@/components/admin/labels/LabelStudio";

export const dynamic = "force-dynamic";

export default async function NonCannabisLabelPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  await requirePermission("inventory.manage");
  const { id } = await params;
  const { back } = await searchParams;
  const [product, profile] = await Promise.all([getNonCannabisProduct(id), getStoreProfile()]);
  if (!product) notFound();

  const storeName = profile.storeName || profile.legalEntity || "Greenway";
  const subject = ncSubject(ncSourceFromRow(product as unknown as Record<string, unknown>), { storeName, printedOn: pacificToday() });
  const suggested = Number.isInteger(product.qty_on_hand) && product.qty_on_hand > 0 ? Math.min(product.qty_on_hand, 500) : null;

  return (
    <div>
      <AdminPageHeader
        title="Label Studio"
        subtitle={subject.title}
        action={
          <BackLink
            fallback="/admin/inventory/noncannabis"
            back={back}
            className="text-xs text-[var(--admin-text-muted)] underline hover:text-[var(--admin-accent)]"
          >
            ← Back to other inventory
          </BackLink>
        }
      />
      <LabelStudio kind="nc" items={[{ subject, copies: 1, suggestedCopies: suggested }]} />
    </div>
  );
}
