"use client";

/**
 * CH-3 client island: "Fetch sizes & pricing" on the menu-item detail page.
 * Calls fetchCultiveraProductDetailAction (worker → pinned Cultivera detail
 * endpoint → payload stored on OUR item row), shows the result inline, and
 * refreshes the server page so the variants table appears.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/admin/ui";
import { fetchCultiveraProductDetailAction } from "../../../actions";

export function FetchSizesButton({
  snapshotId,
  itemId,
  label,
}: {
  snapshotId: string;
  itemId: string;
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
      const res = await fetchCultiveraProductDetailAction(fd);
      setFailed(!res.ok);
      setMessage(
        res.ok
          ? `Fetched ${res.variantCount} size${res.variantCount === 1 ? "" : "s"} from Cultivera.`
          : res.error || "Fetch failed.",
      );
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="save" size="sm" disabled={pending} onClick={run}>
        {pending ? "Fetching…" : label}
      </Button>
      {message && (
        <span
          className={`text-[0.65rem] leading-snug ${failed ? "text-[var(--admin-danger)]" : "text-[var(--admin-text-faint)]"}`}
        >
          {message}
        </span>
      )}
    </div>
  );
}
