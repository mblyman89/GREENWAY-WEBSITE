/**
 * D242 — Budalerts sections on the Vendor Menus page (server components).
 *
 *   - BudalertsToolbar: the "Fetch all due brands" loop, the brand-list
 *     refresh, the last run, and the internal-use note. Sits above the
 *     "Still need a menu" table.
 *   - BudalertsDoneTable: the owner's "done" table — vendors that were in
 *     "Still need a menu" and now have their product data (photos, prices)
 *     gathered from a linked Budalerts brand.
 *
 * Kept out of page.tsx so the page itself only gains a few lines.
 */
import Link from "next/link";
import { Badge, Section } from "@/components/admin/ui";
import { EmptyState } from "@/components/admin/ux";
import { BUDALERTS_INTERNAL_NOTE, BUDALERTS_CACHE_DAYS } from "@/lib/purchasing/budalerts-core";
import { loadBudalertsBoard } from "@/lib/purchasing/budalerts-board-store";
import { ageLabel, needGroupLabel } from "@/lib/purchasing/vendor-menu-coverage-core";
import { BudalertsRowControls, FetchAllBudalertsButton, RefreshBudalertsSlugsButton } from "./budalerts-controls";

const BASE = "/admin/purchasing/menus";
const TH = "px-3 py-2.5 font-semibold";
const TD = "px-3 py-3 align-top";
const TABLE_SHELL = "overflow-x-auto rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]";
const THEAD = "bg-[var(--admin-surface-2)] text-left text-[0.65rem] uppercase tracking-wide text-[var(--admin-text-faint)]";
const ROW = "bg-[var(--admin-surface)] transition hover:bg-[var(--admin-surface-hover)]";
const FAINT = "text-xs text-[var(--admin-text-faint)]";
const LINK = "text-[var(--admin-accent)] hover:underline";

export async function BudalertsToolbar({ now }: { now: number }) {
  const board = await loadBudalertsBoard(now);
  if (!board.available) {
    return (
      <div id="budalerts" className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4 text-sm text-[var(--admin-text-muted)]">
        <p className="font-semibold text-[var(--admin-text)]">Budalerts (internal use only)</p>
        <p className="mt-1">{board.warnings[0] ?? "Budalerts is not set up yet."}</p>
      </div>
    );
  }
  return (
    <div id="budalerts" className="space-y-2 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl text-sm text-[var(--admin-text-muted)]">
          <p className="font-semibold text-[var(--admin-text)]">
            Budalerts — photos and prices for vendors with no wholesale menu{" "}
            <Badge tone="gold">internal use only</Badge>
          </p>
          <p className="mt-1">
            Link a vendor to its Budalerts brand on the rows below (exact-name suggestions are offered), then fetch. We read
            only the public brand and category pages robots.txt allows, one page every 3 seconds, and refetch a brand at most
            every {BUDALERTS_CACHE_DAYS} days. Once a linked brand has listings, the vendor moves to the
            &ldquo;Done — from Budalerts&rdquo; table. {board.linkedBrands} brand{board.linkedBrands === 1 ? "" : "s"} linked,{" "}
            {board.dueBrands} due.
          </p>
          <p className={`mt-1 ${FAINT}`}>{BUDALERTS_INTERNAL_NOTE}</p>
          {board.lastRunAt && (
            <p className={`mt-1 ${FAINT}`}>
              Last run {ageLabel(board.lastRunAt, now)}
              {board.lastRunNote ? `: ${board.lastRunNote}` : ""}
            </p>
          )}
          {board.warnings.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs text-[var(--admin-danger)]">
              {board.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <FetchAllBudalertsButton due={board.dueBrands} />
          <RefreshBudalertsSlugsButton count={board.knownSlugCount} />
        </div>
      </div>
    </div>
  );
}

export async function BudalertsDoneTable({ now }: { now: number }) {
  const board = await loadBudalertsBoard(now);
  if (!board.available) return null;
  const rows = board.done;
  return (
    <Section
      title={`Done — data gathered from Budalerts (${rows.length})`}
      description="Vendors we carry with no wholesale menu, whose product photos and prices are now on file from Budalerts. Internal use only — never shown on the website or shared."
    >
      {rows.length === 0 ? (
        <EmptyState
          icon="📸"
          title="No vendors done from Budalerts yet"
          description="Link a vendor in “Still need a menu” to its Budalerts brand and fetch. It moves here once listings come back."
        />
      ) : (
        <div className={TABLE_SHELL}>
          <table className="w-full min-w-[56rem] text-sm">
            <thead className={THEAD}>
              <tr>
                <th className={TH}>Vendor</th>
                <th className={TH}>Priority</th>
                <th className={`${TH} text-right`}>Our stock</th>
                <th className={TH}>Budalerts brands</th>
                <th className={`${TH} text-right`}>Listings · photos</th>
                <th className={TH}>Gathered</th>
                <th className={TH}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--admin-border)]">
              {rows.map((r) => {
                const info = board.rows[r.vendor.id] ?? { linked: [], suggestions: [] };
                return (
                  <tr key={r.vendor.id} className={ROW}>
                    <td className={TD}>
                      <Link href={`/admin/vendors/${r.vendor.id}`} className="font-medium text-[var(--admin-text)] hover:text-[var(--admin-accent)]">
                        {r.vendor.display_name}
                      </Link>
                      <div className={FAINT}>{r.vendor.license_number ? `Lic ${r.vendor.license_number}` : "—"}</div>
                    </td>
                    <td className={TD}>
                      <Badge tone="green">done</Badge> <span className={FAINT}>{needGroupLabel(r.group)}</span>
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>
                      {r.lots.lotsInStock} in stock
                      <div className={FAINT}>{r.lots.lotsTotal} lots total</div>
                    </td>
                    <td className={TD}>
                      <div className="flex flex-col gap-0.5">
                        {r.budalerts.usable.map((s) => (
                          <Link key={s.id} href={`${BASE}/budalerts/${s.id}?back=${encodeURIComponent(BASE)}`} className={`${LINK} text-xs`}>
                            {s.brandName || s.slug} →
                          </Link>
                        ))}
                      </div>
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>
                      {r.budalerts.itemCount.toLocaleString("en-US")} · {r.budalerts.imageCount.toLocaleString("en-US")}
                    </td>
                    <td className={TD}>
                      <span className={FAINT}>{r.budalerts.lastFetchedAt ? ageLabel(r.budalerts.lastFetchedAt, now) : "—"}</span>
                    </td>
                    <td className={TD}>
                      <BudalertsRowControls vendorId={r.vendor.id} vendorName={r.vendor.display_name} linked={info.linked} suggestions={info.suggestions} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
