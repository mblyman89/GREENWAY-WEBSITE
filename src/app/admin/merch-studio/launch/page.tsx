/**
 * /admin/merch-studio/launch: Setup & Launch coach (D232 slice M-3a, G-78,
 * SOP-11 Appendix B.5 item 1).
 *
 * Owner (D231, verbatim): "first step, do this, done great, step two…".
 * One card per SOP-11 §4.2 step S-1 … S-12 plus the §4.5 test order. Each card
 * says what to do (exact clicks, copy buttons, links), how we know it is done
 * (Merch Health checks, live, and/or the owner's tick) and its status. Done
 * cards collapse with "✅ Great, done!"; the first open card says "Next:".
 * A step whose check goes red later re-opens ("Needs you").
 *
 * Owner & admin only (settings.manage).
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Badge, Card } from "@/components/admin/ui";
import { CopyValue, LaunchNote, LaunchTick } from "@/components/admin/merch-studio/LaunchControls";
import { RunMerchHealthButton, TokenExpiryForm } from "@/components/admin/merch-studio/MerchHealthControls";
import { gatherMerchHealth, readHealthSettings } from "@/lib/merch/merch-health-server";
import { readLaunchProgress } from "@/lib/merch/merch-launch-server";
import { MERCH_LAUNCH_RECORD_PAGE, progressLine, stepNumber, summarizeLaunch, type LaunchStatus } from "@/lib/merch/merch-launch-core";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATUS: Record<LaunchStatus, { icon: string; label: string; tone: "green" | "gold" | "danger" | "neutral" }> = {
  done: { icon: "✅", label: "Done", tone: "green" },
  "in-progress": { icon: "🟡", label: "In progress", tone: "gold" },
  "needs-you": { icon: "⛔", label: "Needs you", tone: "danger" },
  "not-started": { icon: "⬜", label: "Not started", tone: "neutral" },
};

export default async function MerchLaunchPage() {
  await requirePermission("settings.manage");
  const [report, prog, settings] = await Promise.all([gatherMerchHealth(), readLaunchProgress(), readHealthSettings()]);
  const sum = summarizeLaunch(report, prog.progress);
  const pct = Math.round((sum.done / sum.total) * 100);

  return (
    <div>
      <AdminPageHeader
        title="Setup & Launch"
        subtitle="Set up greenwaymerch.com one step at a time. Each step says exactly what to click, and turns green when it is done."
        breadcrumbs={<Breadcrumbs items={[{ label: "MKTG & ADV" }, { label: "Merch Studio", href: "/admin/merch-studio" }, { label: "Setup & Launch" }]} />}
        action={<RunMerchHealthButton />}
        helpId="merch-studio"
      />
      <div className="space-y-4 px-5 py-6 sm:px-8">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold">{progressLine(sum)}</p>
            <div className="flex flex-wrap gap-3 text-sm">
              <Link href={MERCH_LAUNCH_RECORD_PAGE} className="text-[var(--admin-accent)] hover:underline">Print setup record (form 8.1)</Link>
              <Link href="/admin/merch-studio/health" className="text-[var(--admin-accent)] hover:underline">Merch Health</Link>
            </div>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-[var(--admin-accent)]" style={{ width: `${pct}%` }} />
          </div>
          {sum.next ? (
            <p className="mt-2 text-sm">
              <strong>Next:</strong> {stepNumber(sum.next.step.id)} · {sum.next.step.title}
            </p>
          ) : null}
          {sum.shopUnknown ? (
            <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
              The shop&apos;s own checks are Unknown until <code>MERCH_HEALTH_TOKEN</code> is set in both Vercel projects (step 1 makes Token D; steps 9 and 12 add it). Until then, those steps wait.
            </p>
          ) : null}
          {prog.error ? <p className="mt-2 text-sm text-[var(--admin-danger)]">Could not read saved progress: {prog.error}</p> : null}
        </Card>

        {sum.steps.map((s) => {
          const st = STATUS[s.status];
          const isNext = sum.next?.step.id === s.step.id;
          const open = s.status !== "done";
          return (
            <Card key={s.step.id}>
              <details open={open && (isNext || s.status === "needs-you")}>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                  <span aria-hidden>{st.icon}</span>
                  <span className="font-semibold">
                    {stepNumber(s.step.id)} · {s.step.title}
                  </span>
                  <Badge tone={st.tone}>{s.status === "done" ? "✅ Great, done!" : st.label}</Badge>
                  {isNext ? <Badge tone="orange">Next</Badge> : null}
                  <span className="text-xs text-[var(--admin-text-muted)]">about {s.step.minutes} min · SOP-11 {s.step.sop}</span>
                </summary>
                <div className="mt-3 space-y-3 text-sm">
                  <p className="text-[var(--admin-text-muted)]">{s.why}</p>
                  <ol className="list-decimal space-y-1 pl-5">
                    {s.step.todo.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ol>
                  {s.step.copy.length ? <div className="space-y-1">{s.step.copy.map((c) => <CopyValue key={c.label} label={c.label} value={c.value} />)}</div> : null}
                  {s.step.links.length ? (
                    <p className="flex flex-wrap gap-3">
                      {s.step.links.map((l) => (
                        <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="text-[var(--admin-accent)] hover:underline">
                          {l.label} ↗
                        </a>
                      ))}
                    </p>
                  ) : null}
                  <p>
                    <strong>✅ You know it worked when:</strong> {s.step.doneWhen}
                  </p>
                  {s.proofs.length ? (
                    <ul className="space-y-1">
                      {s.proofs.map((p) => (
                        <li key={p.id} className="rounded bg-[var(--admin-surface-2)] px-2 py-1">
                          <Badge tone={p.level === "ok" ? "green" : p.level === "warn" ? "gold" : p.level === "fail" ? "danger" : "neutral"}>{p.passed ? "Passed" : p.level === "unknown" ? "Unknown" : "Not yet"}</Badge>{" "}
                          {p.id} {p.title}: {p.detail}
                          {!p.passed && p.fix ? <span className="block text-xs text-[var(--admin-text-muted)]">Fix: {p.fix}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {s.step.id === "S-4" ? <TokenExpiryForm current={settings.printfulTokenExpires} /> : null}
                  {s.step.note ? <LaunchNote field={s.step.note.key} label={s.step.note.label} type={s.step.note.type} current={prog.progress.notes[s.step.note.key] ?? ""} /> : null}
                  {s.step.manual ? <LaunchTick stepId={s.step.id} ticked={s.ticked} /> : null}
                </div>
              </details>
            </Card>
          );
        })}

        <Card>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">Sign the setup record</h2>
          <p className="mt-1 text-sm">When every step is done, sign form 8.1. The printed copy shows these.</p>
          <div className="mt-2 flex flex-wrap gap-4">
            <LaunchNote field="signedBy" label="Signed by" type="text" current={prog.progress.notes.signedBy ?? ""} />
            <LaunchNote field="signedOn" label="Signed on" type="date" current={prog.progress.notes.signedOn ?? ""} />
          </div>
        </Card>
      </div>
    </div>
  );
}
