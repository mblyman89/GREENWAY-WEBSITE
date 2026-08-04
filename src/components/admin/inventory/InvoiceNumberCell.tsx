"use client";

/**
 * InvoiceNumberCell — inline, correctable Invoice # for the intake table.
 *
 * The Invoice # is DERIVED from the vendor payload (order/invoice # else the
 * manifest number). When it's wrong the owner clicks the pencil, types the
 * correct value, and Saves — the correction (migration 0151's
 * invoice_number_override) then wins everywhere the invoice # is shown. A blank
 * Save clears the correction and reverts to the derived value.
 *
 * Client component so the edit is inline (no page navigation to edit); it posts
 * to the `setInvoiceNumberAction` server action bound to this manifest's id.
 * The page already gates the whole intake area behind inventory.manage, and the
 * action re-checks that permission server-side — so this is owner-only.
 */
import { useState } from "react";
import { useFormStatus } from "react-dom";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-[var(--admin-radius)] bg-[var(--admin-accent)] px-2 py-1 text-xs font-bold uppercase tracking-wide text-black transition hover:brightness-110 disabled:opacity-40"
      title="Save the corrected Invoice #"
    >
      {pending ? "Saving…" : "Save"}
    </button>
  );
}

export function InvoiceNumberCell({
  displayValue,
  isOverridden,
  action,
}: {
  /** What the table currently shows (derived value or existing override). */
  displayValue: string | null;
  /** True when this value came from an owner correction (0151). */
  isOverridden: boolean;
  /** setInvoiceNumberAction.bind(null, manifestId) — posts FormData. */
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="text-[var(--admin-text-muted)]">{displayValue ?? "—"}</span>
        {isOverridden && (
          <span
            className="rounded bg-[var(--admin-gold-soft)] px-1 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-[var(--admin-gold)]"
            title="This Invoice # was corrected by you (overrides the value read from the document)."
          >
            edited
          </span>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs text-[var(--admin-text-faint)] transition hover:text-[var(--admin-accent)]"
          title="Correct the Invoice / Order #"
          aria-label="Edit invoice number"
        >
          ✏️
        </button>
      </span>
    );
  }

  return (
    <form
      action={action}
      className="inline-flex items-center gap-1.5"
      onSubmit={() => setEditing(false)}
    >
      <input
        name="invoice_number"
        defaultValue={displayValue ?? ""}
        autoFocus
        placeholder="Invoice / Order #"
        className="w-36 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-1 text-xs text-[var(--admin-text)] outline-none focus:border-[var(--admin-accent)]"
      />
      <SaveButton />
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] px-2 py-1 text-xs text-[var(--admin-text-muted)] transition hover:text-[var(--admin-text)]"
        title="Cancel"
      >
        Cancel
      </button>
    </form>
  );
}
