"use client";

/**
 * RegisterSwitchesEditor (D241) — the owner's two register switches:
 *   1. Browser registers on / off (off = only the iPad app can unlock).
 *   2. Manager approval on change swaps with the master till on / off.
 */
import { useState, useTransition } from "react";
import { Button } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import type { RegisterSwitches } from "@/lib/pos/register-switches-core";
import { saveRegisterSwitchesAction } from "@/app/admin/registers/switches/actions";

export function RegisterSwitchesEditor({ initial }: { initial: RegisterSwitches }) {
  const { toast } = useToast();
  const [webRegistersAllowed, setWeb] = useState<boolean>(initial.webRegistersAllowed);
  const [swapApprovalRequired, setSwap] = useState<boolean>(initial.swapApprovalRequired);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const res = await saveRegisterSwitchesAction({ webRegistersAllowed, swapApprovalRequired });
      if (res.ok) {
        toast({ tone: "success", message: "Register switches saved." });
      } else {
        toast({ tone: "error", message: res.error });
      }
    });
  }

  const row =
    "flex cursor-pointer items-start gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4";

  return (
    <div className="space-y-4">
      <label className={row}>
        <input
          type="checkbox"
          checked={webRegistersAllowed}
          onChange={(e) => setWeb(e.target.checked)}
          className="mt-1 h-4 w-4 accent-[var(--admin-accent)]"
        />
        <span>
          <span className="block text-sm font-semibold text-[var(--admin-text)]">
            Allow browser registers (web)
          </span>
          <span className="block text-xs text-[var(--admin-text-faint)]">
            {webRegistersAllowed
              ? "ON: a register opened in a web browser (greenwaymarijuana.com/pos) can be unlocked."
              : "OFF: only the iPad app (Greenway Point of Transaction) can be unlocked. A browser register shows “Browser registers are turned off”."}{" "}
            Turn this on only if the iPads have failed. Clock in / out and syncing saved sales keep
            working either way, so nothing is lost.
          </span>
        </span>
      </label>
      <label className={row}>
        <input
          type="checkbox"
          checked={swapApprovalRequired}
          onChange={(e) => setSwap(e.target.checked)}
          className="mt-1 h-4 w-4 accent-[var(--admin-accent)]"
        />
        <span>
          <span className="block text-sm font-semibold text-[var(--admin-text)]">
            Manager approval on change swaps with the master till
          </span>
          <span className="block text-xs text-[var(--admin-text-faint)]">
            {swapApprovalRequired
              ? "ON: a swap needs the cashier's PIN and a manager or lead PIN (two people)."
              : "OFF: the cashier's own PIN records the swap. No manager PIN is asked for."}{" "}
            Either way the swap is saved with the bills both ways and audited. When it is off, the
            audit row says “approval not required”.
          </span>
        </span>
      </label>
      <Button onClick={save} disabled={pending}>
        {pending ? "Saving…" : "Save register switches"}
      </Button>
      <p className="text-xs text-[var(--admin-text-faint)]">
        Online registers follow the change at once (the server checks every unlock and every swap).
        A register that is offline uses the setting from its last menu download until it is back
        online.
      </p>
    </div>
  );
}
