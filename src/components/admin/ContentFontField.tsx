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
import { fontStack, resolveFont } from "@/lib/cms/fonts";
import { isCustomFontId } from "@/lib/cms/custom-font-core";
import { printFontInfo } from "@/lib/printing/print-type-core";
import { useCustomFonts } from "@/components/admin/fonts/custom-fonts-client";
import { CustomFontFaces, CustomFontUpload } from "@/components/admin/fonts/CustomFontUpload";
import { AllFontOptions } from "@/components/admin/fonts/AllFontOptions";
import { WebFonts } from "@/components/fonts/WebFonts";

// D272: every font the system has — your uploads, the site library and the 120+ Google library.
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
  const mine = useCustomFonts();
  const g = printFontInfo(value);
  const customPick = isCustomFontId(value) ? (mine.find((f) => f.id === value) ?? { id: value, label: "Uploaded font" }) : null;
  const curated = resolveFont(value || fallbackId, fallbackId);
  const selected = customPick
    ? { id: customPick.id, label: customPick.label, note: "Your uploaded font (you confirmed you have the right to use it).", stack: fontStack(customPick.id, fallbackId) }
    : g
      ? { id: value, label: g.family, note: "Google Fonts library — free for commercial use, loads on every page.", stack: fontStack(value, fallbackId) }
      : curated;

  const preview =
    sampleText || "Greenway Marijuana — Premium Cannabis, Everyday Deals";

  return (
    <div className="space-y-3">
      <CustomFontFaces />
      <WebFonts ids={[selected.id]} />
      <select
        value={selected.id}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
      >
        <AllFontOptions value={selected.id} />
      </select>

      <p className="text-[0.72rem] text-white/50">{selected.note}</p>
      <CustomFontUpload onUploaded={onChange} />

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
