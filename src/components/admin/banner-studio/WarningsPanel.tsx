"use client";

/**
 * R41 S2 — live design checks (bible PART 3.2 / 3.5 / 5.4).
 * Advice only — nothing here blocks saving. Contrast numbers are a worst-case
 * ESTIMATE (the photo is unknown), per WCAG 2.2 SC 1.4.3 (4.5:1 normal text,
 * 3:1 large text: 24px+, or 18.67px+ bold).
 */
import { checkDesign, type BannerDesign } from "@/lib/cms/banner-design-core";
import type { StudioSelection } from "./StudioCanvas";

export function WarningsPanel({
  design,
  legacy,
  onSelect,
}: {
  design: BannerDesign;
  legacy: { eyebrow?: string; title?: string; subtitle?: string };
  onSelect: (s: StudioSelection) => void;
}) {
  const warnings = checkDesign(design, legacy);
  return (
    <div className="space-y-2">
      {warnings.length === 0 ? (
        <p className="rounded-md bg-[var(--admin-accent-soft)] px-3 py-2 text-xs text-[var(--admin-accent)]">✓ Looks good — no readability or layout problems found.</p>
      ) : (
        <ul className="space-y-1.5">
          {warnings.map((w, i) => (
            <li key={`${w.code}-${i}`} className="rounded-md bg-[var(--admin-gold)]/10 px-3 py-2 text-xs text-white/85">
              ⚠️ {w.message}
              {w.boxId || w.buttonId ? (
                <button
                  type="button"
                  className="ml-2 text-[var(--admin-accent)] underline"
                  onClick={() => onSelect(w.boxId ? { target: "box", id: w.boxId } : { target: "button", id: w.buttonId! })}
                >
                  Show me
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <details className="text-[0.7rem] text-white/55">
        <summary className="cursor-pointer text-white/70">Tips for text on pictures</summary>
        <ul className="mt-1 list-disc space-y-1 pl-4">
          <li>Keep one clear headline of about 8 words or fewer, with one or two buttons.</li>
          <li>Put text over a calm part of the picture, or add a shade / box behind it.</li>
          <li>Check the Phone view — text that fits on a computer can cover faces on a phone.</li>
          <li>Never put important words only inside the picture file; screen readers and Google can&apos;t read them.</li>
          <li>The required Washington warnings already show in your site footer on every page, so a banner doesn&apos;t need them. This follows your LCB enforcement officer&apos;s guidance for age-gated sites. If you ever add a small-print box anyway, keep it at least 10% of the largest text (WAC 314-55-155(7)).</li>
        </ul>
      </details>
    </div>
  );
}
