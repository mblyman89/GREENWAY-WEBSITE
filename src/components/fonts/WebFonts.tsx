/**
 * D272 — loads any font the system knows (owner uploads + the Google library)
 * on ANY page, server or client. React 19 hoists `<link precedence>` /
 * `<style href precedence>` into <head> and de-dupes by href, so ten banners
 * using one font load it once. Site-library fonts (next/font) need nothing.
 */
import { customFontFaceCss, isCustomFontId } from "@/lib/cms/custom-font-core";
import { loadableFontIds } from "@/lib/cms/fonts";
import { printFontHref } from "@/lib/printing/print-type-core";

export function WebFonts({ ids }: { ids: Iterable<string | null | undefined> }) {
  const list = loadableFontIds(ids);
  if (!list.length) return null;
  return (
    <>
      {list.map((id) => {
        if (isCustomFontId(id))
          return (
            <style key={id} href={`gw-font-${id}`} precedence="default">
              {customFontFaceCss([id])}
            </style>
          );
        const href = printFontHref(id)?.replace("display=block", "display=swap");
        return href ? <link key={id} rel="stylesheet" href={href} precedence="default" /> : null;
      })}
    </>
  );
}
