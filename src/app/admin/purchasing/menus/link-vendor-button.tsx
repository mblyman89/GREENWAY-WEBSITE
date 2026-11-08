"use client";

/**
 * D213 — "Link to vendor" on a "Menus on file" row. Opens a type-to-search
 * picker over every live vendor card (the page passes the list once, via a
 * shared <datalist>), then saves the choice as a 'menu' alias plus vendor_id
 * on the saved menus, so this and every future pull with the same seller name
 * lands on the right vendor. Re-linking a wrongly matched row works the same
 * way. The owner chooses; nothing is guessed.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/admin/ui";
import type { MenuLinkTarget, VendorPickOption } from "@/lib/purchasing/vendor-menu-coverage-core";
import { linkMenuToVendorAction } from "./actions";

export const VENDOR_PICK_LIST_ID = "menu-link-vendor-options";

/** Renders the shared datalist ONCE per page. */
export function VendorPickList({ options }: { options: VendorPickOption[] }) {
  return (
    <datalist id={VENDOR_PICK_LIST_ID}>
      {options.map((o) => (
        <option key={o.id} value={o.label} />
      ))}
    </datalist>
  );
}

export function LinkVendorButton({
  targets,
  options,
  relink = false,
}: {
  targets: MenuLinkTarget[];
  options: VendorPickOption[];
  relink?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const byLabel = useMemo(() => new Map(options.map((o) => [o.label, o.id])), [options]);
  const chosenId = byLabel.get(text.trim()) ?? null;

  if (targets.length === 0) return null;

  if (!open) {
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-left text-xs font-medium text-[var(--admin-accent)] hover:underline"
          title={`Remember which vendor "${targets.map((t) => t.label).join('", "')}" is`}
        >
          {relink ? "Wrong vendor? Re-link" : "Link to vendor →"}
        </button>
        {msg && <span className={`text-xs ${msg.ok ? "text-[var(--admin-accent)]" : "text-[var(--admin-gold)]"}`}>{msg.text}</span>}
      </div>
    );
  }

  async function save() {
    if (!chosenId) {
      setMsg({ ok: false, text: "Pick a vendor from the list (start typing its name or license #)." });
      return;
    }
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    fd.set("vendor_id", chosenId);
    fd.set("targets", JSON.stringify(targets));
    try {
      const res = await linkMenuToVendorAction(fd);
      setMsg({ ok: res.ok, text: res.message });
      if (res.ok) {
        setOpen(false);
        router.refresh();
      }
    } catch {
      setMsg({ ok: false, text: "The request failed (network or time limit). Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-w-[14rem] flex-col gap-1">
      <input
        list={VENDOR_PICK_LIST_ID}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type a vendor name or license #"
        className="w-full rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1 text-xs text-[var(--admin-text)]"
        aria-label="Vendor to link this menu to"
        autoFocus
      />
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={save} disabled={busy || !chosenId}>
          {busy ? "Linking…" : "Link"}
        </Button>
        <button type="button" className="text-xs text-[var(--admin-text-muted)] hover:underline" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
      {msg && <span className={`text-xs ${msg.ok ? "text-[var(--admin-accent)]" : "text-[var(--admin-gold)]"}`}>{msg.text}</span>}
    </div>
  );
}
