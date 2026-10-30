import { CountGrid } from "@/components/admin/registers/CountGrid";
import { Button, Input, Select } from "@/components/admin/ui";
import { formatCents } from "@/lib/registers/cash";
import type { EmployeeOption, RegisterActivityRow } from "@/lib/registers/oversight";
import { openDrawerAction, closeDrawerAction, recordDropAction } from "@/app/admin/registers/actions";

/**
 * Manager control layer for a register on the back-office command center.
 *
 * Server component (renders <form action={serverAction}>). The interactive
 * count grid with a live total is the only client piece (CountGrid). All three
 * flows reuse the EXISTING server actions and store functions — no new backend
 * contract:
 *   - Open drawer  (idle register): count-in float          → openDrawerAction
 *   - Close drawer (open register): BLIND count-out          → closeDrawerAction
 *   - Cash drop    (open register): drop to the safe         → recordDropAction
 *
 * These mirror the front-end iPad POS cash steps, exposed here so a manager can
 * also perform / correct them from the command center (e.g. close a drawer that
 * was left open, as the owner hit).
 */
function EmployeePicker({
  name,
  employees,
  label,
  required = false,
}: {
  name: string;
  employees: EmployeeOption[];
  label: string;
  required?: boolean;
}) {
  return (
    <label className="block text-xs text-[var(--admin-text-muted)]">
      {label}
      <Select name={name} defaultValue="" required={required}>
        <option value="">{required ? "Select…" : "— none —"}</option>
        {employees.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
            {e.role !== "sales" ? ` (${e.role})` : ""}
          </option>
        ))}
      </Select>
    </label>
  );
}

export function RegisterControls({
  register,
  employees,
}: {
  register: RegisterActivityRow;
  employees: EmployeeOption[];
}) {
  // Idle register → offer count-in (open drawer).
  if (!register.open) {
    return (
      <details className="group mt-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-0">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-medium text-[var(--admin-text)] transition hover:bg-[var(--admin-surface-2)]">
          <span>Open drawer</span>
          <span className="text-xs text-[var(--admin-text-faint)] group-open:hidden">
            float {formatCents(register.defaultFloatMinor)}
          </span>
        </summary>
        <form action={openDrawerAction} className="space-y-3 border-t border-[var(--admin-border)] p-3">
          <input type="hidden" name="register_id" value={register.registerId} />
          <p className="text-xs text-[var(--admin-text-muted)]">
            Count in the starting float by denomination. Standard float for this register is{" "}
            {formatCents(register.defaultFloatMinor)}. A different count still opens the drawer,
            with a warning (owner rule D85).
          </p>
          <CountGrid
            expectedMinor={register.defaultFloatMinor}
            expectedLabel="Standard float"
            totalLabel="Count-in total"
          />
          <EmployeePicker name="employee_id" employees={employees} label="Opened by" />
          <div className="flex justify-end">
            <Button type="submit" variant="confirm" size="sm">
              Open drawer
            </Button>
          </div>
        </form>
      </details>
    );
  }

  // Open register → offer cash drop + blind close.
  return (
    <div className="mt-3 space-y-2">
      {/* Cash drop to the safe */}
      <details className="group rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)]">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-medium text-[var(--admin-text)] transition hover:bg-[var(--admin-surface-2)]">
          <span>Cash drop to safe</span>
          <span className="text-xs text-[var(--admin-text-faint)]">🔽</span>
        </summary>
        <form action={recordDropAction} className="space-y-3 border-t border-[var(--admin-border)] p-3">
          <input type="hidden" name="session_id" value={register.sessionId ?? ""} />
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-[var(--admin-text-muted)]">
              Amount ($)
              <Input name="amount" type="number" step="0.01" min="0" placeholder="0.00" required />
            </label>
            <label className="block text-xs text-[var(--admin-text-muted)]">
              Drop window
              <Select name="drop_window" defaultValue="afternoon">
                <option value="afternoon">Afternoon</option>
                <option value="night">Night</option>
                <option value="other">Other</option>
              </Select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <EmployeePicker name="dropped_by" employees={employees} label="Dropped by" />
            <EmployeePicker name="witnessed_by" employees={employees} label="Witnessed by" />
          </div>
          <label className="block text-xs text-[var(--admin-text-muted)]">
            Notes (optional)
            <Input name="notes" placeholder="e.g. large-bill pull" />
          </label>
          <div className="flex justify-end">
            <Button type="submit" variant="save" size="sm">
              Record drop
            </Button>
          </div>
        </form>
      </details>

      {/* Blind close */}
      <details className="group rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)]">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-medium text-[var(--admin-text)] transition hover:bg-[var(--admin-surface-2)]">
          <span>Close drawer (blind count-out)</span>
          <span className="text-xs text-[var(--admin-text-faint)]">🔒</span>
        </summary>
        <form action={closeDrawerAction} className="space-y-3 border-t border-[var(--admin-border)] p-3">
          <input type="hidden" name="session_id" value={register.sessionId ?? ""} />
          <p className="text-xs text-[var(--admin-text-muted)]">
            Count the drawer as it sits. This is a <strong>blind</strong> count — the expected
            amount and any over/short stay hidden until a manager reconciles.
          </p>
          {/* No expected shown on purpose: this is a blind close. */}
          <CountGrid totalLabel="Count-out total" />
          {/* Fix Phase 6 (G-64, owner D89 / Q-E-10): the crew's pooled tip jar
              is split evenly at shift change; the closer's share goes on
              their close. "My own tips" records the figure as typed. */}
          <div className="grid grid-cols-3 gap-2">
            <label className="block text-xs text-[var(--admin-text-muted)]">
              Tips are
              <Select name="tip_mode" defaultValue="pool">
                <option value="pool">Crew pool (split evenly)</option>
                <option value="own">This person&apos;s own tips</option>
              </Select>
            </label>
            <label className="block text-xs text-[var(--admin-text-muted)]">
              Tips counted ($)
              <Input name="tips" type="number" step="0.01" min="0" placeholder="0.00" />
            </label>
            <label className="block text-xs text-[var(--admin-text-muted)]">
              People sharing
              <Input name="tip_people" type="number" step="1" min="1" max="10" defaultValue="2" />
            </label>
          </div>
          <p className="text-xs text-[var(--admin-text-muted)]">
            The tip jar is employee money; count it separately and keep it OUT of the drawer count
            above. For a crew pool, type the whole jar: the closer&apos;s share (pool ÷ people,
            whole cents; odd cents stay in the jar) is recorded on their close. Leave blank if not
            recorded.
          </p>
          <EmployeePicker name="employee_id" employees={employees} label="Counted by" required />
          {/* Fix Phase 2.2 (G-01, owner D2): any second employee counts the
              same drawer on their own and enters their PIN. Required. */}
          <div className="space-y-2 rounded-lg border border-[var(--admin-border)] p-2">
            <p className="text-xs font-semibold text-[var(--admin-text)]">Second count (required)</p>
            <p className="text-xs text-[var(--admin-text-muted)]">
              Any other employee counts the drawer by themselves, without looking at the count
              above, and types what they counted. They cannot be the person in Counted by. If the
              two counts differ, the drawer still closes and the difference is shown at reconcile.
            </p>
            <CountGrid totalLabel="Second count total" namePrefix="second_" />
            <label className="block text-xs text-[var(--admin-text-muted)]">
              Second employee&apos;s PIN
              <Input name="second_pin" type="password" inputMode="numeric" autoComplete="off" maxLength={6} required />
            </label>
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="danger" size="sm">
              Close drawer
            </Button>
          </div>
        </form>
      </details>
    </div>
  );
}
