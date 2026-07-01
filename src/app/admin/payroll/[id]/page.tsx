import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Button, Badge } from "@/components/admin/ui";
import { getPayrollRun, getAchCompanySettings } from "@/lib/payroll/payroll-store";
import { listEmployees } from "@/lib/staffing/store";
import { centsToDollars } from "@/lib/payroll/payroll-core";
import {
  PayrollEntryTable,
  type EmployeeRow,
} from "@/components/admin/payroll/PayrollEntryTable";
import { saveRunLinesAction, generateRunAction } from "../actions";

export const dynamic = "force-dynamic";

function statusTone(status: string): "green" | "gold" | "neutral" | "danger" {
  if (status === "file_generated") return "green";
  if (status === "submitted") return "green";
  if (status === "void") return "danger";
  return "gold";
}

function statusLabel(status: string): string {
  switch (status) {
    case "file_generated":
      return "File generated";
    case "submitted":
      return "Submitted";
    case "void":
      return "Void";
    default:
      return "Draft";
  }
}

export default async function PayrollRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  await requirePermission("settings.manage");
  const { id } = await params;
  const { msg, error } = await searchParams;

  const detail = await getPayrollRun(id);
  if (!detail) notFound();
  const { run, lines } = detail;

  const [employees, settings] = await Promise.all([
    listEmployees(),
    getAchCompanySettings(),
  ]);

  const readOnly = run.status !== "draft";
  const settingsComplete = Boolean(
    settings.destination_routing &&
      settings.immediate_origin &&
      settings.company_name &&
      settings.company_id &&
      settings.originating_dfi,
  );

  // Merge each active employee with any existing saved line for this run.
  // Prefill amounts from the saved line (via centsToDollars); prefill banking
  // from the saved line snapshot first, then fall back to the employee's
  // stored direct-deposit banking so repeated runs are fast to fill.
  const linesByEmployee = new Map(
    lines.filter((l) => l.employee_id).map((l) => [l.employee_id as string, l]),
  );

  const rows: EmployeeRow[] = employees.map((emp) => {
    const line = linesByEmployee.get(emp.id);
    const routing = line?.bank_routing ?? emp.bank_routing ?? "";
    const account = line?.bank_account_number ?? emp.bank_account_number ?? "";
    const accountType =
      line?.bank_account_type ?? emp.bank_account_type ?? "checking";
    return {
      id: emp.id,
      name: emp.full_name,
      net: line ? centsToDollars(line.net_pay_cents) : "",
      gross: line?.gross_pay_cents != null ? centsToDollars(line.gross_pay_cents) : "",
      taxes: line?.taxes_cents != null ? centsToDollars(line.taxes_cents) : "",
      deductions:
        line?.deductions_cents != null ? centsToDollars(line.deductions_cents) : "",
      routing,
      account,
      accountType: accountType as "checking" | "savings",
    };
  });

  // Any lines for employees no longer active/listed still count toward the run,
  // but we surface only the merged active-employee rows in the editor. Note if
  // there are orphaned lines so the totals aren't confusing.
  const listedIds = new Set(employees.map((e) => e.id));
  const orphanLines = lines.filter(
    (l) => !l.employee_id || !listedIds.has(l.employee_id),
  );

  const runTitle = run.label?.trim() || `Payroll run ${run.pay_date}`;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Payroll", href: "/admin/payroll" },
          { label: runTitle },
        ]}
      />

      <AdminPageHeader
        title={runTitle}
        subtitle={`Pay date ${run.pay_date} · manually enter the amounts from your Sage paystubs, then generate the bank ACH file.`}
      />

      {msg ? (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)] bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-text)]">
          {msg}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)] bg-[var(--admin-danger-soft,rgba(220,38,38,0.08))] px-4 py-3 text-sm text-[var(--admin-danger)]">
          {error}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <Badge tone={statusTone(run.status)}>{statusLabel(run.status)}</Badge>
        {run.nacha_filename ? (
          <span className="text-xs text-[var(--admin-text-faint)]">
            File: {run.nacha_filename}
            {run.generated_at
              ? ` · generated ${new Date(run.generated_at).toLocaleString()}`
              : ""}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Employees paid" value={String(run.entry_count)} accent="green" />
        <StatCard label="Total net pay" value={`$${centsToDollars(run.total_net_cents)}`} accent="green" />
        <StatCard label="Total taxes" value={`$${centsToDollars(run.total_taxes_cents)}`} accent="muted" />
        <StatCard label="Total gross" value={`$${centsToDollars(run.total_gross_cents)}`} accent="gold" />
      </div>

      {!settingsComplete ? (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)] bg-[var(--admin-danger-soft,rgba(220,38,38,0.08))] px-4 py-3 text-sm text-[var(--admin-danger)]">
          Your bank ACH block is not fully configured yet.{" "}
          <Link href="/admin/payroll" className="underline">
            Finish the ACH company settings
          </Link>{" "}
          before generating a file. You can still enter amounts now.
        </div>
      ) : null}

      {orphanLines.length > 0 ? (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-3 text-xs text-[var(--admin-text-muted)]">
          {orphanLines.length} saved line(s) belong to employees who are no longer
          active and are not shown in the editor below, but they are still counted
          in the run totals and the generated file.
        </div>
      ) : null}

      <PayrollEntryTable
        runId={id}
        employees={rows}
        saveAction={saveRunLinesAction}
        readOnly={readOnly}
      />

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--admin-border)] pt-5">
        {run.status === "draft" ? (
          <form action={generateRunAction.bind(null, id)}>
            <Button type="submit" variant="primary" size="sm" disabled={!settingsComplete}>
              Generate ACH file
            </Button>
          </form>
        ) : null}

        {run.nacha_filename ? (
          <Link
            href={`/admin/payroll/${id}/download`}
            className="inline-flex items-center gap-2 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-1.5 text-sm font-medium text-[var(--admin-text)] hover:bg-[var(--admin-surface-2)]"
            prefetch={false}
          >
            ⬇ Download {run.nacha_filename}
          </Link>
        ) : null}

        <span className="text-xs text-[var(--admin-text-faint)]">
          {run.status === "draft"
            ? "Save your entries, then generate the file. Generating locks the run."
            : "This run is locked. Download the file above, or the file has already been submitted."}
        </span>
      </div>

      <HelpPanel
        id="payroll-run-help"
        title="How this works"
        steps={[
          "Run payroll in Sage as you normally do and print/open each employee's paystub.",
          "Type each employee's net pay (required) here. Gross, taxes and deductions are optional but let the row self-check against net pay.",
          "Enter each employee's bank routing and account number once — it is saved to their record and prefilled on future runs.",
          "Click Save entries, confirm the totals match Sage, then Generate ACH file.",
          "Download the .ach file and upload it to Timberland Bank's Jack Henry portal for direct deposit.",
        ]}
      >
        <p className="text-sm text-[var(--admin-text-muted)]">
          This does not connect to Sage automatically — you enter the final
          amounts yourself so nothing is guessed. The generated file is a standard
          NACHA PPD credit file (routing check digits and totals are validated
          before it is written).
        </p>
      </HelpPanel>
    </div>
  );
}
