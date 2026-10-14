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
      <Field label="Bank name" help="“Immediate Destination Name” on the ACH file. Timberland: TIMBERLAND BANK.">
        <Input name="destination_name" defaultValue={settings.destination_name} placeholder="TIMBERLAND BANK" />
      </Field>
      <Field label="Bank routing number (ABA)" help="The “Immediate Destination.” Timberland's is 325170754 (Brenda, answer 3). Digits only.">
        <Input name="destination_routing" defaultValue={settings.destination_routing} placeholder="325170754" inputMode="numeric" />
      </Field>
      <Field label="Company name" help="Enter GREENWAY MARIJUANA. The batch header keeps 16 characters, GREENWAY MARIJUA, which is how Timberland set it up (Brenda, answer 1). Not the legal or IRS name.">
        <Input name="company_name" defaultValue={settings.company_name} placeholder="GREENWAY MARIJUANA" />
      </Field>

      {/* --- Your own funding account (the missing one) --- */}
      <Field label="Your account number" help="Your funding account at Timberland (the agreement names the account ending 6048). Not written in the file: Timberland's batches are unbalanced (credits only).">
        <Input name="company_account_number" defaultValue={settings.company_account_number} placeholder="account ending 6048" inputMode="numeric" />
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
      <Field label="Company ID" help="“1” followed by the 9-digit EIN, 10 digits, no dashes (Brenda, answer 2: “1 + EIN”). Must match the EIN on Books > Company information.">
        <Input name="company_id" defaultValue={settings.company_id} placeholder="1 + EIN (10 digits)" inputMode="numeric" />
      </Field>
      <Field label="Immediate Origin" help="The same “1” + EIN as the Company ID, 10 digits.">
        <Input name="immediate_origin" defaultValue={settings.immediate_origin} placeholder="1 + EIN (10 digits)" inputMode="numeric" />
      </Field>
      <Field label="Originating DFI" help="The first 8 digits of Timberland's routing number: 32517075.">
        <Input name="originating_dfi" defaultValue={settings.originating_dfi} placeholder="32517075" inputMode="numeric" />
      </Field>
      <Field label="Statement description" help="Payroll files always say PAYROLL (a Nacha rule since March 20, 2026), whatever is typed here. Vendor payment files say VENDOR PAY. 10 chars max.">
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
