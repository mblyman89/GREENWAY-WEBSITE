"use client";

/**
 * ContentFontField — the editor control for a "font" content block.
 *
 * Stores a single string: the font id from the curated library (e.g. "poppins"
 * or "system"). The editor sees a friendly dropdown grouped by category, plus a
 * LIVE preview line rendered in the selected font so they know exactly what
 * they're choosing before publishing.
 *
 * The live preview only works if the font's CSS variable is loaded on the page.
 * The admin layout spreads the same font variables as the public site, so the
 * preview matches what visitors will see.
 */
import { useMemo } from "react";
import { FONT_OPTIONS, resolveFont, type FontCategory } from "@/lib/cms/fonts";

const CATEGORY_LABEL: Record<FontCategory, string> = {
  sans: "Sans-serif (clean & modern)",
  serif: "Serif (classic & elegant)",
  display: "Display (bold headlines)",
  mono: "Monospaced",
};

const CATEGORY_ORDER: FontCategory[] = ["sans", "serif", "display", "mono"];

export function ContentFontField({
  value,
  onChange,
  fallbackId = "system",
  sampleText,
}: {
  value: string;
  onChange: (next: string) => void;
  fallbackId?: string;
  sampleText?: string;
}) {
  const selected = resolveFont(value || fallbackId, fallbackId);

  const grouped = useMemo(() => {
    const map = new Map<FontCategory, typeof FONT_OPTIONS>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const f of FONT_OPTIONS) map.get(f.category)!.push(f);
    return map;
  }, []);

  const preview =
    sampleText || "Greenway Marijuana — Premium Cannabis, Everyday Deals";

  return (
    <div className="space-y-3">
      <select
        value={selected.id}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
      >
        {CATEGORY_ORDER.map((cat) => {
          const opts = grouped.get(cat) ?? [];
          if (opts.length === 0) return null;
          return (
            <optgroup key={cat} label={CATEGORY_LABEL[cat]}>
              {opts.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>

      <p className="text-[0.72rem] text-white/50">{selected.note}</p>

      {/* Live preview rendered in the chosen font. */}
      <div className="rounded-lg border border-white/10 bg-[#0a0a0a] p-4">
        <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wide text-white/40">
          Live preview
        </p>
        <p
          className="text-2xl font-black leading-tight text-white"
          style={{ fontFamily: selected.stack }}
        >
          {preview}
        </p>
        <p
          className="mt-2 text-sm text-white/70"
          style={{ fontFamily: selected.stack }}
        >
          The quick brown fox jumps over the lazy dog · 0123456789
        </p>
      </div>
    </div>
  );
}
