import { Field, Input, Button } from "@/components/admin/ui";
import type { AchCompanySettings } from "@/lib/payroll/payroll-store";
import { saveBankingSettingsAction } from "@/app/admin/settings/banking/actions";

/**
 * The originating bank / company ACH block. Every field is annotated with what
 * it is and where it comes from, because these are bank-assigned values the
 * owner cannot guess. Shared by payroll and vendor (AP) ACH files.
 */
export function BankingSettingsForm({ settings }: { settings: AchCompanySettings }) {
  return (
    <form action={saveBankingSettingsAction} className="grid gap-4 sm:grid-cols-2">
      {/* --- What the owner already knows --- */}
      <Field label="Bank name" help="Your bank — “Immediate Destination Name” on the ACH file.">
        <Input name="destination_name" defaultValue={settings.destination_name} placeholder="Timberland Bank" />
      </Field>
      <Field label="Bank routing number (ABA)" help="Your bank's 9-digit routing — the “Immediate Destination.”">
        <Input name="destination_routing" defaultValue={settings.destination_routing} placeholder="123456780" inputMode="numeric" />
      </Field>
      <Field label="Company (legal / DBA) name" help="Prints on employees' & vendors' statements. Trimmed to 16 chars in the file.">
        <Input name="company_name" defaultValue={settings.company_name} placeholder="Greenway Marijuana" />
      </Field>

      {/* --- Your own funding account (the missing one) --- */}
      <Field label="Your account number" help="Your funding account at the bank. Not printed in the ACH header; used for the balanced-file offset and your bank's upload portal.">
        <Input name="company_account_number" defaultValue={settings.company_account_number} placeholder="000123456789" inputMode="numeric" />
      </Field>
      <Field label="Account type" help="Which of your accounts funds the batch.">
        <select
          name="company_account_type"
          defaultValue={settings.company_account_type}
          className="w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm text-[var(--admin-text)]"
        >
          <option value="checking">Checking</option>
          <option value="savings">Savings</option>
        </select>
      </Field>

      {/* --- Bank-assigned values (explained in the help panel above) --- */}
      <Field label="Company ID" help="Bank-assigned 10-char ID — usually “1” + your 9-digit EIN. Ask your bank if unsure.">
        <Input name="company_id" defaultValue={settings.company_id} placeholder="1911234567" />
      </Field>
      <Field label="Immediate Origin" help="Bank-assigned 10-char origin — usually the same “1” + EIN as Company ID. Ask your bank.">
        <Input name="immediate_origin" defaultValue={settings.immediate_origin} placeholder="1911234567" />
      </Field>
      <Field label="Originating DFI" help="The first 8 digits of YOUR bank's routing number. Auto-derived, but confirm with your bank.">
        <Input name="originating_dfi" defaultValue={settings.originating_dfi} placeholder="12345678" inputMode="numeric" />
      </Field>
      <Field label="Statement description" help="Prints on statements, e.g. PAYROLL or VENDOR PAY. 10 chars max.">
        <Input name="entry_description" defaultValue={settings.entry_description} placeholder="PAYROLL" />
      </Field>

      <div className="sm:col-span-2">
        <Button type="submit" variant="save" size="sm">
          Save banking settings
        </Button>
      </div>
    </form>
  );
}
