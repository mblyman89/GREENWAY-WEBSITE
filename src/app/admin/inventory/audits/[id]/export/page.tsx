/**
 * src/app/admin/inventory/audits/[id]/export/page.tsx   (slice books-12)
 *
 * THE WORK PAPER.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS ROUTE EXISTS AT ALL
 * ---------------------------------------------------------------------------
 * A count that lives only inside a web application is not much use to the two
 * audiences that eventually ask about it: an LCB inspector, and whoever
 * prepares the tax return. Both of them work in paper and PDF. Michael also
 * still owes work papers on the open items, so a count that can be printed the
 * moment it is finished removes a job rather than adding one.
 *
 * This is deliberately a PAGE and not a CSV download. A spreadsheet of numbers
 * with no scope, no materiality threshold, no signature and no statement of
 * what the count does and does not prove is not a work paper -- it is a data
 * dump that looks like one. Everything a reviewer needs to judge the evidence
 * is on the sheet next to the evidence.
 *
 * ---------------------------------------------------------------------------
 * WHY IT PRINTS THE LIMITATIONS TOO
 * ---------------------------------------------------------------------------
 * The "what this does not prove" block is not humility for its own sake. A
 * count proves existence and condition. It does NOT prove ownership -- and
 * consignment product sitting on the shelf is not Michael's. It does not prove
 * value. Stating that on the paper is what stops the paper being read as a
 * broader assurance than it is, which is the exact criticism a work paper is
 * supposed to pre-empt.
 *
 * ---------------------------------------------------------------------------
 * PRINT BEHAVIOUR
 * ---------------------------------------------------------------------------
 * @page rules and a print stylesheet are inlined here rather than added to
 * globals.css, because they must apply to THIS document only. The screen
 * version stays on the dark house theme; the printed version switches to black
 * on white, because a dark-background print wastes toner and photocopies badly
 * -- and a work paper's whole job is to be photocopied.
 */
import { requirePermission } from "@/lib/auth/session";
import { Breadcrumbs } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui";
import { formatCents } from "@/lib/accounting/books-view-core";
import { getAuditReview } from "@/lib/inventory/audit-hub-store";
import { LABELS } from "@/lib/inventory/inventory-audit-post-core";
import { DEFAULT_MATERIALITY } from "@/lib/inventory/inventory-audit-core";
import {
  describeMateriality,
  PROVES_AND_DOES_NOT,
  findVarianceReason,
} from "@/lib/inventory/audit-hub-guidance-core";
import { HubRefusal } from "../../HubRefusal";

export const dynamic = "force-dynamic";

/**
 * The legal entity, spelled the way it is registered.
 *
 * "GREENWAY" is spelled out deliberately. A transposed trade name (GRWNY /
 * GRNWY) is one of the documented historical errors in these books, and a work
 * paper carrying a misspelled entity name is a work paper somebody can argue
 * belongs to a different business.
 */
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
    .wp .pb { page-break-before: always; }
  }
`;

export default async function WorkPaperPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // books-23: owner only. The work papers price every difference, so this is a
  // financial document even though it lives under Inventory.
  await requirePermission("inventory.audit");
  const { id } = await params;
  const review = await getAuditReview(id);

  if (!review.ok) {
    return (
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { label: "Inventory", href: "/admin/inventory" },
            { label: "Auditing", href: "/admin/inventory/audits" },
            { label: "Work paper" },
          ]}
        />
        <HubRefusal refusal={review.refusal} context="the work paper" />
      </div>
    );
  }

  const { session, lines, readiness } = review.data;
  const printedAt = new Date();

  // Counted lines only, ordered by size of difference. A reviewer reads the
  // biggest exception first; alphabetical order would bury it.
  const ordered = [...lines].sort((a, b) => {
    const av = Math.abs(a.assessment.varianceCents ?? 0);
    const bv = Math.abs(b.assessment.varianceCents ?? 0);
    return bv - av;
  });

  const scannedCount = lines.filter((l) => l.captureMethod === "scan").length;

  return (
    <div className="space-y-6">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <div className="no-print space-y-4">
        <Breadcrumbs
          items={[
            { label: "Inventory", href: "/admin/inventory" },
            { label: "Auditing", href: "/admin/inventory/audits" },
            { label: session.label, href: `/admin/inventory/audits/${id}` },
            { label: "Work paper" },
          ]}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-white">Work paper</h1>
            <p className="text-sm text-[var(--admin-text-muted)]">
              Use your browser&apos;s print dialog and choose &ldquo;Save as PDF&rdquo;. It prints
              black on white, so it photocopies and files properly.
            </p>
          </div>
          <Button href={`/admin/inventory/audits/${id}`} variant="neutral" size="sm">
            Back to the audit
          </Button>
        </div>
      </div>

      {/* ══ THE PAPER ═══════════════════════════════════════════════════ */}
      <div className="wp rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-white">
        {/* ── Heading block ──────────────────────────────────────────── */}
        <div className="border-b border-white/15 pb-4">
          <p className="text-xs uppercase tracking-widest text-[var(--admin-text-muted)]">
            Inventory count work paper
          </p>
          <h2 className="mt-1 text-xl font-bold">{ENTITY}</h2>
          <p className="mt-1 text-sm">{session.label}</p>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
          <Row k="Status" v={session.postedAt ? "posted" : LABELS[session.status]} />
          <Row k="Created" v={fmtDate(session.createdAt)} />
          <Row k="Scope agreed" v={session.scopeApprovedAt ? fmtDate(session.scopeApprovedAt) : "not recorded"} />
          <Row k="Result approved" v={session.resultApprovedAt ? fmtDate(session.resultApprovedAt) : "not approved"} />
          <Row k="Posted to the books" v={session.postedAt ? fmtDate(session.postedAt) : "not posted"} />
          <Row k="Printed" v={fmtDate(printedAt.toISOString())} />
        </dl>

        {/* ── Scope and why ──────────────────────────────────────────── */}
        <Section title="1. Scope, and why these items">
          <p className="text-sm leading-relaxed">
            {session.plannedLotCount} lot{session.plannedLotCount === 1 ? "" : "s"} were selected
            for counting. {readiness.counted} were counted and {readiness.uncounted} were not.
          </p>
          {session.scopeRationale ? (
            <p className="mt-2 border-l-2 border-white/25 pl-3 text-sm italic leading-relaxed">
              &ldquo;{session.scopeRationale}&rdquo;
            </p>
          ) : (
            <p className="mt-2 text-sm">
              No scope rationale was recorded. A scope with no stated reason is weak evidence,
              because it cannot be distinguished from counting whatever was convenient.
            </p>
          )}
          <p className="mt-2 text-xs leading-relaxed">
            The reason above was recorded before any counted quantity was known. That ordering is
            what makes the selection defensible rather than a search for a comfortable answer.
          </p>
        </Section>

        {/* ── Method ─────────────────────────────────────────────────── */}
        <Section title="2. Method">
          <ul className="space-y-1 text-sm leading-relaxed">
            <li>
              Counted BLIND. The expected quantity was never sent to the counting screen, so no
              counter could have been influenced by it.
            </li>
            <li>
              Quantities and unit costs were frozen onto the sheet when the count was created, so
              a sale rung up mid-count cannot change the figure being measured.
            </li>
            <li>
              {scannedCount} of {lines.length} entries were captured by barcode scan; the remainder
              were typed by hand. Hand-typed entries are the weaker records and are labelled as
              such below.
            </li>
            <li>Differences were valued at recorded invoice cost, never at retail.</li>
          </ul>
        </Section>

        {/* ── Materiality ────────────────────────────────────────────── */}
        <Section title="3. Materiality threshold">
          <p className="text-sm leading-relaxed">{describeMateriality(DEFAULT_MATERIALITY)}</p>
          <p className="mt-2 text-xs leading-relaxed">
            This threshold was set before the count, not after seeing the results.
          </p>
        </Section>

        {/* ── Results ────────────────────────────────────────────────── */}
        <Section title="4. Results">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Fig k="Lots in scope" v={String(readiness.totalLines)} />
            <Fig k="Exactly right" v={String(readiness.clean)} />
            <Fig
              k="Total error (gross)"
              v={readiness.grossVarianceCents === null ? "not calculable" : formatCents(readiness.grossVarianceCents)}
            />
            <Fig
              k="Net effect on books"
              v={readiness.netVarianceCents === null ? "not calculable" : formatCents(readiness.netVarianceCents)}
            />
          </div>
          <p className="mt-3 text-xs leading-relaxed">
            GROSS adds the sizes of the differences and ignores their direction. NET lets an
            overage cancel a shortage. Gross is quoted first because a net figure near zero can
            hide a large amount of offsetting error &mdash; which is itself the signature of two
            batches of one product being counted as a single pile.
          </p>
        </Section>

        {/* ── The lines ──────────────────────────────────────────────── */}
        <Section title="5. Exceptions and detail">
          <table className="w-full border-collapse text-left text-[11px]">
            <thead>
              <tr className="border-b border-white/20">
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
                  <tr key={l.lotId} className="border-b border-white/10 align-top">
                    <td className="py-1.5 pr-2 font-mono">{l.lotCode ?? "NO LOT CODE"}</td>
                    <td className="py-1.5 pr-2">{l.productName ?? "unnamed"}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {l.systemQty.toLocaleString()}
                    </td>
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

        {/* ── Outstanding items ──────────────────────────────────────── */}
        {readiness.blockers.length > 0 ? (
          <Section title="6. Outstanding items at the time of printing">
            <ul className="space-y-1.5 text-sm leading-relaxed">
              {readiness.blockers.map((b) => (
                <li key={b}>&bull; {b}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs leading-relaxed">
              These are printed rather than omitted. A work paper that shows only the tidy parts of
              an unfinished count is worse than no work paper, because it invites a conclusion the
              evidence does not support.
            </p>
          </Section>
        ) : null}

        {/* ── Scope of the conclusion ────────────────────────────────── */}
        <Section title={readiness.blockers.length > 0 ? "7. What this count does and does not establish" : "6. What this count does and does not establish"}>
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
              <p className="text-[10px] font-semibold uppercase tracking-wide">
                It does NOT establish
              </p>
              <ul className="mt-1 space-y-1 text-xs leading-relaxed">
                {PROVES_AND_DOES_NOT.doesNotProve.map((x) => (
                  <li key={x}>&bull; {x}</li>
                ))}
              </ul>
            </div>
          </div>
        </Section>

        {/* ── Signature ──────────────────────────────────────────────── */}
        <div className="mt-6 border-t border-white/15 pt-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide">Approval</p>
          {session.resultApprovedAt ? (
            <p className="mt-1 text-sm">
              Approved in the system on {fmtDate(session.resultApprovedAt)}. The approving user is
              recorded against the session in the database and in the activity log.
            </p>
          ) : (
            <p className="mt-1 text-sm">
              NOT YET APPROVED. This paper reflects a count in progress and should not be filed as
              a completed procedure.
            </p>
          )}
          <div className="mt-6 grid grid-cols-2 gap-8 text-xs">
            <div className="border-t border-white/40 pt-1">Counted by / date</div>
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
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
        {k}
      </dt>
      <dd className="text-xs">{v}</dd>
    </div>
  );
}

function Fig({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
        {k}
      </p>
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

/** ISO to something a human reads, without pretending to know a timezone. */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}
