/**
 * src/app/admin/reports/layout.tsx
 *
 * Shared shell for the reporting suite: a persistent header + tab navigation.
 * Each tab renders its own page below. Permission is enforced per-page too, but
 * we gate here as a first line of defense.
 */
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { ReportTabs } from "@/components/admin/reports/ReportTabs";
import { can } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePermission("reports.view");
  // R41 round 9: the ACH Payments tab shows for owner and admin only.
  const showAchTab = can(session.profile.role, "ach.request");
  // CVB-6: the Cultivera Benchmark tab shows for the owner only.
  const showCultiveraTab = can(session.profile.role, "cultivera.benchmark");
  return (
    <div>
      <AdminPageHeader
        title="Reports & Analytics"
        subtitle="Sales, COGS, tax, customers, compliance, and accounting — all in one place."
        breadcrumbs={<Breadcrumbs items={[{ label: "Reports" }]} />}
      />
      <div className="space-y-5 px-5 py-6 sm:px-8">
        <ReportTabs showAchTab={showAchTab} showCultiveraTab={showCultiveraTab} />
        {children}
      </div>
    </div>
  );
}
