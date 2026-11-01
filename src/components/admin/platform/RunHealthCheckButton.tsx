"use client";

/**
 * RunHealthCheckButton (slice G-71a, owner message 12): runs the database
 * health check now from /admin/settings/platform-health. Records a run; the
 * daily email still comes only from the morning cron.
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import { runHealthCheckNowAction } from "@/app/admin/settings/platform-health/actions";

export function RunHealthCheckButton() {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const res = await runHealthCheckNowAction();
      if (res.ok) {
        toast({ tone: res.status === "ok" ? "success" : "error", message: res.summary });
      } else {
        toast({ tone: "error", message: res.error });
      }
      router.refresh();
    });
  }

  return (
    <Button variant="special" onClick={run} disabled={pending}>
      {pending ? "Checking..." : "Run check now"}
    </Button>
  );
}
