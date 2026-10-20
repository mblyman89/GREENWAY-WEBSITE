/**
 * S-17d: the integrator hand-over plan on the CCRS hub. Server component (no
 * hooks); every date and warning comes from the PURE planHandover.
 */
import type { HandoverFacts, HandoverPlan, HandoverSeverity } from "@/lib/compliance/ccrs-handover-core";
import type { LedgerEnv } from "@/lib/compliance/ccrs-ledger-core";
import { Button } from "@/components/admin/ui";

const SEVERITY_CLASS: Record<HandoverSeverity, string> = {
  block: "border-red-500/40 bg-red-500/10 text-red-100",
  warn: "border-amber-400/40 bg-amber-400/10 text-amber-100",
  info: "border-sky-400/30 bg-sky-400/10 text-sky-100",
};

const SEVERITY_LABEL: Record<HandoverSeverity, string> = {
  block: "Fix before the first upload",
  warn: "Check",
  info: "Note",
};

export function HandoverPlanCard({
  plan,
  facts,
  canEdit,
  weekKey,
  env,
  action,
}: {
  plan: HandoverPlan;
  facts: HandoverFacts;
  canEdit: boolean;
  weekKey: string;
  env: LedgerEnv;
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <div className="space-y-3 text-xs text-white/70" data-testid="handover-plan">
      {plan.greenwayFirstWeek && plan.greenwayFirstDue ? (
        <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3 text-emerald-50">
          <p className="text-sm font-bold" data-testid="handover-first-due">
            Your first upload: week {plan.greenwayFirstWeek.start} to {plan.greenwayFirstWeek.end}, due Sunday{" "}
            {plan.greenwayFirstDue}.
          </p>
          <p className="mt-1">
            You can upload it as early as Saturday {plan.greenwayEarliestUpload} after close.
            {plan.greenwaySecondWeek
              ? ` The week after (${plan.greenwaySecondWeek.start} to ${plan.greenwaySecondWeek.end}) is due Sunday ${plan.greenwaySecondWeek.due}.`
              : ""}
          </p>
          {plan.integratorLastWeek ? (
            <p className="mt-1 text-emerald-50/80">
              Cultivera&rsquo;s last week: {plan.integratorLastWeek.start} to {plan.integratorLastWeek.end}, due Sunday{" "}
              {plan.integratorLastWeek.due}
              {plan.integratorLastSaleAssumed ? " (assumed: last sale the day before your first day of sales)" : ""}.
            </p>
          ) : null}
        </div>
      ) : null}

      {plan.warnings.length > 0 ? (
        <ul className="space-y-2">
          {plan.warnings.map((w) => (
            <li key={w.code} className={`rounded-lg border p-2 ${SEVERITY_CLASS[w.severity]}`} data-code={w.code}>
              <span className="font-bold">{SEVERITY_LABEL[w.severity]}:</span> {w.text}
              <span className="mt-0.5 block text-[10px] opacity-60">{w.cite}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {plan.steps.length > 0 ? (
        <ol className="list-decimal space-y-1 pl-5">
          {plan.steps.map((s) => (
            <li key={s.id} data-step={s.id}>
              <strong className="text-white/85">{s.id}</strong> {s.text}{" "}
              <span className="text-[10px] text-white/35">{s.cite}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {canEdit ? (
        <form action={action} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="week_key" value={weekKey} />
          <input type="hidden" name="env" value={env} />
          <label className="text-[11px] text-white/50">
            Cultivera&rsquo;s last sale day
            <input
              type="date"
              name="integrator_last_sale"
              defaultValue={facts.integratorLastSaleDate ?? ""}
              className="mt-1 block rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white/80"
            />
          </label>
          <label className="text-[11px] text-white/50">
            Cultivera&rsquo;s final upload day (from them, in writing)
            <input
              type="date"
              name="integrator_final_upload"
              defaultValue={facts.integratorFinalUploadDate ?? ""}
              className="mt-1 block rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white/80"
            />
          </label>
          <Button type="submit" variant="save" size="sm">
            Save hand-over dates
          </Button>
          <span className="text-[11px] text-white/35">Leave a box empty if you do not know the date yet.</span>
        </form>
      ) : (
        <p className="text-white/40">Changing these requires the &ldquo;Change settings&rdquo; permission.</p>
      )}
    </div>
  );
}
