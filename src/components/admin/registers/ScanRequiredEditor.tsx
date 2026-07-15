"use client";

/**
 * ScanRequiredEditor (POS Slice B41) — the owner turns Dutchie-style
 * "require scanning" on or off. When on, cannabis items must be added at
 * the register by scanning the package barcode; merch/accessory tiles and
 * the B39 keypad stay tappable (no lot identity to protect), and a manager
 * or lead PIN lifts the restriction for a single sale (damaged label,
 * scanner down).
 */
import { useState, useTransition } from "react";
import { Button } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import type { PosScanRequiredConfig } from "@/lib/pos/scan-required-core";
import { saveScanRequiredAction } from "@/app/admin/registers/scanning/actions";

export function ScanRequiredEditor({ initial }: { initial: PosScanRequiredConfig }) {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState<boolean>(initial.enabled);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const res = await saveScanRequiredAction({ enabled });
      if (res.ok) {
        toast({ tone: "success", message: "Scanning policy saved. Registers pick it up on their next menu refresh." });
      } else {
        toast({ tone: "error", message: res.error });
      }
    });
  }

  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer items-start gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="mt-1 h-4 w-4 accent-[var(--admin-accent)]"
        />
        <span>
          <span className="block text-sm font-semibold text-[var(--admin-text)]">
            Require scanning for cannabis items
          </span>
          <span className="block text-xs text-[var(--admin-text-faint)]">
            Budtenders must scan the package barcode to ring cannabis — tapping a cannabis tile
            shows &ldquo;scan required&rdquo; instead of adding it. Merch &amp; accessory tiles and the
            quick-amount keypad are unaffected.
          </span>
        </span>
      </label>
      <Button onClick={save} disabled={pending}>
        {pending ? "Saving…" : "Save scanning policy"}
      </Button>
      <p className="text-xs text-[var(--admin-text-faint)]">
        A manager or lead can lift the requirement for a single sale with their PIN (damaged
        label, scanner down) — verified server-side, so the unlock needs the register to be
        online. The register locks after every sale, so an unlock never carries into the next
        customer.
      </p>
    </div>
  );
}
