"use client";

/**
 * D232 slice M-2: the two controls on /admin/merch-studio/health.
 *   - RunMerchHealthButton: runs H-1..H-19 now (records a run, no email).
 *   - TokenExpiryForm: saves the Printful token's expiry date for H-3.
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import { runMerchHealthNowAction, saveTokenExpiryAction } from "@/app/admin/merch-studio/health/actions";

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
