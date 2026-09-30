import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BackLink } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { CHIP_ACTION } from "@/components/admin/ui";
import { getImport } from "@/lib/pos/menu-version";
import { formatDateTime } from "@/lib/pos/format";
import { pacificToday } from "@/lib/reports/timezone";
import { RECEIVED_DATE_FLOOR } from "@/lib/inventory/received-date-core";
import { groupUndatedLots, siblingDateNote } from "@/lib/inventory/received-date-bulk-core";
import { loadUndatedImportLots } from "@/lib/inventory/received-date-bulk-store";
import { setImportReceivedDatesAction } from "../../fix-actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * R16b — received dates for the lots this Cultivera import created without
 * one (diagnostic import_lot_received_date_missing). One form per vendor: a
 * date for the group, an optional date per lot, an attestation tick. CCRS
 * reports the lot's CreatedDate from this date (received-date-core.ts
 * ccrsInventoryCreatedDate), so it must come from the paper record — nothing
 * here is guessed or pre-filled. See received-date-bulk-core.ts.
 */
export default async function ImportReceivedDatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string; error?: string; back?: string }>;
}) {
  const session = await requirePermission("menu.import");
  const { id } = await params;
  const sp = await searchParams;
  const imp = await getImport(id);
  if (!imp) notFound();
  const canFix = can(session.profile.role, "inventory.manage");
  let loadError: string | null = null;
  let load: Awaited<ReturnType<typeof loadUndatedImportLots>> = { manifestFound: false, lots: [], datedCount: 0 };
  try {
    load = await loadUndatedImportLots(id);
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Could not read this import's lots.";
  }
  const groups = groupUndatedLots(load.lots);
  const withStock = load.lots.filter((l) => l.onHandQty > 0).length;
  const withSibling = load.lots.filter((l) => l.siblingDates.length > 0).length;
  const today = pacificToday();

  return (
    <div>
      <AdminPageHeader
        title="Received dates for this import's lots"
        subtitle={`Import ${formatDateTime(imp.created_at)} · lots Cultivera exported with a blank Received date`}
        action={
          <BackLink
            fallback={`/admin/menu-imports/${id}`}
            back={sp.back}
            className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/80 hover:border-[var(--admin-accent)] hover:text-white"
          >
            ← Import review
          </BackLink>
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.done && (
          <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-accent)]">
            {sp.done}
          </div>
        )}
        {sp.error && (
          <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-200">{sp.error}</div>
        )}
        {loadError && (
          <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-200">{loadError}</div>
        )}
        {!loadError && !load.manifestFound && (
          <div className="rounded-lg border border-orange-500/50 bg-orange-500/10 px-4 py-3 text-sm text-orange-200">
            This import has no inventory records yet. They are created when it is published; then its undated lots appear here.
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Lots with no received date" value={load.lots.length} hint={`${withStock} still have stock`} accent="orange" />
          <StatCard label="Vendors" value={groups.length} hint="one form each" accent="gold" />
          <StatCard label="Lots already dated" value={load.datedCount} hint="on this import" accent="green" />
          <StatCard label="Have a dated sibling lot" value={withSibling} hint="shown as a reference only" accent="muted" />
        </div>

        <p className="max-w-3xl text-xs text-white/50">
          The received date is what CCRS reports as the lot&apos;s CreatedDate, so it has to come from the paper record —
          the transfer manifest or invoice. Nothing here is pre-filled: barcodes do not encode the date, and another lot
          of the same product may have arrived on a different delivery. Enter one date for a vendor&apos;s delivery and
          untick any lot that came on a different day (or give that lot its own date). A lot that got a date elsewhere in
          the meantime is never overwritten. Each save is recorded as owner-entered, with your name and the time.
        </p>

        {groups.map((g) => (
          <section key={g.key} className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="received-date-group">
            <form action={setImportReceivedDatesAction} className="space-y-3">
              <input type="hidden" name="importId" value={id} />
              <input type="hidden" name="vendorName" value={g.vendorName} />
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-white">{g.vendorName}</h2>
                  <p className="text-xs text-white/40">
                    {g.lots.length} lot{g.lots.length === 1 ? "" : "s"} · {g.onHandTotal} on hand
                  </p>
                </div>
                {canFix && (
                  <label className="flex flex-col text-xs text-white/60">
                    Received on (for every ticked lot)
                    <input
                      type="date"
                      name="groupDate"
                      min={RECEIVED_DATE_FLOOR}
                      max={today}
                      className="mt-1 rounded border border-white/15 bg-black px-2 py-1 text-xs text-white"
                    />
                  </label>
                )}
              </div>
              <table className="w-full text-left text-xs">
                <thead className="text-white/40">
                  <tr>
                    {canFix && <th className="w-8 py-1">Set</th>}
                    <th className="py-1">Product</th>
                    <th className="py-1">Lot / barcode</th>
                    <th className="py-1 text-right">On hand</th>
                    {canFix && <th className="py-1">Own date (optional)</th>}
                  </tr>
                </thead>
                <tbody>
                  {g.lots.map((l) => {
                    const note = siblingDateNote(l.siblingDates);
                    return (
                      <tr key={l.id} className="border-t border-white/5 align-top text-white/80">
                        {canFix && (
                          <td className="py-1">
                            <input type="checkbox" name="lot" value={l.id} defaultChecked aria-label={`Set the date on ${l.productName ?? l.id}`} />
                          </td>
                        )}
                        <td className="py-1">
                          <Link href={`/admin/inventory/${l.id}`} className="hover:text-white hover:underline">
                            {l.productName ?? "Unnamed lot"}
                          </Link>
                          {note && <p className="text-white/40">{note}</p>}
                        </td>
                        <td className="py-1 font-mono text-white/50">{l.lotCode ?? "—"}</td>
                        <td className="py-1 text-right">{l.onHandQty}</td>
                        {canFix && (
                          <td className="py-1">
                            <input
                              type="date"
                              name={`date_${l.id}`}
                              min={RECEIVED_DATE_FLOOR}
                              max={today}
                              className="rounded border border-white/15 bg-black px-2 py-0.5 text-xs text-white"
                            />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {canFix && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
                  <label className="flex items-center gap-2 text-xs text-white/70">
                    <input type="checkbox" name="attest" value="1" />
                    These dates come from the transfer manifest or invoice for this delivery.
                  </label>
                  <button type="submit" className={CHIP_ACTION} data-testid="received-date-save">
                    Save received dates for {g.vendorName}
                  </button>
                </div>
              )}
            </form>
          </section>
        ))}

        {!loadError && load.manifestFound && load.lots.length === 0 && (
          <p className="rounded-xl border border-white/10 bg-[#0a0a0a] p-6 text-center text-sm text-white/70">
            Every lot from this import has a received date. Nothing to fix.
          </p>
        )}
      </div>
    </div>
  );
}
