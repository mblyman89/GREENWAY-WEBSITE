import { Field, Input, Button } from "@/components/admin/ui";

/**
 * The payroll SOURCE DOCUMENT panel. The owner uploads the payroll data (Sage
 * register / paystub export / CSV / PDF) that this run is tied to. A run cannot
 * generate an ACH file until a document is attached — this is the owner's rule:
 * "block payments unless there is a source document to tie it to."
 */
export function PayrollSourceDocPanel({
  runId,
  hasDocument,
  uploadAction,
}: {
  runId: string;
  hasDocument: boolean;
  uploadAction: (runId: string, formData: FormData) => void | Promise<void>;
}) {
  return (
    <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-bold text-[var(--admin-text)]">Payroll source document</h2>
        {hasDocument ? (
          <span className="rounded-full bg-[var(--admin-accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--admin-accent)]">
            ✓ Attached
          </span>
        ) : (
          <span className="rounded-full bg-[var(--admin-danger-soft,rgba(220,38,38,0.12))] px-2 py-0.5 text-[11px] font-semibold text-[var(--admin-danger)]">
            Required
          </span>
        )}
      </div>
      <p className="mb-4 text-xs text-[var(--admin-text-muted)]">
        Upload the payroll data this run pays from — your Sage payroll register, the paystub
        export, or a CSV/PDF. The file is fingerprinted (SHA-256) so it can be recognised, and the
        run is tied to it. {hasDocument ? "A document is attached; you can replace it below." : "You must attach a document before generating the ACH file."}
      </p>
      <form action={uploadAction.bind(null, runId)} className="grid gap-3 sm:grid-cols-2">
        <Field label="Payroll file" help="Sage register / paystub export / CSV / PDF">
          <input
            type="file"
            name="source_file"
            required
            className="block w-full text-sm text-[var(--admin-text)] file:mr-3 file:rounded-[var(--admin-radius)] file:border-0 file:bg-[var(--admin-surface-2)] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[var(--admin-text)]"
          />
        </Field>
        <Field label="Label (optional)" help="e.g. “Sage register — period ending 6/14”">
          <Input name="doc_label" placeholder="Sage payroll register" />
        </Field>
        <Field label="Period start (optional)">
          <Input type="date" name="period_start" />
        </Field>
        <Field label="Period end (optional)">
          <Input type="date" name="period_end" />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" variant="save" size="sm">
            {hasDocument ? "Replace document" : "Attach document"}
          </Button>
        </div>
      </form>
    </section>
  );
}
