import Link from "next/link";
import { requireStaff } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { Section } from "@/components/admin/ui/Section";
import { Card } from "@/components/admin/ui/Card";
import { Button } from "@/components/admin/ui/Button";
import { countLoyaltySignups } from "@/lib/loyalty/store";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getPublishedVersion, listImports } from "@/lib/pos/menu-version";
import { formatDateTime } from "@/lib/pos/format";
import { getSetupStatus, BUILD_SLICES } from "@/lib/admin/setup-status";
import { safeData } from "@/lib/safe-data";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const session = await requireStaff();
  const loyaltyCount = await countLoyaltySignups();

  // POS menu status (gracefully degrades when Supabase isn't configured yet).
  let publishedItems: number | null = null;
  let lastImportLabel = "—";
  if (isSupabaseServiceConfigured) {
    const menu = await safeData(
      async () => {
        const [published, imports] = await Promise.all([
          getPublishedVersion(),
          listImports(1),
        ]);
        return { published, imports };
      },
      { published: null, imports: [] as Awaited<ReturnType<typeof listImports>> },
    );
    publishedItems = menu.data.published?.item_count ?? null;
    lastImportLabel = menu.data.imports[0]
      ? formatDateTime(menu.data.imports[0].created_at)
      : "No imports yet";
  }

  // Truthful setup state (probes the real database).
  const setup = await safeData(() => getSetupStatus(), null);

  const firstName =
    (session.profile.full_name ?? session.email).split(/[\s@]/)[0] || "there";

  const hasImport =
    lastImportLabel !== "—" && lastImportLabel !== "No imports yet";

  return (
    <div>
      <AdminPageHeader
        title={`Welcome back, ${firstName}`}
        subtitle={`Signed in as ${ROLE_LABELS[session.profile.role]}.`}
        action={
          <Button href="/" external variant="subtle" size="sm">
            View live site ↗
          </Button>
        }
      />

      <div className="px-5 py-6 sm:px-8">
        {/* Getting started — only while setup is incomplete */}
        {setup.data && setup.data.completed < setup.data.total && (
          <Section className="mb-10">
            <GettingStarted status={setup.data} />
          </Section>
        )}

        {/* Command center */}
        <Section title="Today at a glance">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Open orders"
              value="—"
              hint="See orders"
              accent="orange"
              href="/admin/orders"
              icon="🧾"
            />
            <StatCard
              label="Live menu items"
              value={publishedItems ?? "—"}
              hint={
                publishedItems !== null
                  ? "Currently published"
                  : "No menu published yet"
              }
              accent="green"
              href="/admin/menu-imports"
              icon="🌿"
            />
            <StatCard
              label="Last POS import"
              value={hasImport ? "✓" : lastImportLabel}
              hint={hasImport ? lastImportLabel : "Upload to begin"}
              href="/admin/menu-imports"
              icon="⬆️"
            />
            <StatCard
              label="Loyalty signups"
              value={loyaltyCount}
              hint="Awaiting POS entry"
              accent="gold"
              href="/admin/loyalty-signups"
              icon="⭐"
            />
          </div>
        </Section>

        {/* Build progress (data-driven) */}
        <Section className="mt-10" title="Back office build progress">
          <div className="grid gap-3 sm:grid-cols-2">
            {BUILD_SLICES.map((slice) => (
              <ProgressRow
                key={slice.id}
                done={slice.done}
                label={slice.label}
                detail={slice.detail}
              />
            ))}
          </div>
        </Section>

        {/* Quick links */}
        <Section className="mt-10" title="Quick links">
          <div className="flex flex-wrap gap-2.5">
            <QuickLink
              href="/admin/loyalty-signups"
              label="Review loyalty signups"
            />
            <QuickLink href="/admin/users" label="Manage staff users" />
            <QuickLink href="/admin/audit" label="View audit log" />
            <QuickLink href="/admin/content" label="Edit site content" />
          </div>
        </Section>
      </div>
    </div>
  );
}

function GettingStarted({
  status,
}: {
  status: Awaited<ReturnType<typeof getSetupStatus>>;
}) {
  const pct = Math.round((status.completed / status.total) * 100);
  return (
    <Card padding="lg" accent="green">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--admin-text)]">
            Getting started
          </h2>
          <p className="mt-0.5 text-sm text-[var(--admin-text-muted)]">
            {status.completed} of {status.total} steps complete. Let&apos;s get
            your site fully live.
          </p>
        </div>
        <div className="text-right">
          <span className="text-2xl font-bold text-[var(--admin-accent)]">
            {pct}%
          </span>
          <Link
            href="/admin/getting-started"
            className="mt-1 block text-xs font-semibold text-[var(--admin-accent)] hover:underline"
          >
            Open full walkthrough →
          </Link>
        </div>
      </div>

      {/* progress bar */}
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-[var(--admin-accent)] transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* next action call-out */}
      {status.nextAction && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/25 bg-[var(--admin-gold-soft)] p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-gold)]">
              Next step
            </p>
            <p className="mt-0.5 text-sm font-medium text-[var(--admin-text)]">
              {status.nextAction.label}
            </p>
            <p className="text-xs text-[var(--admin-text-muted)]">
              {status.nextAction.detail}
            </p>
          </div>
          {status.nextAction.href && (
            <Button href={status.nextAction.href} variant="primary" size="sm">
              Do this now
            </Button>
          )}
        </div>
      )}

      {/* full checklist */}
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {status.checks.map((check) => (
          <li
            key={check.id}
            className="flex items-start gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3"
          >
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
                check.state === "done"
                  ? "bg-[var(--admin-accent)] text-black"
                  : check.state === "unknown"
                    ? "border border-[var(--admin-border-strong)] text-[var(--admin-text-faint)]"
                    : "border border-[var(--admin-gold)]/50 text-[var(--admin-gold)]"
              }`}
            >
              {check.state === "done" ? "✓" : ""}
            </span>
            <div className="min-w-0">
              {check.href && check.state !== "done" ? (
                <Link
                  href={check.href}
                  className="text-sm font-medium text-[var(--admin-text)] hover:text-[var(--admin-accent)]"
                >
                  {check.label}
                </Link>
              ) : (
                <p
                  className={`text-sm font-medium ${
                    check.state === "done"
                      ? "text-[var(--admin-text-muted)]"
                      : "text-[var(--admin-text)]"
                  }`}
                >
                  {check.label}
                </p>
              )}
              <p className="text-xs text-[var(--admin-text-faint)]">
                {check.detail}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ProgressRow({
  label,
  detail,
  done,
}: {
  label: string;
  detail: string;
  done?: boolean;
}) {
  return (
    <Card padding="sm" className="flex items-start gap-3">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
          done
            ? "bg-[var(--admin-accent)] text-black"
            : "border border-[var(--admin-border-strong)] text-[var(--admin-text-faint)]"
        }`}
      >
        {done ? "✓" : ""}
      </span>
      <div>
        <p
          className={`text-sm font-medium ${
            done ? "text-[var(--admin-text)]" : "text-[var(--admin-text-muted)]"
          }`}
        >
          {label}
        </p>
        <p className="text-xs text-[var(--admin-text-faint)]">{detail}</p>
      </div>
    </Card>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="admin-focus rounded-full border border-[var(--admin-border-strong)] px-4 py-2 text-sm text-[var(--admin-text-muted)] transition hover:border-[var(--admin-accent)] hover:text-[var(--admin-text)]"
    >
      {label}
    </Link>
  );
}
