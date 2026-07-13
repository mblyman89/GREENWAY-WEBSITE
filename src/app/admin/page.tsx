import Link from "next/link";
import { requireStaff } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { Section } from "@/components/admin/ui/Section";
import { Card, CardHeader } from "@/components/admin/ui/Card";
import { Button } from "@/components/admin/ui/Button";
import { getCockpitSnapshot } from "@/lib/admin/cockpit-data";
import { getSetupStatus } from "@/lib/admin/setup-status";
import { WorkspaceTour } from "@/components/admin/WorkspaceTour";
import {
  formatMoneyMinor,
  deltaLabel,
  peakHour,
  toBars,
  buildAttentionFlags,
  type Delta,
} from "@/lib/admin/cockpit-core";
import { formatDateTime } from "@/lib/pos/format";
import { can } from "@/lib/auth/roles";
import { getWorkQueueInputs } from "@/lib/catalog/hub";
import { emptyWorkQueueInputs, workQueueAttentionFlags } from "@/lib/catalog/work-queue-core";
import { missingWebhookSecrets } from "@/lib/security/fail-closed";
import { isAtRestEncryptionConfigured } from "@/lib/security/at-rest-crypto";
import { getOverdueComplianceCount } from "@/lib/compliance/compliance-calendar-store";

export const dynamic = "force-dynamic";

/** Accent for a delta pill: green up, orange down, muted flat. */
function deltaAccent(d: Delta): "green" | "orange" | "muted" {
  if (d.isNew || d.direction === "up") return "green";
  if (d.direction === "down") return "orange";
  return "muted";
}

export default async function AdminDashboardPage() {
  const session = await requireStaff();
  // W3: intake work-queue flags only for people who can act on them — every
  // queue target requires inventory.manage, so gate the fetch the same way.
  const canWorkIntake = can(session.profile.role, "inventory.manage");
  const [snap, setup, overdueCompliance, intakeInputs] = await Promise.all([
    getCockpitSnapshot(),
    getSetupStatus(),
    getOverdueComplianceCount(),
    canWorkIntake ? getWorkQueueInputs() : Promise.resolve(emptyWorkQueueInputs()),
  ]);
  const setupComplete = setup.completed >= setup.total;

  // S-9: surface unset webhook secrets loudly. In production those endpoints
  // now refuse (fail closed), so this banner tells the owner exactly which env
  // vars to set to bring the surfaces back online.
  const missingSecrets = missingWebhookSecrets();
  // S-10: nag until at-rest encryption for banking/credentials is keyed.
  const encryptionKeyMissing = !isAtRestEncryptionConfigured();

  const firstName =
    (session.profile.full_name ?? session.email).split(/[\s@]/)[0] || "there";

  // W3: the product-intake pipeline surfaces its work here too — same verified
  // counts, same priority order, and same copy as the hub's work queue.
  const flags = [
    ...buildAttentionFlags({
      activeOrders: snap.activeOrders,
      lowStockCount: snap.lowStockCount,
      drawers: snap.drawers,
      publishedItems: snap.publishedItems,
    }),
    ...workQueueAttentionFlags(intakeInputs),
  ];

  const peak = peakHour(snap.today.byHour);
  const hourBars = toBars(
    snap.today.byHour.map((h) => ({ label: h.label, value: h.revenueMinorUnits })),
  );
  const topSellers = snap.today.byProduct.slice(0, 6);
  const topCategories = snap.today.byCategory.slice(0, 5);

  return (
    <div>
      <AdminPageHeader
        title={`Welcome back, ${firstName}`}
        subtitle={`Point-of-sale cockpit · signed in as ${ROLE_LABELS[session.profile.role]}.`}
        action={
          <div className="flex gap-2">
            <Button href="/admin/getting-started" variant="neutral" size="sm">
              Setup guide
            </Button>
            <Button href="/" external variant="neutral" size="sm">
              View live site ↗
            </Button>
          </div>
        }
      />

      <div className="space-y-10 px-5 py-6 sm:px-8">
        {/* ── S-9: missing webhook secrets (fail-closed surfaces offline) ── */}
        {missingSecrets.length > 0 && (
          <div className="rounded-[var(--admin-radius-lg)] border border-amber-500/30 bg-amber-500/[0.06] px-5 py-4">
            <p className="text-sm font-semibold text-amber-300">
              Webhook secrets missing — those endpoints refuse traffic in production
            </p>
            <ul className="mt-1 list-inside list-disc text-xs text-amber-200/90">
              {missingSecrets.map((m) => (
                <li key={m.envVar}>
                  {m.surface}: set <code className="font-mono">{m.envVar}</code>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── S-18: overdue compliance-calendar obligations ── */}
        {overdueCompliance > 0 && (
          <Link
            href="/admin/compliance/calendar"
            className="admin-card-interactive block rounded-[var(--admin-radius-lg)] border border-red-500/40 bg-red-500/[0.08] px-5 py-4"
          >
            <p className="text-sm font-semibold text-red-300">
              {overdueCompliance} compliance obligation{overdueCompliance === 1 ? " is" : "s are"} past due
            </p>
            <p className="mt-1 text-xs text-red-200/90">
              Open the compliance calendar to see what&apos;s overdue (LIQ-1295, weekly CCRS,
              CCTV retention check, …) and sign it off once done.
            </p>
          </Link>
        )}

        {/* ── S-10: at-rest encryption key not set ── */}
        {encryptionKeyMissing && (
          <div className="rounded-[var(--admin-radius-lg)] border border-amber-500/30 bg-amber-500/[0.06] px-5 py-4">
            <p className="text-sm font-semibold text-amber-300">
              At-rest encryption is off — banking details and API secrets are stored unencrypted
            </p>
            <p className="mt-1 text-xs text-amber-200/90">
              Set <code className="font-mono">DATA_ENCRYPTION_KEY</code> (any long random string) in the
              server environment. New saves of employee banking, the ACH funding account, and
              integration secrets are then encrypted automatically.
            </p>
          </div>
        )}

        {/* ── Setup progress nudge (only until fully set up) ─────────────────
            Top POS onboarding keeps the checklist one click away from home
            until the store is live. Once every step is done, this disappears. */}
        {!setupComplete && (
          <Link
            href="/admin/getting-started"
            className="admin-card-interactive flex flex-wrap items-center gap-4 rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent)]/[0.06] px-5 py-4"
          >
            <span className="text-2xl" aria-hidden="true">
              🧭
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--admin-text)]">
                Finish setting up your store
              </p>
              <p className="text-xs text-[var(--admin-text-muted)]">
                {setup.completed} of {setup.total} steps done
                {setup.nextAction ? ` · next: ${setup.nextAction.label}` : ""}
              </p>
            </div>
            <div className="hidden w-40 sm:block">
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[var(--admin-accent)]"
                  style={{
                    width: `${Math.round((setup.completed / Math.max(setup.total, 1)) * 100)}%`,
                  }}
                />
              </div>
            </div>
            <span className="shrink-0 text-sm font-medium text-[var(--admin-accent)]">
              Continue setup →
            </span>
          </Link>
        )}

        {/* ── Needs your attention ─────────────────────────────────────── */}
        {flags.length > 0 && (
          <Section title="Needs your attention">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {flags.map((f, i) => {
                const tone =
                  f.severity === "critical"
                    ? "border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 text-[var(--admin-danger)]"
                    : f.severity === "warning"
                      ? "border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]"
                      : "border-[var(--admin-border)] bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)]";
                const inner = (
                  <div className={`flex items-start gap-2 rounded-[var(--admin-radius)] border px-3 py-2.5 text-sm ${tone}`}>
                    <span>
                      {f.severity === "critical" ? "🚨" : f.severity === "warning" ? "⚠️" : "ℹ️"}
                    </span>
                    <span className="text-[var(--admin-text)]">{f.text}</span>
                  </div>
                );
                return f.href ? (
                  <Link key={i} href={f.href} className="admin-focus">
                    {inner}
                  </Link>
                ) : (
                  <div key={i}>{inner}</div>
                );
              })}
            </div>
          </Section>
        )}

        {/* ── Today's sales KPIs (vs yesterday) ────────────────────────── */}
        <Section title="Today's sales" description="Compared with the same point yesterday.">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Revenue"
              value={formatMoneyMinor(snap.today.totalRevenueMinorUnits)}
              hint={deltaLabel(snap.deltas.revenue)}
              accent={deltaAccent(snap.deltas.revenue)}
              icon="💵"
            />
            <StatCard
              label="Orders"
              value={snap.today.totalOrders}
              hint={deltaLabel(snap.deltas.orders)}
              accent={deltaAccent(snap.deltas.orders)}
              icon="🧾"
            />
            <StatCard
              label="Units sold"
              value={snap.today.totalUnits}
              hint={deltaLabel(snap.deltas.units)}
              accent={deltaAccent(snap.deltas.units)}
              icon="📦"
            />
            <StatCard
              label="Avg. order"
              value={formatMoneyMinor(snap.today.avgOrderMinorUnits)}
              hint={deltaLabel(snap.deltas.avgOrder)}
              accent={deltaAccent(snap.deltas.avgOrder)}
              icon="🛒"
            />
          </div>
        </Section>

        {/* ── Hourly sales + top sellers ───────────────────────────────── */}
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2" padding="none">
            <CardHeader
              className="p-5 pb-0"
              title="Sales by hour (today)"
              subtitle={
                peak
                  ? `Busiest so far: ${peak.label} (${formatMoneyMinor(peak.revenueMinorUnits)})`
                  : "No sales recorded yet today."
              }
            />
            <div className="p-5 pt-0">
              {hourBars.some((b) => b.value > 0) ? (
                <div className="flex h-40 items-end gap-1">
                  {hourBars.map((b) => (
                    <div key={b.label} className="group flex flex-1 flex-col items-center justify-end">
                      <div
                        className="w-full rounded-t bg-[var(--admin-accent)]/70 transition group-hover:bg-[var(--admin-accent)]"
                        style={{ height: `${b.heightPct}%`, minHeight: b.value > 0 ? "3px" : "0" }}
                        title={`${b.label}: ${formatMoneyMinor(b.value)}`}
                      />
                      <span className="mt-1 hidden text-[9px] text-[var(--admin-text-faint)] sm:block">
                        {b.label.replace(/:00/, "").replace(/\s?(AM|PM)/, "")}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-10 text-center text-sm text-[var(--admin-text-faint)]">
                  Sales will chart here as orders come through today.
                </p>
              )}
            </div>
          </Card>

          <Card padding="none">
            <CardHeader className="p-5 pb-0" title="Top sellers (today)" />
            <div className="p-5 pt-0">
              {topSellers.length > 0 ? (
                <ol className="space-y-2">
                  {topSellers.map((p, i) => (
                    <li key={p.label} className="flex items-center gap-3 text-sm">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--admin-surface-2)] text-xs font-bold text-[var(--admin-text-muted)]">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[var(--admin-text)]">{p.label}</span>
                      <span className="shrink-0 text-xs text-[var(--admin-text-muted)]">
                        {p.units}× · {formatMoneyMinor(p.revenueMinorUnits)}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="py-6 text-center text-sm text-[var(--admin-text-faint)]">
                  No products sold yet today.
                </p>
              )}
            </div>
          </Card>
        </div>

        {/* ── Open orders board + live registers ───────────────────────── */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card padding="none">
            <CardHeader
              className="p-5 pb-0"
              title="Open orders"
              subtitle={`${snap.activeOrders} awaiting fulfillment`}
              action={
                <Button href="/admin/orders" variant="neutral" size="sm">
                  Manage
                </Button>
              }
            />
            <div className="grid grid-cols-2 gap-3 p-5 pt-0 sm:grid-cols-4">
              {snap.orderBoard.map((o) => (
                <Link
                  key={o.status}
                  href="/admin/orders"
                  className="admin-card-interactive rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 text-center"
                >
                  <div className="text-2xl font-bold text-[var(--admin-text)]">{o.count}</div>
                  <div className="mt-0.5 text-[11px] text-[var(--admin-text-muted)]">{o.label}</div>
                </Link>
              ))}
            </div>
          </Card>

          <Card padding="none">
            <CardHeader
              className="p-5 pb-0"
              title="Register Activity"
              subtitle={
                snap.registers.length > 0
                  ? `${snap.drawers.openCount} open · ${snap.drawers.verifiedCount} verified`
                  : "No registers configured"
              }
              action={
                <Button href="/admin/registers" variant="neutral" size="sm">
                  View activity
                </Button>
              }
            />
            <div className="p-5 pt-0">
              {snap.registers.length > 0 ? (
                <ul className="space-y-2">
                  {snap.registers.map((r) => {
                    const s = r.openSession;
                    return (
                      <li
                        key={r.register.id}
                        className="flex items-center gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm"
                      >
                        <span
                          className={`h-2.5 w-2.5 shrink-0 rounded-full ${s ? "bg-[var(--admin-accent)]" : "bg-white/20"}`}
                        />
                        <span className="min-w-0 flex-1 truncate text-[var(--admin-text)]">
                          {r.register.name}
                        </span>
                        <span className="shrink-0 text-xs text-[var(--admin-text-muted)]">
                          {s
                            ? `${s.status} · drops ${formatMoneyMinor(r.dropsMinor)}`
                            : "Closed"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="py-6 text-center text-sm text-[var(--admin-text-faint)]">
                  Set up a register to track cash drawers.
                </p>
              )}
              {snap.drawers.needsAttention > 0 && (
                <p className="mt-3 rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-3 py-2 text-xs text-[var(--admin-danger)]">
                  {snap.drawers.needsAttention} drawer{snap.drawers.needsAttention === 1 ? "" : "s"} need review (closed blind or over/short).
                </p>
              )}
            </div>
          </Card>
        </div>

        {/* ── Operations status strip ──────────────────────────────────── */}
        <Section title="Operations">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Live menu items"
              value={snap.publishedItems ?? "—"}
              hint={snap.publishedItems !== null ? "Currently published" : "No menu published"}
              accent="green"
              href="/admin/menu-imports"
              icon="🌿"
            />
            <StatCard
              label="Low stock"
              value={snap.lowStockCount}
              hint={snap.lowStockCount > 0 ? "At/below reorder point" : "All above reorder point"}
              accent={snap.lowStockCount > 0 ? "orange" : "muted"}
              href="/admin/purchasing"
              icon="📉"
            />
            <StatCard
              label="Last POS import"
              value={snap.lastImportISO ? "✓" : "—"}
              hint={snap.lastImportISO ? formatDateTime(snap.lastImportISO) : "Upload to begin"}
              href="/admin/menu-imports"
              icon="⬆️"
            />
            <StatCard
              label="Loyalty signups"
              value={snap.loyaltySignups}
              hint="New — awaiting review"
              accent="gold"
              href="/admin/loyalty-signups"
              icon="⭐"
            />
          </div>

          {/* Top categories inline (only when there's data) */}
          {topCategories.length > 0 && (
            <div className="mt-4 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-white/40">
                Today&apos;s revenue by category
              </p>
              <div className="space-y-2">
                {topCategories.map((c) => (
                  <div key={c.label} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 truncate text-sm capitalize text-[var(--admin-text)]">
                      {c.label}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-[var(--admin-accent)]"
                        style={{ width: `${Math.round(c.revenueShare * 100)}%` }}
                      />
                    </div>
                    <span className="w-24 shrink-0 text-right text-xs text-[var(--admin-text-muted)]">
                      {formatMoneyMinor(c.revenueMinorUnits)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>

        {/* ── Explore your back office (quick navigation) ────────────────────
            A compact launcher to every workspace, role-filtered. Best-in-class
            POS homes offer fast "jump back in" navigation beyond the KPIs. */}
        <Section
          title="Explore your back office"
          description="Jump straight into any area."
          action={
            <Button href="/admin/getting-started" variant="neutral" size="sm">
              Guided tour
            </Button>
          }
        >
          <WorkspaceTour role={session.profile.role} variant="compact" />
        </Section>
      </div>
    </div>
  );
}
