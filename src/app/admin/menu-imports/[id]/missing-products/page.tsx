import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BackLink } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Badge } from "@/components/admin/ui";
import { getImport, listVersions, getVersionItems } from "@/lib/pos/menu-version";
import {
  buildMissingProductMasterWorklist,
  menuItemRowToMissingMasterItem,
  formatMinorUnits,
  reconciliationStatement,
  NO_BRAND_TEXT,
  type MissingMasterRow,
} from "@/lib/pos/missing-product-master-core";
import { formatDateTime } from "@/lib/pos/format";

export const dynamic = "force-dynamic";

/**
 * PROGRAM 3 / SLICE 6B — the missing-product-master worklist.
 *
 * Owner, Round 7: "the rejected ones, i can not fix or do anything with them at
 * all." Measured against his own Sep-1-2026 workbooks: all 771 rejected rows
 * carry ONE reason, `no_product_master` — the product is in the INVENTORIES
 * export but has no row in the PRODUCTS export. 8,012 units, $141,148.02 of
 * retail value, 158 brands, and not one of them with zero stock.
 *
 * This screen exists because the Fact Review page rendered those rows as
 * name + notes inside a collapsed <details> with no form and no export. The
 * rows were never actionable, and nothing told the owner they were also never
 * the thing blocking his publish.
 *
 * It deliberately does NOT try to auto-match names. Measured on the real files:
 * a safe match (name normalised AND package size agreeing) recovers 3 of 801,
 * while the loose "strip the size suffix" match would link a 28g jar to a 7g
 * product row — inventing a package size on a cannabis SKU (standing rule 3 /
 * data-governance Rule 3.1). See SLICE6B_DIAGNOSIS.md for the measurements.
 */
export default async function MissingProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string; brand?: string }>;
}) {
  await requirePermission("menu.import");
  const { id } = await params;
  const sp = await searchParams;

  const imp = await getImport(id);
  if (!imp) notFound();

  let versions: Awaited<ReturnType<typeof listVersions>> = [];
  try {
    versions = await listVersions(50);
  } catch (err) {
    console.error("[menu-imports/:id/missing-products] load error:", err);
  }
  const version = versions.find((v) => v.import_id === id) ?? null;
  // getVersionItems() is fully paged and returns [] on a failed page rather
  // than a partial menu (SLICE 5A) — a short worklist would understate the
  // problem, which is the one thing this screen must never do.
  const items = version ? await getVersionItems(version.id) : [];

  const worklist = buildMissingProductMasterWorklist(
    items.map((row) => menuItemRowToMissingMasterItem(row, row.variants)),
  );

  const goingLive = items.filter((i) => !i.hidden).length;
  const rejected = items.filter((i) => i.hidden).length;
  const reconciliation = reconciliationStatement({
    totalItems: items.length,
    goingLive,
    documentedRejects: rejected,
  });

  // Rejected rows hidden for some OTHER reason are a different problem; say so
  // rather than letting the counts silently disagree.
  const otherRejects = rejected - worklist.totals.items;

  const selectedBrand = sp.brand ? decodeURIComponent(sp.brand) : null;
  const visibleBrands = selectedBrand
    ? worklist.brands.filter((b) => b.brand === selectedBrand)
    : worklist.brands;

  return (
    <div>
      <AdminPageHeader
        title="Missing Product Masters"
        subtitle={`Import ${formatDateTime(imp.created_at)} · in your inventory file, not in your products file`}
        action={
          <BackLink
            fallback={`/admin/menu-imports/${id}/facts`}
            back={sp.back}
            className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/80 hover:border-[var(--admin-accent)] hover:text-white"
          >
            ← Fact Review
          </BackLink>
        }
      />

      <div className="space-y-8 px-5 py-6 sm:px-8">
        {/* THE SENTENCE THE OWNER NEEDED IN ROUND 7. He spent the round
            believing these 771 rows were why his website was empty. They were
            not — the publish gate never counted them. */}
        <div className="rounded-xl border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-accent)]">
          <strong>These do not block publishing.</strong>{" "}
          <span className="text-white/80">{reconciliation}</span>{" "}
          <span className="text-white/60">
            They are a data-completeness worklist: every one is real stock that will not appear on
            your menu until the product exists in your products file.
          </span>
        </div>

        {version === null && (
          <div className="rounded-lg border border-orange-500/50 bg-orange-500/10 px-4 py-3 text-sm text-orange-200">
            <strong>No staged version found for this import.</strong> Nothing can be listed until
            the import has staged a menu version.
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Products to create"
            value={worklist.totals.items}
            hint={`across ${worklist.totals.brands} brands`}
            accent="orange"
          />
          <StatCard label="Units on hand" value={worklist.totals.units} hint="real, sellable stock" accent="muted" />
          <StatCard
            label="Retail value stranded"
            value={`$${formatMinorUnits(worklist.totals.retailValueMinorUnits)}`}
            hint="at your staged prices"
            accent="gold"
          />
          <StatCard
            label="Rows needing more info"
            value={worklist.totals.incompleteItems}
            hint="your export left a field blank"
            accent={worklist.totals.incompleteItems > 0 ? "orange" : "green"}
          />
        </div>

        {otherRejects > 0 && (
          <div className="rounded-lg border border-white/15 bg-white/5 px-4 py-3 text-xs text-white/60">
            {otherRejects} other hidden row{otherRejects === 1 ? " is" : "s are"} hidden for a
            different documented reason and {otherRejects === 1 ? "is" : "are"} not part of this
            worklist.
          </div>
        )}

        {/* How to actually clear it. Grounded in the constraint already
            recorded in docs/CULTIVERA_PRODUCT_UPLOAD.md: the owner cannot
            upload his own sheets — his Cultivera rep does the batch upload. */}
        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-white">How to clear this list</h2>
              <p className="mt-1 max-w-3xl text-xs text-white/55">
                Cultivera does not let you upload product sheets yourself — your rep does the batch
                upload. Download this list in the column layout your rep already accepts, fill in
                the naming columns, and send it over. On your next import these products will match
                and go straight to the menu.
              </p>
            </div>
            {worklist.totals.items > 0 && (
              <a
                href={`/admin/menu-imports/${id}/missing-products/export`}
                className="shrink-0 rounded-full bg-[var(--admin-accent)] px-4 py-2 text-xs font-semibold text-black hover:opacity-90"
              >
                Download rep sheet (CSV)
              </a>
            )}
          </div>
          <p className="mt-3 text-xs text-white/40">
            Every field in the sheet is copied from your own inventory export. Where the export was
            blank the cell is left blank and listed under &ldquo;Still Needed From Greenway&rdquo; —
            nothing is invented for you.
          </p>
        </section>

        {worklist.totals.items === 0 ? (
          <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-8 text-center">
            <p className="text-sm text-white/70">
              Nothing is missing a product master on this import.
            </p>
          </section>
        ) : (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-white">
                By brand <span className="text-white/40">(each brand is one conversation)</span>
              </h2>
              {selectedBrand && (
                <Link
                  href={`/admin/menu-imports/${id}/missing-products`}
                  className="rounded-full border border-white/15 px-3 py-1 text-[11px] text-white/70 hover:border-[var(--admin-accent)] hover:text-white"
                >
                  Showing {selectedBrand} — clear filter
                </Link>
              )}
            </div>

            {!selectedBrand && (
              <div className="flex flex-wrap gap-2">
                {worklist.brands.slice(0, 24).map((b) => (
                  <Link
                    key={b.brand}
                    href={`/admin/menu-imports/${id}/missing-products?brand=${encodeURIComponent(b.brand)}`}
                    className="rounded-full border border-white/15 px-3 py-1 text-[11px] text-white/70 hover:border-[var(--admin-accent)] hover:text-white"
                  >
                    {b.brand}{" "}
                    <span className="text-white/40">
                      {b.itemCount} · ${formatMinorUnits(b.retailValueMinorUnits)}
                    </span>
                  </Link>
                ))}
                {worklist.brands.length > 24 && (
                  <span className="px-2 py-1 text-[11px] text-white/35">
                    +{worklist.brands.length - 24} more brands below
                  </span>
                )}
              </div>
            )}

            {visibleBrands.map((group) => (
              <details
                key={group.brand}
                open={visibleBrands.length <= 3}
                className="rounded-xl border border-white/10 bg-[#0a0a0a]"
              >
                <summary className="cursor-pointer px-5 py-3 text-sm">
                  <span className="font-semibold text-white">
                    {group.brand === NO_BRAND_TEXT ? (
                      <em className="text-white/60">{NO_BRAND_TEXT}</em>
                    ) : (
                      group.brand
                    )}
                  </span>
                  <span className="ml-2 text-xs text-white/45">
                    {group.itemCount} product{group.itemCount === 1 ? "" : "s"} · {group.units} units
                    · ${formatMinorUnits(group.retailValueMinorUnits)} stranded
                  </span>
                </summary>
                <div className="border-t border-white/10">
                  {group.rows.map((row) => (
                    <MissingRow key={row.sourceItemId} row={row} />
                  ))}
                </div>
              </details>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

/** One product the owner needs created, with everything we could transcribe. */
function MissingRow({ row }: { row: MissingMasterRow }) {
  return (
    <div className="border-b border-white/5 px-5 py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm text-white/85">{row.name}</span>
        <span className="text-xs text-white/45">
          {row.units} units · ${formatMinorUnits(row.retailValueMinorUnits)}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/45">
        {row.category && <span>{row.category}</span>}
        {row.inventoryType && <span>· {row.inventoryType}</span>}
        {row.strainName && <span>· {row.strainName}</span>}
        {row.packageLabels.length > 0 && <span>· {row.packageLabels.join(" / ")}</span>}
        {row.medical && <Badge tone="gold">Medical</Badge>}
      </div>
      {row.missingFields.length > 0 && (
        <p className="mt-1 text-[11px] text-[var(--admin-orange)]">
          Your export had no {row.missingFields.join(", ")} for this row — you will need to supply
          {row.missingFields.length === 1 ? " it" : " them"}.
        </p>
      )}
    </div>
  );
}
