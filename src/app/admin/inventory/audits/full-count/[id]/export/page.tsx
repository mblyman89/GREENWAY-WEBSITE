/**
 * src/app/admin/inventory/audits/full-count/[id]/export/page.tsx   (Fix Phase 4.4d · G-41 · D58)
 *
 * THE COMBINED WORK PAPER for a year-end full count.
 *
 * A full count is several ordinary audits ("sections") counted by different
 * people. Each section still has its own work paper; this page is the ONE
 * paper for the whole count: every section's lines in one table (with a
 * section column), one set of gross and net totals, every outstanding item,
 * and one signature block. It follows the single-audit work paper
 * (audits/[id]/export/page.tsx) on purpose, so a reviewer reads the same
 * sections in the same order: scope, method, materiality, results, detail,
 * outstanding items, what it does and does not establish, approval.
 *
 * Owner only (inventory.audit): the paper prices every difference.
 */
import { requirePermission } from "@/lib/auth/session";
import { Breadcrumbs } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui";
import { formatCents } from "@/lib/accounting/books-view-core";
import { FULL_COUNT_STAGE_LABEL } from "@/lib/inventory/full-count-core";
import { getFullCountReview } from "@/lib/inventory/full-count-store";
import { LABELS, isAuditSessionStatus } from "@/lib/inventory/inventory-audit-post-core";
import { DEFAULT_MATERIALITY } from "@/lib/inventory/inventory-audit-core";
import {
  describeMateriality,
  PROVES_AND_DOES_NOT,
  findVarianceReason,
} from "@/lib/inventory/audit-hub-guidance-core";
import { HubRefusal } from "../../../HubRefusal";

export const dynamic = "force-dynamic";

/** The legal entity, spelled the way it is registered (same as the single-audit paper). */
const ENTITY = "LYMAN'S MARIJUANA, Inc. dba Greenway Marijuana";

const PRINT_CSS = `
  @page { size: Letter portrait; margin: 0.6in; }
  @media print {
    .no-print { display: none !important; }
    .wp { background: #fff !important; color: #000 !important; border: none !important; }
    .wp * { background: transparent !important; color: #000 !important; border-color: #999 !important; }
    .wp table { page-break-inside: auto; }
    .wp tr { page-break-inside: avoid; page-break-after: auto; }
    .wp thead { display: table-header-group; }
  }
`;

export default async function FullCountWorkPaperPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("inventory.audit");
  const { id } = await params;
  const review = await getFullCountReview(id);
  const base = `/admin/inventory/audits/full-count/${id}`;

  if (!review.ok) {
    return (
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { label: "Inventory", href: "/admin/inventory" },
            { label: "Inventory audits", href: "/admin/inventory/audits" },
            { label: "Year-end full count", href: "/admin/inventory/audits/full-count" },
            { label: "Work paper" },
          ]}
        />
        <HubRefusal refusal={review.refusal} context="the full-count work paper" />
      </div>
    );
  }

  const { fullCount: fc, lines, totals, blockers } = review.data;
  const printedAt = new Date();
  const live = fc.sections.filter((s) => s.status !== "cancelled");
  const cancelled = fc.sections.length - live.length;
  const allApproved = live.length > 0 && live.every((s) => s.status === "approved" || s.postedAt);
  const allPosted = live.length > 0 && live.every((s) => s.postedAt);

  // Biggest difference first, across every section.
  const ordered = [...lines].sort((a, b) => {
    const av = Math.abs(a.assessment.varianceCents ?? 0);
    const bv = Math.abs(b.assessment.varianceCents ?? 0);
    return bv - av || a.sectionNo - b.sectionNo;
  });

  let n = 0;
  const num = () => `${++n}.`;

  return (
    <div className="space-y-6">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <div className="no-print space-y-4">
        <Breadcrumbs
          items={[
            { label: "Inventory", href: "/admin/inventory" },
            { label: "Inventory audits", href: "/admin/inventory/audits" },
            { label: "Year-end full count", href: "/admin/inventory/audits/full-count" },
            { label: `Full count ${fc.year}`, href: base },
            { label: "Work paper" },
          ]}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-white">Combined work paper</h1>
            <p className="text-sm text-[var(--admin-text-muted)]">
              Every section of the {fc.year} full count on one paper. Use your browser&apos;s print
              dialog and choose &ldquo;Save as PDF&rdquo;. Each section also keeps its own work paper.
            </p>
          </div>
          <Button href={base} variant="neutral" size="sm">
            Back to the full count
          </Button>
        </div>
      </div>

      <div className="wp rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-white">
        <div className="border-b border-white/15 pb-4">
          <p className="text-xs uppercase tracking-widest text-[var(--admin-text-muted)]">
            Year-end full inventory count &mdash; combined work paper
          </p>
          <h2 className="mt-1 text-xl font-bold">{ENTITY}</h2>
          <p className="mt-1 text-sm">
            Full count for {fc.year} &middot; {fc.sections.length} section
            {fc.sections.length === 1 ? "" : "s"}
            {cancelled > 0 ? ` (${cancelled} cancelled)` : ""}
          </p>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
          <Row k="Stage" v={FULL_COUNT_STAGE_LABEL[fc.rollup.stage]} />
          <Row k="Created" v={fmtDate(fc.createdAt)} />
          <Row k="Sections posted" v={`${fc.rollup.posted} of ${live.length}`} />
          <Row k="Printed" v={fmtDate(printedAt.toISOString())} />
        </dl>

        <Section title={`${num()} Scope, and why these items`}>
          <p className="text-sm leading-relaxed">
            Every active lot at the moment the full count was created was put into scope:{" "}
            {totals.totalLines} lot{totals.totalLines === 1 ? "" : "s"} across {live.length} live
            section{live.length === 1 ? "" : "s"}. {totals.counted} were counted and{" "}
            {totals.uncounted} were not.
          </p>
          <p className="mt-2 text-xs leading-relaxed">
            A full count is not a sample. It is the once-a-year count of everything, split into
            sections by vendor (A to Z, never splitting a product across sections) so several
            people can count at once. Each section is an ordinary blind audit with its own scope
            note, cut-off and approval.
          </p>
          <table className="mt-3 w-full border-collapse text-left text-[11px]">
            <thead>
              <tr className="border-b border-white/20">
                <th className="py-1.5 pr-2 font-semibold">Section</th>
                <th className="py-1.5 pr-2 font-semibold">Status</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Lots</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Counted</th>
                <th className="py-1.5 pr-2 font-semibold">Counted by</th>
                <th className="py-1.5 font-semibold">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {fc.sections.map((s) => (
                <tr key={s.id} className="border-b border-white/10 align-top">
                  <td className="py-1.5 pr-2">
                    {s.sectionNo} of {s.sectionCount}
                  </td>
                  <td className="py-1.5 pr-2">
                    {s.postedAt ? "posted" : isAuditSessionStatus(s.status) ? LABELS[s.status] : s.status}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{s.plannedLotCount}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{s.countedLotCount}</td>
                  <td className="py-1.5 pr-2">{s.claimedByName ?? "not claimed"}</td>
                  <td className="py-1.5">{s.submittedAt ? fmtDate(s.submittedAt) : "\u2014"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title={`${num()} Method`}>
          <ul className="space-y-1 text-sm leading-relaxed">
            <li>
              Counted BLIND, section by section. The expected quantity was never sent to any
              counting screen.
            </li>
            <li>
              Each section was claimed by one counter, so two people never counted the same lots.
            </li>
            <li>
              The books quantity for each lot was recorded the moment that lot was first counted. A
              sale or receipt on a lot while it was being counted blocks posting until it is
              recounted.
            </li>
            <li>
              {totals.scanned} of {lines.length} entries were captured by barcode scan; the
              remainder were typed by hand and are labelled as such below.
            </li>
            <li>Differences were valued at recorded invoice cost, never at retail.</li>
          </ul>
        </Section>

        <Section title={`${num()} Materiality threshold`}>
          <p className="text-sm leading-relaxed">{describeMateriality(DEFAULT_MATERIALITY)}</p>
          <p className="mt-2 text-xs leading-relaxed">
            The same threshold applies to every section and was set before the count.
          </p>
        </Section>

        <Section title={`${num()} Combined results`}>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Fig k="Lots in scope" v={String(totals.totalLines)} />
            <Fig k="Exactly right" v={String(totals.clean)} />
            <Fig
              k="Total error (gross)"
              v={totals.grossVarianceCents === null ? "not calculable" : formatCents(totals.grossVarianceCents)}
            />
            <Fig
              k="Net effect on books"
              v={totals.netVarianceCents === null ? "not calculable" : formatCents(totals.netVarianceCents)}
            />
          </div>
          <p className="mt-3 text-xs leading-relaxed">
            GROSS adds the sizes of the differences and ignores their direction. NET lets an
            overage cancel a shortage. A total reads &ldquo;not calculable&rdquo; if any one section
            cannot be valued, rather than quietly leaving that section out.
          </p>
        </Section>

        <Section title={`${num()} Exceptions and detail (all sections)`}>
          <table className="w-full border-collapse text-left text-[11px]">
            <thead>
              <tr className="border-b border-white/20">
                <th className="py-1.5 pr-2 font-semibold">Sec</th>
                <th className="py-1.5 pr-2 font-semibold">Lot</th>
                <th className="py-1.5 pr-2 font-semibold">Product</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Books</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Counted</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Diff</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Value</th>
                <th className="py-1.5 pr-2 font-semibold">How</th>
                <th className="py-1.5 font-semibold">Reason recorded</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((l) => {
                const a = l.assessment;
                const reason = findVarianceReason(l.reasonCode);
                return (
                  <tr key={`${l.sectionNo}-${l.lotId}`} className="border-b border-white/10 align-top">
                    <td className="py-1.5 pr-2 tabular-nums">{l.sectionNo}</td>
                    <td className="py-1.5 pr-2 font-mono">{l.lotCode ?? "NO LOT CODE"}</td>
                    <td className="py-1.5 pr-2">{l.productName ?? "unnamed"}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{l.systemQty.toLocaleString()}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {l.countedQty === null ? "not counted" : l.countedQty.toLocaleString()}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {a.varianceQty === null
                        ? "\u2014"
                        : `${a.varianceQty > 0 ? "+" : ""}${a.varianceQty.toLocaleString()}`}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {a.varianceCents === null ? "no cost on file" : formatCents(a.varianceCents)}
                    </td>
                    <td className="py-1.5 pr-2">
                      {l.captureMethod === "scan" ? "scanned" : l.captureMethod === "manual" ? "typed" : "\u2014"}
                    </td>
                    <td className="py-1.5">
                      {reason ? (
                        <>
                          {reason.label}
                          {l.reasonNote ? ` \u2014 ${l.reasonNote}` : ""}
                          {reason.costsTax ? " [treated as a taxable disappearance]" : ""}
                        </>
                      ) : a.requiresDocumentation ? (
                        "NONE RECORDED"
                      ) : (
                        "\u2014"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>

        {blockers.length > 0 ? (
          <Section title={`${num()} Outstanding items at the time of printing`}>
            <ul className="space-y-1.5 text-sm leading-relaxed">
              {blockers.map((b) => (
                <li key={b}>&bull; {b}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs leading-relaxed">
              Printed rather than omitted: a paper showing only the finished sections of an
              unfinished count would invite a conclusion the evidence does not support.
            </p>
          </Section>
        ) : null}

        <Section title={`${num()} What this count does and does not establish`}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide">It does establish</p>
              <ul className="mt-1 space-y-1 text-xs leading-relaxed">
                {PROVES_AND_DOES_NOT.proves.map((x) => (
                  <li key={x}>&bull; {x}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide">It does NOT establish</p>
              <ul className="mt-1 space-y-1 text-xs leading-relaxed">
                {PROVES_AND_DOES_NOT.doesNotProve.map((x) => (
                  <li key={x}>&bull; {x}</li>
                ))}
              </ul>
            </div>
          </div>
        </Section>

        <div className="mt-6 border-t border-white/15 pt-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide">Approval</p>
          {allPosted ? (
            <p className="mt-1 text-sm">
              Every live section was approved and posted to the books. Each approving user is
              recorded against its section and in the activity log.
            </p>
          ) : allApproved ? (
            <p className="mt-1 text-sm">
              Every live section is approved; not every section is posted yet.
            </p>
          ) : (
            <p className="mt-1 text-sm">
              NOT YET APPROVED. At least one section is still being counted or reviewed. This paper
              should not be filed as a completed year-end count.
            </p>
          )}
          <div className="mt-6 grid grid-cols-2 gap-8 text-xs">
            <div className="border-t border-white/40 pt-1">Count supervised by / date</div>
            <div className="border-t border-white/40 pt-1">Reviewed by / date</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">{k}</dt>
      <dd className="text-xs">{v}</dd>
    </div>
  );
}

function Fig({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">{k}</p>
      <p className="tabular-nums">{v}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 border-t border-white/10 pt-4">
      <h3 className="text-sm font-bold">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}
