import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { listPromotions, detectConflicts } from "@/lib/promotions/promotions-store";
import { WEEKDAY_LABELS, DISCOUNT_TYPE_LABELS } from "@/lib/promotions/types";
import type { PostStatus, Weekday } from "@/lib/promotions/types";
import { WeeklyScheduleStrip } from "@/components/admin/promotions/WeeklyScheduleStrip";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<PostStatus, string> = {
  draft: "border-white/15 bg-white/5 text-white/60",
  scheduled: "border-[#ffd700]/40 bg-[#ffd700]/10 text-[#ffd700]",
  published: "border-[#7ed957]/40 bg-[#7ed957]/10 text-[#7ed957]",
  archived: "border-white/10 bg-white/5 text-white/35",
};

export default async function PromotionsAdminPage() {
  await requirePermission("promotions.manage");

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader
          title="Promotions & Specials"
          subtitle="Daily deals, the Thursday brand selector, and clearance — all with a preview-before-publish gate."
        />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-xl border border-[#ffd700]/30 bg-[#ffd700]/5 p-5 text-sm text-[#ffd700]">
            Supabase is not configured yet. Once the database is connected and migration{" "}
            <code>0006_slice6_promotions.sql</code> is applied, promotions will manage here. Until
            then the storefront uses the built-in daily-deal defaults.
          </div>
        </div>
      </div>
    );
  }

  const [promos, conflicts] = await Promise.all([listPromotions(), detectConflicts()]);
  const published = promos.filter((p) => p.status === "published").length;
  const drafts = promos.filter((p) => p.status === "draft").length;
  const scheduled = promos.filter((p) => p.status === "scheduled").length;

  const scheduleItems = promos
    .filter((p) => p.status !== "archived")
    .map((p) => ({ id: p.id, title: p.title, status: p.status, weekday: p.weekday }));
  const todayWeekday = new Date().getDay() as Weekday;

  return (
    <div>
      <AdminPageHeader
        title="Promotions & Specials"
        subtitle="Daily deals, the Thursday brand selector, and clearance — all with a preview-before-publish gate."
        breadcrumbs={<Breadcrumbs items={[{ label: "Promotions" }]} />}
        help={
          <HelpPanel
            id="promotions"
            title="How promotions work"
            steps={[
              "Create a promotion and pick the products or brands.",
              "Set the discount and the start/end dates.",
              "Preview how the sale badge looks on the site.",
              "Publish — it goes live automatically on the dates you set.",
            ]}
          >
            <p>
              If two promotions overlap on the same products, you&apos;ll get a
              friendly warning before publishing so there are no surprises.
            </p>
          </HelpPanel>
        }
        action={
          <Link
            href="/admin/promotions/new"
            className="rounded-lg bg-[#7ed957] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[#6bc945]"
          >
            + New promotion
          </Link>
        }
      />

      <div className="px-5 py-6 sm:px-8">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total promotions" value={promos.length} accent="muted" />
          <StatCard label="Published (live)" value={published} accent="green" />
          <StatCard label="Drafts" value={drafts} accent="muted" />
          <StatCard label="Scheduled" value={scheduled} accent="gold" />
        </div>

        {scheduleItems.length > 0 && (
          <div className="mt-6">
            <WeeklyScheduleStrip items={scheduleItems} todayWeekday={todayWeekday} />
          </div>
        )}

        {conflicts.length > 0 && (
          <div className="mt-6 rounded-xl border border-[#ff7f00]/40 bg-[#ff7f00]/10 p-4 text-sm text-[#ffb066]">
            <p className="font-semibold text-[#ff7f00]">
              ⚠ {conflicts.length} product{conflicts.length === 1 ? "" : "s"} fall under more than one
              published promotion
            </p>
            <p className="mt-1 text-[#ffb066]/80">
              Overlapping deals can show conflicting badges. Review the affected products and tighten
              targeting or add exclusions.
            </p>
            <ul className="mt-2 space-y-1">
              {conflicts.slice(0, 8).map((c) => (
                <li key={c.productKey} className="text-xs text-[#ffb066]/90">
                  <span className="text-white/80">{c.productName}</span> —{" "}
                  {c.promotionTitles.join(" + ")}
                </li>
              ))}
              {conflicts.length > 8 && (
                <li className="text-xs text-[#ffb066]/70">…and {conflicts.length - 8} more.</li>
              )}
            </ul>
          </div>
        )}

        <div className="mt-6 overflow-hidden rounded-xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/40">
              <tr>
                <th className="px-4 py-3">Promotion</th>
                <th className="px-4 py-3">Schedule</th>
                <th className="px-4 py-3">Discount</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {promos.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-white/40">
                    No promotions yet. The storefront is currently showing the built-in daily-deal
                    defaults. Create one to override them.
                  </td>
                </tr>
              )}
              {promos.map((p) => (
                <tr key={p.id} className="transition hover:bg-white/5">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/promotions/${p.id}`}
                      className="font-medium text-white hover:text-[#7ed957]"
                    >
                      {p.title}
                    </Link>
                    {p.promo_key && (
                      <span className="ml-2 text-xs text-white/30">{p.promo_key}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-white/60">
                    {p.weekday !== null
                      ? `Every ${WEEKDAY_LABELS[p.weekday as Weekday]}`
                      : p.starts_at
                        ? `${p.starts_at.slice(0, 10)} → ${p.ends_at?.slice(0, 10) ?? "…"}`
                        : "—"}
                  </td>
                  <td className="px-4 py-3 text-white/60">
                    {DISCOUNT_TYPE_LABELS[p.discount_type]}
                    {p.discount_percent > 0 ? ` · ${p.discount_percent}%` : ""}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[p.status]}`}
                    >
                      {p.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
