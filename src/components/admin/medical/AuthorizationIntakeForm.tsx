"use client";

/**
 * AuthorizationIntakeForm — Slice 85.
 *
 * The guided, single-screen form used on /admin/medical/intake to take in a new
 * medical authorization efficiently. It mirrors the DOH 608-048 checklist used
 * elsewhere (see MedicalPanel) but adds a scanned-form upload (from the owner's
 * Canon PIXMA TS3522 flatbed) so the paper authorization is retained as part of
 * the WAC 314-55-090(2) five-year record in one step.
 *
 * There is NO public DOH/MCR retailer API, so we record what the Certified
 * Medical Cannabis Consultant validates — we do not call the DOH database.
 *
 * Wired to intakeAuthorizationAction (server action) which creates the row,
 * uploads the optional scan, then redirects back with a status flag.
 */
import { useFormStatus } from "react-dom";
import { Field, Input, Select, Textarea } from "@/components/admin/ui";
import { intakeAuthorizationAction } from "@/app/admin/medical/actions";

function SubmitButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="inline-flex items-center justify-center rounded-[var(--admin-radius)] bg-[var(--admin-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Issuing…" : "Issue recognition card"}
    </button>
  );
}

export function AuthorizationIntakeForm({
  customerId,
  disabled = false,
}: {
  customerId: string;
  disabled?: boolean;
}) {
  return (
    <form action={intakeAuthorizationAction} className="space-y-4">
      <input type="hidden" name="customer_id" value={customerId} />

      {/* Step: scan */}
      <div className="rounded-lg border border-[var(--admin-border)] p-3">
        <p className="mb-1 text-xs font-semibold text-[var(--admin-text)]">
          Scanned authorization (Canon PIXMA TS3522)
        </p>
        <p className="mb-2 text-xs text-[var(--admin-text-faint)]">
          Scan the paper form to PDF or JPG on the Canon flatbed, then attach it here. Stored
          privately (staff-only) as part of the retained record.
        </p>
        <input
          type="file"
          name="form_scan"
          accept="application/pdf,image/png,image/jpeg,image/tiff"
          disabled={disabled}
          className="block w-full text-sm text-[var(--admin-text-muted)] file:mr-3 file:rounded-[var(--admin-radius)] file:border-0 file:bg-[var(--admin-surface-2,#1f2937)] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[var(--admin-text)] disabled:opacity-50"
        />
      </div>

      {/* Step: details */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Unique patient identifier (UPID)" help="From the MCR">
          <Input name="unique_patient_identifier" placeholder="e.g. 1234567" disabled={disabled} />
        </Field>
        <Field label="Holder type">
          <Select name="holder_type" defaultValue="patient" disabled={disabled}>
            <option value="patient">Patient</option>
            <option value="designated_provider">Designated Provider</option>
          </Select>
        </Field>
        <Field label="Authorization ID (optional)" help="Provider's form / authorization number">
          <Input name="authorization_id" placeholder="Optional" disabled={disabled} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Effective date">
            <Input name="effective_on" type="date" disabled={disabled} />
          </Field>
          <Field label="Expiration date">
            <Input name="expires_on" type="date" disabled={disabled} />
          </Field>
        </div>
      </div>

      {/* Step: DOH 608-048 checklist */}
      <div className="rounded-lg border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-3">
        <p className="mb-2 text-xs font-semibold text-[var(--admin-gold)]">
          Authorization-form checklist (DOH 608-048) — all four required to issue
        </p>
        <div className="space-y-2 text-sm text-[var(--admin-text)]">
          <label className="flex items-start gap-2">
            <input type="checkbox" name="chk_form" className="mt-0.5 h-4 w-4" disabled={disabled} />
            <span>Form complete &amp; signed by a health care practitioner</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="chk_tamper" className="mt-0.5 h-4 w-4" disabled={disabled} />
            <span>Printed on tamper-resistant paper with a security feature</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="chk_identity" className="mt-0.5 h-4 w-4" disabled={disabled} />
            <span>Identity verified (full legal name, physical address)</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="chk_seal" className="mt-0.5 h-4 w-4" disabled={disabled} />
            <span>Embossed RCW 69.51A.030 seal visible</span>
          </label>
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm text-[var(--admin-text)]">
        <input
          type="checkbox"
          name="in_doh_database"
          defaultChecked
          className="mt-0.5 h-4 w-4"
          disabled={disabled}
        />
        <span>
          Patient entered / active in the DOH database (MCR) — enables tax exemptions. A consultant
          does this in the MCR; there is no API.
        </span>
      </label>

      <Field label="Notes (optional)">
        <Textarea name="notes" rows={2} placeholder="Internal note" disabled={disabled} />
      </Field>

      <div className="flex items-center gap-3">
        <SubmitButton disabled={disabled} />
        <span className="text-xs text-[var(--admin-text-faint)]">
          After issuing, print the card and run it through the Scotch Thermal Laminator.
        </span>
      </div>
    </form>
  );
}
