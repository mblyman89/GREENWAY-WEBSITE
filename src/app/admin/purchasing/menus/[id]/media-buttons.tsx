"use client";

/**
 * CV-5 client islands for the snapshot browser: per-item "Save image"/"Save
 * COA" buttons. Each calls a typed server action, shows the returned message
 * inline, and refreshes the server page so the "in library" badges update. The
 * snapshot-wide "Save all" button now lives in ../auto-save-all-button.tsx
 * (MB-1: background auto-loop until every asset is saved).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/admin/ui";
import { saveItemMediaAction } from "../actions";

export function SaveItemMediaButton({
  snapshotId,
  itemId,
  kind,
  label,
}: {
  snapshotId: string;
  itemId: string;
  kind: "image" | "coa";
  label: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function run() {
    setMessage(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("snapshot_id", snapshotId);
      fd.set("item_id", itemId);
      fd.set("kind", kind);
      const res = await saveItemMediaAction(fd);
      setFailed(!res.ok);
      setMessage(res.message);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant="neutral" size="sm" disabled={pending} onClick={run}>
        {pending ? "Saving…" : label}
      </Button>
      {message && (
        <span className={`text-[0.65rem] leading-snug ${failed ? "text-[var(--admin-danger)]" : "text-[var(--admin-text-faint)]"}`}>
          {message}
        </span>
      )}
    </div>
  );
}


