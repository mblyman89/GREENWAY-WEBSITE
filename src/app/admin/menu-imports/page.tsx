import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { SopSheetLink } from "@/components/admin/SopSheetLink";
import { StatCard } from "@/components/admin/StatCard";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { listImports, listVersions, getPublishedVersion, listIntakeStagedVersions } from "@/lib/pos/menu-version";
import { countTestData } from "@/lib/pos/import-service";
import { formatDateTime } from "@/lib/pos/format";
import type { PosImportStatus, MenuVersionStatus } from "@/lib/pos/db-types";
import { withBackParam } from "@/lib/admin/back-link-core";
import { uploadAndStageImport, cleanSlateTestDataAction } from "./actions";

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
  searchParams: Promise<{ error?: string; published?: string; staged?: string; cleaned?: string }>;
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
  let intakeStaged: Awaited<ReturnType<typeof listIntakeStagedVersions>> = [];
  let testCounts = { imports: 0, versions: 0 };
  let loadError: string | null = null;

  try {
    [published, versions, imports, intakeStaged, testCounts] = await Promise.all([
      getPublishedVersion(),
      listVersions(30),
      listImports(30),
      listIntakeStagedVersions(30),
      countTestData().catch(() => ({ imports: 0, versions: 0 })),
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
        breadcrumbs={<Breadcrumbs items={[{ label: "Menu Imports" }]} />}
        help={
          <HelpPanel
            id="menu-imports"
            title="How your menu gets published"
            steps={[
              "Day to day: receive products, approve each one with a price, and it is carried onto a menu draft here automatically — no upload.",
              "Open the draft under 'Menu drafts from receiving' and review what is new vs. your live menu.",
              "Click Publish when it looks right — those products show on the website and become sellable at the register.",
              "One time only: the PRODUCTS + INVENTORIES upload below is for your initial Cultivera import; you will not need it after that.",
            ]}
          >
            <p>
              After the initial Cultivera import, your menu is built from what you
              receive and approve — no more spreadsheet uploads. Prices come from
              your invoices, manifests, and COAs at approval, and stock comes from
              the quantity you received.
            </p>
            <SopSheetLink slug="publish" />
          </HelpPanel>
        }
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
        {params.cleaned && (
          <div className="rounded-lg border border-[#7ed957]/40 bg-[#7ed957]/10 px-4 py-3 text-sm text-[#7ed957]">
            Clean Slate complete — {decodeURIComponent(params.cleaned)} Real data and your knowledge base were untouched.
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

        {/* Menu drafts auto-carried from receiving (intake-origin, no POS upload) */}
        <section className="rounded-xl border border-[#7ed957]/25 bg-[#7ed957]/5 p-5">
          <h2 className="text-sm font-semibold text-white">Menu drafts from receiving</h2>
          <p className="mt-1 text-xs text-white/50">
            When you approve a received product with a price, it&apos;s published to the live menu
            automatically &mdash; <strong>no upload, no publish click needed</strong>. This section is
            the safety net: if an automatic publish ever hiccups, the staged menu update lands here so
            you can press Publish yourself.
          </p>
          {intakeStaged.length === 0 ? (
            <p className="mt-3 text-xs text-white/40">
              Nothing waiting &mdash; every menu update from receiving has published automatically.
            </p>
          ) : (
            <div className="mt-4 divide-y divide-white/10 overflow-hidden rounded-lg border border-white/10">
              {intakeStaged.map((v) => {
                const s = (v.summary_json ?? {}) as {
                  added?: number;
                  carried?: number;
                  merged?: number;
                };
                return (
                  <div
                    key={v.id}
                    className="grid items-center gap-3 px-4 py-3 sm:grid-cols-[1.4fr_1fr_auto]"
                  >
                    <div>
                      <p className="text-sm font-medium text-white">{formatDateTime(v.created_at)}</p>
                      <p className="text-xs text-white/40">
                        {s.added ?? 0} new from receiving
                        {(s.merged ?? 0) > 0 ? <> &middot; {s.merged} restock option(s) merged</> : null} &middot;{" "}
                        {s.carried ?? 0} carried from live menu
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
                      <span className="rounded bg-[#ff7f00]/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-[#ff7f00]">
                        staged
                      </span>
                      {v.item_count} items &middot; {v.variant_count} variants
                      {v.warning_count > 0 && (
                        <span className="text-[#ffd700]">{v.warning_count} to fix</span>
                      )}
                    </div>
                    <Link
                      href={withBackParam(`/admin/menu-imports/version/${v.id}`, params)}
                      className="admin-focus justify-self-end rounded-[var(--admin-radius-sm)] border border-[#7ed957]/50 bg-[#7ed957]/10 px-3 py-1.5 text-xs font-semibold text-[#7ed957] transition hover:bg-[#7ed957]/20"
                    >
                      Review &amp; publish
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </section>

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
              <label className="flex items-center gap-2 text-xs text-white/70">
                <input type="checkbox" name="test_mode" />
                <span>
                  <strong>Test mode</strong> — flag this upload as test/rehearsal data. Test uploads can
                  be wiped later with Clean Slate without touching real data.
                </span>
              </label>
            </div>
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

        {/* Clean Slate — remove only test data */}
        {canPublish && (
          <section className="rounded-xl border border-red-500/25 bg-red-500/5 p-5">
            <h2 className="text-sm font-semibold text-white">Clean Slate — reset test data</h2>
            <p className="mt-1 text-xs text-white/50">
              Permanently deletes <strong>only</strong> the imports and staged menu versions marked as
              test data ({testCounts.imports} test import{testCounts.imports === 1 ? "" : "s"} ·{" "}
              {testCounts.versions} test version{testCounts.versions === 1 ? "" : "s"} right now). It never
              touches your real imports, your published menu, or your validated cannabis knowledge base.
              Published versions are protected even if mis-flagged.
            </p>
            {testCounts.imports === 0 && testCounts.versions === 0 ? (
              <p className="mt-3 text-xs text-white/40">No test data to clean right now.</p>
            ) : (
              <form action={cleanSlateTestDataAction} className="mt-4 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-white/70">
                    Type <code className="rounded bg-black/40 px-1">DELETE TEST DATA</code> to confirm
                  </span>
                  <input
                    name="confirm"
                    type="text"
                    autoComplete="off"
                    placeholder="DELETE TEST DATA"
                    className="w-64 rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white/80"
                  />
                </label>
                <button
                  type="submit"
                  className="rounded-full border border-red-500/50 bg-red-500/10 px-5 py-2 text-sm font-bold text-red-300 transition hover:bg-red-500/20"
                >
                  Wipe test data
                </button>
              </form>
            )}
          </section>
        )}

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
                    {imp.is_test && (
                      <span className="rounded bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-red-300">
                        test
                      </span>
                    )}
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
                    href={withBackParam(`/admin/menu-imports/${imp.id}`, params)}
                    className="admin-focus justify-self-end rounded-[var(--admin-radius-sm)] border border-[var(--admin-border-strong)] px-3 py-1.5 text-xs text-[var(--admin-text-muted)] transition hover:border-[var(--admin-accent)] hover:text-[var(--admin-text)]"
                  >
                    Review
                  </Link>
                </div>
              );
            })}
            {imports.length === 0 && (
              <p className="px-5 py-8 text-sm text-[var(--admin-text-faint)]">
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
