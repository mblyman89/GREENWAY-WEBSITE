import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BackLink } from "@/components/admin/ux";
import { Button, CHIP_ACTION } from "@/components/admin/ui";
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
import { liveWithOpenReviewsCopy, publishNowAcknowledgementCopy } from "@/lib/pos/publish-now-core";
import {
  buildPublishVerdict,
  PUBLISH_SWAP_NOTE,
  removalConfirmCopy,
  removalListTitle,
  type PublishVerdict,
} from "@/lib/pos/publish-guard-core";
import { publishVersion, backfillLotsAction, refileFromTypeCheck, fillLotFactsAction } from "../actions";
import { bulkRefileFromTypeCheck } from "../fix-actions";
import { listWebsiteCategoryTypes, listInventoryTypes } from "@/lib/pos/types-store";
import { isValidWebsiteCategory } from "@/lib/menu/menu-category-override-core";
import Link from "next/link";
import {
  posImportFixFor,
  posDiagnosticRowLink,
  hiddenItemFix,
  IMPORT_PAGE_ANCHORS,
  MISSING_COA_HREF,
  MISSING_EXPIRY_BULK_HREF,
  importReceivedDatesHref,
  typeFocusHref,
  lotSearchHref,
  productSearchHref,
  type PosFixContext,
} from "@/lib/pos/pos-import-fix-core";
import {
  buildTypeCheckReport,
  typeCheckAdvice,
  TYPE_CHECK_ANCHOR,
  type TypeCheckGroup,
} from "@/lib/pos/cultivera-type-from-category-core";

const VERDICT_STYLE: Record<PublishVerdict["level"], string> = {
  safe: "border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 text-[var(--admin-accent)]",
  caution: "border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 text-[var(--admin-gold)]",
  danger: "border-red-500/40 bg-red-500/10 text-red-300",
};

export const dynamic = "force-dynamic";
/**
 * R17 — the lot-plan "Fill received dates & cannabinoids" server action runs
 * inside this page's function (~300 date UPDATEs + ~2,340 per-lot potency
 * patches on the real export). Pin the budget explicitly rather than relying
 * on the platform default; the fill is fill-only, so a re-click after any
 * timeout safely resumes where it stopped.
 */
export const maxDuration = 300;

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
  searchParams: Promise<{ error?: string; published?: string; staged?: string; back?: string; backfilled?: string; notice?: string; refiled?: string }>;
}) {
  const session = await requirePermission("menu.import");
  const { id } = await params;
  const sp = await searchParams;
  const canPublish = can(session.profile.role, "menu.publish");
  // R14a: "publish now, fix after" is owner/admin only (roles.ts).
  const canPublishOpenReviews = can(session.profile.role, "menu.publish.open_reviews");

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
          removedNames: diff.removed.map((r) => r.name),
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
      receivedDateMissing?: number;
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
  // Round 13: where each diagnostic / hidden card is actually fixed.
  const fixCtx: PosFixContext = {
    importId: id,
    versionPublished: version?.status === "published",
    lotsCreated: hasCreatedLots,
  };
  const codeSummary = summarizeByCode(diagnostics, (d) => {
    const link = posDiagnosticRowLink(d.code, d.context_json, fixCtx);
    if (!link) return null;
    const c = (d.context_json ?? {}) as Record<string, unknown>;
    const name = [c.product, c.displayName, c.productName, c.barcode, c.category].find((v) => typeof v === "string" && v.trim());
    return { ...link, name: typeof name === "string" ? name : d.message };
  });
  // R14b: Cultivera's Category is OUR type; its InventoryType is the CCRS type.
  // Read every staged row against the category's measured CCRS type
  // (cultivera-type-from-category-core) -- computed from the rows already
  // loaded above, no extra read.
  const typeCheck = buildTypeCheckReport(
    items.map((i) => ({
      sourceItemId: i.source_item_id,
      name: i.name,
      productName: i.product_name,
      category: i.pos_inventory_category,
      inventoryType: i.pos_inventory_type,
    })),
  );
  const canRefile = can(session.profile.role, "inventory.manage");
  // R15b: the closed vocabulary for the per-row / whole-group "Re-file as" select
  // (same registries refileFromTypeCheck validates against).
  let refileChoices: RefileChoice[] = [];
  if (canRefile && typeCheck.groups.length > 0) {
    try {
      const [cats, types] = await Promise.all([
        listWebsiteCategoryTypes({ includeInactive: false }),
        listInventoryTypes({ includeInactive: false }),
      ]);
      const okCats = cats.filter((c) => isValidWebsiteCategory(c.value));
      const okValues = new Set(okCats.map((c) => c.value));
      refileChoices = [
        ...types
          .filter((t) => t.website_category && okValues.has(t.website_category))
          .map((t) => ({ value: `${t.website_category}|${t.label}`, label: `${t.label} (${t.website_category})` })),
        ...okCats.map((c) => ({ value: `${c.value}|`, label: `${c.label} — category only` })),
      ];
    } catch (err) {
      console.error("[menu-imports/:id] refile registry load error:", err);
    }
  }
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
        {sp.refiled && (
          <div
            className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-accent)]"
            data-testid="type-check-refiled"
          >
            {decodeURIComponent(sp.refiled)}
          </div>
        )}
        {sp.error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {decodeURIComponent(sp.error)}
          </div>
        )}
        {/* S18: the cutover release / rebuild outcome, told plainly. */}
        {sp.notice && (
          <div className="rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 px-4 py-3 text-sm text-[var(--admin-gold)]">
            {decodeURIComponent(sp.notice)}
          </div>
        )}
        {sp.published && (
          <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-accent)]">
            Published. The public menu now reflects this version.
          </div>
        )}
        {/* R14a: live with open reviews -- keep fixing, each decision reaches the live menu. */}
        {version?.status === "published" && liveWithOpenReviewsCopy(gate.reconciliation.pending) && (
          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 px-4 py-3 text-sm text-[var(--admin-gold)]"
            data-testid="live-open-reviews"
          >
            <span>{liveWithOpenReviewsCopy(gate.reconciliation.pending)}</span>
            <Button href={`/admin/menu-imports/${id}/facts`} variant="primary" size="sm">
              Keep fixing in Fact Review &rarr;
            </Button>
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
                  {removalListTitle(diff.removed.length)}
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
        <section id={IMPORT_PAGE_ANCHORS.diagnostics} className="scroll-mt-24 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
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
              {codeSummary.map((c) => {
                const fix = posImportFixFor(c.code, fixCtx);
                const rows = c.rowLinks;
                return (
                  <div
                    key={`${c.severity}-${c.code}`}
                    data-testid="import-diagnostic"
                    data-code={c.code}
                    className={`rounded-lg border px-3 py-2 text-xs ${SEVERITY_STYLE[c.severity]}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="font-mono font-semibold">{c.code}</span>
                        <span className="ml-2 opacity-80">{c.sample}</span>
                      </div>
                      <span className="shrink-0 rounded bg-black/30 px-2 py-0.5 font-semibold">×{c.count}</span>
                    </div>
                    {fix && (
                      <div className="mt-2 border-t border-white/10 pt-2 text-white/75">
                        <p>{fix.what}</p>
                        <p className="mt-0.5 text-white/60">{fix.how}</p>
                        {fix.links.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {fix.links.map((l) => (
                              <Link key={l.href} href={l.href} className={CHIP_ACTION} data-testid="import-diagnostic-fix">
                                {l.label} →
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {rows.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-white/60">
                          One at a time ({rows.length}{c.count > rows.length ? ` of ${c.count}` : ""})
                        </summary>
                        <ul className="mt-1 max-h-64 space-y-1 overflow-auto">
                          {rows.map((r) => (
                            <li key={r.key} className="flex items-center justify-between gap-2">
                              <span className="truncate text-white/70">{r.name}</span>
                              <Link href={r.href} data-testid="import-diagnostic-row-fix" className="shrink-0 font-semibold text-[var(--admin-accent)] hover:underline">
                                {r.label} →
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 text-sm text-white/50">No diagnostics — clean import.</p>
          )}
        </section>

        {/* R14b — Type & category check (Cultivera's type column vs its category). */}
        {typeCheck.checked > 0 && (
          <section id={TYPE_CHECK_ANCHOR} className="scroll-mt-24 rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="type-check">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-white">Type & category check</h2>
              <span className="text-xs text-white/50">
                {typeCheck.agree} agree · {typeCheck.flagged} to look at
                {typeCheck.noCategory > 0 ? ` · ${typeCheck.noCategory} with no category` : ""}
              </span>
              {typeCheck.flagged > 0 && (
                <a
                  href={`/admin/menu-imports/${imp.id}/type-check/export`}
                  className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/80 hover:border-[var(--admin-accent)] hover:text-white"
                  data-testid="type-check-rep-sheet"
                >
                  Download the sheet for your Cultivera rep (CSV)
                </a>
              )}
            </div>
            <p className="mt-1 text-xs text-white/45">
              Cultivera&apos;s <strong>Category</strong> is our type; its <strong>Inventory Type</strong> is the
              CCRS type. Every category has one CCRS type (measured on your own export), so each row is read
              against it. Nothing here changes by itself &mdash; every change is a button you press.
            </p>
            {typeCheck.groups.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--admin-accent)]">Every category and CCRS type agree.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {typeCheck.groups.map((g) => (
                  <TypeCheckCard key={g.key} g={g} importId={id} canRefile={canRefile} lotsCreated={hasCreatedLots} choices={refileChoices} />
                ))}
              </div>
            )}
          </section>
        )}

        {/* Hidden items */}
        {hiddenTotal > 0 && (
          <section id={IMPORT_PAGE_ANCHORS.hidden} className="scroll-mt-24 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
            <h2 className="text-sm font-semibold text-white">
              Hidden items ({hiddenTotal})
            </h2>
            <p className="mt-1 text-xs text-white/40">
              These are excluded from the public menu (e.g. unmapped category, no price, or no
              inventory). Showing first {hiddenItems.length}.
            </p>
            <div className="mt-3 max-h-96 overflow-auto rounded-lg border border-white/10">
              {hiddenItems.map((i) => {
                const fix = hiddenItemFix({
                  sourceItemId: i.source_item_id,
                  hiddenReason: i.hidden_reason,
                  importId: id,
                  versionPublished: fixCtx.versionPublished,
                });
                return (
                  <div key={i.id} className="flex items-center justify-between gap-2 border-b border-white/5 px-3 py-1.5 text-xs">
                    <span className="text-white/80">
                      {i.name} <span className="text-white/40">· {i.brand_name} · {i.category}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] uppercase text-white/50">
                        {i.hidden_reason ?? "hidden"}
                      </span>
                      {fix && (
                        <Link href={fix.href} data-testid="hidden-item-fix" className="font-semibold text-[var(--admin-accent)] hover:underline">
                          {fix.label} →
                        </Link>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* T-327 (Slice 1) — Backfill lots for an import published BEFORE the
            lot-creation feature (live menu, but no inventory records yet). */}
        {canBackfillLots && (
          <section id={IMPORT_PAGE_ANCHORS.backfill} className="scroll-mt-24 rounded-xl border border-[var(--admin-gold)]/30 bg-[var(--admin-gold)]/5 p-5">
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
          <section id={IMPORT_PAGE_ANCHORS.lotPlan} className="scroll-mt-24 rounded-xl border border-[var(--admin-accent)]/25 bg-[var(--admin-accent)]/5 p-5">
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
            {/* Round 13: the two blanks the import cannot fill, with their real controls. */}
            {hasCreatedLots ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {(lotPlan.expirationMissing ?? 0) > 0 && (
                  <Button href={MISSING_EXPIRY_BULK_HREF} variant="primary" size="sm" data-testid="lot-plan-expiry-fix">
                    Set expiry dates with Bulk fill →
                  </Button>
                )}
                {(lotPlan.receivedDateMissing ?? 0) > 0 && (
                  <Button href={importReceivedDatesHref(imp.id)} variant="primary" size="sm" data-testid="lot-plan-received-date-fix">
                    Set received dates ({lotPlan.receivedDateMissing} blank in the export) →
                  </Button>
                )}
                {(lotPlan.coaMissing ?? 0) > 0 && (
                  <Button href={MISSING_COA_HREF} variant="neutral" size="sm" data-testid="lot-plan-coa-list">
                    See the lots without a COA →
                  </Button>
                )}
              </div>
            ) : null}
            {/* R15a: lots created by an earlier publish never got their received
                date / THC / CBD / CBN / CBC. Fill-only, safe to re-click. */}
            {hasCreatedLots && canRefile && !imp.is_test ? (
              <form action={fillLotFactsAction} className="mt-3" data-testid="lot-plan-fill-facts">
                <input type="hidden" name="importId" value={imp.id} />
                <Button type="submit" variant="confirm" size="sm">
                  Fill received dates & cannabinoids from the spreadsheet
                </Button>
                <p className="mt-1 text-xs text-white/45">
                  Re-reads this import&apos;s stored Cultivera files and fills the Received, THC, CBD and
                  name-verified CBN/CBC/CBG columns on its lots &mdash; only where they are blank. Anything
                  you already typed is never overwritten.
                </p>
              </form>
            ) : null}
            {!hasCreatedLots && (
              <p className="mt-3 text-xs text-white/50" data-testid="lot-plan-not-yet">
                These lots are created when this version is published; the Bulk fill buttons appear here after that.
              </p>
            )}
            {(lotPlan.coaMissing ?? 0) > 0 && (
              <p className="mt-2 text-xs text-white/45">
                Attaching COA files waits on Cultivera&apos;s answer about COA access &mdash; there is no attach button yet.
              </p>
            )}
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
              {/* R14a: publish now, fix after. Offered ONLY when pending review
                  rows are the sole refusal; the server re-checks everything on
                  fresh reads (publishMenuVersion) and records the decision. */}
              {gate.blockedOnlyByPending && canPublishOpenReviews && version && (
                <form
                  action={publishVersion}
                  className="mt-4 rounded-lg border border-[var(--admin-accent)]/30 bg-[var(--admin-accent)]/5 p-4"
                  data-testid="publish-now-form"
                >
                  <input type="hidden" name="versionId" value={version.id} />
                  <input type="hidden" name="importId" value={imp.id} />
                  <input type="hidden" name="publish_now_offered" value="yes" />
                  <input type="hidden" name="seen_pending" value={String(gate.reconciliation.pending)} />
                  <p className="text-sm font-semibold text-white">Or publish now and fix after</p>
                  <label className="mt-2 flex items-start gap-2 text-xs text-white/75">
                    <input type="checkbox" name="publish_now" value="yes" className="mt-0.5" required />
                    <span>{publishNowAcknowledgementCopy(gate.reconciliation.pending)}</span>
                  </label>
                  <p className="mt-2 text-xs text-white/50">{PUBLISH_SWAP_NOTE}</p>
                  {verdict?.requiresRemovalConfirm && (
                    <label className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2.5 text-xs text-red-300">
                      <input type="checkbox" name="confirm_removals" value="yes" className="mt-0.5" />
                      <span>{removalConfirmCopy(verdict.removedCount)}</span>
                    </label>
                  )}
                  <Button type="submit" variant="confirm" className="mt-3">
                    Publish now, fix after
                  </Button>
                </form>
              )}
              {gate.blockedOnlyByPending && canPublish && !canPublishOpenReviews && (
                <p className="mt-3 text-xs text-white/50">
                  The owner or an admin can publish now and fix these after.
                </p>
              )}
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
              <p className="mb-3 text-xs text-white/50">{PUBLISH_SWAP_NOTE}</p>
              {verdict?.requiresRemovalConfirm && (
                <label className="mb-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2.5 text-xs text-red-300">
                  <input type="checkbox" name="confirm_removals" value="yes" className="mt-0.5" />
                  <span>{removalConfirmCopy(verdict.removedCount)}</span>
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

type RowLink = { key: string; href: string; label: string; name: string };
type CodeSummary = { severity: DiagnosticSeverity; code: string; count: number; sample: string; rowLinks: RowLink[] };

/** Round 13: per-code row links are capped so a 4,000-row code stays renderable. */
const ROW_LINK_CAP = 200;

function summarizeByCode<D extends { severity: DiagnosticSeverity; code: string; message: string }>(
  diagnostics: D[],
  rowLink: (d: D) => { href: string; label: string; name: string } | null,
): CodeSummary[] {
  const map = new Map<string, CodeSummary>();
  const rank: Record<DiagnosticSeverity, number> = { error: 0, warning: 1, info: 2 };
  for (const d of diagnostics) {
    const key = `${d.severity}|${d.code}`;
    let entry = map.get(key);
    if (entry) entry.count += 1;
    else {
      entry = { severity: d.severity, code: d.code, count: 1, sample: d.message, rowLinks: [] };
      map.set(key, entry);
    }
    if (entry.rowLinks.length < ROW_LINK_CAP) {
      const link = rowLink(d);
      // One link per destination: a facts link repeated 600 times is noise.
      if (link && !entry.rowLinks.some((r) => r.href === link.href)) {
        entry.rowLinks.push({ key: `${link.href}|${entry.rowLinks.length}`, ...link });
      }
    }
  }
  return [...map.values()].sort(
    (a, b) => rank[a.severity] - rank[b.severity] || b.count - a.count,
  );
}

const TYPE_CHECK_TITLE: Record<TypeCheckGroup["verdict"], string> = {
  category_suspect: "Filed under the wrong category",
  unknown_category: "Category we don't know yet",
  type_mismatch: "CCRS type doesn't match the category",
};

type RefileChoice = { value: string; label: string };

/** R15b: a closed "Re-file as" select + submit (server re-validates the pick). */
function RefileSelect({ choices, defaultValue, testId, label }: { choices: RefileChoice[]; defaultValue?: string; testId: string; label: string }) {
  return (
    <>
      <select name="choice" defaultValue={defaultValue ?? ""} required className="max-w-[14rem] rounded border border-white/15 bg-black px-2 py-1 text-[11px] text-white">
        <option value="">Re-file as…</option>
        {choices.map((c) => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>
      <button type="submit" className={CHIP_ACTION} data-testid={testId}>{label}</button>
    </>
  );
}

/** R14b: one Type & category check group, with its per-product fix. R15b: bulk + manual. */
function TypeCheckCard({
  g,
  importId,
  canRefile,
  lotsCreated,
  choices,
}: {
  g: TypeCheckGroup;
  importId: string;
  canRefile: boolean;
  lotsCreated: boolean;
  choices: RefileChoice[];
}) {
  const suggestedCount = g.rows.filter((r) => r.suggestion).length;
  const tone = g.verdict === "type_mismatch" ? SEVERITY_STYLE.info : SEVERITY_STYLE.warning;
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs ${tone}`} data-testid="type-check-group" data-verdict={g.verdict}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="font-semibold">{TYPE_CHECK_TITLE[g.verdict]}</span>
          <span className="ml-2 opacity-80">
            &ldquo;{g.category}&rdquo;{g.actualCcrsType ? ` · CCRS type ${g.actualCcrsType}` : " · CCRS type blank"}
            {g.expectedCcrsType ? ` · expected ${g.expectedCcrsType}` : ""}
          </span>
        </div>
        <span className="shrink-0 rounded bg-black/30 px-2 py-0.5 font-semibold">×{g.count}</span>
      </div>
      <p className="mt-1.5 text-white/65">{typeCheckAdvice(g)}</p>
      {g.verdict === "unknown_category" && (
        <Link
          href={typeFocusHref(g.category, g.suggestion?.websiteCategory)}
          className={`${CHIP_ACTION} mt-2`}
          data-testid="type-check-add-type"
        >
          Add &ldquo;{g.category}&rdquo; as a type{g.suggestion ? ` (suggested: ${g.suggestion.websiteCategory})` : ""} →
        </Link>
      )}
      {g.verdict === "unknown_category" && g.suggestion && <p className="mt-1 text-white/45">{g.suggestion.why}</p>}
      {canRefile && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {g.verdict === "category_suspect" && suggestedCount > 0 && (
            <form action={bulkRefileFromTypeCheck}>
              <input type="hidden" name="importId" value={importId} />
              <input type="hidden" name="groupKey" value={g.key} />
              <input type="hidden" name="mode" value="suggested" />
              <button type="submit" className={CHIP_ACTION} data-testid="type-check-bulk-suggested">
                Re-file all {g.count} as suggested
              </button>
            </form>
          )}
          {choices.length > 0 && (
            <form action={bulkRefileFromTypeCheck} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="importId" value={importId} />
              <input type="hidden" name="groupKey" value={g.key} />
              <input type="hidden" name="mode" value="manual" />
              <RefileSelect
                choices={choices}
                defaultValue={g.suggestion ? `${g.suggestion.websiteCategory}|${g.suggestion.houseType ?? ""}` : undefined}
                testId="type-check-bulk-manual"
                label={`Re-file all ${g.count}`}
              />
            </form>
          )}
        </div>
      )}
      {canRefile && g.verdict === "type_mismatch" && (
        <p className="mt-1 text-white/40">Re-filing changes only our type and website category — the CCRS type stays as Cultivera reported it.</p>
      )}
      <details className="mt-2">
        <summary className="cursor-pointer text-white/60">
          One at a time ({g.rows.length}
          {g.count > g.rows.length ? ` of ${g.count}` : ""})
        </summary>
        <ul className="mt-1 max-h-72 space-y-1.5 overflow-auto">
          {g.rows.map((r) => (
            <li key={r.sourceItemId} className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-white/75">
                {r.name}
                {r.suggestion && <span className="ml-2 text-white/40">{r.suggestion.why}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {g.verdict === "category_suspect" && r.suggestion && canRefile && (
                  <form action={refileFromTypeCheck}>
                    <input type="hidden" name="importId" value={importId} />
                    <input type="hidden" name="sourceItemId" value={r.sourceItemId} />
                    <input type="hidden" name="website_category" value={r.suggestion.websiteCategory} />
                    <input type="hidden" name="house_type" value={r.suggestion.houseType ?? ""} />
                    <button type="submit" className={CHIP_ACTION} data-testid="type-check-refile">
                      Re-file as {r.suggestion.houseType ?? r.suggestion.websiteCategory}
                    </button>
                  </form>
                )}
                {canRefile && choices.length > 0 && (
                  <form action={refileFromTypeCheck} className="flex items-center gap-1">
                    <input type="hidden" name="importId" value={importId} />
                    <input type="hidden" name="sourceItemId" value={r.sourceItemId} />
                    <RefileSelect choices={choices} testId="type-check-refile-manual" label="Save" />
                  </form>
                )}
                <Link
                  href={lotsCreated ? lotSearchHref(r.name) : productSearchHref(r.name)}
                  data-testid="type-check-open"
                  className="font-semibold text-[var(--admin-accent)] hover:underline"
                >
                  {lotsCreated ? "Open its lot" : "Open the product"} →
                </Link>
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

