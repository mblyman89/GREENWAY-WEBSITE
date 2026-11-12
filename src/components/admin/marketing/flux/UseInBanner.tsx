"use client";

/**
 * D234 slice C-8 (SOP-11b G-104, F-11-28): Creative Studio → "Use in a banner".
 * Pick the banner editor; the link opens it with the picture waiting
 * (?useImage=…). There the owner presses "Use the Creative Studio picture
 * here" on the slide or banner he wants, then Save draft and Publish as usual.
 * When the studio was opened from a banner ("Make a picture for this banner"),
 * that banner and its slide are picked already.
 */
import { useState } from "react";
import { BANNER_TARGETS, bannerTargetById, bannerLinkFor } from "@/lib/marketing/ad-check-core";

export function UseInBanner({
  imageUrl,
  initialTarget,
  slot,
}: {
  imageUrl: string;
  /** BANNER_TARGETS id from ?for= (the banner that asked for this picture). */
  initialTarget?: string | null;
  /** The card anchor from ?slot= ("slide-<id>"); only used for that same banner. */
  slot?: string | null;
}) {
  const start = bannerTargetById(initialTarget)?.id ?? "";
  const [targetId, setTargetId] = useState(start);
  const target = bannerTargetById(targetId);
  const href = target ? bannerLinkFor(target, imageUrl, targetId === start ? slot : null) : null;
  return (
    <span data-use-in-banner className="flex basis-full flex-wrap items-center gap-1.5">
      <select
        value={targetId}
        onChange={(e) => setTargetId(e.target.value)}
        aria-label="Which banner"
        className="rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-1.5 py-1 text-[0.68rem] text-[var(--admin-text)]"
      >
        <option value="">Use in a banner…</option>
        {BANNER_TARGETS.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
      {href ? (
        <a href={href} className="rounded-md bg-[var(--admin-accent)] px-2 py-1 text-[0.68rem] font-bold text-black">
          Open the banner editor →
        </a>
      ) : null}
    </span>
  );
}
