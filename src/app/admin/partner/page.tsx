/**
 * /admin/partner  (D184, round slice S7)
 *
 * Greenway Partner. Owner (2026-11-05): "Set ai to be level 2 to start."
 *
 * Top: what the partner sees right now and the fixes it proposes, each bound
 * to one approved, audited tool. [auto] fixes touch nothing (any manager may
 * run them); fixes that change money, counts or CCRS wait for Michael.
 * Middle: ask it anything about the live data (it explains; it cannot write).
 * Bottom (Michael only): the level switch.
 */
import { requirePermission } from "@/lib/auth/session";
import { canReadBooks } from "@/lib/accounting/books-view-core";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Card } from "@/components/admin/ui";
import { PendingSubmit } from "@/components/admin/compliance/PendingSubmit";
import { PartnerChat } from "@/components/admin/partner/PartnerChat";
import { LEVEL_TEXT, mayApply, PARTNER_TOOLS, SELECTABLE_LEVELS } from "@/lib/ai/partner-core";
import { isAiConfigured, partnerNow } from "@/lib/ai/partner-store";
import { SALES_CHECK_PAGE, TAXES_OWED_PAGE } from "@/lib/compliance/ccrs-completeness-store";
import { applyProposalAction, savePartnerLevelAction } from "./actions";

export const dynamic = "force-dynamic";

const GATE_TEXT = {
  auto: { label: "Safe: any manager may run it", cls: "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]" },
  owner_approves: { label: "Michael approves", cls: "bg-amber-100 text-amber-900" },
  explain_only: { label: "Explain only (Level 1)", cls: "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)]" },
} as const;

export default async function PartnerPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const session = await requirePermission("staffing.manage");
  const isOwner = canReadBooks(session.profile.role);
  const sp = await searchParams;
  const { level, facts, proposals } = await partnerNow();

  return (
    <div>
      <AdminPageHeader
        title="Greenway Partner"
        subtitle="Your data partner: it reads the live database, explains in plain English, and proposes safe, audited fixes."
        breadcrumbs={<Breadcrumbs items={[{ label: "Dashboard", href: "/admin" }, { label: "Greenway Partner" }]} />}
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.error ? (
          <div role="alert" className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-4 py-3 text-sm text-[var(--admin-danger)]">
            {sp.error}
          </div>
        ) : null}
        {sp.saved ? (
          <div role="status" className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
            {sp.saved}
          </div>
        ) : null}

        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] px-4 py-3 text-sm" data-testid="partner-level">
          <span className="font-bold">{LEVEL_TEXT[level]}</span>
        </div>

        {facts.database ? (
          <div
            data-testid="partner-database"
            role={facts.database.status === "ok" ? "status" : "alert"}
            className={`rounded-[var(--admin-radius)] border px-4 py-3 text-sm ${facts.database.status === "ok" ? "border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]" : facts.database.status === "warn" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] text-[var(--admin-danger)]"}`}
          >
            <span className="font-bold">Database: </span>
            {facts.database.summary}{" "}
            <a className="underline" href="/admin/settings/platform-health">
              Vital signs
            </a>
          </div>
        ) : null}

        {facts.readErrors.length ? (
          <div role="alert" className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-4 py-3 text-sm text-[var(--admin-danger)]">
            The partner could not read everything, so fixes are paused until it can:
            <ul className="mt-1 list-disc pl-5">
              {facts.readErrors.slice(0, 8).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <Card>
          <div className="space-y-4 p-5" data-testid="partner-proposals">
            <h2 className="text-base font-bold text-[var(--admin-text)]">Fixes the partner proposes ({proposals.length})</h2>
            {!proposals.length ? <p className="text-sm text-[var(--admin-accent)]">Nothing to fix with a tool right now.</p> : null}
            {proposals.map((p) => {
              const g = GATE_TEXT[p.gate];
              const can = mayApply(p.gate, isOwner) && !facts.readErrors.length;
              return (
                <div key={p.id} id={p.id} className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-4 text-sm" data-testid={`proposal-${p.id}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-[var(--admin-text-muted)]">{p.id}</span>
                    <span className="font-semibold">{p.title}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${g.cls}`}>{g.label}</span>
                  </div>
                  <p className="mt-2">{p.why}</p>
                  <p className="mt-1 text-[var(--admin-text-muted)]">What it changes: {p.changes}</p>
                  <p className="mt-1 text-xs text-[var(--admin-text-muted)]">Tool: {PARTNER_TOOLS[p.tool].label}</p>
                  {can ? (
                    <form action={applyProposalAction} className="mt-3">
                      <input type="hidden" name="proposalId" value={p.id} />
                      <PendingSubmit busy="Fixing…" testId={`apply-${p.id}`} className="rounded-lg bg-[var(--admin-accent)] px-4 py-2 text-sm font-semibold text-white">
                        {p.gate === "owner_approves" ? "Approve and fix" : "Fix it"}
                      </PendingSubmit>
                    </form>
                  ) : p.gate === "owner_approves" ? (
                    <p className="mt-2 text-xs font-semibold text-amber-800">Waiting for Michael to approve.</p>
                  ) : null}
                </div>
              );
            })}
            <p className="text-xs text-[var(--admin-text-muted)]">
              Legal blocks (hours, limits, age, recalls) are never proposed: software never forces those. Sales that already have an order are finished on the order itself.
            </p>
          </div>
        </Card>

        <Card>
          <div className="space-y-3 p-5">
            <h2 className="text-base font-bold text-[var(--admin-text)]">Ask the partner</h2>
            {isAiConfigured ? (
              <PartnerChat />
            ) : (
              <p className="text-sm text-[var(--admin-text-muted)]">AI is not set up (AI_API_KEY). The fixes above work without it.</p>
            )}
          </div>
        </Card>

        <Card>
          <div className="space-y-2 p-5 text-sm">
            <h2 className="text-base font-bold text-[var(--admin-text)]">What the partner sees right now</h2>
            {facts.morning ? <p>Morning report: {facts.morning.headline}</p> : null}
            {facts.weeks.map((w) => (
              <p key={w.label}>
                CCRS {w.label}: {w.headline}
              </p>
            ))}
            <p>Open register exceptions: {facts.exceptions.length}</p>
            <p>Lots that sold more than they had: {facts.shortfalls.length}</p>
            <div className="flex flex-wrap gap-3 pt-1">
              <a className="underline" href={SALES_CHECK_PAGE}>
                CCRS sales check
              </a>
              <a className="underline" href={TAXES_OWED_PAGE}>
                Taxes owed
              </a>
              <a className="underline" href="/admin/registers/exceptions">
                Register exceptions
              </a>
              <a className="underline" href="/admin/registers/night-watch">
                Night watch
              </a>
            </div>
          </div>
        </Card>

        <HelpPanel
          id="partner"
          title="How the partner keeps your data safe"
          steps={[
            "The AI never writes to the database. It reads the facts and explains them.",
            "Every fix is worked out by fixed rules from the live data and runs through one approved tool that is audited with a before/after record.",
            "Pressing a fix sends only its id. The server re-reads the data and runs it only if the same fix is still needed, so an old page or a made-up id changes nothing.",
            "At Level 2, a fix that changes nothing about the sale (a retry) may be run by any manager. Anything that changes money, counts or CCRS waits for Michael.",
            "It never changes a price, a tax rate, a sale amount or a date, and never forces a legal block.",
          ]}
        />

        {isOwner ? (
          <Card>
            <form action={savePartnerLevelAction} className="space-y-3 p-5" data-testid="partner-level-form">
              <h2 className="text-base font-bold text-[var(--admin-text)]">Partner level (Michael only)</h2>
              {SELECTABLE_LEVELS.map((l) => (
                <label key={l} className="flex items-start gap-2 text-sm">
                  <input type="radio" name="level" value={String(l)} defaultChecked={l === level} />
                  <span>{LEVEL_TEXT[l]}</span>
                </label>
              ))}
              <p className="text-xs text-[var(--admin-text-muted)]">{LEVEL_TEXT[3]}</p>
              <PendingSubmit busy="Saving…" testId="partner-level-save" className="rounded-lg bg-[var(--admin-accent)] px-4 py-2 text-sm font-semibold text-white">
                Save level
              </PendingSubmit>
            </form>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
