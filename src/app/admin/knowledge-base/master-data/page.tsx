import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import Link from "next/link";
import { getMasterDataTree } from "@/lib/ai/kb/master-data";
import { KbFlash } from "../KbFlash";

export const dynamic = "force-dynamic";

function ImagePill({ hasImage }: { hasImage: boolean }) {
  // DAM coverage signal: real logo/hero OR an active KB image substitute.
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={
        hasImage
          ? {
              borderColor: "var(--admin-border)",
              background: "var(--admin-accent-soft)",
              color: "var(--admin-accent)",
            }
          : {
              borderColor: "var(--admin-orange-soft)",
              background: "var(--admin-orange-soft)",
              color: "var(--admin-orange)",
            }
      }
      title={hasImage ? "Has image (logo/hero or fallback)" : "No image or fallback — would render blank"}
    >
      <span aria-hidden>{hasImage ? "\u2713" : "\u25CB"}</span>
      {hasImage ? "Image" : "No image"}
    </span>
  );
}

function CompletenessPill({ pct }: { pct: number }) {
  const color =
    pct >= 85
      ? "var(--admin-accent)"
      : pct >= 65
        ? "var(--admin-gold)"
        : pct >= 40
          ? "var(--admin-orange)"
          : "var(--admin-danger, #d9534f)";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--admin-border)] bg-[var(--admin-bg)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-[var(--admin-text)]"
      title={`${pct}% complete`}
    >
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: color }} />
      {pct}%
    </span>
  );
}

export default async function KbMasterDataPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  await requirePermission("products.enrich");
  const { msg, error } = await searchParams;

  const tree = await getMasterDataTree();

  return (
    <div>
      <AdminPageHeader
        title="Master data"
        subtitle="Your Vendor → Brand → Product hierarchy — the backbone of the knowledge base"
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Knowledge Base", href: "/admin/knowledge-base" },
              { label: "Master data" },
            ]}
          />
        }
      />
      <div className="px-5 py-6 sm:px-8 space-y-6">
        <KbFlash msg={msg} error={error} />

        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Vendors", value: tree.totals.vendors },
            { label: "Brands", value: tree.totals.brands },
            { label: "Published products", value: tree.totals.products },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4"
            >
              <div className="text-xs font-medium text-[var(--admin-text-muted)]">{s.label}</div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-[var(--admin-text)]">
                {s.value.toLocaleString()}
              </div>
            </div>
          ))}
        </div>

        <p className="text-sm text-[var(--admin-text-muted)]">
          Vendors and brands are edited on the{" "}
          <Link href="/admin/vendors" className="text-[var(--admin-accent)] underline">
            Vendors page
          </Link>
          ; brand voice/style facts live under{" "}
          <Link href="/admin/knowledge-base/brands" className="text-[var(--admin-accent)] underline">
            Brand facts
          </Link>
          . This view shows how they connect and where data is thin.
        </p>

        {tree.vendors.length === 0 && tree.orphanBrands.length === 0 ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-6 text-sm text-[var(--admin-text-muted)]">
            No vendors or brands yet. Import them from the{" "}
            <Link href="/admin/vendors" className="text-[var(--admin-accent)] underline">
              Vendors page
            </Link>
            .
          </div>
        ) : (
          <div className="space-y-3">
            {tree.vendors.map((v) => (
              <section
                key={v.id}
                className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/admin/vendors/${v.slug}`}
                      className="text-sm font-semibold text-[var(--admin-text)] hover:underline"
                    >
                      {v.name}
                    </Link>
                    <CompletenessPill pct={v.completeness} />
                    <ImagePill hasImage={v.hasImage} />
                    <span className="text-xs text-[var(--admin-text-muted)]">
                      {v.brandCount} brand{v.brandCount === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>

                {v.brands.length > 0 ? (
                  <ul className="mt-3 space-y-1.5 border-l border-[var(--admin-border)] pl-4">
                    {v.brands.map((b) => (
                      <li key={b.id} className="flex flex-wrap items-center gap-3 text-sm">
                        <span className="text-[var(--admin-text)]">{b.name}</span>
                        <CompletenessPill pct={b.completeness} />
                        <ImagePill hasImage={b.hasImage} />
                        <span className="text-xs text-[var(--admin-text-muted)]">
                          {b.productCount} product{b.productCount === 1 ? "" : "s"}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 pl-4 text-xs text-[var(--admin-text-faint)]">
                    No brands linked to this vendor yet.
                  </p>
                )}
              </section>
            ))}

            {tree.orphanBrands.length > 0 ? (
              <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-orange)]/30 bg-[var(--admin-surface)] p-4">
                <h2 className="text-sm font-semibold text-[var(--admin-text)]">
                  Brands without a vendor ({tree.orphanBrands.length})
                </h2>
                <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                  Link these to a vendor on the Vendors page to complete the hierarchy.
                </p>
                <ul className="mt-3 space-y-1.5">
                  {tree.orphanBrands.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center gap-3 text-sm">
                      <span className="text-[var(--admin-text)]">{b.name}</span>
                      <CompletenessPill pct={b.completeness} />
                      <ImagePill hasImage={b.hasImage} />
                      <span className="text-xs text-[var(--admin-text-muted)]">
                        {b.productCount} product{b.productCount === 1 ? "" : "s"}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
