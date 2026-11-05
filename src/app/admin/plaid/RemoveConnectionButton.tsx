"use client";

/**
 * RemoveConnectionButton — a small client wrapper around the
 * removePlaidItemAction server action that asks the owner to CONFIRM before it
 * submits, so a whole bank connection (and its accounts/transactions/mortgage/
 * holdings) can't be deleted by an accidental click.
 *
 * It renders its own <form action={removePlaidItemAction}> with the item_id in
 * a hidden field. On the button click we run window.confirm(); if the owner
 * cancels we preventDefault() so no submit fires and nothing happens. A plain <form> submit (no confirm) is
 * the graceful fallback if JS is disabled — the server action still gates on
 * permission, so this is safe.
 */
import { removePlaidItemAction } from "./actions";

export function RemoveConnectionButton({
  itemId,
  institutionName,
}: {
  itemId: string;
  /** Shown in the confirm prompt so the owner knows exactly what they're removing. */
  institutionName: string;
}) {
  return (
    // D179: confirm on the button CLICK (not onSubmit) so a Cancel never
    // leaves PendingKeeper holding the form busy (L-30 bug class).
    <form action={removePlaidItemAction}>
      <input type="hidden" name="item_id" value={itemId} />
      <button
        type="submit"
        onClick={(e) => {
        const ok = window.confirm(
          `Remove the "${institutionName}" connection?\n\n` +
            "This deletes its accounts, transactions, and any mortgage/holdings " +
            "detail from this app, and disconnects it from Plaid. You can always " +
            "reconnect it later. This cannot be undone.",
        );
        if (!ok) e.preventDefault();
        }}
        className="rounded-[var(--admin-radius)] border border-amber-500/40 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/[0.08]"
      >
        Remove
      </button>
    </form>
  );
}
