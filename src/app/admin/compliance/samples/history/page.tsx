import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import {
  getSampleSettings,
  listEmployeeSampleHistory,
  WAC_CITATION,
} from "@/lib/compliance/trade-samples";
import {
  SampleHistoryClient,
  type SampleHistoryCaps,
} from "@/components/admin/compliance/SampleHistoryClient";

export const dynamic = "force-dynamic";

/**
 * Employee Sample History — read-only reporting surface (WAC 314-55-096).
 *
 * Shows every TRADE sample RECEIPT by a paid employee (outgoing trade).
 * Incoming-from-processor rows are excluded server-side (they aren't an
 * employee receipt). IQC is producer/processor-only [096(3)] and is not
 * available to a retailer, so it has been fully retired. All filtering /
 * sorting / CSV happen client-side; nothing on this page mutates data.
 */
export default async function SampleHistoryPage() {
  await requirePermission("settings.manage");

  const [events, settings] = await Promise.all([
    listEmployeeSampleHistory(),
    getSampleSettings(),
  ]);

  const caps: SampleHistoryCaps = {
    tradeCap: settings.outgoingUnitsPerEmployee,
  };

  // Distinct employees present in the history (for the filter dropdown), A–Z.
  const employees = [
    ...new Map(
      events
        .filter((e) => e.employeeId && e.employeeName)
        .map((e) => [e.employeeId as string, { id: e.employeeId as string, name: e.employeeName as string }]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="pb-12">
      <AdminPageHeader
        title="Employee sample history"
        subtitle={`Every trade-outgoing sample given to an employee — ${WAC_CITATION}`}
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Compliance", href: "/admin/compliance/sales-limits" },
              { label: "Employee samples", href: "/admin/compliance/samples" },
              { label: "Sample history" },
            ]}
          />
        }
        help={
          <HelpPanel
            id="sample-history"
            title="Reading the sample history"
            steps={[
              "This page lists every TRADE sample RECEIVED by a paid employee (trade-outgoing). Samples coming IN from a processor are not shown here (they are not an employee receipt). IQC is producer/processor-only and is not available to a retailer.",
              "Use the filters to narrow by employee, quarter, or product type; the free-text search matches employee name and note.",
              "The per-employee quarter cards show units given vs the statutory cap (30 trade/employee/quarter) for the rows currently in view — green under 80%, amber at 80%, red at or over the cap.",
              "Export CSV downloads exactly the rows you are currently viewing (after filters and sort).",
            ]}
          >
            <p>
              This is a read-only report — assignments happen on the Employee Samples page. Source:{" "}
              {WAC_CITATION}.
            </p>
          </HelpPanel>
        }
      />

      <div className="px-5 py-6 sm:px-8">
        <SampleHistoryClient events={events} employees={employees} caps={caps} />
      </div>
    </div>
  );
}
