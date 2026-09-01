import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BackLink } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui";
import { StatCard } from "@/components/admin/StatCard";
import {
  getImport,
  getImportDiagnosticsChecked,
  listVersions,
  getPublishedVersion,
  diffVersions,
  getVersionItems,
} from "@/lib/pos/menu-version";
import type { ReadCompletenessVerdict } from "@/lib/supabase/read-completeness-core";
import { formatDateTime, formatMoney, formatBytes } from "@/lib/pos/format";
import type { DiagnosticSeverity } from "@/lib/pos/db-types";
import { listFactReviews, factReviewsToResolutions } from "@/lib/pos/fact-review-store";
import {
  REVIEW_DIAGNOSTIC_CODES,
  buildFactReviewBuckets,
  menuItemRowToFactReviewItem,
  posDiagnosticToFactReviewDiagnostic,
} from "@/lib/pos/fact-review-core";
import { evaluateCommitGate } from "@/lib/pos/import-commit-core";
import { buildPublishVerdict, type PublishVerdict } from "@/lib/pos/publish-guard-core";
import { publishVersion, backfillLotsAction } from "../actions";

const VERDICT_STYLE: Record<PublishVerdict["level"], string> = {
  safe: "border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 text-[var(--admin-accent)]",
  caution: "border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 text-[var(--admin-gold)]",
  danger: "border-red-500/40 bg-red-500/10 text-red-300",
};

export const dynamic = "force-dynamic";

const SEVERITY_STYLE: Record<DiagnosticSeverity, string> = {
  error: "border-red-500/40 bg-red-500/5 text-red-300",
  warning: "border-[var(--admin-gold)]/30 bg-[var(--admin-gold)]/5 text-[var(--admin-gold)]",
  info: "border-white/10 bg-white/[0.02] text-white/60",
};

export default async function ImportReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; published?: string; staged?: string; back?: string; backfilled?: string }>;
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
  let diagnostics: Awaited<ReturnType<typeof getImportDiagnosticsChecked>>["rows"] = [];
  // SLICE 6A: this screen previews the publish gate. If its diagnostics read is
  // short, the preview disagrees with the real gate -- which is exactly what
  // happened: the preview said 11 pending, the gate refused on 614.
  let diagVerdict: ReadCompletenessVerdict | null = null;
  let diff: Awaited<ReturnType<typeof diffVersions>> | null = null;
  let items: Awaited<ReturnType<typeof getVersionItems>> = [];
  let factReviews: Awaited<ReturnType<typeof listFactReviews>> = [];

  try {
    const [v, p, d, fr] = await Promise.all([
      listVersions(50),
      getPublishedVersion(),
      // SLICE 6A: `{ limit: 5000 }` did NOT match the server-side gate, despite
      // the SLICE 58 comment that said it did. `.limit()` cannot raise
      // PostgREST's `db.max_rows` (1,000), while the gate calls
      // `getImportDiagnostics(importId)` with NO limit and pages everything.
      // The preview and the gate were reading 1,000 vs 6,603 rows -- so the
      // preview lied in exactly the way that comment promised it would not.
      getImportDiagnosticsChecked(id),
      listFactReviews(id),
    ]);
    versions = v;
    published = p;
    diagnostics = d.rows;
    diagVerdict = d.verdict;
    factReviews = fr;
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

  // SLICE 57: how many diagnostics feed the golden-record exception queue,
  // and how many decisions are already saved for this import.
  const factFlagCount = diagnostics.filter((d) => REVIEW_DIAGNOSTIC_CODES.has(d.code)).length;
  const factDecidedCount = factReviews.length;

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

  // SLICE 76 — plain-English safety verdict: is publishing this draft safe?
  // Only meaningful while the version is still staged (published/archived
  // versions aren't a publish decision anymore).
  const verdict =
    version && version.status === "staged" && diff
      ? buildPublishVerdict({
          added: diff.added.length,
          removed: diff.removed.length,
          priceChanged: diff.priceChanged.length,
          unchanged: diff.unchangedCount,
          hasLiveMenu: Boolean(published),
          stagedCreatedAt: version.created_at,
          publishedCreatedAt: published?.created_at ?? null,
        })
      : null;

  // SLICE 58: preview the commit gate (Rule 3.1) so the reviewer sees the
  // publish verdict BEFORE clicking -- pending fact reviews refuse the commit
  // and the balanced Rule 3.3 equation is shown when the gate is open. The
  // server-side publish path re-evaluates the same gate on fresh reads.
  const gate = evaluateCommitGate(
    buildFactReviewBuckets(
      items.map(menuItemRowToFactReviewItem),
      diagnostics.map(posDiagnosticToFactReviewDiagnostic),
      factReviewsToResolutions(factReviews),
    ),
  );

  // SLICE 46: the compliance lot plan computed at staging time (persisted in
  // summary_json.lotPlan). Older imports staged before this feature have none.
  const lotPlan = ((version?.summary_json ?? {}) as {
    lotPlan?: {
      lotsPlanned?: number;
      unitsTotal?: number;
      coaMissing?: number;
      expirationMissing?: number;
    };
  }).lotPlan ?? null;

  // T-327 (Slice 1): has this import already minted its compliance lots? The
  // lot-creation routine writes an `import_lots_created` (or, on a repeat,
  // `import_lots_already_created`) info diagnostic. If NEITHER is present and
  // the version is published + non-test, the import predates lot creation (or
  // was published before the feature) and the owner can BACKFILL its lots.
  const hasCreatedLots = diagnostics.some(
    (d) => d.code === "import_lots_created" || d.code === "import_lots_already_created",
  );
  const canBackfillLots =
    canPublish &&
    version?.status === "published" &&
    !imp.is_test &&
    !hasCreatedLots;

  return (
    <div>
      <AdminPageHeader
        title="Import Review"
        subtitle={`Imported ${formatDateTime(imp.created_at)} · status ${imp.status}`}
        action={
          <BackLink
            fallback="/admin/menu-imports"
            back={sp.back}
            className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/80 hover:border-[var(--admin-accent)] hover:text-white"
          >
            ← All imports
          </BackLink>
        }
      />

      <div className="space-y-8 px-5 py-6 sm:px-8">
        {sp.backfilled && (
          <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-accent)]">
            {decodeURIComponent(sp.backfilled)}
          </div>
        )}
        {sp.error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {decodeURIComponent(sp.error)}
          </div>
        )}
        {sp.published && (
          <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-accent)]">
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

        {/* SLICE 76 — the safety verdict, front and center. */}
        {verdict && (
          <div className={`rounded-xl border p-4 text-sm ${VERDICT_STYLE[verdict.level]}`}>
            <p className="font-semibold">{verdict.headline}</p>
            <p className="mt-1 opacity-90">{verdict.detail}</p>
          </div>
        )}

        {/* Diff vs published */}
        {diff && (
          <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
            <h2 className="text-sm font-semibold text-white">
              Changes vs. live menu
              {!published && <span className="ml-2 text-xs font-normal text-white/40">(no live menu yet — everything is new)</span>}
            </h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-4">
              <DiffStat label="New products" value={diff.added.length} accent="text-[var(--admin-accent)]" />
              <DiffStat label="Price changes" value={diff.priceChanged.length} accent="text-[var(--admin-gold)]" />
              <DiffStat label="Removed" value={diff.removed.length} accent="text-red-400" />
              <DiffStat label="Unchanged" value={diff.unchangedCount} accent="text-white/50" />
            </div>

            {diff.priceChanged.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-xs font-semibold text-[var(--admin-gold)]">
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
                <summary className="cursor-pointer text-xs font-semibold text-[var(--admin-accent)]">
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

        {/* Fact review — golden-record exception queue (SLICE 57) */}
        <section className="rounded-xl border border-[var(--admin-gold)]/25 bg-[var(--admin-gold)]/[0.03] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-white">Fact review</h2>
              <p className="mt-1 text-xs text-white/50">
                The dry-run report: every staged row lands in exactly one bucket — auto-accepted,
                needs-review, or rejected — with its facts, sources, confidence, and plain-English
                notes. {factFlagCount} flag{factFlagCount === 1 ? "" : "s"} raised
                {factDecidedCount > 0 ? ` · ${factDecidedCount} decision${factDecidedCount === 1 ? "" : "s"} saved` : ""}.
                Nothing uncertain goes live without a named human decision.
              </p>
            </div>
            <Button href={`/admin/menu-imports/${id}/facts`} variant="primary" size="sm">
              Open fact review
            </Button>
          </div>
        </section>

        {/* Diagnostics */}
        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Diagnostics</h2>
            <div className="flex gap-3 text-xs">
              <span className="text-red-400">{errors.length} errors</span>
              <span className="text-[var(--admin-gold)]">{warnings.length} warnings</span>
              <span className="text-white/50">{info.length} info</span>
            </div>
          </div>

          {/* SLICE 6A: this panel used to render a silently-truncated 1,000 of
              6,603 diagnostics and show it as if it were the whole picture. */}
          {diagVerdict && !diagVerdict.complete && (
            <p className="mt-3 rounded-lg border border-orange-500/50 bg-orange-500/10 px-3 py-2 text-xs text-orange-200">
              <strong>Incomplete diagnostics list.</strong> {diagVerdict.message} The counts above are
              a lower bound, not the full total.
            </p>
          )}

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

        {/* T-327 (Slice 1) — Backfill lots for an import published BEFORE the
            lot-creation feature (live menu, but no inventory records yet). */}
        {canBackfillLots && (
          <section className="rounded-xl border border-[var(--admin-gold)]/30 bg-[var(--admin-gold)]/5 p-5">
            <h2 className="text-sm font-semibold text-white">
              Missing inventory records for this import
            </h2>
            <p className="mt-1 text-xs text-white/60">
              This import is live on the menu but has <strong>no inventory lots</strong> in the back
              office &mdash; it was published before inventory records were created automatically.
              Click below to create them now: one traceable lot per product, exactly like a receiving
              delivery, so every sale decrements real stock and margin reports work. This is safe to
              click &mdash; existing lots are skipped, so it never doubles inventory.
            </p>
            <form action={backfillLotsAction} className="mt-4">
              <input type="hidden" name="importId" value={imp.id} />
              <input type="hidden" name="from" value={sp.back === "publish" ? "publish" : ""} />
              <Button type="submit" variant="confirm">
                Create inventory records now
              </Button>
            </form>
          </section>
        )}

        {/* Compliance inventory lots (SLICE 46) */}
        {lotPlan && (
          <section className="rounded-xl border border-[var(--admin-accent)]/25 bg-[var(--admin-accent)]/5 p-5">
            <h2 className="text-sm font-semibold text-white">Compliance inventory lots</h2>
            <p className="mt-1 text-xs text-white/50">
              Publishing this version also creates traceable inventory lots &mdash; the same
              records a receiving delivery gets &mdash; so every sale decrements real stock,
              carries a CCRS identifier, and has a unit cost for margin reports. Lots that already
              exist are skipped, so re-publishing never doubles inventory.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Lots planned" value={lotPlan.lotsPlanned ?? 0} accent="green" />
              <StatCard label="Units covered" value={lotPlan.unitsTotal ?? 0} accent="muted" />
              <StatCard
                label="COA to attach"
                value={lotPlan.coaMissing ?? 0}
                hint="Marked N in the POS export"
                accent="orange"
              />
              <StatCard
                label="Expiry to set"
                value={lotPlan.expirationMissing ?? 0}
                hint="Blank in the POS export"
                accent="orange"
              />
            </div>
          </section>
        )}

        {/* Publish */}
        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <h2 className="text-sm font-semibold text-white">Publish</h2>
          {version?.status === "published" ? (
            <p className="mt-2 text-sm text-[var(--admin-accent)]">
              This version is live (published {formatDateTime(version.published_at)}).
            </p>
          ) : blocked ? (
            <p className="mt-2 text-sm text-red-400">
              This import has {version?.error_count} blocking error(s). Resolve the source data and
              re-import before publishing.
            </p>
          ) : !gate.ready ? (
            <div className="mt-2">
              <p className="text-sm text-[var(--admin-gold)]">{gate.message}</p>
              <Button
                href={`/admin/menu-imports/${id}/facts`}
                variant="neutral"
                size="sm"
                className="mt-3"
              >
                Open fact review
              </Button>
            </div>
          ) : !canPublish ? (
            <p className="mt-2 text-sm text-white/50">
              Review looks good. A manager or admin must publish to make this menu live.
            </p>
          ) : (
            <form action={publishVersion} className="mt-3">
              <input type="hidden" name="versionId" value={version?.id ?? ""} />
              <input type="hidden" name="importId" value={imp.id} />
              <p className="mb-1 text-xs text-[var(--admin-accent)]">{gate.message}</p>
              <p className="mb-3 text-xs text-white/50">
                Publishing replaces the WHOLE live menu with this version and refreshes the public
                site. The previous version is archived (not deleted).
              </p>
              {verdict?.requiresRemovalConfirm && (
                <label className="mb-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2.5 text-xs text-red-300">
                  <input type="checkbox" name="confirm_removals" value="yes" className="mt-0.5" />
                  <span>
                    I understand publishing this version will <strong>REMOVE {verdict.removedCount} product(s)</strong>{" "}
                    from the live menu (see the &ldquo;Removed products&rdquo; list above), and that&apos;s what I want.
                  </span>
                </label>
              )}
              <Button type="submit" disabled={!version} variant="confirm">
                Publish this menu live
              </Button>
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
