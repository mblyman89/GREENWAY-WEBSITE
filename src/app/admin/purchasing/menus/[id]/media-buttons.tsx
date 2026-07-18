"use client";

/**
 * CV-5 client islands for the snapshot browser: per-item "Save image"/"Save
 * COA" buttons and the snapshot-wide "Save all to library" button. Each calls
 * a typed server action, shows the returned message inline, and refreshes the
 * server page so the "in library" badges update.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/admin/ui";
import { saveItemMediaAction, saveAllSnapshotMediaAction } from "../actions";

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

export function SaveAllMediaButton({
  snapshotId,
  remaining,
}: {
  snapshotId: string;
  /** How many unsaved images/COAs the server counted at render time. */
  remaining: number;
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
      const res = await saveAllSnapshotMediaAction(fd);
      setFailed(!res.ok);
      setMessage(res.message);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="save" size="sm" disabled={pending || remaining === 0} onClick={run}>
        {pending
          ? "Saving to library…"
          : remaining === 0
            ? "All media saved"
            : `Save all to library (${remaining})`}
      </Button>
      {message && (
        <span className={`max-w-xs text-right text-[0.65rem] leading-snug ${failed ? "text-[var(--admin-danger)]" : "text-[var(--admin-text-muted)]"}`}>
          {message}
        </span>
      )}
    </div>
  );
}
