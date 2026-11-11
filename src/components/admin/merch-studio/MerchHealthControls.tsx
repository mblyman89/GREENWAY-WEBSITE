"use client";

/**
 * D232 slice M-2: the two controls on /admin/merch-studio/health.
 *   - RunMerchHealthButton: runs H-1..H-19 now (records a run, no email).
 *   - TokenExpiryForm: saves the Printful token's expiry date for H-3.
 *   - WebhookPanel (M-6, G-89): Check (reads Printful's webhook, changes
 *     nothing) then Register / repair (all 5 events, after the shop
 *     confirms Token C). Token C is never shown.
 *   - AutoConfirmSwitch (M-7, Q-11-7): on (owner, reason, 20+ clean
 *     orders) / off (owner or admin). Built and left off.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import { previewPrintfulWebhookAction, registerPrintfulWebhookAction, runMerchHealthNowAction, saveTokenExpiryAction, setAutoConfirmAction } from "@/app/admin/merch-studio/health/actions";
import type { WebhookPreview } from "@/lib/merch/merch-webhook-server";

export function RunMerchHealthButton() {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="special"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await runMerchHealthNowAction();
          toast(res.ok ? { tone: res.status === "ok" ? "success" : "error", message: res.summary } : { tone: "error", message: res.error });
          router.refresh();
        })
      }
    >
      {pending ? "Checking..." : "Run check now"}
    </Button>
  );
}

export function TokenExpiryForm({ current }: { current: string }) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      action={(fd) =>
        startTransition(async () => {
          const res = await saveTokenExpiryAction(fd);
          toast(res.ok ? { tone: "success", message: "Saved. Run the check to update H-3." } : { tone: "error", message: res.error });
          router.refresh();
        })
      }
    >
      <label className="text-sm">
        <span className="mb-1 block text-[var(--admin-text-muted)]">Printful token expires on</span>
        <input type="date" name="printfulTokenExpires" defaultValue={current} className="rounded-[var(--admin-radius-sm)] border border-white/15 bg-[var(--admin-surface-2)] px-2 py-1 text-sm" />
      </label>
      <Button type="submit" variant="save" disabled={pending}>
        {pending ? "Saving..." : "Save date"}
      </Button>
    </form>
  );
}

function HookLine({ label, v }: { label: string; v: WebhookPreview["current"] }) {
  if (!v) return null;
  return (
    <div className="text-xs">
      <p className="font-semibold">{label}</p>
      <p>Address: {v.url || "(none)"}</p>
      <p>Events: {v.types.length ? v.types.join(", ") : "(none)"}</p>
      <p>Stock watch: {v.productIds.length ? v.productIds.map((n) => `#${n}`).join(", ") : "(no garments)"}</p>
    </div>
  );
}

export function WebhookPanel() {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<WebhookPreview | null>(null);
  const check = () => startTransition(async () => { setPreview(await previewPrintfulWebhookAction()); });
  const register = () => {
    if (!window.confirm("Printful keeps only ONE webhook per store, so this replaces what is registered now (any other event type is kept). Continue?")) return;
    startTransition(async () => {
      const res = await registerPrintfulWebhookAction();
      toast(res.ok ? { tone: "success", message: res.message } : { tone: "error", message: res.error });
      setPreview(await previewPrintfulWebhookAction());
      router.refresh();
    });
  };
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button variant="neutral" size="sm" disabled={pending} onClick={check}>{pending && !preview ? "Checking..." : "Check what is registered"}</Button>
        {preview?.ok ? <Button variant="confirm" size="sm" disabled={pending} onClick={register}>{pending ? "Working..." : preview.noChange ? "Register again" : "Register / repair the Printful webhook"}</Button> : null}
      </div>
      {preview ? (
        <div className="space-y-2 rounded-[var(--admin-radius-sm)] border border-white/10 p-2">
          {preview.error ? <p className="text-sm text-[var(--admin-danger)]">{preview.error}</p> : null}
          <HookLine label="Registered now" v={preview.current} />
          {preview.ok ? <HookLine label="After pressing Register" v={preview.next} /> : null}
          {preview.ok ? <p className="text-xs">{preview.noChange ? "Already right; nothing would change." : `Changes: ${preview.changes.join(" ")}`}{preview.urlSource === "env" ? " Token C comes from PRINTFUL_WEBHOOK_TOKEN in this project." : " Token C is the one already registered."}</p> : null}
          <p className="text-xs text-[var(--admin-text-muted)]">Before registering, the shop is asked to accept a harmless test notice on that address; if it does not (wrong Token C, shop not deployed), nothing is changed at Printful. Token C is never shown here.</p>
        </div>
      ) : null}
    </div>
  );
}

export function AutoConfirmSwitch({ on, isOwner, cleanOrders, minClean, since }: { on: boolean; isOwner: boolean; cleanOrders: number | null; minClean: number; since: string }) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const send = (turn: "on" | "off") => {
    if (turn === "on" && !window.confirm("Turn auto-confirm ON? Each paid order will go straight to Printful production with no review.")) return;
    const fd = new FormData();
    fd.set("turn", turn);
    fd.set("reason", reason);
    startTransition(async () => {
      const res = await setAutoConfirmAction(fd);
      toast(res.ok ? { tone: "success", message: res.message } : { tone: "error", message: res.error });
      router.refresh();
    });
  };
  const unlocked = cleanOrders !== null && cleanOrders >= minClean;
  return (
    <div className="mt-2 space-y-2 rounded-[var(--admin-radius-sm)] border border-white/10 p-3 text-sm">
      <p>
        Back-office switch: <strong>{on ? "ON" : "OFF"}</strong>
        {since ? <span className="text-[var(--admin-text-muted)]"> (since {since})</span> : null}. Clean orders so far (fulfilled by Printful):{" "}
        <strong>{cleanOrders === null ? "?" : cleanOrders}</strong> of {minClean} needed.
      </p>
      {on ? (
        <Button variant="neutral" size="sm" disabled={pending} onClick={() => send("off")}>
          {pending ? "Saving..." : "Turn auto-confirm off"}
        </Button>
      ) : isOwner ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">
            <span className="mb-1 block text-[var(--admin-text-muted)]">Reason (owner only)</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="w-72 rounded-[var(--admin-radius-sm)] border border-white/15 bg-[var(--admin-surface-2)] px-2 py-1 text-sm" />
          </label>
          <Button variant="confirm" size="sm" disabled={pending || !unlocked || reason.trim().length < 5} onClick={() => send("on")}>
            {pending ? "Saving..." : "Turn auto-confirm on"}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-[var(--admin-text-muted)]">Only the owner can turn it on.</p>
      )}
      <p className="text-xs text-[var(--admin-text-muted)]">
        Recommended off until {minClean}+ clean orders (SOP-11 Q-11-7). The shop reads this switch on each order, no redeploy. If the shop cannot reach the back office, orders stay drafts.
      </p>
    </div>
  );
}
