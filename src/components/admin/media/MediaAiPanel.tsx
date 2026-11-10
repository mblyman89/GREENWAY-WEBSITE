/**
 * src/components/admin/media/MediaAiPanel.tsx   (D221 M4)
 *
 * The "AI closer look" card on /admin/media: library health, the open run
 * (progress, spend vs budget) and the Start / Pause / Resume / Stop / Retry
 * buttons. Server component; every button is a plain form posting to
 * ../ai-actions (media.manage + audit). The work itself is the
 * /api/cron/media-describe worker (every 5 minutes, leased).
 */
import Link from "next/link";
import { Button } from "@/components/admin/ui/Button";
import { Input } from "@/components/admin/ui/Field";
import { estimateRunUsd } from "@/lib/media/media-describe-core";
import type { DescribePanel } from "@/lib/media/media-describe-store";

type Act = (formData: FormData) => Promise<void>;

const usd = (n: number | null | undefined) => (n === null || n === undefined ? "no cap" : `$${Number(n).toFixed(2)}`);

export function MediaAiPanel({
  panel,
  startAction,
  statusAction,
  retryAction,
}: {
  panel: DescribePanel;
  startAction: Act;
  statusAction: Act;
  retryAction: () => Promise<void>;
}) {
  const h = panel.health ?? {};
  const n = (k: string) => Number(h[k] ?? 0);
  const pending = n("ai_pending");
  const est = estimateRunUsd(pending);
  const run = panel.open;
  const last = panel.last && (!run || panel.last.id !== run.id) ? panel.last : null;

  return (
    <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--admin-text)]">AI closer look (alt text, SEO, brand check)</h2>
        <span className="text-[11px] text-[var(--admin-text-faint)]">Model {panel.model} · detail {panel.detail}</span>
      </div>
      {panel.error && <p className="mt-2 text-xs text-[var(--admin-orange)]">{panel.error}</p>}

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:grid-cols-7">
        {[
          ["Described", n("ai_described")],
          ["Waiting", pending],
          ["Failed", n("ai_failed")],
          ["Skipped", n("ai_skipped")],
          ["With SEO", n("with_seo")],
          ["Needs review", n("needs_review")],
          ["AI spend", `$${n("ai_spend_usd").toFixed(2)}`],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded border border-[var(--admin-border)] px-2 py-1.5">
            <div className="text-[var(--admin-text-faint)]">{label}</div>
            <div className="text-sm font-semibold text-[var(--admin-text)]">{value}</div>
          </div>
        ))}
      </div>

      {n("needs_review") > 0 && (
        <p className="mt-3 text-xs">
          <Link href="/admin/media/review" className="font-semibold text-[var(--admin-accent)] hover:underline">
            Open the review queue ({n("needs_review")}) →
          </Link>
        </p>
      )}

      {!panel.aiConfigured && (
        <p className="mt-3 text-xs text-[var(--admin-orange)]">AI is not configured on this deployment (OPENAI_API_KEY is missing on Vercel).</p>
      )}

      {run ? (
        <div className="mt-3 space-y-2 text-xs text-[var(--admin-text-muted)]">
          <p>
            Run <span className="font-semibold text-[var(--admin-text)]">{run.status}</span>: {run.done} described, {run.failed} failed, {run.skipped} skipped
            {run.total ? ` of about ${run.total}` : ""} · spent {usd(run.cost_usd)} of {usd(run.budget_usd)}
            {run.follow_new ? " · keeps describing new pictures" : ""}
            {run.last_tick_at ? ` · last worked ${new Date(run.last_tick_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}` : " · starts within 5 minutes"}
          </p>
          {run.last_error && <p className="text-[var(--admin-orange)]">Last problem: {run.last_error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {run.status === "running" || run.status === "queued" ? (
              <form action={statusAction}>
                <input type="hidden" name="run_id" value={run.id} />
                <input type="hidden" name="to" value="paused" />
                <Button type="submit" variant="neutral" size="sm">Pause</Button>
              </form>
            ) : (
              <form action={statusAction} className="flex items-center gap-2">
                <input type="hidden" name="run_id" value={run.id} />
                <input type="hidden" name="to" value="running" />
                <Input name="budget_usd" placeholder={`budget (now ${usd(run.budget_usd)})`} className="w-40" inputMode="decimal" />
                <Button type="submit" variant="confirm" size="sm">Resume</Button>
              </form>
            )}
            <form action={statusAction}>
              <input type="hidden" name="run_id" value={run.id} />
              <input type="hidden" name="to" value="cancelled" />
              <Button type="submit" variant="danger" size="sm">Stop</Button>
            </form>
          </div>
        </div>
      ) : (
        <form action={startAction} className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--admin-text-muted)]">
          <span>
            {pending} picture(s) waiting · estimated ${est.low.toFixed(2)}–${est.high.toFixed(2)}
          </span>
          <Input name="budget_usd" defaultValue="5" className="w-24" inputMode="decimal" aria-label="Budget in dollars" />
          <label className="flex items-center gap-1">
            <input type="checkbox" name="follow_new" defaultChecked /> keep describing new pictures as they are saved
          </label>
          <Button type="submit" variant="confirm" size="sm" disabled={!panel.aiConfigured}>Start</Button>
          {last && (
            <span className="w-full text-[11px] text-[var(--admin-text-faint)]">
              Last run {last.status}: {last.done} described, {last.failed} failed, spent {usd(last.cost_usd)}{last.last_error ? ` · ${last.last_error}` : ""}
            </span>
          )}
        </form>
      )}

      {n("ai_failed") > 0 && (
        <form action={retryAction} className="mt-2">
          <Button type="submit" variant="neutral" size="sm">Retry the {n("ai_failed")} failed</Button>
        </form>
      )}
      <p className="mt-2 text-[11px] leading-snug text-[var(--admin-text-faint)]">
        Runs on the server every 5 minutes, so you can close this tab. It stops by itself at the budget. AI text never replaces
        anything a person typed, and anything doubtful goes to the review queue instead of being changed.
      </p>
    </section>
  );
}
