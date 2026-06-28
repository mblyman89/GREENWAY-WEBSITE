import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { listImports, listVersions, getPublishedVersion } from "@/lib/pos/menu-version";
import { formatDateTime } from "@/lib/pos/format";
import type { PosImportStatus, MenuVersionStatus } from "@/lib/pos/db-types";
import { uploadAndStageImport } from "./actions";

export const dynamic = "force-dynamic";

const IMPORT_STATUS_STYLE: Record<PosImportStatus, string> = {
  uploaded: "bg-white/10 text-white/70",
  processing: "bg-[#ffd700]/15 text-[#ffd700]",
  staged: "bg-[#ff7f00]/15 text-[#ff7f00]",
  published: "bg-[#7ed957]/15 text-[#7ed957]",
  failed: "bg-red-500/15 text-red-400",
};

const VERSION_STATUS_STYLE: Record<MenuVersionStatus, string> = {
  staged: "bg-[#ff7f00]/15 text-[#ff7f00]",
  published: "bg-[#7ed957]/15 text-[#7ed957]",
  archived: "bg-white/10 text-white/50",
};

export default async function MenuImportsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; published?: string; staged?: string }>;
}) {
  const session = await requirePermission("menu.import");
  const params = await searchParams;
  const canPublish = can(session.profile.role, "menu.publish");

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Menu Imports" subtitle="Upload POS exports and publish the live menu." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-xl border border-[#ffd700]/30 bg-[#ffd700]/5 p-5 text-sm text-[#ffd700]">
            Supabase service-role key is not configured yet. Add the env vars from
            <code className="mx-1 rounded bg-black/40 px-1">docs/BACK_OFFICE_SETUP.md</code>
            to enable menu imports.
          </div>
        </div>
      </div>
    );
  }

  // Load page data defensively. Each helper already returns safe defaults on
  // failure, but we wrap the whole load so a single unexpected throw renders a
  // friendly diagnostic card instead of the full-page "did not load" error.
  let published: Awaited<ReturnType<typeof getPublishedVersion>> = null;
  let versions: Awaited<ReturnType<typeof listVersions>> = [];
  let imports: Awaited<ReturnType<typeof listImports>> = [];
  let loadError: string | null = null;

  try {
    [published, versions, imports] = await Promise.all([
      getPublishedVersion(),
      listVersions(30),
      listImports(30),
    ]);
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Could not load menu data.";
    console.error("[menu-imports] page load error:", err);
  }

  return (
    <div>
      <AdminPageHeader
        title="Menu Imports"
        subtitle="Upload PRODUCTS.xlsx + INVENTORIES.xlsx, review the staged menu, then publish it live."
      />

      <div className="space-y-8 px-5 py-6 sm:px-8">
        {loadError && (
          <div className="rounded-xl border border-[#ffd700]/30 bg-[#ffd700]/5 p-5 text-sm text-[#ffd700]">
            <p className="font-semibold">We couldn&apos;t load your existing menu history just now.</p>
            <p className="mt-1 text-[#ffd700]/80">
              This is usually a brief connection hiccup — your data is safe. You can still upload below,
              or reload the page in a moment. (Technical detail: {loadError})
            </p>
          </div>
        )}
        {params.error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {decodeURIComponent(params.error)}
          </div>
        )}
        {params.published && (
          <div className="rounded-lg border border-[#7ed957]/40 bg-[#7ed957]/10 px-4 py-3 text-sm text-[#7ed957]">
            Menu published. The public site now reflects this version.
          </div>
        )}
        {params.staged && (
          <div className="rounded-lg border border-[#ff7f00]/40 bg-[#ff7f00]/10 px-4 py-3 text-sm text-[#ff7f00]">
            Import staged for review. Check the diagnostics and diff below, then publish.
          </div>
        )}

        {/* Live status */}
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Live menu version"
            value={published ? `${published.item_count}` : "None"}
            hint={published ? `Published ${formatDateTime(published.published_at)}` : "No version published yet"}
            accent={published ? "green" : "muted"}
          />
          <StatCard
            label="Live variants"
            value={published ? `${published.variant_count}` : "—"}
            hint={published ? `${published.vendor_count} vendors` : "—"}
            accent="muted"
          />
          <StatCard
            label="Staged drafts"
            value={`${versions.filter((v) => v.status === "staged").length}`}
            hint="Awaiting review / publish"
            accent="orange"
          />
        </div>

        {/* Upload */}
        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <h2 className="text-sm font-semibold text-white">Upload a new POS export</h2>
          <p className="mt-1 text-xs text-white/40">
            Select the two spreadsheets exported from your POS. We&apos;ll transform them into a
            staged menu you can review before anything goes live. Nothing publishes automatically.
          </p>
          <form action={uploadAndStageImport} className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-white/70">PRODUCTS.xlsx</span>
              <input
                name="products"
                type="file"
                accept=".xlsx,.xls"
                required
                className="rounded-lg border border-white/15 bg-black px-3 py-2.5 text-sm text-white/80 file:mr-3 file:rounded file:border-0 file:bg-[#7ed957] file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-black"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-white/70">INVENTORIES.xlsx</span>
              <input
                name="inventories"
                type="file"
                accept=".xlsx,.xls"
                required
                className="rounded-lg border border-white/15 bg-black px-3 py-2.5 text-sm text-white/80 file:mr-3 file:rounded file:border-0 file:bg-[#7ed957] file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-black"
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                className="rounded-full bg-[#ff7f00] px-6 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
              >
                Upload &amp; stage for review
              </button>
            </div>
          </form>
        </section>

        {/* Versions / history */}
        <section className="overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0a]">
          <div className="border-b border-white/10 px-5 py-3 text-sm font-semibold text-white">
            Import history
          </div>
          <div className="divide-y divide-white/10">
            {imports.map((imp) => {
              const version = versions.find((v) => v.import_id === imp.id);
              return (
                <div
                  key={imp.id}
                  className="grid items-center gap-3 px-5 py-4 sm:grid-cols-[1.4fr_1fr_1fr_auto]"
                >
                  <div>
                    <p className="text-sm font-medium text-white">{formatDateTime(imp.created_at)}</p>
                    <p className="text-xs text-white/40">
                      {imp.products_filename ?? "PRODUCTS"} + {imp.inventories_filename ?? "INVENTORIES"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${IMPORT_STATUS_STYLE[imp.status] ?? "bg-white/10 text-white/70"}`}>
                      {imp.status}
                    </span>
                    {version && (
                      <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${VERSION_STATUS_STYLE[version.status] ?? "bg-white/10 text-white/50"}`}>
                        v: {version.status}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-white/60">
                    {version ? (
                      <>
                        {version.item_count} items · {version.variant_count} variants
                        {version.error_count > 0 && (
                          <span className="ml-2 text-red-400">{version.error_count} err</span>
                        )}
                        {version.warning_count > 0 && (
                          <span className="ml-2 text-[#ffd700]">{version.warning_count} warn</span>
                        )}
                      </>
                    ) : imp.error_message ? (
                      <span className="text-red-400">{imp.error_message.slice(0, 60)}</span>
                    ) : (
                      "—"
                    )}
                  </div>
                  <Link
                    href={`/admin/menu-imports/${imp.id}`}
                    className="justify-self-end rounded-md border border-white/15 px-3 py-1.5 text-xs text-white/80 hover:border-[#7ed957] hover:text-white"
                  >
                    Review
                  </Link>
                </div>
              );
            })}
            {imports.length === 0 && (
              <p className="px-5 py-8 text-sm text-white/50">
                No imports yet. Upload your first POS export above to stage a menu.
              </p>
            )}
          </div>
        </section>

        {!canPublish && (
          <p className="text-xs text-white/40">
            Your role can upload and review imports, but publishing the live menu requires a manager
            or admin.
          </p>
        )}
      </div>
    </div>
  );
}
