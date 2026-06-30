import { Field, Input, Textarea, Button } from "@/components/admin/ui";
import type { Customer } from "@/lib/customers/types";

/**
 * CustomerForm — create/edit a customer. Server-component friendly; submits to
 * a server action passed in by the page. Part of POS Slice 2.
 */
export function CustomerForm({
  customer,
  action,
  submitLabel,
}: {
  customer?: Customer | null;
  action: (formData: FormData) => void;
  submitLabel: string;
}) {
  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" required>
          <Input name="first_name" defaultValue={customer?.first_name ?? ""} required />
        </Field>
        <Field label="Last name">
          <Input name="last_name" defaultValue={customer?.last_name ?? ""} />
        </Field>
        <Field label="Email">
          <Input type="email" name="email" defaultValue={customer?.email ?? ""} />
        </Field>
        <Field label="Phone">
          <Input name="phone" defaultValue={customer?.phone ?? ""} placeholder="(360) 555-0123" />
        </Field>
        <Field label="Date of birth" help="yyyy-mm-dd — powers the 21+ check at the register.">
          <Input type="date" name="birthdate" defaultValue={customer?.birthdate ?? ""} />
        </Field>
      </div>

      <div className="space-y-2 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
        <label className="flex items-center gap-2 text-sm text-[var(--admin-text-muted)]">
          <input type="checkbox" name="marketing_consent" defaultChecked={customer?.marketing_consent ?? false} />
          Marketing consent (customer agreed to receive marketing)
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--admin-text-muted)]">
          <input type="checkbox" name="do_not_contact" defaultChecked={customer?.do_not_contact ?? false} />
          Do not contact (suppress all outreach)
        </label>
      </div>

      <Field label="Staff note" help="Internal only — never shown to the customer.">
        <Textarea name="staff_note" rows={3} defaultValue={customer?.staff_note ?? ""} />
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" variant="save">
          {submitLabel}
        </Button>
        <Button href="/admin/customers" variant="subtle">
          Cancel
        </Button>
      </div>
    </form>
  );
}
