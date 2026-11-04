"use client";

/**
 * OfflineUnlockPolicyEditor (D161) — the owner's controls for offline PIN
 * unlock on the iPad registers.
 *
 * Owner, 2026-11-04: "please now build for me something that allows my
 * employees to unlock the ipad registers in offline mode."
 *
 * Only the owner (registers.lockdown) can save or reset; everyone else with
 * access sees it read-only. The reset asks for the word RESET because it
 * makes every employee re-arm every iPad.
 */
import { useState, useTransition } from "react";
import { Button } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import { OFFLINE_POLICY_LIMITS, type OfflineUnlockPolicy } from "@/lib/pos/offline-unlock-core";
import { resetOfflineUnlockAction, saveOfflinePolicyAction } from "@/app/admin/registers/ipad-setup/offline-actions";

export function OfflineUnlockPolicyEditor({
  initial,
  canEdit,
  configured,
}: {
  initial: OfflineUnlockPolicy;
  canEdit: boolean;
  /** False when the server has no secret to derive offline keys from. */
  configured: boolean;
}) {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [hours, setHours] = useState(String(initial.maxOfflineHours));
  const [days, setDays] = useState(String(initial.armTtlDays));
  const [approval, setApproval] = useState(initial.allowOfflineApproval);
  const [confirm, setConfirm] = useState("");
  const [pending, startTransition] = useTransition();
  const L = OFFLINE_POLICY_LIMITS;

  function save() {
    startTransition(async () => {
      const res = await saveOfflinePolicyAction({ enabled, maxOfflineHours: hours, armTtlDays: days, allowOfflineApproval: approval });
      toast(res.ok ? { tone: "success", message: res.message } : { tone: "error", message: res.error });
    });
  }
  function reset() {
    startTransition(async () => {
      const res = await resetOfflineUnlockAction({ confirm });
      if (res.ok) setConfirm("");
      toast(res.ok ? { tone: "success", message: res.message } : { tone: "error", message: res.error });
    });
  }

  const box = "rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4";
  return (
    <div className="space-y-4" data-testid="offline-unlock-policy">
      {!configured ? (
        <p className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] p-3 text-xs text-[var(--admin-danger)]">
          The server has no secret to create offline keys, so offline unlock cannot arm. Set POS_OFFLINE_SECRET (32+
          characters) in Vercel, or make sure the Supabase service key is configured.
        </p>
      ) : null}
      {!canEdit ? (
        <p className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-3 text-xs text-[var(--admin-gold)]">
          Read-only. Only the owner can change offline unlock.
        </p>
      ) : null}
      <label className={`flex cursor-pointer items-start gap-3 ${box}`}>
        <input type="checkbox" checked={enabled} disabled={!canEdit} onChange={(e) => setEnabled(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--admin-accent)]" />
        <span>
          <span className="block text-sm font-semibold text-[var(--admin-text)]">Allow PIN unlock when the internet is down</span>
          <span className="block text-xs text-[var(--admin-text-faint)]">
            The iPad checks the PIN itself against a scrambled copy made the last time that person unlocked online. The PIN is
            never stored. Every offline unlock is recorded and re-checked when the internet returns. Turning this off erases the
            offline copies on every iPad.
          </span>
        </span>
      </label>
      <div className={box}>
        <label htmlFor="offline-hours" className="block text-sm font-semibold text-[var(--admin-text)]">
          Stop offline unlock after this many hours without contact
        </label>
        <input id="offline-hours" type="number" inputMode="numeric" min={L.maxOfflineHours.min} max={L.maxOfflineHours.max} step={1} value={hours} disabled={!canEdit} onChange={(e) => setHours(e.target.value)} className="mt-2 w-24 rounded-md border border-[var(--admin-border)] bg-transparent px-3 py-1.5 text-sm text-[var(--admin-text)]" />
        <p className="mt-1 text-xs text-[var(--admin-text-faint)]">
          Default 168 (7 days). A stolen iPad stops accepting PINs after this long. Too short and a long outage locks the counter.
        </p>
      </div>
      <div className={box}>
        <label htmlFor="offline-days" className="block text-sm font-semibold text-[var(--admin-text)]">
          Each person must unlock online at least every (days)
        </label>
        <input id="offline-days" type="number" inputMode="numeric" min={L.armTtlDays.min} max={L.armTtlDays.max} step={1} value={days} disabled={!canEdit} onChange={(e) => setDays(e.target.value)} className="mt-2 w-24 rounded-md border border-[var(--admin-border)] bg-transparent px-3 py-1.5 text-sm text-[var(--admin-text)]" />
        <p className="mt-1 text-xs text-[var(--admin-text-faint)]">Default 30. Any normal online unlock renews it automatically.</p>
      </div>
      <label className={`flex cursor-pointer items-start gap-3 ${box}`}>
        <input type="checkbox" checked={approval} disabled={!canEdit} onChange={(e) => setApproval(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--admin-accent)]" />
        <span>
          <span className="block text-sm font-semibold text-[var(--admin-text)]">Allow manager/lead approvals offline (no-sale, price override)</span>
          <span className="block text-xs text-[var(--admin-text-faint)]">
            Only a manager or lead who has unlocked that iPad online can approve. Each one is flagged for review if that person is
            no longer a manager when it syncs.
          </span>
        </span>
      </label>
      {canEdit ? (
        <Button onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save offline unlock policy"}
        </Button>
      ) : null}
      {canEdit ? (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 p-4">
          <p className="text-sm font-semibold text-[var(--admin-danger)]">Reset offline PINs on every iPad</p>
          <p className="mt-1 text-xs text-[var(--admin-text-faint)]">
            Use if an iPad is lost or stolen, or you suspect a PIN was shared. Every iPad erases its offline copies at its next
            check-in, and every employee must unlock each iPad online once again. Firing an employee or changing a PIN does NOT
            need this: the iPad drops that person automatically at its next check-in.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input aria-label="Type RESET to confirm" placeholder="Type RESET" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-32 rounded-md border border-[var(--admin-border)] bg-transparent px-3 py-1.5 text-sm text-[var(--admin-text)]" />
            <Button onClick={reset} disabled={pending || confirm.trim().toUpperCase() !== "RESET"} variant="danger">
              Reset offline PINs
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
