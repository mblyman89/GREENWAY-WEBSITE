import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Button, Badge } from "@/components/admin/ui";
import { getConfig, listTiers, listPromotions, loyaltySummary } from "@/lib/loyalty/loyalty-store";

export const dynamic = "force-dynamic";

function pct(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
}

function money(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

export default async function LoyaltyProgramPage() {
  await requirePermission("loyalty.view");

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: "Operations" }, { label: "Loyalty Program" }]} />
        <AdminPageHeader title="Loyalty program" subtitle="Points, tiers, promotions, and redemptions." />
        <EmptyState title="Supabase not configured" description="Connect the service role key to manage loyalty." />
      </div>
    );
  }

  const [cfg, tiers, promos, summary] = await Promise.all([
    getConfig(),
    listTiers(),
    listPromotions(),
    loyaltySummary(),
  ]);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Operations" }, { label: "Loyalty Program" }]} />
      <AdminPageHeader
        title="Loyalty program"
        subtitle="Points accrue pretax at the program rate; no tax counts toward points."
        action={
          <Link href="/admin/loyalty-signups">
            <Button variant="subtle">Signups</Button>
          </Link>
        }
        help={
          <HelpPanel
            id="loyalty-program"
            title="How loyalty works"
            steps={[
              "Customers opt in with email + phone to earn points and daily discounts.",
              "Points accrue on the PRETAX subtotal at the program rate (1pt/$1 by default).",
              "Reaching a tier unlocks a standing discount (e.g. 150 pts = 10%, 300 pts = 25%).",
              "Customers redeem points for a CODE texted/emailed — usable online or in store.",
            ]}
          >
            <p>
              Points are managed per customer from each customer&apos;s detail page. This page shows the program
              configuration, tiers, and active promotions.
            </p>
          </HelpPanel>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Enrolled customers" value={summary.accounts.toLocaleString("en-US")} accent="green" />
        <StatCard
          label="Points outstanding"
          value={summary.pointsOutstanding.toLocaleString("en-US")}
          hint={money(summary.pointsOutstanding * cfg.pointValueMinor)}
          accent="gold"
        />
        <StatCard label="Codes awaiting use" value={summary.codesIssued.toLocaleString("en-US")} accent="orange" />
      </div>

      {/* Program configuration */}
      <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
        <h2 className="mb-4 text-sm font-semibold text-white">Program configuration</h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div>
            <dt className="text-white/40">Earn rate</dt>
            <dd className="font-semibold text-white">{cfg.pointsPerDollar} pt / $1 pretax</dd>
          </div>
          <div>
            <dt className="text-white/40">Point value</dt>
            <dd className="font-semibold text-white">{money(cfg.pointValueMinor)} / pt</dd>
          </div>
          <div>
            <dt className="text-white/40">Minimum to redeem</dt>
            <dd className="font-semibold text-white">{cfg.minRedeemPoints} pts</dd>
          </div>
          <div>
            <dt className="text-white/40">Signup bonus</dt>
            <dd className="font-semibold text-white">{cfg.signupBonusPoints} pts</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-white/40">
          Adjust these values in the <code>loyalty_config</code> table. Codes expire{" "}
          {cfg.codeExpiryDays == null ? "never" : `after ${cfg.codeExpiryDays} days`}.
        </p>
      </section>

      {/* Tiers */}
      <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
        <h2 className="mb-4 text-sm font-semibold text-white">Tiers</h2>
        {tiers.length === 0 ? (
          <p className="text-sm text-white/50">No tiers configured.</p>
        ) : (
          <div className="space-y-2">
            {tiers.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between rounded-lg border border-[var(--admin-border)] px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <Badge tone="gold">{t.name}</Badge>
                  <span className="text-sm text-white/70">{t.minPoints.toLocaleString("en-US")}+ lifetime pts</span>
                </div>
                <span className="text-sm font-semibold text-[var(--admin-green)]">{pct(t.discountBps)} off</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Promotions */}
      <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
        <h2 className="mb-4 text-sm font-semibold text-white">Promotions</h2>
        {promos.length === 0 ? (
          <p className="text-sm text-white/50">
            No promotions yet. Add rows to <code>loyalty_promotions</code> (signup, happy_hour, promo, custom).
          </p>
        ) : (
          <div className="space-y-2">
            {promos.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--admin-border)] px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <Badge tone={p.isActive ? "green" : "neutral"}>{p.kind.replace("_", " ")}</Badge>
                  <span className="text-sm text-white/70">
                    {p.multiplierBps !== 10000 ? `${(p.multiplierBps / 10000).toFixed(2)}x` : ""}
                    {p.flatBonusPoints > 0 ? ` +${p.flatBonusPoints} pts` : ""}
                    {p.hourStart != null && p.hourEnd != null ? ` · ${p.hourStart}:00–${p.hourEnd}:00 PT` : ""}
                  </span>
                </div>
                {!p.isActive && <span className="text-xs text-white/30">inactive</span>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
