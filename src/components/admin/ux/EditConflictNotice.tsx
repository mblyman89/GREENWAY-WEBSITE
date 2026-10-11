"use client";

/**
 * R45-S2: admin-wide notice for an edit conflict. When a save is refused
 * because someone else saved first, the server redirects with
 * `?conflict=<block_key>`. This banner (mounted once in the admin layout, so no
 * per-page wiring) explains what happened in plain English and offers a
 * one-click "Reload latest". role="alert" so screen readers announce it.
 */
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CONFLICT_PARAM, conflictMessage, parseConflictParam } from "@/lib/cms/edit-conflict-core";

export function EditConflictNotice() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const key = parseConflictParam(params.get(CONFLICT_PARAM));
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  if (!key || dismissedKey === key) return null;

  const cleanUrl = () => {
    const next = new URLSearchParams(params.toString());
    next.delete(CONFLICT_PARAM);
    const q = next.toString();
    return `${pathname}${q ? `?${q}` : ""}#block-${key}`;
  };

  return (
    <div
      role="alert"
      className="fixed inset-x-3 top-3 z-[60] mx-auto max-w-2xl rounded-[var(--admin-radius,12px)] border border-amber-400/60 bg-amber-50 p-4 text-sm text-amber-950 shadow-xl"
    >
      <p className="font-bold">Your change wasn&rsquo;t saved, because someone else saved first</p>
      <p className="mt-1">{conflictMessage(key)}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            router.replace(cleanUrl());
            router.refresh();
          }}
          className="rounded-full bg-amber-900 px-4 py-1.5 text-xs font-bold text-white hover:bg-amber-800"
        >
          Reload latest version
        </button>
        <button
          type="button"
          onClick={() => setDismissedKey(key)}
          className="rounded-full border border-amber-900/40 px-4 py-1.5 text-xs font-bold text-amber-950 hover:bg-amber-100"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
