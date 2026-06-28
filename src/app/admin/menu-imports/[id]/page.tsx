import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCard } from "@/components/admin/StatCard";
import {
  getImport,
  getImportDiagnostics,
  listVersions,
  getPublishedVersion,
  diffVersions,
  getVersionItems,
} from "@/lib/pos/menu-version";
import { formatDateTime, formatMoney, formatBytes } from "@/lib/pos/format";
import type { DiagnosticSeverity } from "@/lib/pos/db-types";
import { publishVersion } from "../actions";

export const dynamic = "force-dynamic";

const SEVERITY_STYLE: Record<DiagnosticSeverity, string> = {
  error: "border-red-500/40 bg-red-500/5 text-red-300",
  warning: "border-[#ffd700]/30 bg-[#ffd700]/5 text-[#ffd700]",
  info: "border-white/10 bg-white/[0.02] text-white/60",
};

export default async function ImportReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; published?: string; staged?: string }>;
}) {
  const session = await requirePermission("menu.import");
  const { id } = await params;
  const sp = await searchParams;
  const canPublish = can(session.profile.role, "menu.publish");

  const imp = await getImport(id);
  if (!imp) notFound();

  // All helpers below self-protect (return safe defaults on failure), but we
  // still guard the orchestration so the review screen never white-screens.
  let versions: Awaited<ReturnType<typeof listVersions>> = [];
  let published: Awaited<ReturnType<typeof getPublishedVersion>> = null;
  let diagnostics: Awaited<ReturnType<typeof getImportDiagnostics>> = [];
  let diff: Awaited<ReturnType<typeof diffVersions>> | null = null;
  let items: Awaited<ReturnType<typeof getVersionItems>> = [];

  try {
    [versions, published, diagnostics] = await Promise.all([
      listVersions(50),
      getPublishedVersion(),
      getImportDiagnostics(id, { limit: 2000 }),
    ]);
  } catch (err) {
    console.error("[menu-imports/:id] load error:", err);
  }
  const version = versions.find((v) => v.import_id === id) ?? null;

  // Diff this staged version against the currently-published one.
  if (version) {
    try {
      diff = await diffVersions(version.id, published?.id ?? null);
    } catch (err) {
      console.error("[menu-imports/:id] diff error:", err);
    }
  }

  // Group diagnostics by severity, then by code (collapse repetitive codes).
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  const info = diagnostics.filter((d) => d.severity === "info");

  const codeSummary = summarizeByCode(diagnostics);

  // Hidden items (first 100) for review.
  if (version) {
    try {
      items = await getVersionItems(version.id);
    } catch (err) {
      console.error("[menu-imports/:id] items error:", err);
    }
  }
  const hiddenItems = items.filter((i) => i.hidden).slice(0, 100);
  const hiddenTotal = items.filter((i) => i.hidden).length;

  const blocked = (version?.error_count ?? 0) > 0;

  return (
    <div>
      <AdminPageHeader
        title="Import Review"
        subtitle={`Imported ${formatDateTime(imp.created_at)} · status ${imp.status}`}
        action={
          <Link
            href="/admin/menu-imports"
            className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/80 hover:border-[#7ed957] hover:text-white"
          >
            ← All imports
          </Link>
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
            Published. The public menu now reflects this version.
          </div>
        )}

        {/* Summary cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Menu items" value={version?.item_count ?? 0} accent="green" />
          <StatCard label="Variants" value={version?.variant_count ?? 0} accent="muted" />
          <StatCard label="Vendors" value={version?.vendor_count ?? 0} accent="muted" />
          <StatCard
            label="Hidden"
            value={version?.hidden_count ?? 0}
            hint="Excluded from public menu"
            accent="orange"
          />
        </div>

        {/* Source files */}
        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <h2 className="text-sm font-semibold text-white">Source files</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 text-xs text-white/60">
            <div className="rounded-lg border border-white/10 p-3">
              <p className="font-medium text-white">{imp.products_filename ?? "PRODUCTS.xlsx"}</p>
              <p>{formatBytes(imp.products_size_bytes)}</p>
              <p className="mt-1 break-all text-white/30">hash {imp.products_file_hash?.slice(0, 16)}…</p>
            </div>
            <div className="rounded-lg border border-white/10 p-3">
              <p className="font-medium text-white">{imp.inventories_filename ?? "INVENTORIES.xlsx"}</p>
              <p>{formatBytes(imp.inventories_size_bytes)}</p>
              <p className="mt-1 break-all text-white/30">hash {imp.inventories_file_hash?.slice(0, 16)}…</p>
            </div>
          </div>
        </section>

        {/* Diff vs published */}
        {diff && (
          <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
            <h2 className="text-sm font-semibold text-white">
              Changes vs. live menu
              {!published && <span className="ml-2 text-xs font-normal text-white/40">(no live menu yet — everything is new)</span>}
            </h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-4">
              <DiffStat label="New products" value={diff.added.length} accent="text-[#7ed957]" />
              <DiffStat label="Price changes" value={diff.priceChanged.length} accent="text-[#ffd700]" />
              <DiffStat label="Removed" value={diff.removed.length} accent="text-red-400" />
              <DiffStat label="Unchanged" value={diff.unchangedCount} accent="text-white/50" />
            </div>

            {diff.priceChanged.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-xs font-semibold text-[#ffd700]">
                  Price changes ({diff.priceChanged.length})
                </summary>
                <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-white/10">
                  {diff.priceChanged.slice(0, 200).map((d) => (
                    <div key={d.sourceId} className="flex items-center justify-between border-b border-white/5 px-3 py-1.5 text-xs">
                      <span className="text-white/80">{d.name} <span className="text-white/40">· {d.brand}</span></span>
                      <span className="text-white/60">
                        {formatMoney(d.oldPrice ?? 0)} → <span className="text-white">{formatMoney(d.newPrice ?? 0)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}
            {diff.removed.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-semibold text-red-400">
                  Removed products ({diff.removed.length})
                </summary>
                <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-white/10">
                  {diff.removed.slice(0, 200).map((d) => (
                    <div key={d.sourceId} className="border-b border-white/5 px-3 py-1.5 text-xs text-white/70">
                      {d.name} <span className="text-white/40">· {d.brand} · {d.category}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
            {diff.added.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-semibold text-[#7ed957]">
                  New products ({diff.added.length})
                </summary>
                <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-white/10">
                  {diff.added.slice(0, 200).map((d) => (
                    <div key={d.sourceId} className="border-b border-white/5 px-3 py-1.5 text-xs text-white/70">
                      {d.name} <span className="text-white/40">· {d.brand} · {d.category}</span> · {formatMoney(d.newPrice ?? 0)}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </section>
        )}

        {/* Diagnostics */}
        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Diagnostics</h2>
            <div className="flex gap-3 text-xs">
              <span className="text-red-400">{errors.length} errors</span>
              <span className="text-[#ffd700]">{warnings.length} warnings</span>
              <span className="text-white/50">{info.length} info</span>
            </div>
          </div>

          {codeSummary.length > 0 ? (
            <div className="mt-3 space-y-1.5">
              {codeSummary.map((c) => (
                <div
                  key={`${c.severity}-${c.code}`}
                  className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-xs ${SEVERITY_STYLE[c.severity]}`}
                >
                  <div>
                    <span className="font-mono font-semibold">{c.code}</span>
                    <span className="ml-2 opacity-80">{c.sample}</span>
                  </div>
                  <span className="shrink-0 rounded bg-black/30 px-2 py-0.5 font-semibold">×{c.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-white/50">No diagnostics — clean import.</p>
          )}
        </section>

        {/* Hidden items */}
        {hiddenTotal > 0 && (
          <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
            <h2 className="text-sm font-semibold text-white">
              Hidden items ({hiddenTotal})
            </h2>
            <p className="mt-1 text-xs text-white/40">
              These are excluded from the public menu (e.g. unmapped category, no price, or no
              inventory). Showing first {hiddenItems.length}.
            </p>
            <div className="mt-3 max-h-96 overflow-auto rounded-lg border border-white/10">
              {hiddenItems.map((i) => (
                <div key={i.id} className="flex items-center justify-between border-b border-white/5 px-3 py-1.5 text-xs">
                  <span className="text-white/80">
                    {i.name} <span className="text-white/40">· {i.brand_name} · {i.category}</span>
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
          {version?.status === "published" ? (
            <p className="mt-2 text-sm text-[#7ed957]">
              This version is live (published {formatDateTime(version.published_at)}).
            </p>
          ) : blocked ? (
            <p className="mt-2 text-sm text-red-400">
              This import has {version?.error_count} blocking error(s). Resolve the source data and
              re-import before publishing.
            </p>
          ) : !canPublish ? (
            <p className="mt-2 text-sm text-white/50">
              Review looks good. A manager or admin must publish to make this menu live.
            </p>
          ) : (
            <form action={publishVersion} className="mt-3">
              <input type="hidden" name="versionId" value={version?.id ?? ""} />
              <input type="hidden" name="importId" value={imp.id} />
              <p className="mb-3 text-xs text-white/50">
                Publishing replaces the current live menu with this version and refreshes the public
                site. The previous version is archived (not deleted).
              </p>
              <button
                type="submit"
                disabled={!version}
                className="rounded-full bg-[#7ed957] px-6 py-2.5 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-40"
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

type CodeSummary = { severity: DiagnosticSeverity; code: string; count: number; sample: string };

function summarizeByCode(
  diagnostics: { severity: DiagnosticSeverity; code: string; message: string }[],
): CodeSummary[] {
  const map = new Map<string, CodeSummary>();
  const rank: Record<DiagnosticSeverity, number> = { error: 0, warning: 1, info: 2 };
  for (const d of diagnostics) {
    const key = `${d.severity}|${d.code}`;
    const existing = map.get(key);
    if (existing) existing.count += 1;
    else map.set(key, { severity: d.severity, code: d.code, count: 1, sample: d.message });
  }
  return [...map.values()].sort(
    (a, b) => rank[a.severity] - rank[b.severity] || b.count - a.count,
  );
}
