import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BackLink } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { getVersion, getPublishedVersion, diffVersions, getVersionItems } from "@/lib/pos/menu-version";
import { formatDateTime, formatMoney } from "@/lib/pos/format";
import { publishVersion } from "../../actions";

export const dynamic = "force-dynamic";

type IntakeSummary = {
  origin?: string;
  manifest_id?: string;
  carried?: number;
  added?: number;
  merged?: number;
  diagnostics?: { severity: "info" | "warning" | "error"; code: string; message: string }[];
};

/**
 * Review + Publish surface for an INTAKE-ORIGIN staged menu version (import_id
 * IS NULL — auto-carried from an accepted/approved manifest, no POS-export
 * upload). Keyed on the VERSION id (the pos_imports-keyed /[id] page can't show
 * these because there is no import row). Publishing reuses the same gated
 * publishVersion action.
 */
export default async function IntakeVersionReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ versionId: string }>;
  searchParams: Promise<{ error?: string; published?: string; back?: string }>;
}) {
  const session = await requirePermission("menu.import");
  const { versionId } = await params;
  const sp = await searchParams;
  const canPublish = can(session.profile.role, "menu.publish");

  const version = await getVersion(versionId);
  // Only intake-origin (import_id NULL) versions belong on this surface;
  // POS-export versions are reviewed on the /[id] page.
  if (!version || version.import_id !== null) notFound();

  const summary = (version.summary_json ?? {}) as IntakeSummary;

  let published: Awaited<ReturnType<typeof getPublishedVersion>> = null;
  let diff: Awaited<ReturnType<typeof diffVersions>> | null = null;
  let items: Awaited<ReturnType<typeof getVersionItems>> = [];
  try {
    published = await getPublishedVersion();
    diff = await diffVersions(version.id, published?.id ?? null);
    items = await getVersionItems(version.id);
  } catch (err) {
    console.error("[menu-imports/version/:id] load error:", err);
  }

  const diagnostics = Array.isArray(summary.diagnostics) ? summary.diagnostics : [];
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  const info = diagnostics.filter((d) => d.severity === "info");
  const hiddenItems = items.filter((i) => i.hidden).slice(0, 100);
  const hiddenTotal = items.filter((i) => i.hidden).length;
  const isPublished = version.status === "published";

  return (
    <div>
      <AdminPageHeader
        title="Menu draft from receiving"
        subtitle={`Auto-carried ${formatDateTime(version.created_at)} \u00b7 ${summary.added ?? 0} new card(s)${(summary.merged ?? 0) > 0 ? ` + ${summary.merged} restock option(s)` : ""} on top of ${summary.carried ?? 0} live item(s)`}
        action={
          <BackLink
            fallback="/admin/menu-imports"
            back={sp.back}
            className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/80 hover:border-[#7ed957] hover:text-white"
          >
            &larr; All menu updates
          </BackLink>
        }
      />

      <div className="space-y-8 px-5 py-6 sm:px-8">
        {sp.error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {decodeURIComponent(sp.error)}
          </div>
        )}
        {sp.published && (
          <div className="rounded-lg border border-[#7ed957]/40 bg-[#7ed957]/10 px-4 py-3 text-sm text-[#7ed957]">
            Published. The public menu now reflects this version and these products are sellable in the POS.
          </div>
        )}

        <div className="rounded-xl border border-[#7ed957]/25 bg-[#7ed957]/5 p-4 text-sm text-white/70">
          These products came in through <strong>receiving</strong> and were approved with a price.
          They&apos;ve been carried onto a copy of your current live menu so you can review and publish
          them &mdash; <strong>no Menu Imports upload needed</strong>. Publishing makes them show on the
          website and become sellable at the register.
        </div>

        {/* Summary cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="New from receiving" value={summary.added ?? 0} accent="green" />
          <StatCard label="Restocks merged into cards" value={summary.merged ?? 0} accent="green" />
          <StatCard label="Carried from live menu" value={summary.carried ?? 0} accent="muted" />
          <StatCard label="Total items" value={version.item_count} accent="muted" />
          <StatCard
            label="Hidden"
            value={version.hidden_count}
            hint="Excluded from public menu"
            accent="orange"
          />
        </div>

        {/* Diff vs published */}
        {diff && (
          <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
            <h2 className="text-sm font-semibold text-white">
              Changes vs. live menu
              {!published && (
                <span className="ml-2 text-xs font-normal text-white/40">(no live menu yet &mdash; everything is new)</span>
              )}
            </h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-4">
              <DiffStat label="New products" value={diff.added.length} accent="text-[#7ed957]" />
              <DiffStat label="Price changes" value={diff.priceChanged.length} accent="text-[#ffd700]" />
              <DiffStat label="Removed" value={diff.removed.length} accent="text-red-400" />
              <DiffStat label="Unchanged" value={diff.unchangedCount} accent="text-white/50" />
            </div>

            {diff.added.length > 0 && (
              <details className="mt-4" open>
                <summary className="cursor-pointer text-xs font-semibold text-[#7ed957]">
                  New products from receiving ({diff.added.length})
                </summary>
                <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-white/10">
                  {diff.added.slice(0, 200).map((d) => (
                    <div key={d.sourceId} className="border-b border-white/5 px-3 py-1.5 text-xs text-white/70">
                      {d.name} <span className="text-white/40">&middot; {d.brand} &middot; {d.category}</span> &middot;{" "}
                      {formatMoney(d.newPrice ?? 0)}
                    </div>
                  ))}
                </div>
              </details>
            )}
            {diff.priceChanged.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-semibold text-[#ffd700]">
                  Price changes ({diff.priceChanged.length})
                </summary>
                <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-white/10">
                  {diff.priceChanged.slice(0, 200).map((d) => (
                    <div
                      key={d.sourceId}
                      className="flex items-center justify-between border-b border-white/5 px-3 py-1.5 text-xs"
                    >
                      <span className="text-white/80">
                        {d.name} <span className="text-white/40">&middot; {d.brand}</span>
                      </span>
                      <span className="text-white/60">
                        {formatMoney(d.oldPrice ?? 0)} &rarr;{" "}
                        <span className="text-white">{formatMoney(d.newPrice ?? 0)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </section>
        )}

        {/* Diagnostics from the auto-carry planner */}
        {diagnostics.length > 0 && (
          <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">What happened when we carried these over</h2>
              <div className="flex gap-3 text-xs">
                <span className="text-[#ffd700]">{warnings.length} to fix</span>
                <span className="text-white/50">{info.length} info</span>
              </div>
            </div>
            <div className="mt-3 space-y-1.5">
              {warnings.slice(0, 100).map((d, i) => (
                <div
                  key={`w-${i}`}
                  className="rounded-lg border border-[#ffd700]/30 bg-[#ffd700]/5 px-3 py-2 text-xs text-[#ffd700]"
                >
                  {d.message}
                </div>
              ))}
              {warnings.length === 0 && (
                <p className="text-sm text-white/50">No issues &mdash; every approved product carried over cleanly.</p>
              )}
            </div>
          </section>
        )}

        {/* Hidden items */}
        {hiddenTotal > 0 && (
          <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
            <h2 className="text-sm font-semibold text-white">Hidden items ({hiddenTotal})</h2>
            <p className="mt-1 text-xs text-white/40">
              Excluded from the public menu (e.g. unmapped category, no price, or no inventory). Showing
              first {hiddenItems.length}.
            </p>
            <div className="mt-3 max-h-96 overflow-auto rounded-lg border border-white/10">
              {hiddenItems.map((i) => (
                <div
                  key={i.id}
                  className="flex items-center justify-between border-b border-white/5 px-3 py-1.5 text-xs"
                >
                  <span className="text-white/80">
                    {i.name} <span className="text-white/40">&middot; {i.brand_name} &middot; {i.category}</span>
                  </span>
                  <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] uppercase text-white/50">
                    {i.hidden_reason ?? "hidden"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Publish */}
        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <h2 className="text-sm font-semibold text-white">Publish</h2>
          {isPublished ? (
            <p className="mt-2 text-sm text-[#7ed957]">
              This version is live (published {formatDateTime(version.published_at)}).
            </p>
          ) : !canPublish ? (
            <p className="mt-2 text-sm text-white/50">
              Review looks good. A manager or admin must publish to make this menu live.
            </p>
          ) : (
            <form action={publishVersion} className="mt-3">
              <input type="hidden" name="versionId" value={version.id} />
              <p className="mb-3 text-xs text-white/50">
                Publishing replaces the current live menu with this version and refreshes the public
                site. The previous version is archived (not deleted).
              </p>
              <button
                type="submit"
                className="rounded-full bg-[#7ed957] px-6 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
              >
                Publish this menu live
              </button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}

function DiffStat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-lg border border-white/10 p-3">
      <p className="text-[11px] uppercase tracking-wide text-white/45">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accent}`}>{value}</p>
    </div>
  );
}
