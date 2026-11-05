/**
 * /admin/inventory/lots/[id]/label — Label Studio for one inventory lot (D177).
 *
 * Replaces the fixed 4×6 lot label (Slice 83). Same route, so every existing
 * link (receiving manifest, lot page) keeps working; it now opens the studio
 * with the 4×6 still pre-selected, and staff can pick any vendor's stock,
 * switch 1D / QR / UPC, and choose what prints.
 *
 * This is a REPRINT view: nothing here touches CCRS or inventory counts. The
 * Rollo has no cloud API, so printing goes through the browser dialog
 * (docs/rollo-label-printing.md).
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { getLotById } from "@/lib/inventory/store";
import { getStoreProfile } from "@/lib/admin/store-profile-store";
import { pacificToday } from "@/lib/reports/timezone";
import { lotSubject } from "@/lib/printing/label-layout-core";
import { lotSourceFromRow, suggestedCopiesForLot } from "@/lib/printing/label-studio-core";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { LabelStudio } from "@/components/admin/labels/LabelStudio";

export const dynamic = "force-dynamic";

const LINK = "text-xs text-[var(--admin-text-muted)] underline hover:text-[var(--admin-accent)]";

export default async function LotLabelPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("inventory.manage");
  const { id } = await params;
  const [lot, profile] = await Promise.all([getLotById(id), getStoreProfile()]);
  if (!lot) notFound();

  const storeName = profile.storeName || profile.legalEntity || "Greenway";
  const src = lotSourceFromRow(lot as unknown as Record<string, unknown>);
  const subject = lotSubject(src, { storeName, printedOn: pacificToday() });

  return (
    <div>
      <AdminPageHeader
        title="Label Studio"
        subtitle={subject.title}
        action={
          <div className="flex flex-wrap items-center gap-4">
            {lot.manifest_id ? (
              <Link href={`/admin/inventory/intake/${lot.manifest_id}`} className={LINK}>
                ← Back to manifest
              </Link>
            ) : null}
            <Link href={`/admin/inventory/${lot.id}`} className={LINK}>
              ← Back to lot
            </Link>
            {lot.manifest_id ? (
              <Link href={`/admin/inventory/intake/${lot.manifest_id}/labels`} className={LINK}>
                Label every line on this manifest
              </Link>
            ) : null}
          </div>
        }
      />
      <LabelStudio kind="lot" items={[{ subject, copies: 1, suggestedCopies: suggestedCopiesForLot(src) }]} />
    </div>
  );
}
