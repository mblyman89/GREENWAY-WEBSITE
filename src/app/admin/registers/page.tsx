import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Button, Badge, Card, Section } from "@/components/admin/ui";
import { RegisterControls } from "@/components/admin/registers/RegisterControls";
import { getRegisterActivity, type ActivityKind } from "@/lib/registers/oversight";
import { listPosExceptions } from "@/lib/pos/sync-store";
import { listPosDevices } from "@/lib/pos/device-store";
import { formatCents, overShortLabel } from "@/lib/registers/cash";
import { reconcileDrawerAction, assignRefundAction } from "./actions";
import { loadDrawerFigure, drawersForDay, type LoadedDrawerFigure } from "@/lib/registers/drawer-figure-store";
import { figureReady, type FigureRefund } from "@/lib/registers/drawer-figure-core";
import { businessDayFor } from "@/lib/staffing/time";
import { compareCounts, secondCountSentence } from "@/lib/registers/second-count-core";
import { isOverShortWarning, OVER_SHORT_REASON_MAX_LEN } from "@/lib/registers/over-short-warning-core";
import { undeclaredBagsBefore } from "@/lib/registers/deposit-bag-store";
import { undeclaredBagWarning } from "@/lib/accounting/safe-bag-core";
import { pacificToday } from "@/lib/reports/timezone";
import { listOpenSupplyRuns } from "@/lib/registers/supply-run-store";

export const dynamic = "force-dynamic";

const BASE = "/admin/registers";

export default async function RegisterActivityPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    reconciled?: string;
    verified?: string;
    posted?: string;
    assigned?: string;
    closed?: string;
    count_diff?: string;
    warn?: string;
    reason_unsaved?: string;
    opened?: string;
    float_warn?: string;
    tip_pool?: string;
  }>;
}) {
  const session = await requirePermission("orders.manage");
  const canManage = can(session.profile.role, "inventory.manage");
  // Fix Phase 2.3 (G-03, owner D7): the over/short warnings screen is admin only.
  const canSeeWarnings = can(session.profile.role, "registers.warnings");
  const sp = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader
          title="Register Activity"
          subtitle="Live oversight of shifts, registers, and store activity."
        />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t fully set up yet. Register and shift activity will appear here
            once setup is complete.
          </div>
        </div>
      </div>
    );
  }

  const [data, openExceptions, devicesResult, undeclaredRes, openRunsRes] = await Promise.all([
    getRegisterActivity(),
    listPosExceptions(200),
    listPosDevices(),
    // Fix Phase 2.6 (G-04 requirement 6, owner D27 "warning only please"):
    // bags counted on an EARLIER night and still not recounted. A warning on
    // this page; it never blocks a close. Missing 0316 = no warning (the bag
    // screen itself says the migration is needed).
    undeclaredBagsBefore(pacificToday()),
    // Fix Phase 2.7c (G-11, D17): cash out with employees on supply runs.
    // Missing 0318 = no count (the supply-run screen says the migration is needed).
    listOpenSupplyRuns(),
  ]);
  const openRuns = openRunsRes.ok ? openRunsRes.runs : [];
  const undeclared = undeclaredRes.ok ? undeclaredRes.bags : [];
  const undeclaredWarning = undeclaredBagWarning(undeclared.map((b) => ({ bagNo: b.bagNo, businessDay: b.businessDay, status: "undeclared" as const })));
  const { kpis, onClock, registers, attention, feed, employees } = data;
  // GW-027 — devices holding server-REJECTED rows (which exist ONLY on the
  // device). Surface them loudly here so a manager knows to walk over.
  const rejectedDevices = devicesResult.ok
    ? devicesResult.devices.filter((d) => d.status === "active" && d.rejected_count > 0)
    : [];

  // Fix Phase 2.1 (G-05 / F-01-4): each closed drawer's own cash figure,
  // built by the server from the drawer's sales, the refunds tied to it and
  // its drops. Managers only (it reveals expected cash).
  const reconcileItems = canManage ? attention.filter((a) => a.kind === "reconcile") : [];
  const figures = new Map<string, LoadedDrawerFigure | null>();
  await Promise.all(
    reconcileItems.map(async (a) => {
      figures.set(a.sessionId, await loadDrawerFigure(a.sessionId));
    }),
  );
  // Drawers a refund can still be tied to (not yet reconciled), per day.
  const refundDays = new Set<string>();
  for (const f of figures.values()) {
    for (const r of f?.figure.unattributed ?? []) refundDays.add(refundDay(r, f!.session.business_day));
  }
  const drawerChoices = new Map<string, { id: string; label: string }[]>();
  await Promise.all(
    [...refundDays].map(async (day) => {
      const list = await drawersForDay(day);
      drawerChoices.set(
        day,
        list.filter((d) => d.status === "open" || d.status === "closed").map((d) => ({ id: d.id, label: d.label })),
      );
    }),
  );

  return (
    <div>
      <AdminPageHeader
        title="Register Activity"
        subtitle="Live oversight of shifts, registers, and store activity."
        breadcrumbs={
          <Breadcrumbs items={[{ label: "Register Activity" }]} />
        }
        toolbar={
          // Fix Phase 2.9 (owner message 6: "the top button bar, is cutoff.
          // Can you fix it so everything is visible on screen"). A full-width
          // row that wraps, so every button is on screen at any width.
          <>
            <Button href={`${BASE}/eod`} variant="neutral" size="sm">
              End-of-day report
            </Button>
            <Button href={`${BASE}/cashiers`} variant="neutral" size="sm">
              Cashier shift report
            </Button>
            <Button href={`${BASE}/history`} variant="neutral" size="sm">
              Cash drawer reports
            </Button>
            {canSeeWarnings ? (
              <Button href={`${BASE}/over-short`} variant="neutral" size="sm">
                Over / short warnings
              </Button>
            ) : null}
            <Button href={`${BASE}/exceptions`} variant="neutral" size="sm">
              Exceptions{openExceptions.length > 0 ? ` (${openExceptions.length})` : ""}
            </Button>
            <Button href={`${BASE}/returns`} variant="neutral" size="sm">
              Returns desk
            </Button>
            {/* Fix 6F (G-67/G-68) — owner message 9: return policy as settings. */}
            <Button href={`${BASE}/return-policy`} variant="neutral" size="sm">
              Return policy
            </Button>
            <Button href={`${BASE}/safe`} variant="neutral" size="sm">
              Safe
            </Button>
            <Button href={`${BASE}/deposit-bags`} variant="neutral" size="sm">
              Deposit bags{undeclared.length > 0 ? ` (${undeclared.length} to recount)` : ""}
            </Button>
            <Button href={`${BASE}/supply-runs`} variant="neutral" size="sm">
              Supply runs{openRuns.length > 0 ? ` (${openRuns.length} open)` : ""}
            </Button>
            <Button href="/admin/staffing/tips" variant="neutral" size="sm">
              Tip tracker
            </Button>
            <Button href={`${BASE}/devices`} variant="neutral" size="sm">
              POS devices
            </Button>
            <Button href={`${BASE}/receipt`} variant="neutral" size="sm">
              Receipt design
            </Button>
            <Button href={`${BASE}/rounding`} variant="neutral" size="sm">
              Cash rounding
            </Button>
            <Button href={`${BASE}/scanning`} variant="neutral" size="sm">
              Scan-required mode
            </Button>
          </>
        }
        help={
          <HelpPanel id="register-activity" title="What is this page?">
            <p>
              This is the back-office <strong>oversight console</strong> for the point-of-sale
              floor. It mirrors what leading systems (Lightspeed BackOffice Shifts Summary, Square
              Dashboard, Toast reporting) surface for a manager: who is working, what each register
              is doing, and a live feed of store activity.
            </p>
            <p className="mt-2">
              The hands-on cash steps &mdash; counting cash in, dropping to the safe, and blind-closing
              a drawer &mdash; normally happen on the front-end iPad POS at the register. This console
              also gives a manager the same <strong>cash controls</strong> so you can open, drop, or
              close a drawer from here (for example, to close one that was left open), plus the
              oversight sign-off: <strong>reconcile</strong> a closed drawer. Either the night manager or
              the morning manager may reconcile; do it before the day&apos;s deposit bag is sealed
              (owner rule D87). The old &quot;verify till&quot; step is retired: the morning recount on
              Deposit bags is the verify now (owner rule D83).
            </p>
            <p className="mt-2">
              Sales figures shown are <strong>online pickup order</strong> sales &mdash; the only
              transaction records in this back office. In-store card/cash sales are captured at the
              register and are not itemized here.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <Flash sp={sp} />

        {undeclaredWarning ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
            {undeclaredWarning}{" "}
            <a href={`${BASE}/deposit-bags`} className="underline">
              Open Deposit bags
            </a>
          </div>
        ) : null}

        {/* Today at a glance */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Online order sales · today"
            value={formatCents(kpis.onlineSalesTodayMinor)}
            hint={deltaHint(kpis.onlineSalesDeltaDir, kpis.onlineSalesDeltaPct)}
            accent="green"
          />
          <StatCard
            label="Active orders"
            value={String(kpis.activeOrders)}
            hint="Awaiting prep or pickup"
            accent="gold"
          />
          <StatCard
            label="Open drawers"
            value={`${kpis.openDrawers} / ${kpis.registerCount}`}
            hint="Registers with an open shift"
            accent="muted"
          />
          <StatCard
            label="Net over / short · today"
            value={overShortLabel(kpis.netOverShortTodayMinor)}
            hint={kpis.awaitingReconcile > 0 ? `${kpis.awaitingReconcile} awaiting reconcile` : "Reconciled drawers"}
            accent={kpis.netOverShortTodayMinor === 0 ? "muted" : "orange"}
          />
        </div>

        {/* GW-027 — rejected rows held ON a register device (they never
            entered the ledger, so this self-reported summary is the only
            back-office visibility; the rows must be reviewed at the device) */}
        {rejectedDevices.length > 0 && (
          <Section
            title="Rejected events on registers"
            description="These events were refused by the server before entering the ledger and are held on the register itself — review them at the device."
          >
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {rejectedDevices.map((d) => (
                <Card key={d.id} padding="md" accent="orange">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-semibold text-[var(--admin-text)]">{d.name}</span>
                    <Badge tone="danger">
                      {d.rejected_count} rejected
                    </Badge>
                  </div>
                  <p className="text-xs text-[var(--admin-text-muted)]">
                    {d.rejected_note ? `${d.rejected_note} · ` : ""}
                    {d.rejected_reported_at
                      ? `Reported ${new Date(d.rejected_reported_at).toLocaleString("en-US")}.`
                      : "Reported at last sync."}
                  </p>
                </Card>
              ))}
            </div>
          </Section>
        )}

        {/* Needs attention — only when there is something to do */}
        {attention.length > 0 && (
          <Section
            title="Needs attention"
            description="Closed drawers awaiting a manager reconcile. Night or morning manager; before the bag is sealed (D87)."
          >
            {!canManage ? (
              <Card padding="md">
                <p className="text-sm text-[var(--admin-text-muted)]">
                  {attention.length} drawer{attention.length === 1 ? "" : "s"} awaiting a manager
                  reconcile. Ask a manager to sign off.
                </p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {attention.map((a) => (
                  <ReconcileCard
                    key={a.sessionId}
                    item={a}
                    loaded={figures.get(a.sessionId) ?? null}
                    drawerChoices={drawerChoices}
                  />
                ))}
              </div>
            )}
          </Section>
        )}

        {/* On the clock — shift management at-a-glance */}
        <Section
          title="On the clock"
          description="Team members currently clocked in."
          action={
            <Button href="/admin/staffing/clock" variant="neutral" size="sm">
              Timeclock
            </Button>
          }
        >
          {onClock.length === 0 ? (
            <Card padding="md">
              <EmptyState
                title="Nobody is clocked in"
                description="When the team clocks in on the iPad, they'll appear here."
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {onClock.map((p) => (
                <Card key={p.employeeId} padding="md">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-[var(--admin-text)]">{p.name}</div>
                      <div className="text-xs capitalize text-[var(--admin-text-muted)]">
                        {p.role}
                      </div>
                    </div>
                    <Badge tone="green">On</Badge>
                  </div>
                  <div className="mt-3 text-xs text-[var(--admin-text-faint)]">
                    In at {p.clockInLabel} · {formatDuration(p.minutesOnClock)}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Section>

        {/* Registers — live status + manager cash controls */}
        <Section
          title="Registers"
          description="Live status of each register, with manager cash controls."
        >
          {registers.length === 0 ? (
            <Card padding="md">
              <EmptyState title="No registers configured" description="Registers appear here once set up." />
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {registers.map((r) => (
                <Card key={r.registerId} padding="md" accent={r.open ? "green" : undefined}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{
                          backgroundColor: r.open
                            ? "var(--admin-accent)"
                            : "var(--admin-text-faint)",
                        }}
                      />
                      <span className="text-sm font-semibold text-[var(--admin-text)]">{r.name}</span>
                    </div>
                    <Badge tone={r.open ? "green" : "neutral"}>{r.open ? "Open" : "Closed"}</Badge>
                  </div>
                  <div className="mt-1 text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                    {r.kind === "manager_till" ? "Manager till" : "Sales register"}
                  </div>

                  {r.open ? (
                    <>
                      <dl className="mt-3 space-y-1 text-xs">
                        <Row label="Opened by" value={r.openedByLabel ?? "—"} />
                        <Row label="Opened" value={r.openedAtLabel ?? "—"} />
                        <Row label="Starting cash" value={formatCents(r.startingCashMinor)} />
                        <Row label="Dropped to safe" value={formatCents(r.droppedMinor)} />
                        {r.expectedCloseMinor != null && (
                          <Row label="Expected close" value={formatCents(r.expectedCloseMinor)} />
                        )}
                      </dl>

                      {r.dropsToday.length > 0 && (
                        <div className="mt-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2">
                          <div className="mb-1 text-xs font-semibold text-[var(--admin-text-muted)]">
                            Drops today ({r.dropsToday.length})
                          </div>
                          <ul className="space-y-1 text-xs">
                            {r.dropsToday.map((d) => (
                              <li key={d.id} className="flex items-center justify-between gap-2">
                                <span className="truncate text-[var(--admin-text-faint)]">
                                  {d.atLabel} · {d.window}
                                  {d.byLabel ? ` · ${d.byLabel}` : ""}
                                </span>
                                <span className="whitespace-nowrap font-medium text-[var(--admin-text)]">
                                  {formatCents(d.amountMinor)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="mt-3 text-xs text-[var(--admin-text-muted)]">
                      No open shift. Count in a starting float to open this drawer.
                    </p>
                  )}

                  <RegisterControls register={r} employees={employees} />
                </Card>
              ))}
            </div>
          )}
        </Section>

        {/* Live activity feed */}
        <Section
          title="Live activity"
          description="Recent orders, drawer events, and clock-ins across the store."
        >
          {feed.length === 0 ? (
            <Card padding="md">
              <EmptyState
                title="No recent activity"
                description="Orders, drawer events, and clock-ins will stream in here."
              />
            </Card>
          ) : (
            <Card padding="none">
              <ul className="divide-y divide-[var(--admin-border)]">
                {feed.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-4 py-3">
                    <span aria-hidden className="text-lg">
                      {activityIcon(e.kind)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-[var(--admin-text)]">{e.title}</div>
                      {e.detail && (
                        <div className="truncate text-xs text-[var(--admin-text-muted)]">
                          {e.detail}
                        </div>
                      )}
                    </div>
                    {e.amountMinor != null && (
                      <span className="whitespace-nowrap text-sm font-medium text-[var(--admin-text)]">
                        {e.kind === "drawer_reconciled" || e.kind === "drawer_verified"
                          ? overShortLabel(e.amountMinor)
                          : formatCents(e.amountMinor)}
                      </span>
                    )}
                    <span className="whitespace-nowrap text-xs text-[var(--admin-text-faint)]">
                      {e.atLabel}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </Section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presentational helpers (pure)
// ---------------------------------------------------------------------------

function Flash({
  sp,
}: {
  sp: {
    error?: string;
    reconciled?: string;
    verified?: string;
    posted?: string;
    assigned?: string;
    closed?: string;
    count_diff?: string;
    warn?: string;
    reason_unsaved?: string;
    opened?: string;
    float_warn?: string;
    tip_pool?: string;
  };
}) {
  if (sp.error) {
    return (
      <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/30 bg-[var(--admin-danger)]/10 px-4 py-3 text-sm text-[var(--admin-danger)]">
        {sp.error}
      </div>
    );
  }
  if (sp.reconciled != null) {
    return (
      <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
        Drawer reconciled · {overShortLabel(Number(sp.reconciled) || 0)}
        {/* Fix Phase 2.3 (G-03, owner D7): more than $5.00 is a warning only. */}
        {sp.warn ? (
          <span className="mt-1 block text-xs text-[var(--admin-gold)]">
            Warning: more than $5.00 over or short. The reason is saved and the owner sees it on Over / short warnings.
          </span>
        ) : null}
        {sp.reason_unsaved ? (
          <span className="mt-1 block text-xs text-[var(--admin-gold)]">
            The reason is in the Security Log only: migration 0315 is not applied yet, so it could not be saved on the drawer.
          </span>
        ) : null}
        {/* What the LEDGER did. Without this the manager sees a friendly
            green banner whether the entry posted or was silently refused,
            which is the D-71 failure shape exactly. */}
        {sp.posted ? (
          <span className="mt-1 block text-xs opacity-80">{sp.posted}</span>
        ) : null}
      </div>
    );
  }
  if (sp.closed != null) {
    // Fix Phase 2.2 (G-01): the close records both counts. A difference is a
    // warning only (the owner has not said it should block).
    const diff = Number(sp.count_diff);
    const differs = sp.count_diff != null && Number.isFinite(diff) && diff !== 0;
    return (
      <div
        className={
          differs
            ? "rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]"
            : "rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]"
        }
      >
        {differs
          ? `Drawer closed. Warning: ${secondCountSentence(compareCounts(0, diff))} Both counts are saved and shown at reconcile.`
          : "Drawer closed. Both counts agree. A manager reconciles it below."}
        {/* Fix Phase 6 (G-64, owner D89): the crew tip pool split. */}
        {sp.tip_pool ? <span className="mt-1 block text-xs">{sp.tip_pool}</span> : null}
        {/* Fix Phase 6 (G-61, owner D84): closing does not clock out. */}
        <span className="mt-1 block text-xs opacity-80">The closer is still clocked in; they clock out when they are done.</span>
      </div>
    );
  }
  if (sp.opened != null) {
    // Fix Phase 6 (G-62, owner D85 "Warn please"): a count-in off the
    // standard float is saved and warned, never blocked.
    return (
      <div
        className={
          sp.float_warn
            ? "rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]"
            : "rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]"
        }
      >
        {sp.float_warn ? `Drawer opened. Warning: ${sp.float_warn}` : "Drawer opened at the standard float."}
      </div>
    );
  }
  if (sp.assigned != null) {
    return (
      <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
        Refund tied. The drawer figures below now include it.
      </div>
    );
  }
  if (sp.verified != null) {
    return (
      <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
        Till verified · {overShortLabel(Number(sp.verified) || 0)}
      </div>
    );
  }
  return null;
}

/** The Pacific business day a refund belongs to (its own time, else the drawer's day). */
function refundDay(r: FigureRefund, fallback: string): string {
  return r.atIso ? businessDayFor(r.atIso) : fallback;
}

/**
 * Fix Phase 2.1 (G-05 / F-01-3 / F-01-4): the reconcile card. Nothing is
 * typed: the figure is the server's, the reconciler is the signed-in
 * manager. Anything the figure cannot know is listed and blocks the button.
 */
function ReconcileCard({
  item,
  loaded,
  drawerChoices,
}: {
  item: {
    sessionId: string;
    registerName: string;
    businessDay: string;
    closingCountMinor: number | null;
    tipsMinor: number | null;
    closedByName: string | null;
    secondCountedByName: string | null;
    secondCountMinor: number | null;
  };
  loaded: LoadedDrawerFigure | null;
  drawerChoices: Map<string, { id: string; label: string }[]>;
}) {
  const f = loaded?.figure ?? null;
  const ready = f ? figureReady(f) : false;
  return (
    <Card padding="md" accent="orange">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-[var(--admin-text)]">{item.registerName}</span>
        <Badge tone="orange">Reconcile</Badge>
      </div>
      <p className="mb-2 text-xs text-[var(--admin-text-muted)]">
        {item.businessDay}
        {item.tipsMinor != null
          ? ` · ${formatCents(item.tipsMinor)} tips at close (employee money, not drawer cash)`
          : ""}
      </p>
      {!f ? (
        <p className="text-xs text-[var(--admin-danger)]">This drawer could not be loaded. Reload the page.</p>
      ) : (
        <>
          <dl className="mb-3 space-y-1 text-xs">
            <Row label="Opening float" value={f.openingMinor == null ? "Not counted" : formatCents(f.openingMinor)} />
            <Row
              label={`Sales on this drawer (${f.saleCount})`}
              value={formatCents(f.grossMinor)}
            />
            {f.roundingMinor !== 0 && <Row label="Cash rounding" value={formatCents(f.roundingMinor)} />}
            {f.employeeTabMinor > 0 && (
              <Row label={`Employee tab, no cash (${f.employeeTabCount})`} value={`− ${formatCents(f.employeeTabMinor)}`} />
            )}
            {f.otherTenderMinor > 0 && (
              <Row label={`Other tender, not cash (${f.otherTenderCount})`} value={`− ${formatCents(f.otherTenderMinor)}`} />
            )}
            <Row label="= Cash sales" value={formatCents(f.cashSalesMinor)} />
            <Row
              label={`Refunds paid from this drawer (${f.refundsPaid.length})`}
              value={`− ${formatCents(f.refundsPaidMinor)}`}
            />
            <Row label="Drops to the safe" value={`− ${formatCents(f.dropsMinor)}`} />
            <Row label="= Expected in drawer" value={f.expectedMinor == null ? "Unknown" : formatCents(f.expectedMinor)} />
            <Row
              label={item.closedByName ? `Counted at close (${item.closedByName})` : "Counted at close"}
              value={item.closingCountMinor == null ? "Not counted" : formatCents(item.closingCountMinor)}
            />
            {/* Fix Phase 2.2 (G-01, owner D2): the second person's own count. */}
            <Row
              label={item.secondCountedByName ? `Second count (${item.secondCountedByName})` : "Second count"}
              value={item.secondCountMinor == null ? "None" : formatCents(item.secondCountMinor)}
            />
            {f.overShortMinor != null && <Row label="Over / short" value={overShortLabel(f.overShortMinor)} />}
          </dl>
          {(() => {
            const cmp = compareCounts(item.closingCountMinor, item.secondCountMinor);
            return (
              <p
                className={`mb-3 text-xs ${
                  cmp.state === "second_higher" || cmp.state === "second_lower"
                    ? "text-[var(--admin-gold)]"
                    : "text-[var(--admin-text-muted)]"
                }`}
              >
                {cmp.state === "second_higher" || cmp.state === "second_lower" ? "Warning: " : ""}
                {secondCountSentence(cmp)}
              </p>
            );
          })()}
          {f.refundsPaid.length > 0 && (
            <ul className="mb-3 list-disc pl-5 text-xs text-[var(--admin-text-muted)]">
              {f.refundsPaid.map((r) => (
                <li key={`${r.source}:${r.sourceId}`}>
                  {r.label ?? (r.source === "void" ? "Void" : "Counter return")} · {formatCents(r.refundMinor)}
                </li>
              ))}
            </ul>
          )}
          {f.exceptionCount > 0 && (
            <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
              {f.exceptionCount} sale{f.exceptionCount === 1 ? "" : "s"} ({formatCents(f.exceptionMinor)}) from this
              drawer {f.exceptionCount === 1 ? "was" : "were"} refused by the server and {f.exceptionCount === 1 ? "is" : "are"} not
              counted. If the customer paid, the drawer will be over by that amount. See Exceptions.
            </p>
          )}
          {f.blockers.length > 0 && (
            <div className="mb-3 rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/30 bg-[var(--admin-danger)]/10 p-2 text-xs text-[var(--admin-danger)]">
              <p className="font-semibold">Reconcile waits until:</p>
              <ul className="list-disc pl-5">
                {f.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          )}
          {f.unattributed.length > 0 && (
            <div className="mb-3 space-y-2">
              <p className="text-xs font-medium text-[var(--admin-text)]">
                Say where each refund&apos;s cash came from:
              </p>
              {f.unattributed.map((r) => {
                const day = refundDay(r, item.businessDay);
                const choices = drawerChoices.get(day) ?? [];
                return (
                  <form
                    key={`${r.source}:${r.sourceId}`}
                    action={assignRefundAction}
                    className="flex flex-wrap items-end gap-2 text-xs"
                  >
                    <input type="hidden" name="source" value={r.source} />
                    <input type="hidden" name="source_id" value={r.sourceId} />
                    <input type="hidden" name="business_day" value={day} />
                    <span className="flex-1 text-[var(--admin-text-muted)]">
                      {r.label ?? (r.source === "void" ? "Void" : "Counter return")} · {formatCents(r.refundMinor)}
                      {r.atIso
                        ? ` · ${new Date(r.atIso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
                        : ""}
                    </span>
                    <select
                      name="paid_from"
                      required
                      defaultValue=""
                      className="rounded border border-[var(--admin-border)] bg-transparent px-2 py-1"
                    >
                      <option value="" disabled>
                        Paid from…
                      </option>
                      {choices.map((d) => (
                        <option key={d.id} value={`drawer:${d.id}`}>
                          {d.label}
                        </option>
                      ))}
                      <option value="safe">Store safe</option>
                    </select>
                    <Button type="submit" variant="neutral" size="sm">
                      Tie refund
                    </Button>
                  </form>
                );
              })}
            </div>
          )}
          <form action={reconcileDrawerAction} className="space-y-2">
            <input type="hidden" name="session_id" value={item.sessionId} />
            {/* Fix Phase 2.3 (G-03, owner D7 / D21): a reason is required only
                when the drawer is more than $5.00 over or short. The server
                checks again against its own figure when you click. */}
            {(() => {
              const warn = isOverShortWarning(f.overShortMinor);
              return (
                <label className="block text-xs text-[var(--admin-text-muted)]">
                  {warn ? (
                    <span className="mb-1 block font-semibold text-[var(--admin-gold)]">
                      Warning: more than $5.00 {(f.overShortMinor ?? 0) > 0 ? "over" : "short"}. Reason (required)
                    </span>
                  ) : (
                    <span className="mb-1 block">Reason for over / short (optional at $5.00 or less)</span>
                  )}
                  <textarea
                    name="over_short_reason"
                    required={warn}
                    maxLength={OVER_SHORT_REASON_MAX_LEN}
                    rows={2}
                    placeholder={warn ? "Why is it over or short? Ask the cashier and the second counter." : "Optional"}
                    className="w-full rounded border border-[var(--admin-border)] bg-transparent px-2 py-1 text-[var(--admin-text)]"
                  />
                </label>
              );
            })()}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="confirm" size="sm" disabled={!ready}>
                Reconcile
              </Button>
              <span className="text-xs text-[var(--admin-text-faint)]">
                Signed as you. The server re-checks this figure when you click.
              </span>
            </div>
          </form>
        </>
      )}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-[var(--admin-text-muted)]">{label}</dt>
      <dd className="font-medium text-[var(--admin-text)]">{value}</dd>
    </div>
  );
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function deltaHint(dir: "up" | "down" | "flat", pct: number | null): string {
  if (pct == null) return "vs yesterday";
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "▬";
  return `${arrow} ${Math.abs(Math.round(pct))}% vs yesterday`;
}

function activityIcon(kind: ActivityKind): string {
  switch (kind) {
    case "order_new":
      return "🛒";
    case "order_ready":
      return "📦";
    case "order_completed":
      return "✅";
    case "order_cancelled":
      return "✖️";
    case "drawer_open":
      return "🔓";
    case "drawer_closed":
      return "🔒";
    case "drawer_reconciled":
      return "🧾";
    case "drawer_verified":
      return "✔️";
    case "clock_in":
      return "🕒";
    case "drawer_drop":
      return "🔽";
    default:
      return "•";
  }
}
