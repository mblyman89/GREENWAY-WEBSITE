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

export const dynamic = "force-dynamic";

export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  await requirePermission("reports.view");
  return (
    <div>
      <AdminPageHeader
        title="Reports & Analytics"
        subtitle="Sales, COGS, tax, customers, compliance, and accounting — all in one place."
        breadcrumbs={<Breadcrumbs items={[{ label: "Reports" }]} />}
      />
      <div className="space-y-5 px-5 py-6 sm:px-8">
        <ReportTabs />
        {children}
      </div>
    </div>
  );
}
