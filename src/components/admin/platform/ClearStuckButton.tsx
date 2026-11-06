"use client";

/**
 * ClearStuckButton (D193, DB health B): clears stuck APP database connections
 * from /admin/settings/platform-health. Changes no saved data; an unfinished
 * step is rolled back. The 10-minute check does the same by itself when
 * Greenway Partner is on Level 2.
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import { clearStuckConnectionsAction } from "@/app/admin/settings/platform-health/actions";

export function ClearStuckButton({ count }: { count: number }) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const res = await clearStuckConnectionsAction();
      toast({ tone: res.ok ? "success" : "error", message: res.ok ? res.message : res.error });
      router.refresh();
    });
  }

  return (
    <Button variant="special" onClick={run} disabled={pending}>
      {pending ? "Clearing..." : `Clear ${count} stuck connection${count === 1 ? "" : "s"}`}
    </Button>
  );
}
