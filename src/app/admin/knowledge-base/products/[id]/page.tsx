/**
 * /admin/knowledge-base/products/[id] - R28 KB product page.
 *
 * One product's knowledge record with what its LAB CERTIFICATE says: every
 * cannabinoid (percent and mg per serving), every terpene (ppm), the
 * cross-checks, what the certificate gives the product (serving facts), the
 * facts on its newest lot (what the register and the website use, with where
 * each came from), and the editable Product facts - the same panels and the
 * same save path as the lot page, so the back office, the register and the
 * website stay on one set of numbers.
 *
 * Lots are found by the KB link (inventory_lots.kb_product_id) or the POS key,
 * never by name. The certificate shown is the NEWEST lot's.
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { isUuid } from "@/lib/catalog/draft-deep-link-core";
import { getLotById } from "@/lib/inventory/store";
import { loadKbProductPage, loadLotFactsContext } from "@/lib/inventory/coa-panel-server";
import { labCertificateView, coaFactsView, lotFactRows, factSaveBanner } from "@/lib/inventory/coa-panel-core";
import { LabCertificatePanel, ProductFactsSection } from "@/components/admin/inventory/LabCertificatePanels";

export const dynamic = "force-dynamic";

const box = "rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5";

export default async function KbProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fact?: string; fact_msg?: string; fact_warn?: string }>;
}) {
  const session = await requirePermission("products.enrich");
  const { id } = await params;
  const { fact, fact_msg, fact_warn } = await searchParams;
  if (!isUuid(id)) notFound();

  const data = await loadKbProductPage(id);
  if (!data.ok && data.notFound) notFound();

  const crumbs = (
    <Breadcrumbs
      items={[
        { label: "Knowledge Base", href: "/admin/knowledge-base" },
        { label: "Product records", href: "/admin/knowledge-base/products" },
        { label: data.ok ? data.product.display_name : "Product" },
      ]}
    />
  );

  if (!data.ok) {
    return (
      <div>
        <AdminPageHeader title="Product record" breadcrumbs={crumbs} />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 px-4 py-3 text-sm text-[var(--admin-danger)]">
            This product record could not be read ({data.error}). Reload the page.
          </div>
        </div>
      </div>
    );
  }

  const { product, lots, lotsOk } = data;
  const newest = lots[0] ?? null;
  const lot = newest ? await getLotById(newest.id) : null;
  const canManageInventory = can(session.profile.role, "inventory.manage");
  const labView = labCertificateView(lot ? lot.lab ?? null : null);
  const coaFacts = coaFactsView(lot?.lab ?? null, {
    name: lot?.product_name ?? product.display_name,
    inventoryType: lot?.inventory_type ?? null,
  });
  const factsCtx = lot ? await loadLotFactsContext(lot.id) : null;

  return (
    <div>
      <AdminPageHeader
        title={product.display_name}
        subtitle={`${product.brand_slug}${product.category ? ` - ${product.category}` : ""}`}
        breadcrumbs={crumbs}
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className={box} data-testid="kb-product-knowledge">
            <h2 className="mb-3 text-sm font-bold text-[var(--admin-text)]">What the knowledge base holds</h2>
            <dl className="space-y-2 text-sm">
              <KbRow label="POS key" value={product.pos_product_key ?? "-"} />
              <KbRow label="Status" value={product.status ?? "-"} />
              <KbRow label="Total THC" value={product.total_thc_pct !== null ? `${product.total_thc_pct}%` : "-"} />
              <KbRow label="Total CBD" value={product.total_cbd_pct !== null ? `${product.total_cbd_pct}%` : "-"} />
              <KbRow label="Potency from" value={product.potency_source ?? "-"} />
            </dl>
            <h3 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">Terpenes</h3>
            <p className="text-sm" data-testid="kb-terpenes">
              {product.terpenes.length > 0 ? product.terpenes.join(", ") : "None recorded yet."}
            </p>
            <h3 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">Cannabinoids</h3>
            <p className="text-sm" data-testid="kb-cannabinoids">
              {product.cannabinoids.length > 0 ? product.cannabinoids.join(", ") : "None recorded yet."}
            </p>
            <p className="mt-3 text-xs text-[var(--admin-text-faint)]">
              Terpenes and cannabinoids the system reads from a lab certificate are added here only when these
              lists are empty - anything a person or a vendor menu saved is never overwritten. The website shows
              these terpenes on the product page.
            </p>
            {product.short_description && <p className="mt-3 text-sm text-[var(--admin-text-muted)]">{product.short_description}</p>}
          </div>

          <div className={box} data-testid="kb-product-lots">
            <h2 className="mb-3 text-sm font-bold text-[var(--admin-text)]">Lots of this product</h2>
            {!lotsOk && <p className="mb-2 text-xs text-[var(--admin-danger)]">Some lots could not be read. Reload the page.</p>}
            {lots.length === 0 ? (
              <p className="text-sm text-[var(--admin-text-muted)]">
                No inventory lot is linked to this product yet, so there is no lab certificate to show.
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {lots.map((l, i) => (
                  <li key={l.id} className="flex justify-between gap-3">
                    <Link href={`/admin/inventory/${l.id}`} className="text-[var(--admin-accent)] hover:underline">
                      {l.lot_code ?? l.product_name ?? "Lot"}
                    </Link>
                    <span className="text-xs text-[var(--admin-text-muted)]">
                      {i === 0 ? "newest - shown below - " : ""}
                      {l.on_hand_qty ?? 0} {l.unit ?? ""} on hand{l.status ? `, ${l.status}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {lot && (
          <div className="grid gap-6 lg:grid-cols-2">
            <LabCertificatePanel
              view={labView}
              facts={coaFacts}
              heading={`Lab certificate - lot ${lot.lot_code ?? ""}`.trim()}
            />
            {factsCtx && (
              <ProductFactsSection
                lotFacts={lotFactRows(lot as unknown as Record<string, unknown>)}
                ctx={factsCtx}
                returnTo={`/admin/knowledge-base/products/${product.id}`}
                banner={factSaveBanner(fact, fact_msg, fact_warn)}
                lotHref={{ href: `/admin/inventory/${lot.id}#lab-certificate`, label: lot.lot_code ?? "the newest lot" }}
                canEdit={canManageInventory}
              />
            )}
          </div>
        )}
        {lot && canManageInventory && (
          <p className="text-xs text-[var(--admin-text-faint)]">
            To read this certificate again, open the{" "}
            <Link href={`/admin/inventory/${lot.id}#lab-certificate`} className="underline">lot page</Link> and press Re-read lab certificate.
          </p>
        )}
      </div>
    </div>
  );
}

function KbRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[var(--admin-text-faint)]">{label}</dt>
      <dd className="text-right text-[var(--admin-text)]">{value}</dd>
    </div>
  );
}
