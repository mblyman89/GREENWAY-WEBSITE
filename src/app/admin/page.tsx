import Link from "next/link";
import { requireStaff } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCard } from "@/components/admin/StatCard";
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

  return (
    <div>
      <AdminPageHeader
        title={`Welcome back, ${firstName}`}
        subtitle={`You are signed in as ${ROLE_LABELS[session.profile.role]}.`}
      />

      <div className="px-5 py-6 sm:px-8">
        {/* Getting started — only while setup is incomplete */}
        {setup.data && setup.data.completed < setup.data.total && (
          <section className="mb-10">
            <GettingStarted status={setup.data} />
          </section>
        )}

        {/* Command center */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">
            Today at a glance
          </h2>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Open orders" value="—" hint="See orders" accent="orange" href="/admin/orders" />
            <StatCard
              label="Live menu items"
              value={publishedItems ?? "—"}
              hint={publishedItems !== null ? "Currently published" : "No menu published yet"}
              accent="green"
              href="/admin/menu-imports"
            />
            <StatCard
              label="Last POS import"
              value={lastImportLabel === "—" || lastImportLabel === "No imports yet" ? lastImportLabel : "✓"}
              hint={lastImportLabel !== "—" && lastImportLabel !== "No imports yet" ? lastImportLabel : "Upload to begin"}
              href="/admin/menu-imports"
            />
            <StatCard
              label="Loyalty signups"
              value={loyaltyCount}
              hint="Awaiting POS entry"
              accent="gold"
              href="/admin/loyalty-signups"
            />
          </div>
        </section>

        {/* Build progress (data-driven) */}
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">
            Back office build progress
          </h2>
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
        </section>

        {/* Quick links */}
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">
            Quick links
          </h2>
          <div className="flex flex-wrap gap-3">
            <QuickLink href="/admin/loyalty-signups" label="Review loyalty signups" />
            <QuickLink href="/admin/users" label="Manage staff users" />
            <QuickLink href="/admin/audit" label="View audit log" />
            <QuickLink href="/" label="View live site ↗" external />
          </div>
        </section>
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
    <div className="rounded-xl border border-[#7ed957]/25 bg-[#0a0a0a] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">Getting started</h2>
          <p className="mt-0.5 text-sm text-white/60">
            {status.completed} of {status.total} steps complete. Let&apos;s get
            your site fully live.
          </p>
        </div>
        <div className="text-right">
          <span className="text-2xl font-semibold text-[#7ed957]">{pct}%</span>
        </div>
      </div>

      {/* progress bar */}
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-[#7ed957] transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* next action call-out */}
      {status.nextAction && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#ffd700]/25 bg-[#ffd700]/[0.05] p-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-[#ffd700]">
              Next step
            </p>
            <p className="mt-0.5 text-sm font-medium text-white">
              {status.nextAction.label}
            </p>
            <p className="text-xs text-white/60">{status.nextAction.detail}</p>
          </div>
          {status.nextAction.href && (
            <Link
              href={status.nextAction.href}
              className="rounded-lg bg-[#7ed957] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[#94e570]"
            >
              Do this now
            </Link>
          )}
        </div>
      )}

      {/* full checklist */}
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {status.checks.map((check) => (
          <li
            key={check.id}
            className="flex items-start gap-3 rounded-lg border border-white/10 bg-[#0d0d0d] p-3"
          >
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
                check.state === "done"
                  ? "bg-[#7ed957] text-black"
                  : check.state === "unknown"
                    ? "border border-white/20 text-white/30"
                    : "border border-[#ffd700]/50 text-[#ffd700]"
              }`}
            >
              {check.state === "done" ? "✓" : ""}
            </span>
            <div className="min-w-0">
              {check.href && check.state !== "done" ? (
                <Link
                  href={check.href}
                  className="text-sm font-medium text-white hover:text-[#7ed957]"
                >
                  {check.label}
                </Link>
              ) : (
                <p
                  className={`text-sm font-medium ${
                    check.state === "done" ? "text-white/70" : "text-white"
                  }`}
                >
                  {check.label}
                </p>
              )}
              <p className="text-xs text-white/40">{check.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
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
    <div className="flex items-start gap-3 rounded-lg border border-white/10 bg-[#0a0a0a] p-4">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
          done ? "bg-[#7ed957] text-black" : "border border-white/20 text-white/30"
        }`}
      >
        {done ? "✓" : ""}
      </span>
      <div>
        <p className={`text-sm font-medium ${done ? "text-white" : "text-white/70"}`}>
          {label}
        </p>
        <p className="text-xs text-white/40">{detail}</p>
      </div>
    </div>
  );
}

function QuickLink({
  href,
  label,
  external,
}: {
  href: string;
  label: string;
  external?: boolean;
}) {
  return (
    <Link
      href={href}
      target={external ? "_blank" : undefined}
      className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 transition hover:border-[#7ed957] hover:text-white"
    >
      {label}
    </Link>
  );
}
