import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BackLink } from "@/components/admin/ux";
import { Button, CHIP_ACTION } from "@/components/admin/ui";
import { StatCard } from "@/components/admin/StatCard";
import { getImport, getImportDiagnosticsChecked, listVersions, getVersionItems } from "@/lib/pos/menu-version";
import { listFactReviews, factReviewsToResolutions } from "@/lib/pos/fact-review-store";
import {
  buildFactReviewBuckets,
  menuItemRowToFactReviewItem,
  posDiagnosticToFactReviewDiagnostic,
  type FactReviewRow,
} from "@/lib/pos/fact-review-core";
import { groupPendingReviews } from "@/lib/pos/fact-review-bulk-core";
import { NO_PRODUCT_MASTER } from "@/lib/pos/missing-product-master-core";
import type { ReadCompletenessVerdict } from "@/lib/supabase/read-completeness-core";
import { formatDateTime } from "@/lib/pos/format";
import { resolveFactReview, resolveFactReviewGroup } from "../../actions";
import { posStateOf } from "@/lib/enrichment/product-visibility-core";
import { hiddenItemFix } from "@/lib/pos/pos-import-fix-core";
import { liveWithOpenReviewsCopy } from "@/lib/pos/publish-now-core";
import {
  parseFactFocus,
  filterByFocus,
  factsGroupHref,
  suggestFactsFromName,
  suggestionNote,
  ONE_AT_A_TIME_ANCHOR,
  type FactFocus,
} from "@/lib/pos/fact-review-focus-core";

/** fact-review-store.ts writes exactly this reason on a reviewer reject. */
const REVIEWER_REJECTED_REASON = "reviewer_rejected";

export const dynamic = "force-dynamic";

/**
 * PROGRAM 3 / SLICE 57 — the golden-record fact-review screen (dry-run report
 * + exception queue). Every staged row lands in exactly one bucket:
 * auto-accepted / needs-review / rejected, with its facts, per-fact sources,
 * confidence, and plain-English notes. Review rows offer approve / inline
 * fix / reject; nothing uncertain goes live without a named human decision
 * (docs/data-governance.md Rules 3.1-3.3).
 */
export default async function FactReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; back?: string; group?: string; q?: string }>;
}) {
  await requirePermission("menu.import");
  const { id } = await params;
  const sp = await searchParams;

  const imp = await getImport(id);
  if (!imp) notFound();

  let versions: Awaited<ReturnType<typeof listVersions>> = [];
  let diagnostics: Awaited<ReturnType<typeof getImportDiagnosticsChecked>>["rows"] = [];
  // SLICE 6A: the read is only trustworthy if it is provably WHOLE. This screen
  // is where the owner clears the publish gate, so showing a silently-truncated
  // queue is worse than showing an error -- it reads as "nothing left to do".
  let diagVerdict: ReadCompletenessVerdict | null = null;
  let reviews: Awaited<ReturnType<typeof listFactReviews>> = [];
  try {
    const [v, d, r] = await Promise.all([
      listVersions(50),
      // SLICE 6A: was `getImportDiagnostics(id, { limit: 5000 })`, which
      // PostgREST capped at 1,000 -- and because the old read ordered by the
      // `severity` ENUM ('error','warning','info') ascending, `info` sorted
      // LAST and 4,160 warnings consumed the entire ceiling. Every
      // `fact_extraction_review` and `cannabinoid_missing` row (745 of 764)
      // was therefore invisible on the one screen built to decide them.
      getImportDiagnosticsChecked(id),
      listFactReviews(id),
    ]);
    versions = v;
    diagnostics = d.rows;
    diagVerdict = d.verdict;
    reviews = r;
  } catch (err) {
    console.error("[menu-imports/:id/facts] load error:", err);
  }
  const version = versions.find((v) => v.import_id === id) ?? null;
  const items = version ? await getVersionItems(version.id) : [];

  const buckets = buildFactReviewBuckets(
    items.map(menuItemRowToFactReviewItem),
    diagnostics.map(posDiagnosticToFactReviewDiagnostic),
    factReviewsToResolutions(reviews),
  );
  const pending = buckets.needsReview.filter((r) => r.resolution === null);
  const decided = buckets.needsReview.filter((r) => r.resolution !== null);
  // SLICE 6A: one row per product is unusable at 614 rows. Group the queue by
  // the machine's own verbatim reason so ONE named human decision can cover a
  // whole reason at once -- still written as one audit row per product.
  const groups = groupPendingReviews(pending);
  // R14b: the one-at-a-time list can be narrowed to ONE reason (?group=) and
  // searched (?q=); a save returns here with the same focus.
  const focus = parseFactFocus({ group: sp.group, q: sp.q });
  const groupOfRow = new Map<string, string>();
  for (const g of groups) for (const sid of g.sourceItemIds) groupOfRow.set(sid, g.key);
  const focusedPending = filterByFocus(pending, focus, (sid) => groupOfRow.get(sid));
  const focusGroup = focus.group ? groups.find((g) => g.key === focus.group) ?? null : null;
  const focused = Boolean(focus.group || focus.q);
  // The full product name (the card shows the display name) for name reading.
  const productNameById = new Map(items.map((i) => [i.source_item_id, i.product_name || i.name] as const));
  // SLICE 6B: how many of the rejected rows are the "in inventory, not in the
  // products file" case. Counted from the SAME staged rows the buckets were
  // built from, so this can never disagree with the Rejected count above it.
  // Round 13: the raw hidden_reason per card, for the Rejected list's fix controls.
  const hiddenReasonById = new Map(items.map((i) => [i.source_item_id, i.hidden_reason] as const));
  const missingMasterCount = items.filter(
    (i) => {
      // Round 12: the importer's state (an owner Visibility override does not
      // create a Products-file row) -- same rule as the worklist builder.
      const pos = posStateOf({ hidden: i.hidden, hidden_reason: i.hidden_reason });
      return pos.hidden && pos.hidden_reason === NO_PRODUCT_MASTER;
    },
  ).length;

  return (
    <div>
      <AdminPageHeader
        title="Fact Review"
        subtitle={`Import ${formatDateTime(imp.created_at)} · every row lands in exactly one bucket`}
        action={
          <BackLink
            fallback={`/admin/menu-imports/${id}`}
            back={sp.back}
            className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/80 hover:border-[var(--admin-accent)] hover:text-white"
          >
            ← Import review
          </BackLink>
        }
      />

      <div className="space-y-8 px-5 py-6 sm:px-8">
        {sp.error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {decodeURIComponent(sp.error)}
          </div>
        )}
        {sp.saved && (
          <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-accent)]">
            Decision saved.
          </div>
        )}
        {/* R14a: the menu is live with rows still pending -- every decision here
            is mirrored onto the live menu and the public pages are refreshed. */}
        {version?.status === "published" && liveWithOpenReviewsCopy(pending.length) && (
          <div
            className="rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 px-4 py-3 text-sm text-[var(--admin-gold)]"
            data-testid="facts-live-open-reviews"
          >
            {liveWithOpenReviewsCopy(pending.length)}
          </div>
        )}

        {/* SLICE 6A: an incomplete read is stated OUT LOUD. Before this, a
            capped diagnostics read made a 614-row queue render as "Queue
            clear" while the publish gate refused on all 614. */}
        {diagVerdict && !diagVerdict.complete && (
          <div className="rounded-lg border border-orange-500/50 bg-orange-500/10 px-4 py-3 text-sm text-orange-200">
            <strong>This queue is incomplete.</strong> {diagVerdict.message} Decisions you make here
            are still saved, but do not treat an empty queue as &ldquo;nothing left to do&rdquo; until
            this reads clean.
          </div>
        )}

        {/* Reconciliation strip: buckets always sum to rows in. */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Auto-accepted" value={buckets.totals.autoAccepted} hint="Cross-checked or clean single-source" accent="green" />
          <StatCard label="Needs review" value={buckets.totals.needsReview} hint={`${buckets.totals.pendingReview} still pending`} accent="orange" />
          <StatCard label="Rejected" value={buckets.totals.rejected} hint="Hidden with a documented reason" accent="muted" />
          <StatCard label="Rows in" value={buckets.totals.items + buckets.totals.standaloneFlags} hint="= sum of the three buckets" accent="muted" />
        </div>

        {/* Spreadsheet export — the whole report, all three buckets. */}
        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
          <p className="text-xs text-white/50">
            Download the full dry-run report (all three buckets, one row per product, with facts,
            sources, confidence, and notes) as a spreadsheet.
          </p>
          <Button href={`/admin/menu-imports/${id}/facts/export`} variant="save" size="sm">
            Export CSV
          </Button>
        </div>

        {/* Exception queue — pending first. */}
        <section className="rounded-xl border border-[var(--admin-gold)]/25 bg-[#0a0a0a] p-5">
          <h2 className="text-sm font-semibold text-white">
            Needs review <span className="ml-1 text-white/40">({pending.length} pending)</span>
          </h2>
          <p className="mt-1 text-xs text-white/45">
            The import never guesses: each row below has at least one fact the cross-examiner could
            not verify. Approve it as staged, fix the values yourself, or reject it from the menu.
          </p>
          {pending.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--admin-accent)]">Queue clear — every flagged row has a decision.</p>
          ) : (
            <>
              {/* SLICE 6A — DECIDE BY REASON.
                  Rule 3.1 is intact: nothing is auto-decided. One human still
                  presses approve or reject; it just covers every product that
                  shares the machine's identical stated reason, and each product
                  still gets its own recorded, attributed decision row. Bulk
                  FIX is deliberately absent — corrected values are per-product
                  facts, and typing one number across hundreds of products
                  would be inventing data. */}
              <div className="mt-4 space-y-3">
                <p className="text-xs text-white/50">
                  {pending.length} product(s) await a decision, grouped into {groups.length} shared
                  reason(s). Deciding a whole reason at once records a separate, attributed decision
                  for every product in it — nothing is auto-approved.
                </p>
                {groups.map((g) => (
                  <div
                    key={g.key}
                    className="rounded-lg border border-[var(--admin-accent)]/25 bg-[var(--admin-accent)]/[0.04] p-4"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold text-white">
                        {g.count} product{g.count === 1 ? "" : "s"}
                        <span className="ml-2 text-xs font-normal text-white/50">share one reason</span>
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-white/70">{g.reason}</p>
                    <Link href={factsGroupHref(id, g.key)} className={`${CHIP_ACTION} mt-2`} data-testid="facts-group-one-at-a-time">
                      Fix these {g.count} one at a time →
                    </Link>
                    <p className="mt-1 text-[11px] text-white/40">
                      e.g. {g.sampleNames.join(", ")}
                      {g.count > g.sampleNames.length ? ` … and ${g.count - g.sampleNames.length} more` : ""}
                    </p>
                    <form action={resolveFactReviewGroup} className="mt-3 flex flex-wrap items-center gap-2">
                      <input type="hidden" name="importId" value={id} />
                      <input type="hidden" name="groupKey" value={g.key} />
                      <input
                        type="text"
                        name="note"
                        placeholder="Why (optional) — recorded on every row"
                        className="min-w-56 flex-1 rounded-md border border-white/15 bg-black/40 px-2 py-1.5 text-xs text-white placeholder:text-white/30"
                      />
                      <button
                        type="submit"
                        name="action"
                        value="approve"
                        className={CHIP_ACTION}
                      >
                        Approve all {g.count}
                      </button>
                      <button
                        type="submit"
                        name="action"
                        value="reject"
                        className="rounded-full border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/10"
                      >
                        Reject all {g.count}
                      </button>
                    </form>
                  </div>
                ))}
              </div>

              {/* Per-product decisions (including inline fix) remain available. */}
              <details className="mt-5 scroll-mt-24" id={ONE_AT_A_TIME_ANCHOR} open={focused}>
                <summary className="cursor-pointer text-xs font-semibold text-[var(--admin-accent)]">
                  Decide products one at a time ({focused ? `${focusedPending.length} of ${pending.length}` : pending.length}) — the only way to enter corrected values
                </summary>
                {/* R14b: narrow to one reason and/or search by name or brand. */}
                <form method="get" className="mt-3 flex flex-wrap items-center gap-2" data-testid="facts-focus-form">
                  {focus.group && <input type="hidden" name="group" value={focus.group} />}
                  <input
                    type="search"
                    name="q"
                    defaultValue={focus.q ?? ""}
                    placeholder="Find a product by name or brand"
                    className="min-w-56 flex-1 rounded-md border border-white/15 bg-black/40 px-2 py-1.5 text-xs text-white placeholder:text-white/30"
                  />
                  <button type="submit" className={CHIP_ACTION}>Find</button>
                  {focused && (
                    <Link href={`/admin/menu-imports/${id}/facts#${ONE_AT_A_TIME_ANCHOR}`} className="text-xs text-white/60 hover:underline" data-testid="facts-focus-clear">
                      Show all {pending.length}
                    </Link>
                  )}
                </form>
                {focusGroup && (
                  <p className="mt-2 text-xs text-white/60" data-testid="facts-focus-reason">
                    Showing the products that share: <span className="text-white/80">{focusGroup.reason}</span>
                  </p>
                )}
                {focus.group && !focusGroup && (
                  <p className="mt-2 text-xs text-[var(--admin-accent)]">That reason has no products left to decide.</p>
                )}
                <div className="mt-3 space-y-4">
                  {focusedPending.length === 0 && focused && (
                    <p className="text-xs text-white/50">No pending product matches.</p>
                  )}
                  {focusedPending.map((row) => (
                    <ReviewCard
                      key={row.sourceItemId}
                      importId={id}
                      row={row}
                      focus={focus}
                      productName={productNameById.get(row.sourceItemId) ?? row.name}
                    />
                  ))}
                </div>
              </details>
            </>
          )}

          {decided.length > 0 && (
            <details className="mt-5">
              <summary className="cursor-pointer text-xs font-semibold text-white/60">
                Decided ({decided.length})
              </summary>
              <div className="mt-2 space-y-2">
                {decided.map((row) => (
                  <div key={row.sourceItemId} className="rounded-lg border border-white/10 px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-white/80">
                        {row.name} <span className="text-white/40">· {row.brand}</span>
                      </span>
                      <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${row.resolution === "reject" ? "bg-red-500/15 text-red-300" : "bg-[var(--admin-accent)]/15 text-[var(--admin-accent)]"}`}>
                        {row.resolution}
                      </span>
                    </div>
                    {row.resolutionNote && <p className="mt-1 text-white/45">{row.resolutionNote}</p>}
                    <FactLine row={row} />
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>

        {/* Auto-accepted */}
        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <h2 className="text-sm font-semibold text-white">
            Auto-accepted <span className="ml-1 text-white/40">({buckets.autoAccepted.length})</span>
          </h2>
          <p className="mt-1 text-xs text-white/45">
            No open flags. “Verified” rows had at least one fact confirmed by independent arithmetic
            (name vs. potency columns); “single-source” rows carry column values with no second
            witness — honest, just uncorroborated.
          </p>
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-semibold text-[var(--admin-accent)]">Show rows</summary>
            <div className="mt-2 max-h-96 overflow-auto rounded-lg border border-white/10">
              {buckets.autoAccepted.map((row) => (
                <div key={row.sourceItemId} className="border-b border-white/5 px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-white/80">
                      {row.name} <span className="text-white/40">· {row.brand} · {row.category}</span>
                    </span>
                    <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${row.confidence === "verified" ? "bg-[var(--admin-accent)]/15 text-[var(--admin-accent)]" : "bg-white/10 text-white/50"}`}>
                      {row.confidence}
                    </span>
                  </div>
                  <FactLine row={row} />
                  {row.notes.length > 0 && (
                    <ul className="mt-1 list-disc pl-4 text-white/45">
                      {row.notes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </details>
        </section>

        {/* Rejected */}
        <section id="rejected" className="scroll-mt-24 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-white">
                Rejected <span className="ml-1 text-white/40">({buckets.rejected.length})</span>
              </h2>
              <p className="mt-1 max-w-2xl text-xs text-white/45">
                Not going to the public menu — every one with its documented reason. Nothing is
                dropped silently.{" "}
                <strong className="text-white/70">These do not block publishing.</strong>
              </p>
            </div>
            {/* SLICE 6B: this section used to dead-end. The owner reported
                "the rejected ones, i can not fix or do anything with them at
                all" — correct, it rendered name + notes and nothing else.
                Measured on his real files: ALL of them are the one reason
                `no_product_master`, and they are a data-completeness worklist
                with its own screen and a rep-ready export. */}
            {missingMasterCount > 0 && (
              <Link
                href={`/admin/menu-imports/${id}/missing-products?back=${encodeURIComponent(`/admin/menu-imports/${id}/facts`)}`}
                className="shrink-0 rounded-full border border-[var(--admin-accent)]/50 px-4 py-2 text-xs font-semibold text-[var(--admin-accent)] hover:bg-[var(--admin-accent)]/10"
              >
                Work the {missingMasterCount} missing product{missingMasterCount === 1 ? "" : "s"} →
              </Link>
            )}
          </div>
          {buckets.rejected.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-semibold text-red-400">Show rows</summary>
              <div className="mt-2 max-h-96 overflow-auto rounded-lg border border-white/10">
                {buckets.rejected.map((row) => (
                  <div key={row.sourceItemId} className="border-b border-white/5 px-3 py-2 text-xs">
                    <span className="text-white/80">
                      {row.name} <span className="text-white/40">· {row.brand} · {row.category}</span>
                    </span>
                    <ul className="mt-1 list-disc pl-4 text-white/45">
                      {row.notes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                    {/* Round 13: a reviewer reject is reversible (recordFactReview
                        "approve" clears ONLY reviewer_rejected); every other
                        reason links to the control that can change it. */}
                    {hiddenReasonById.get(row.sourceItemId) === REVIEWER_REJECTED_REASON ? (
                      <form action={resolveFactReview} className="mt-2">
                        <input type="hidden" name="importId" value={id} />
                        <input type="hidden" name="sourceItemId" value={row.sourceItemId} />
                        <input type="hidden" name="action" value="approve" />
                        <input type="hidden" name="note" value="Undo reject from the Rejected list" />
                        <button type="submit" className={CHIP_ACTION} data-testid="rejected-undo">
                          Put back on the menu
                        </button>
                      </form>
                    ) : (
                      (() => {
                        const fix = hiddenItemFix({
                          sourceItemId: row.sourceItemId,
                          hiddenReason: hiddenReasonById.get(row.sourceItemId) ?? null,
                          importId: id,
                          versionPublished: version?.status === "published",
                        });
                        return fix ? (
                          <Link href={fix.href} className={`${CHIP_ACTION} mt-2`} data-testid="rejected-fix">
                            {fix.label} →
                          </Link>
                        ) : null;
                      })()
                    )}
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>
      </div>
    </div>
  );
}

/** One-line summary of the structured facts a row carries. */
function FactLine({ row }: { row: FactReviewRow }) {
  const f = row.facts;
  const parts = [
    f.thc !== null ? `THC ${f.thc}` : null,
    f.cbd !== null ? `CBD ${f.cbd}` : null,
    f.servingsPerPack !== null ? `${f.servingsPerPack} servings` : null,
    f.mgPerServing !== null ? `${f.mgPerServing}mg each` : null,
    f.packageThcMg !== null ? `pkg THC ${f.packageThcMg}mg` : null,
    f.packageCbdMg !== null ? `pkg CBD ${f.packageCbdMg}mg` : null,
    typeof f.packageCbgMg === "number" ? `pkg CBG ${f.packageCbgMg}mg` : null,
    typeof f.packageCbnMg === "number" ? `pkg CBN ${f.packageCbnMg}mg` : null,
    typeof f.packageCbcMg === "number" ? `pkg CBC ${f.packageCbcMg}mg` : null,
    f.ratioLabel !== null ? `ratio ${f.ratioLabel}` : null,
    f.netWeightGrams !== null ? `${f.netWeightGrams}g net` : null,
    f.netVolumeMl !== null ? `${f.netVolumeMl}ml net` : null,
  ].filter(Boolean);
  return (
    <p className="mt-1 text-white/50">
      {parts.length > 0 ? parts.join(" · ") : "No structured facts recorded"}
      {row.sources && <span className="ml-2 text-white/30">[{row.sources}]</span>}
    </p>
  );
}

/** One pending exception: facts, reasons, and the three decisions. */
function ReviewCard({
  importId,
  row,
  focus,
  productName,
}: {
  importId: string;
  row: FactReviewRow;
  focus: FactFocus;
  productName: string;
}) {
  // R14b: values the product NAME states literally (never auto-saved).
  const named = suggestFactsFromName(productName);
  const focusFields = (
    <>
      {focus.group && <input type="hidden" name="focusGroup" value={focus.group} />}
      {focus.q && <input type="hidden" name="focusQ" value={focus.q} />}
    </>
  );
  return (
    <div className="rounded-lg border border-[var(--admin-gold)]/25 bg-[var(--admin-gold)]/[0.03] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-white">
          {row.name}
          <span className="ml-2 text-xs font-normal text-white/40">
            {[row.brand, row.category, row.inventoryType].filter(Boolean).join(" · ")}
          </span>
        </p>
      </div>
      <FactLine row={row} />
      <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-[var(--admin-gold)]">
        {row.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* Approve as staged */}
        <form action={resolveFactReview}>
          <input type="hidden" name="importId" value={importId} />
          <input type="hidden" name="sourceItemId" value={row.sourceItemId} />
          <input type="hidden" name="action" value="approve" />
          {focusFields}
          <button type="submit" className={CHIP_ACTION}>Approve as-is</button>
        </form>
        {/* Reject from the menu */}
        <form action={resolveFactReview}>
          <input type="hidden" name="importId" value={importId} />
          <input type="hidden" name="sourceItemId" value={row.sourceItemId} />
          <input type="hidden" name="action" value="reject" />
          {focusFields}
          <button
            type="submit"
            className="admin-focus inline-flex items-center rounded-full bg-[var(--admin-danger-soft)] px-3 py-1 text-[0.7rem] font-bold uppercase tracking-[0.08em] text-[var(--admin-danger)] ring-1 ring-[var(--admin-danger)]/40 transition hover:bg-[var(--admin-danger)] hover:text-black"
          >
            Reject
          </button>
        </form>
      </div>

      {/* R14b: what the name states, one press to use it (still a named human fix). */}
      {(named.suggestions.length > 0 || named.conflicts.length > 0) && (
        <div className="mt-3 rounded-lg border border-[var(--admin-accent)]/25 bg-[var(--admin-accent)]/[0.04] p-3 text-xs" data-testid="facts-name-suggestions">
          <p className="font-semibold text-[var(--admin-accent)]">The product name says</p>
          {named.suggestions.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-white/70">
              {named.suggestions.map((x) => (
                <li key={x.field}>
                  {x.label}: <strong className="text-white">{x.value}</strong> <span className="text-white/40">— {x.why}</span>
                </li>
              ))}
            </ul>
          )}
          {named.conflicts.map((c) => (
            <p key={c} className="mt-1 text-[var(--admin-gold)]">{c}</p>
          ))}
          {named.suggestions.length > 0 && (
            <form action={resolveFactReview} className="mt-2">
              <input type="hidden" name="importId" value={importId} />
              <input type="hidden" name="sourceItemId" value={row.sourceItemId} />
              <input type="hidden" name="action" value="fix" />
              {named.suggestions.map((x) => (
                <input key={x.field} type="hidden" name={x.field} value={x.value} />
              ))}
              <input type="hidden" name="note" value={suggestionNote(named.suggestions)} />
              {focusFields}
              <button type="submit" className={CHIP_ACTION} data-testid="facts-use-name-values">
                Use these values
              </button>
            </form>
          )}
        </div>
      )}

      {/* Inline fix */}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-semibold text-[var(--admin-gold)]">
          Fix values instead
        </summary>
        <form action={resolveFactReview} className="mt-3 space-y-3">
          <input type="hidden" name="importId" value={importId} />
          <input type="hidden" name="sourceItemId" value={row.sourceItemId} />
          <input type="hidden" name="action" value="fix" />
          {focusFields}
          <p className="text-[11px] text-white/50">
            Package THC fills itself from servings × mg per serving when left blank. For ratio products (1:1, 2:2:2:1 CBG:CBC:CBD:THC) enter each cannabinoid’s PACKAGE total in mg — the menu shows these totals, never the lab percent.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <FixField label="THC (display)" name="thc" placeholder={row.facts.thc ?? "e.g. 100mg"} />
            <FixField label="CBD (display)" name="cbd" placeholder={row.facts.cbd ?? "e.g. 100mg"} />
            <FixField label="Ratio" name="ratioLabel" placeholder={row.facts.ratioLabel ?? "e.g. 1:1 THC:CBD"} />
            <FixField label="Servings per pack" name="servingsPerPack" placeholder={str(row.facts.servingsPerPack)} />
            <FixField label="Mg per serving" name="mgPerServing" placeholder={str(row.facts.mgPerServing)} />
            <FixField label="Package THC (mg)" name="packageThcMg" placeholder={str(row.facts.packageThcMg)} />
            <FixField label="Package CBD (mg)" name="packageCbdMg" placeholder={str(row.facts.packageCbdMg)} />
            <FixField label="Package CBG (mg)" name="packageCbgMg" placeholder={str(row.facts.packageCbgMg ?? null)} />
            <FixField label="Package CBN (mg)" name="packageCbnMg" placeholder={str(row.facts.packageCbnMg ?? null)} />
            <FixField label="Package CBC (mg)" name="packageCbcMg" placeholder={str(row.facts.packageCbcMg ?? null)} />
            <FixField label="Net weight (g)" name="netWeightGrams" placeholder={str(row.facts.netWeightGrams)} />
            <FixField label="Net volume (ml)" name="netVolumeMl" placeholder={str(row.facts.netVolumeMl)} />
          </div>

          {/* SLICE 16 — the low-THC beverage classification (WAC 314-55-095(1)(d)(i)(E)-(F)). */}
          <div className="rounded-lg border border-[var(--admin-gold)]/25 bg-[var(--admin-gold)]/[0.04] p-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--admin-gold)]">
              Low-THC beverage (200 mg allowance)
            </p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-[11px] uppercase tracking-wide text-white/45">
                  Qualifies as a low-THC beverage?
                </label>
                <select
                  name="lowThcLiquid"
                  defaultValue=""
                  className="admin-focus mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-xs text-white"
                >
                  <option value="">
                    {row.facts.lowThcLiquid === null
                      ? "Leave unclassified (treated as regular liquid)"
                      : `Leave as-is (currently ${row.facts.lowThcLiquid ? "yes" : "no"})`}
                  </option>
                  <option value="yes">Yes — packaged in units of 4 mg THC or less</option>
                  <option value="no">No — regular infused liquid (72 oz limit)</option>
                </select>
              </div>
              <FixField
                label="THC mg per SEALED CONTAINER"
                name="unitThcMg"
                placeholder={str(row.facts.unitThcMg)}
              />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-white/45">
              One can is one unit; a 4-pack is four units and the budtender scans each can. Enter the
              milligrams in the whole sealed container, <strong>not</strong> one serving — a 16 mg bottle
              labelled &ldquo;4 servings &times; 4 mg&rdquo; is <strong>16 mg</strong> and does <strong>not</strong>{" "}
              qualify. Take the figure from the invoice or the physical package and note the lot number
              below. Anything left unclassified is counted against the regular 72 oz liquid limit.
            </p>
          </div>

          {/* SLICE 17 — "otherwise taken into the body" (WAC 314-55-095(1)(d)(i)(D)). */}
          <div className="rounded-lg border border-[var(--admin-orange)]/25 bg-[var(--admin-orange)]/[0.04] p-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--admin-orange)]">
              Otherwise taken into the body (10 unit limit)
            </p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-[11px] uppercase tracking-wide text-white/45">
                  Is this taken into the body another way?
                </label>
                <select
                  name="otherwiseTaken"
                  defaultValue=""
                  className="admin-focus mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-xs text-white"
                >
                  <option value="">
                    {row.facts.otherwiseTaken === null
                      ? "Leave unclassified (NOT counted against the 10 unit limit)"
                      : `Leave as-is (currently ${row.facts.otherwiseTaken ? "yes" : "no"})`}
                  </option>
                  <option value="yes">Yes — suppository or similar (10 unit limit)</option>
                  <option value="no">No — smoked, eaten, or applied to the skin</option>
                </select>
              </div>
              <FixField
                label="Individual units per PACKAGE"
                name="unitsPerPackage"
                placeholder={str(row.facts.unitsPerPackage)}
              />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-white/45">
              This covers products taken into the body by any route <em>other</em> than inhaling,
              swallowing, or applying to the skin &mdash; in practice,{" "}
              <strong>suppositories</strong> (WAC 314-55-010(40)). Count the individual items in the
              sealed package: a <strong>box of six is 6</strong>, and all six count against the
              customer&rsquo;s ten-unit limit. This is <strong>not</strong> the same as servings.
              <br />
              <strong className="text-[var(--admin-orange)]">Please classify these carefully.</strong>{" "}
              A suppository left unclassified is treated as an ordinary topical and counts against the
              72 oz liquid limit instead, which is so large it effectively imposes{" "}
              <strong>no limit at all</strong>. Unlike the beverage question above, leaving this blank
              is <em>not</em> the safe option.
            </p>
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-white/45">
              Note (how you verified — e.g. “checked the physical package”, or the lot number)
            </label>
            <input
              type="text"
              name="note"
              className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-xs text-white placeholder:text-white/25"
              placeholder="Optional but recommended"
            />
          </div>
          <p className="text-[11px] text-white/40">
            Only the fields you fill in are changed; each carries provenance “reviewer”. Blank
            fields keep their staged values.
          </p>
          <Button type="submit" variant="save" size="sm">
            Save fix
          </Button>
        </form>
      </details>
    </div>
  );
}

function str(value: number | null): string {
  return value === null ? "" : String(value);
}

function FixField({ label, name, placeholder }: { label: string; name: string; placeholder: string }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wide text-white/45">{label}</label>
      <input
        type="text"
        name={name}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-xs text-white placeholder:text-white/25"
      />
    </div>
  );
}
