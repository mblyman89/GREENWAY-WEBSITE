import { Button } from "@/components/admin/ui";
import type { GuardrailFinding } from "@/lib/payroll/payroll-guardrails-core";

const SEVERITY_STYLE: Record<
  GuardrailFinding["severity"],
  { border: string; bg: string; text: string; icon: string; label: string }
> = {
  block: {
    border: "border-[var(--admin-danger)]",
    bg: "bg-[var(--admin-danger-soft,rgba(220,38,38,0.10))]",
    text: "text-[var(--admin-danger)]",
    icon: "⛔",
    label: "Blocked",
  },
  warn: {
    border: "border-[var(--admin-gold,#c99a2e)]",
    bg: "bg-[rgba(201,154,46,0.10)]",
    text: "text-[var(--admin-gold,#c99a2e)]",
    icon: "⚠️",
    label: "Warning",
  },
  info: {
    border: "border-[var(--admin-border)]",
    bg: "bg-[var(--admin-surface-2)]",
    text: "text-[var(--admin-text-muted)]",
    icon: "ℹ️",
    label: "Note",
  },
};

/**
 * The payroll GUARDRAIL review — the compliance gate before generating the ACH
 * file. Renders every finding (blocks, warnings, notes), and only enables the
 * "Generate" button when the run is clear. Soft warnings require an explicit,
 * recorded override; hard blocks (missing source document, employee paid within
 * two weeks, another file already generated this two-week period) can never be
 * bypassed here.
 */
export function PayrollGuardrailPanel({
  runId,
  findings,
  hasHardBlock,
  hasWarnings,
  settingsComplete,
  generateAction,
}: {
  runId: string;
  findings: GuardrailFinding[];
  hasHardBlock: boolean;
  hasWarnings: boolean;
  settingsComplete: boolean;
  generateAction: (runId: string, formData: FormData) => void | Promise<void>;
}) {
  const blocks = findings.filter((f) => f.severity === "block");
  const warns = findings.filter((f) => f.severity === "warn");
  const infos = findings.filter((f) => f.severity === "info");
  const clean = findings.length === 0;
  // Generation is permitted only if no hard block and (no warnings unless overridden).
  const canGenerateWithoutOverride = !hasHardBlock && !hasWarnings && settingsComplete;

  return (
    <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <h2 className="mb-1 text-sm font-bold text-[var(--admin-text)]">Payroll guardrails</h2>
      <p className="mb-4 text-xs text-[var(--admin-text-muted)]">
        Before a file can be generated we check: a source document is attached, each employee is
        paid at most once every two weeks, only one file is produced per two-week period, and we
        flag duplicates, unusual amounts, and changed bank accounts.
      </p>

      {clean ? (
        <div className="mb-4 rounded-[var(--admin-radius)] border border-[var(--admin-accent)] bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-text)]">
          ✓ All guardrails pass. This run is clear to generate.
        </div>
      ) : (
        <ul className="mb-4 space-y-2">
          {[...blocks, ...warns, ...infos].map((f, i) => {
            const s = SEVERITY_STYLE[f.severity];
            return (
              <li
                key={`${f.code}-${f.employeeId ?? "run"}-${i}`}
                className={`flex items-start gap-3 rounded-[var(--admin-radius)] border ${s.border} ${s.bg} px-4 py-3`}
              >
                <span aria-hidden className="mt-0.5 text-base leading-none">
                  {s.icon}
                </span>
                <div className="min-w-0">
                  <p className={`text-xs font-semibold uppercase tracking-wide ${s.text}`}>
                    {s.label}
                    {f.overridable && f.severity === "warn" ? " · can override" : ""}
                    {!f.overridable && f.severity === "block" ? " · cannot be bypassed" : ""}
                  </p>
                  <p className="mt-0.5 text-sm text-[var(--admin-text)]">{f.message}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!settingsComplete ? (
        <div className="mb-4 rounded-[var(--admin-radius)] border border-[var(--admin-danger)] bg-[var(--admin-danger-soft,rgba(220,38,38,0.08))] px-4 py-3 text-sm text-[var(--admin-danger)]">
          Your bank ACH block is not fully configured. Finish it on the{" "}
          <a href="/admin/settings/banking" className="underline">
            Banking settings
          </a>{" "}
          page before generating.
        </div>
      ) : null}

      <form action={generateAction.bind(null, runId)} className="space-y-3">
        {/* Override is only meaningful when there are warnings and no hard block. */}
        {hasWarnings && !hasHardBlock ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-gold,#c99a2e)] bg-[rgba(201,154,46,0.08)] p-3">
            <label className="flex items-start gap-2 text-sm text-[var(--admin-text)]">
              <input type="checkbox" name="override_warnings" className="mt-1" />
              <span>
                I have reviewed the warnings above and confirm this file is correct. Override the
                warnings and generate.
              </span>
            </label>
            <input
              name="override_reason"
              placeholder="Reason (recorded in the audit log)"
              className="mt-2 w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm text-[var(--admin-text)]"
            />
          </div>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={hasHardBlock || !settingsComplete}
        >
          Generate ACH file
        </Button>
        {hasHardBlock ? (
          <span className="ml-3 text-xs text-[var(--admin-danger)]">
            Resolve the blocked item(s) above to enable generation.
          </span>
        ) : !canGenerateWithoutOverride && hasWarnings ? (
          <span className="ml-3 text-xs text-[var(--admin-text-faint)]">
            Tick the override box to generate with warnings.
          </span>
        ) : null}
      </form>
    </section>
  );
}
