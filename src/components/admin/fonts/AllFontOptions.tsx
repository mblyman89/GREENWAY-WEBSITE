"use client";
/**
 * D272 — the <option>s for EVERY font the system can draw, for any font
 * <select>: the owner's uploaded fonts first (Branding → Fonts), then the site
 * library (next/font), then the 120+ Google library. `skip` hides ids the
 * picker already lists (e.g. its curated headline picks). A picked font that
 * isn't in a list (uploaded elsewhere, still loading) still shows.
 */
import { FONT_OPTIONS, type FontCategory } from "@/lib/cms/fonts";
import { isCustomFontId } from "@/lib/cms/custom-font-core";
import { PRINT_FONTS, PRINT_FONT_CATS, printFontId } from "@/lib/printing/print-type-core";
import { useCustomFonts } from "./custom-fonts-client";

const CATS: { cat: FontCategory; label: string }[] = [
  { cat: "sans", label: "Sans-serif (clean & modern)" },
  { cat: "serif", label: "Serif (classic)" },
  { cat: "display", label: "Display (bold headlines)" },
  { cat: "script", label: "Script & handwritten" },
  { cat: "mono", label: "Monospaced" },
];

export function AllFontOptions({ value, skip, noSystem = false }: { value?: string | null; skip?: readonly string[]; noSystem?: boolean }) {
  const mine = useCustomFonts();
  const hide = new Set(skip ?? []);
  if (noSystem) hide.add("system");
  const lostCustom = isCustomFontId(value) && !mine.some((f) => f.id === value) ? value : null;
  return (
    <>
      {mine.length || lostCustom ? (
        <optgroup label="Your fonts (uploaded in Branding)">
          {mine.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
          {lostCustom ? <option value={lostCustom}>Uploaded font</option> : null}
        </optgroup>
      ) : null}
      {CATS.map((c) => {
        const list = FONT_OPTIONS.filter((f) => f.category === c.cat && !hide.has(f.id));
        return list.length ? (
          <optgroup key={c.cat} label={c.label}>
            {list.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </optgroup>
        ) : null;
      })}
      {PRINT_FONT_CATS.map((c) => (
        <optgroup key={c.cat} label={c.label.replace("Print: ", "Google library: ")}>
          {PRINT_FONTS.filter((f) => f.cat === c.cat).map((f) => {
            const id = printFontId(f.family);
            return hide.has(id) ? null : (
              <option key={id} value={id}>
                {f.family}
              </option>
            );
          })}
        </optgroup>
      ))}
    </>
  );
}
