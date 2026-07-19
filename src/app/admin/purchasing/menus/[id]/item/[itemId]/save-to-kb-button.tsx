"use client";

/**
 * CV-7 client island: "Save image to KB" on the menu-item detail page.
 * Saves the product-card image into the media library AND binds it to the
 * durable KB product backbone (one image per strain — every size variant
 * inherits it). Shows the result inline and refreshes the page.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/admin/ui";
import { saveCultiveraItemToKbAction } from "../../../actions";

export function SaveImageToKbButton({
  snapshotId,
  itemId,
  disabled,
}: {
  snapshotId: string;
  itemId: string;
  disabled?: boolean;
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
      const res = await saveCultiveraItemToKbAction(fd);
      setFailed(!res.ok);
      setMessage(res.message);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="neutral" size="sm" disabled={pending || disabled} onClick={run}>
        {pending ? "Saving…" : "Save image to KB"}
      </Button>
      {message && (
        <span
          className={`max-w-[16rem] text-right text-[0.65rem] leading-snug ${
            failed ? "text-[var(--admin-danger)]" : "text-[var(--admin-text-faint)]"
          }`}
        >
          {message}
        </span>
      )}
    </div>
  );
}
