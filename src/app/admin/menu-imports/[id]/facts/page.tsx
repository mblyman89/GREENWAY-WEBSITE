import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BackLink } from "@/components/admin/ux";
import { Button, CHIP_ACTION } from "@/components/admin/ui";
import { StatCard } from "@/components/admin/StatCard";
import { getImport, getImportDiagnostics, listVersions, getVersionItems } from "@/lib/pos/menu-version";
import { listFactReviews, factReviewsToResolutions } from "@/lib/pos/fact-review-store";
import {
  buildFactReviewBuckets,
  menuItemRowToFactReviewItem,
  posDiagnosticToFactReviewDiagnostic,
  type FactReviewRow,
} from "@/lib/pos/fact-review-core";
import { formatDateTime } from "@/lib/pos/format";
import { resolveFactReview } from "../../actions";

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
  searchParams: Promise<{ error?: string; saved?: string; back?: string }>;
}) {
  await requirePermission("menu.import");
  const { id } = await params;
  const sp = await searchParams;

  const imp = await getImport(id);
  if (!imp) notFound();

  let versions: Awaited<ReturnType<typeof listVersions>> = [];
  let diagnostics: Awaited<ReturnType<typeof getImportDiagnostics>> = [];
  let reviews: Awaited<ReturnType<typeof listFactReviews>> = [];
  try {
    [versions, diagnostics, reviews] = await Promise.all([
      listVersions(50),
      getImportDiagnostics(id, { limit: 5000 }),
      listFactReviews(id),
    ]);
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
            <div className="mt-4 space-y-4">
              {pending.map((row) => (
                <ReviewCard key={row.sourceItemId} importId={id} row={row} />
              ))}
            </div>
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
        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <h2 className="text-sm font-semibold text-white">
            Rejected <span className="ml-1 text-white/40">({buckets.rejected.length})</span>
          </h2>
          <p className="mt-1 text-xs text-white/45">
            Not going to the public menu — every one with its documented reason. Nothing is dropped
            silently.
          </p>
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
function ReviewCard({ importId, row }: { importId: string; row: FactReviewRow }) {
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
          <button type="submit" className={CHIP_ACTION}>Approve as-is</button>
        </form>
        {/* Reject from the menu */}
        <form action={resolveFactReview}>
          <input type="hidden" name="importId" value={importId} />
          <input type="hidden" name="sourceItemId" value={row.sourceItemId} />
          <input type="hidden" name="action" value="reject" />
          <button
            type="submit"
            className="admin-focus inline-flex items-center rounded-full bg-[var(--admin-danger-soft)] px-3 py-1 text-[0.7rem] font-bold uppercase tracking-[0.08em] text-[var(--admin-danger)] ring-1 ring-[var(--admin-danger)]/40 transition hover:bg-[var(--admin-danger)] hover:text-black"
          >
            Reject
          </button>
        </form>
      </div>

      {/* Inline fix */}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-semibold text-[var(--admin-gold)]">
          Fix values instead
        </summary>
        <form action={resolveFactReview} className="mt-3 space-y-3">
          <input type="hidden" name="importId" value={importId} />
          <input type="hidden" name="sourceItemId" value={row.sourceItemId} />
          <input type="hidden" name="action" value="fix" />
          <div className="grid gap-3 sm:grid-cols-3">
            <FixField label="THC (display)" name="thc" placeholder={row.facts.thc ?? "e.g. 100mg"} />
            <FixField label="CBD (display)" name="cbd" placeholder={row.facts.cbd ?? "e.g. 100mg"} />
            <FixField label="Ratio" name="ratioLabel" placeholder={row.facts.ratioLabel ?? "e.g. 1:1"} />
            <FixField label="Servings per pack" name="servingsPerPack" placeholder={str(row.facts.servingsPerPack)} />
            <FixField label="Mg per serving" name="mgPerServing" placeholder={str(row.facts.mgPerServing)} />
            <FixField label="Package THC (mg)" name="packageThcMg" placeholder={str(row.facts.packageThcMg)} />
            <FixField label="Package CBD (mg)" name="packageCbdMg" placeholder={str(row.facts.packageCbdMg)} />
            <FixField label="Net weight (g)" name="netWeightGrams" placeholder={str(row.facts.netWeightGrams)} />
            <FixField label="Net volume (ml)" name="netVolumeMl" placeholder={str(row.facts.netVolumeMl)} />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-white/45">
              Note (how you verified — e.g. “checked the physical package”)
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
