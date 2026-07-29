"use client";

/**
 * CV-7b client island: "Save all assets to KB" on the menu-item detail page.
 * A single Cultivera product LINE (e.g. SUBX "Flower") holds MANY strains as
 * size variants. This ONE button saves one image per DISTINCT strain into the
 * media library AND binds each — image + description — to the durable KB
 * product backbone (every size variant of that strain inherits it). SLICE 90:
 * the label + summary now say the descriptions are saved too (it used to be
 * silent). Shows the result inline and refreshes the page. Idempotent —
 * re-running only fills gaps.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/admin/ui";
import { saveAllAssetsLabel } from "@/lib/purchasing/save-assets-core";
import { saveCultiveraDetailStrainsToKbAction } from "../../../actions";

export function SaveImageToKbButton({
  snapshotId,
  itemId,
  strainCount,
  disabled,
}: {
  snapshotId: string;
  itemId: string;
  /** Distinct strains on this detail page — shown on the button for clarity. */
  strainCount?: number;
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
      const res = await saveCultiveraDetailStrainsToKbAction(fd);
      setFailed(!res.ok);
      setMessage(res.message);
      if (res.ok) router.refresh();
    });
  }

  // SLICE 90 — "Save all assets": images AND descriptions land in the KB, so
  // the label says so (the old "strain images" label undersold what happens).
  const label = saveAllAssetsLabel(strainCount);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="neutral" size="sm" disabled={pending || disabled} onClick={run}>
        {pending ? "Saving…" : label}
      </Button>
      {message && (
        <span
          className={`max-w-[18rem] text-right text-[0.65rem] leading-snug ${
            failed ? "text-[var(--admin-danger)]" : "text-[var(--admin-text-faint)]"
          }`}
        >
          {message}
        </span>
      )}
    </div>
  );
}
