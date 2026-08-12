/**
 * TaxCenter.tsx — presentational component for the crypto Tax Center tab (R1-F6).
 *
 * ALL tax logic lives in the pure cores (crypto-tax-center-core, the F3/F4/F5
 * engines). This component only renders the already-computed view-model:
 *   - a per-year card with the capital-gain & income headline numbers,
 *   - the "file-ready" badge and the plain-English open blocks,
 *   - the method sandbox (planning) comparison, and
 *   - a one-click link to the printable Audit Binder export.
 * It contains no business logic and no money math beyond reading pre-formatted
 * strings from the view-model.
 */
import Link from "next/link";
import type { TaxCenterView, TaxCenterYearView } from "@/lib/crypto/crypto-tax-center-core";

const cardCls = "rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-5";

function readyBadge(y: TaxCenterYearView) {
  if (y.fileReady) {
    return (
      <span className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-1 text-xs font-semibold text-emerald-300">
        ✓ File-ready
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full border border-red-500/30 bg-red-500/[0.06] px-3 py-1 text-xs font-semibold text-red-300">
      ⚠ Not ready — {y.blockingCount} open block{y.blockingCount === 1 ? "" : "s"}
    </span>
  );
}

function severityCls(sev: string): string {
  if (sev === "blocking") return "border-red-500/30 bg-red-500/[0.05] text-red-200";
  if (sev === "warning") return "border-amber-500/40 bg-amber-500/[0.06] text-amber-200";
  return "border-white/15 bg-white/[0.03] text-white/70";
}

function YearCard({ y }: { y: TaxCenterYearView }) {
  return (
    <div className={cardCls}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-white">Tax year {y.taxYear}</h2>
        <div className="flex items-center gap-2">
          {y.yearLocked ? (
            <span className="shrink-0 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-white/60">
              Locked (filed)
            </span>
          ) : null}
          {readyBadge(y)}
        </div>
      </div>

      {/* Headline figures */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-3">
          <div className="text-xs uppercase tracking-wide text-white/40">Net capital gain/(loss)</div>
          <div className="mt-1 text-lg font-semibold text-white">{y.netCapitalGainDisplay}</div>
          <div className="mt-1 text-xs text-white/50">{y.form8949RowCount} Form 8949 row{y.form8949RowCount === 1 ? "" : "s"}</div>
        </div>
        <div className="rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-3">
          <div className="text-xs uppercase tracking-wide text-white/40">Ordinary income</div>
          <div className="mt-1 text-lg font-semibold text-white">{y.totalIncomeDisplay}</div>
          <div className="mt-1 text-xs text-white/50">Schedule 1 + Schedule C</div>
        </div>
        <div className="rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-3">
          <div className="text-xs uppercase tracking-wide text-white/40">Loss carried forward</div>
          <div className="mt-1 text-lg font-semibold text-white">{y.carryforwardDisplay}</div>
          <div className="mt-1 text-xs text-white/50">To next tax year</div>
        </div>
      </div>

      {/* Method sandbox (planning) */}
      <div className="mt-4 rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-3">
        <div className="text-xs uppercase tracking-wide text-white/40">Method planner (what-if)</div>
        {y.potentialReductionVsFifoCents > 0 ? (
          <p className="mt-1 text-sm text-white/70">
            Your gain is figured with <span className="font-semibold text-white">FIFO</span> (always
            allowed). Switching to <span className="font-semibold text-white">{y.lowestGainMethod.toUpperCase()}</span> could
            lower this year&apos;s gain — but only if you had a{" "}
            <span className="font-semibold text-amber-300">recorded standing order</span> identifying
            those lots at the time of each sale. Without that record, FIFO applies.
          </p>
        ) : (
          <p className="mt-1 text-sm text-white/60">
            FIFO is used (the IRS default, always allowed). No other method would lower this year&apos;s gain.
          </p>
        )}
      </div>

      {/* Open items */}
      {y.issues.length > 0 ? (
        <div className="mt-4 space-y-2">
          <div className="text-xs uppercase tracking-wide text-white/40">
            What to fix before filing {y.taxYear}
          </div>
          {y.issues.map((iss) => (
            <div
              key={`${y.taxYear}-${iss.check}`}
              className={`rounded-[var(--admin-radius)] border px-3 py-2 text-sm ${severityCls(iss.severity)}`}
            >
              <div className="font-semibold">
                {iss.severity === "blocking" ? "⛔" : iss.severity === "warning" ? "⚠" : "ℹ"} {iss.title}
                {iss.count > 0 ? <span className="ml-1 opacity-70">({iss.count})</span> : null}
              </div>
              <div className="mt-0.5 opacity-90">{iss.fix}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-emerald-300">
          ✓ Nothing outstanding — this year is clean and ready to file.
        </p>
      )}

      {/* Audit binder for this year */}
      <div className="mt-4">
        <Link
          href={`/admin/crypto/audit-binder?year=${y.taxYear}`}
          target="_blank"
          className="rounded-[var(--admin-radius)] border border-white/15 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.08]"
        >
          Open {y.taxYear} audit binder (print → PDF)
        </Link>
      </div>
    </div>
  );
}

export function TaxCenter({ view }: { view: TaxCenterView }) {
  return (
    <div className="space-y-6">
      <div className={cardCls}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="mb-1 text-sm font-semibold text-white">Tax Center</h2>
            <p className="text-sm text-white/60">
              Your crypto gains and income, turned into the exact lines you file — Form 8949 &amp;
              Schedule D for sales, Schedule 1 / Schedule C for income. A year is marked{" "}
              <span className="font-semibold text-emerald-300">file-ready</span> only when nothing is
              missing. We never fill a missing cost or price with $0 — anything unresolved is shown
              below with a plain-English fix.
            </p>
          </div>
          <Link
            href="/admin/crypto/audit-binder"
            target="_blank"
            className="shrink-0 rounded-[var(--admin-radius)] bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400"
          >
            Audit Binder — all years
          </Link>
        </div>
      </div>

      {view.years.length === 0 ? (
        <div className={cardCls}>
          <p className="text-sm text-white/50">
            No tax years to report yet. Connect your wallets, run a sync, and classify your
            transactions on the Classify tab — priced sales and income will appear here, grouped by
            tax year, with a file-ready checklist for each.
          </p>
        </div>
      ) : (
        view.years
          .slice()
          .sort((a, b) => b.taxYear - a.taxYear)
          .map((y) => <YearCard key={y.taxYear} y={y} />)
      )}
    </div>
  );
}
