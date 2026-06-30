import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Button } from "@/components/admin/ui";
import { getManifestById } from "@/lib/inventory/store";
import { listManifestLots } from "@/lib/inventory/intake-store";
import { acceptManifestAction, rejectManifestAction } from "../actions";

export const dynamic = "force-dynamic";

function fmtQty(qty: number, unit: string): string {
  const n = Number.isInteger(qty) ? qty.toString() : qty.toFixed(2);
  return `${n} ${unit}`;
}

export default async function ManifestReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    staged?: string;
    accepted?: string;
    drafts?: string;
    rejected?: string;
    error?: string;
  }>;
}) {
  await requirePermission("inventory.manage");
  const { id } = await params;
  const { staged, accepted, drafts, rejected, error } = await searchParams;

  const manifest = await getManifestById(id);
  if (!manifest) notFound();

  const lots = await listManifestLots(id);
  const isPending = manifest.status === "pending";

  const withCoa = lots.filter((l) => l.lab_result_id).length;
  const missingCoa = lots.length - withCoa;
  const sampleCount = lots.filter((l) => l.is_sample).length;
  const coaLinks = Array.isArray(manifest.coa_links) ? manifest.coa_links : [];

  const acceptAction = acceptManifestAction.bind(null, id);
  const rejectAction = rejectManifestAction.bind(null, id);

  return (
    <div>
      <AdminPageHeader
        title={manifest.manifest_number ?? "Vendor manifest"}
        subtitle={`${manifest.vendor_label ?? "Unknown vendor"} · ${manifest.transfer_date ?? "no date"} · ${
          manifest.source_format === "wcia" ? "WCIA transfer" : "generic JSON"
        }${manifest.source_url ? " (fetched by link)" : ""}`}
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Inventory", href: "/admin/inventory" },
              { label: "Vendor intake", href: "/admin/inventory/intake" },
              { label: manifest.manifest_number ?? "Manifest" },
            ]}
          />
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {staged && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-2 text-sm text-[var(--admin-gold)]">
            Manifest staged as a draft. Review the lines below, then accept to activate the lots.
          </div>
        )}
        {accepted && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            Accepted — {accepted} lot{accepted === "1" ? "" : "s"} activated and on hand.
            {drafts && drafts !== "0" && (
              <>
                {" "}
                {drafts} product{drafts === "1" ? "" : "s"} weren&apos;t on the live menu —{" "}
                <Link href="/admin/inventory/drafts" className="font-semibold underline">
                  review {drafts === "1" ? "it" : "them"} as draft{drafts === "1" ? "" : "s"}
                </Link>
                .
              </>
            )}
          </div>
        )}
        {rejected && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
            Manifest rejected — its lots were marked destroyed and will never be sold.
          </div>
        )}
        {error && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
            Something went wrong with that action.
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-5">
          <StatCard label="Lines" value={lots.length} accent="muted" />
          <StatCard label="With COA" value={`${withCoa}/${lots.length}`} accent={missingCoa > 0 ? "orange" : "green"} />
          <StatCard
            label="COAs captured"
            value={coaLinks.length}
            accent={coaLinks.length > 0 ? "green" : "muted"}
            hint="saved to KB"
          />
          <StatCard
            label="Samples ($0)"
            value={sampleCount}
            accent={sampleCount > 0 ? "gold" : "muted"}
            hint="not for resale"
          />
          <StatCard
            label="Status"
            value={manifest.status}
            accent={manifest.status === "accepted" ? "green" : manifest.status === "pending" ? "gold" : "muted"}
          />
        </div>

        {missingCoa > 0 && isPending && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/30 bg-[var(--admin-orange-soft)] px-4 py-3 text-sm text-[var(--admin-orange)]">
            ⚠️ {missingCoa} line{missingCoa === 1 ? "" : "s"} have no COA / lab result. WA CCRS manifest
            reporting needs the COA&apos;s LabtestexternalIdentifier — add it on the lot before selling.
          </div>
        )}

        {/* Parsed lines */}
        <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
              <tr>
                <th className="px-4 py-3">Product / lot</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 text-center">COA</th>
                <th className="px-4 py-3 text-center">Catalog</th>
                <th className="px-4 py-3">Expires</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--admin-border)]">
              {lots.map((l) => (
                <tr key={l.id} className="bg-[var(--admin-surface)]">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/inventory/${l.id}`}
                      className="font-medium text-[var(--admin-text)] hover:text-[var(--admin-accent)]"
                    >
                      {l.product_name ?? "(unnamed)"}
                    </Link>
                    <div className="text-xs text-[var(--admin-text-faint)]">
                      {l.lot_code ?? "no lot code"}
                      {l.strain_name && <span> · {l.strain_name}</span>}
                      {l.is_sample && (
                        <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--admin-text-faint)]">
                          sample
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-[var(--admin-text-muted)]">{fmtQty(l.received_qty, l.unit)}</td>
                  <td className="px-4 py-3 text-center">
                    {l.lab_result_id ? "✅" : <span className="text-[var(--admin-orange)]">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {l.pos_product_key ? "🔗" : <span className="text-[var(--admin-text-faint)]">—</span>}
                  </td>
                  <td className="px-4 py-3 text-[var(--admin-text-muted)]">{l.expires_on ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Captured COAs (knowledge-base snapshot) */}
        {coaLinks.length > 0 && (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
            <h2 className="mb-1 text-sm font-bold text-[var(--admin-text)]">
              Certificates of analysis ({coaLinks.length})
            </h2>
            <p className="mb-4 text-xs text-[var(--admin-text-muted)]">
              Pulled from the single transfer file — no need to open each product&apos;s COA link in the
              email. These references are saved with the manifest.
            </p>
            <div className="overflow-hidden rounded-[var(--admin-radius)] border border-[var(--admin-border)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                  <tr>
                    <th className="px-4 py-2">Product</th>
                    <th className="px-4 py-2">Lab result ID</th>
                    <th className="px-4 py-2">Expires</th>
                    <th className="px-4 py-2 text-right">COA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--admin-border)]">
                  {coaLinks.map((c, i) => (
                    <tr key={`${c.coa_url}-${i}`} className="bg-[var(--admin-surface)]">
                      <td className="px-4 py-2 text-[var(--admin-text)]">{c.product_name ?? "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs text-[var(--admin-text-muted)]">
                        {c.lab_result_id ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-[var(--admin-text-muted)]">{c.expire_date ?? "—"}</td>
                      <td className="px-4 py-2 text-right">
                        <a
                          href={c.coa_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--admin-accent)] hover:underline"
                        >
                          Open ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Accept / reject controls */}
        {isPending ? (
          <div className="flex flex-wrap items-center gap-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
            <p className="flex-1 text-sm text-[var(--admin-text-muted)]">
              Accepting activates these lots (quarantine → active) and logs a receive adjustment for
              each. Rejecting marks them destroyed.
            </p>
            <form action={acceptAction}>
              <Button type="submit" variant="save" size="sm">
                ✓ Accept manifest
              </Button>
            </form>
            <form action={rejectAction}>
              <Button type="submit" variant="subtle" size="sm">
                ✕ Reject
              </Button>
            </form>
          </div>
        ) : (
          <p className="text-sm text-[var(--admin-text-faint)]">
            This manifest has been {manifest.status}. Lots are managed from the inventory list.
          </p>
        )}
      </div>
    </div>
  );
}
