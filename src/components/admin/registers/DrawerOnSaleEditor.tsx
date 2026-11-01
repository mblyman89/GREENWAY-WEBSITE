"use client";

/**
 * DrawerOnSaleEditor (R-DRAWER-1) — the owner picks how the cash drawer opens
 * after a cash sale: with a printed receipt (default) or without a receipt.
 */
import { useState, useTransition } from "react";
import { Button } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import {
  DRAWER_ON_SALE_LABELS,
  DRAWER_ON_SALE_MODES,
  drawerOnSaleSummary,
  type DrawerOnSaleMode,
  type PosDrawerOnSaleConfig,
} from "@/lib/pos/drawer-on-sale-core";
import { saveDrawerOnSaleAction } from "@/app/admin/registers/cash-drawer/actions";

export function DrawerOnSaleEditor({ initial }: { initial: PosDrawerOnSaleConfig }) {
  const { toast } = useToast();
  const [saved, setSaved] = useState<DrawerOnSaleMode>(initial.mode);
  const [mode, setMode] = useState<DrawerOnSaleMode>(initial.mode);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const res = await saveDrawerOnSaleAction({ mode });
      if (res.ok) {
        setSaved(mode);
        toast({ tone: "success", message: "Cash drawer setting saved. Registers pick it up on their next menu refresh." });
      } else {
        toast({ tone: "error", message: res.error });
      }
    });
  }

  return (
    <div className="space-y-4">
      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold text-[var(--admin-text)]">
          After a cash sale, how should the drawer open?
        </legend>
        {DRAWER_ON_SALE_MODES.map((m) => (
          <label
            key={m}
            className="flex cursor-pointer items-start gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4"
          >
            <input
              type="radio"
              name="drawer-on-sale"
              value={m}
              checked={mode === m}
              onChange={() => setMode(m)}
              className="mt-1 h-4 w-4 accent-[var(--admin-accent)]"
            />
            <span>
              <span className="block text-sm font-semibold text-[var(--admin-text)]">
                {DRAWER_ON_SALE_LABELS[m].title}
                {m === "print_receipt" ? " (default)" : ""}
              </span>
              <span className="block text-xs text-[var(--admin-text-faint)]">{DRAWER_ON_SALE_LABELS[m].detail}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="text-sm text-[var(--admin-text)]">{drawerOnSaleSummary({ mode })}</p>
      <Button onClick={save} disabled={pending || mode === saved}>
        {pending ? "Saving…" : "Save cash drawer setting"}
      </Button>
      <p className="text-xs text-[var(--admin-text-faint)]">
        Either way the drawer opens once per sale; tapping Print receipt again only reprints. No sale (manager PIN)
        is unchanged, and a sale put on the employee pay-later tab never opens the drawer.
      </p>
    </div>
  );
}
