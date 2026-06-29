/**
 * src/components/admin/ai/AiAcceptRatePanel.tsx
 *
 * AI-4 accept-rate + provenance reporting (DF-5). Shows how often staff ACCEPT
 * vs REJECT AI drafts, sliced by the levers we can actually tune: prompt
 * version, provenance source (model vs crawler-grounded vs KB), feature, and
 * confidence band (is the model's self-confidence calibrated?).
 *
 * Server component (presentational). Renders nothing of consequence when there
 * are no reviewed drafts yet, with a gentle "no decisions yet" hint.
 */
import type { AcceptRateReport, AcceptRateBucket } from "@/lib/ai/usage";

function pctLabel(rate: number | null): string {
  if (rate == null) return "—";
  return `${Math.round(rate * 100)}%`;
}

function rateTone(rate: number | null): string {
  if (rate == null) return "text-white/40";
  if (rate >= 0.75) return "text-emerald-300";
  if (rate >= 0.45) return "text-amber-300";
  return "text-red-300";
}

function reviewedCount(b: AcceptRateBucket): number {
  return b.accepted + b.edited + b.rejected;
}

function BucketTable({
  title,
  hint,
  buckets,
}: {
  title: string;
  hint?: string;
  buckets: AcceptRateBucket[];
}) {
  const rows = buckets.filter((b) => reviewedCount(b) > 0 || b.pending > 0);
  return (
    <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      {hint ? <p className="mt-1 text-[11px] text-white/40">{hint}</p> : null}
      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-white/40">No drafts in this window yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[28rem] border-collapse text-xs">
            <thead>
              <tr className="text-left text-white/40">
                <th className="py-1.5 pr-3 font-medium">Group</th>
                <th className="py-1.5 pr-3 text-right font-medium">Accepted</th>
                <th className="py-1.5 pr-3 text-right font-medium">Edited</th>
                <th className="py-1.5 pr-3 text-right font-medium">Rejected</th>
                <th className="py-1.5 pr-3 text-right font-medium">Pending</th>
                <th className="py-1.5 text-right font-medium">Accept rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.key} className="border-t border-white/[0.06]">
                  <td className="py-1.5 pr-3 font-semibold text-white/80">{b.key}</td>
                  <td className="py-1.5 pr-3 text-right text-emerald-300/90">{b.accepted}</td>
                  <td className="py-1.5 pr-3 text-right text-white/70">{b.edited}</td>
                  <td className="py-1.5 pr-3 text-right text-red-300/80">{b.rejected}</td>
                  <td className="py-1.5 pr-3 text-right text-white/40">{b.pending}</td>
                  <td className={`py-1.5 text-right font-bold ${rateTone(b.acceptRate)}`}>
                    {pctLabel(b.acceptRate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AiAcceptRatePanel({ report, days = 90 }: { report: AcceptRateReport; days?: number }) {
  const t = report.totals;
  const reviewed = reviewedCount(t);
  const totalDrafts = reviewed + t.pending;

  return (
    <section className="mt-8 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-white">AI draft accept-rate</h2>
          <p className="text-[11px] text-white/40">
            How often staff accept AI drafts — last {days} days. &ldquo;Edited&rdquo; counts as a qualified accept.
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span className="text-white/50">
            {totalDrafts} draft{totalDrafts === 1 ? "" : "s"} · {reviewed} reviewed · {t.pending} pending
          </span>
          <span className={`text-base font-black ${rateTone(t.acceptRate)}`}>{pctLabel(t.acceptRate)}</span>
        </div>
      </div>

      {totalDrafts === 0 ? (
        <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5 text-xs text-white/40">
          No AI drafts have been generated yet. Once staff use the ✨ AI buttons and review the
          results, accept-rate trends will appear here — broken down by prompt version, provenance,
          feature, and confidence so you can see what&rsquo;s working.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <BucketTable
            title="By provenance source"
            hint="Are crawler-grounded drafts (researched) accepted more than ungrounded model drafts?"
            buckets={report.bySource}
          />
          <BucketTable
            title="By confidence band"
            hint="Is the model's self-reported confidence calibrated — do high-confidence drafts get accepted?"
            buckets={report.byConfidenceBand}
          />
          <BucketTable
            title="By feature"
            hint="Which features draft best (product / vendor / brand)?"
            buckets={report.byEntityType}
          />
          <BucketTable
            title="By prompt version"
            hint="Did a prompt change improve or regress acceptance?"
            buckets={report.byPromptVersion}
          />
        </div>
      )}
    </section>
  );
}
