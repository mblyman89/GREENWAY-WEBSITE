"use client";

/**
 * ReturnPolicyEditor (Fix Phase 6F, G-67 / G-68) — the owner sets the
 * customer-return policy from Register Activity → Return policy:
 *   • "Loyalty members only" toggle (off by default — owner message 9:
 *     "allow anyone to return products so long as they have the original
 *     packaging and the receipt"),
 *   • the return window in days (default 7),
 *   • which product types may be returned (ticked = returnable),
 *   • D205: "Allow returns without a receipt (loyalty members only)": the
 *     register looks the member up by name or phone, lists their sales in
 *     the window, and the product must be scanned to match the line sold.
 * The receipt and original packaging with a legible lot ID are NOT
 * settings — WAC 314-55-079(12) and the receipt lookup require them always.
 */
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import {
  MAX_RETURN_WINDOW_DAYS,
  MIN_RETURN_WINDOW_DAYS,
  returnPolicySummary,
  validateReturnPolicyDraft,
  type PosReturnPolicyConfig,
} from "@/lib/pos/return-policy-core";
import { saveReturnPolicyAction } from "@/app/admin/registers/return-policy/actions";

export function ReturnPolicyEditor({
  initial,
  categories,
}: {
  initial: PosReturnPolicyConfig;
  /** Every product type the store knows (value → label), active + hidden. */
  categories: { value: string; label: string }[];
}) {
  const { toast } = useToast();
  const [loyaltyRequired, setLoyaltyRequired] = useState(initial.loyaltyRequired);
  const [windowDays, setWindowDays] = useState(String(initial.windowDays));
  const [excluded, setExcluded] = useState<string[]>(initial.excludedCategories);
  const [noReceiptMembers, setNoReceiptMembers] = useState(initial.noReceiptMembers);
  const [pending, startTransition] = useTransition();

  // Excluded slugs that are no longer in the category list still show, so a
  // renamed/removed type can be un-blocked instead of hiding forever.
  const rows = useMemo(() => {
    const known = new Set(categories.map((c) => c.value));
    return [...categories, ...excluded.filter((v) => !known.has(v)).map((v) => ({ value: v, label: v }))];
  }, [categories, excluded]);
  const labelFor = (v: string) => rows.find((r) => r.value === v)?.label ?? v;

  const draft = validateReturnPolicyDraft({ loyaltyRequired, windowDays, excludedCategories: excluded, noReceiptMembers });

  function toggleType(value: string, returnable: boolean) {
    setExcluded((prev) => (returnable ? prev.filter((v) => v !== value) : [...prev.filter((v) => v !== value), value]));
  }

  function save() {
    startTransition(async () => {
      const res = await saveReturnPolicyAction({ loyaltyRequired, windowDays, excludedCategories: excluded, noReceiptMembers });
      if (res.ok) {
        toast({ tone: "success", message: "Return policy saved. Registers pick it up on their next menu refresh." });
      } else {
        toast({ tone: "error", message: res.error });
      }
    });
  }

  return (
    <div className="space-y-6">
      <label className="flex cursor-pointer items-start gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
        <input
          type="checkbox"
          checked={loyaltyRequired}
          onChange={(e) => setLoyaltyRequired(e.target.checked)}
          className="mt-1 h-4 w-4 accent-[var(--admin-accent)]"
        />
        <span>
          <span className="block text-sm font-semibold text-[var(--admin-text)]">Loyalty members only</span>
          <span className="block text-xs text-[var(--admin-text-faint)]">
            Off: anyone with the original receipt may return. On: the original sale must have had a loyalty
            member attached.
          </span>
        </span>
      </label>

      <label className="flex cursor-pointer items-start gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
        <input
          type="checkbox"
          checked={noReceiptMembers}
          onChange={(e) => setNoReceiptMembers(e.target.checked)}
          className="mt-1 h-4 w-4 accent-[var(--admin-accent)]"
        />
        <span>
          <span className="block text-sm font-semibold text-[var(--admin-text)]">
            Allow returns without a receipt (loyalty members only)
          </span>
          <span className="block text-xs text-[var(--admin-text-faint)]">
            A courtesy for members who lost the receipt. At the register: look the customer up by name or phone,
            pick their sale (only sales on their loyalty account, still inside the return window), then scan the
            product. The scan must match the item sold. Original packaging and a manager PIN are still required,
            and each one is marked &ldquo;no receipt&rdquo; in the Security Log.
          </span>
        </span>
      </label>

      <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
        <label htmlFor="return-window-days" className="block text-sm font-semibold text-[var(--admin-text)]">
          Return window (days)
        </label>
        <input
          id="return-window-days"
          type="number"
          inputMode="numeric"
          min={MIN_RETURN_WINDOW_DAYS}
          max={MAX_RETURN_WINDOW_DAYS}
          step={1}
          value={windowDays}
          onChange={(e) => setWindowDays(e.target.value)}
          className="mt-2 w-28 rounded-md border border-[var(--admin-border)] bg-transparent px-3 py-1.5 text-sm text-[var(--admin-text)]"
        />
        <p className="mt-1 text-xs text-[var(--admin-text-faint)]">
          Calendar days (Pacific) after the purchase day, {MIN_RETURN_WINDOW_DAYS}–{MAX_RETURN_WINDOW_DAYS}. With 7,
          a sale on the 1st can come back through the 8th.
        </p>
        {!draft.ok ? <p className="mt-1 text-xs text-[#ff6b6b]">{draft.error}</p> : null}
      </div>

      <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
        <p className="text-sm font-semibold text-[var(--admin-text)]">Product types that may be returned</p>
        <p className="text-xs text-[var(--admin-text-faint)]">
          Ticked = returnable. Untick a type to refuse returns of it at the register and the returns desk. When
          any type is unticked, an item whose type is not on record is refused too (ask a manager).
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((c) => {
            const returnable = !excluded.includes(c.value);
            return (
              <label key={c.value} className="flex cursor-pointer items-center gap-2 text-sm text-[var(--admin-text)]">
                <input
                  type="checkbox"
                  checked={returnable}
                  onChange={(e) => toggleType(c.value, e.target.checked)}
                  className="h-4 w-4 accent-[var(--admin-accent)]"
                />
                <span>{c.label}</span>
              </label>
            );
          })}
        </div>
      </div>

      {draft.ok ? (
        <p className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-3 text-xs text-[var(--admin-text-muted)]">
          <span className="font-semibold">Preview: </span>
          {returnPolicySummary(draft.config, labelFor)}
        </p>
      ) : null}

      <Button onClick={save} disabled={pending || !draft.ok}>
        {pending ? "Saving…" : "Save return policy"}
      </Button>
      <p className="text-xs text-[var(--admin-text-faint)]">
        Always required no matter the settings: the original receipt (its number is how the sale is found), unless
        the no-receipt option above is on and the customer is a loyalty member, and the original packaging with the lot ID fully legible (WAC 314-55-079(12)). A manager PIN approves every
        return.
      </p>
    </div>
  );
}
