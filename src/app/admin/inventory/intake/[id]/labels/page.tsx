/**
 * /admin/inventory/intake/[id]/labels — Label Studio for a whole receiving
 * manifest (D177).
 *
 * Owner: "This should be connected to receiving as it already is." The
 * manifest page still offers a per-line label; this page labels every line in
 * one print job with one shared design. Rejected / destroyed lines are left
 * out (they never reach the shelf). Copies default to 1 each, with a one-click
 * "one per unit received" for unit-count lines.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { getManifestById, listLotsForManifestLabels } from "@/lib/inventory/store";
import { getStoreProfile } from "@/lib/admin/store-profile-store";
import { pacificToday } from "@/lib/reports/timezone";
import { lotSubject } from "@/lib/printing/label-layout-core";
import { labelLoadErrorText, lotSourceFromRow, suggestedCopiesForLot } from "@/lib/printing/label-studio-core";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { LabelStudio, type StudioItem } from "@/components/admin/labels/LabelStudio";
import { listLabelTemplatesAction } from "@/app/admin/labels/actions";

export const dynamic = "force-dynamic";

const LINK = "text-xs text-[var(--admin-text-muted)] underline hover:text-[var(--admin-accent)]";
/** Lines that never go on a shelf, so never need a shelf label. */
const SKIP_STATUS = new Set(["destroyed"]);
/** inventory_lots.disposition check (migration 0059): pending | accepted | rejected_at_dock. */
const SKIP_DISPOSITION = "rejected_at_dock";

export default async function ManifestLabelsPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("inventory.manage");
  const { id } = await params;
  const [manifest, loaded, profile, saved] = await Promise.all([getManifestById(id), listLotsForManifestLabels(id), getStoreProfile(), listLabelTemplatesAction("lot")]);
  if (!manifest) notFound();

  const storeName = profile.storeName || profile.legalEntity || "Greenway";
  const ctx = { storeName, printedOn: pacificToday() };
  const heading = [manifest.manifest_number ? `Manifest ${manifest.manifest_number}` : "Manifest", manifest.vendor_label, manifest.transfer_date]
    .filter(Boolean)
    .join(" · ");

  const back = (
    <Link href={`/admin/inventory/intake/${id}`} className={LINK}>
      ← Back to manifest
    </Link>
  );

  if (!loaded.ok) {
    return (
      <div>
        <AdminPageHeader title="Label Studio" subtitle={heading} action={back} />
        <div className="mx-auto max-w-3xl px-5 py-8">
          <div role="alert" className="rounded-[var(--admin-radius-lg)] bg-[var(--admin-danger-soft)] p-4 text-sm text-[var(--admin-danger)]">
            {labelLoadErrorText(loaded.code, loaded.message)}
          </div>
        </div>
      </div>
    );
  }

  const items: StudioItem[] = loaded.lots
    .filter((l) => !SKIP_STATUS.has(String(l.status ?? "").toLowerCase()) && (l as unknown as { disposition?: string | null }).disposition !== SKIP_DISPOSITION)
    .map((l) => {
      const src = lotSourceFromRow(l as unknown as Record<string, unknown>);
      return { subject: lotSubject(src, ctx), copies: 1, suggestedCopies: suggestedCopiesForLot(src) };
    });
  const skipped = loaded.lots.length - items.length;

  return (
    <div>
      <AdminPageHeader
        title="Label Studio"
        subtitle={`${heading} · ${items.length} line${items.length === 1 ? "" : "s"}${skipped ? ` (${skipped} rejected left out)` : ""}`}
        action={back}
      />
      {items.length === 0 ? (
        <div className="mx-auto max-w-3xl px-5 py-8 text-sm text-[var(--admin-text-muted)]">
          This manifest has no lines to label yet. Lines appear here once the manifest is received.
        </div>
      ) : (
        <LabelStudio kind="lot" items={items} contextLine={heading} saved={saved} />
      )}
    </div>
  );
}
