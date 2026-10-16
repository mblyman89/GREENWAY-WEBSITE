import { greenwayBusiness } from "@/content/business";
import { selectClassName } from "@/lib/cms/content-select-core";

/**
 * R64 — the phone label with an optional desktop "real number" reveal.
 *
 * Both the overlay text (e.g. 360-BUY-WEED) and the real number are stacked in
 * one grid cell, so the button keeps the width of the longer one and never
 * jumps on hover. Which one shows is pure CSS (.gw-ph-* in globals.css) and
 * only on mouse devices — phones always see the overlay, and the parent
 * <a href="tel:…"> still dials the real number everywhere.
 */
export function PhoneText({ text, mode, modeKey }: { text: string; mode?: string | null; modeKey: "header.phone.mode" | "locations.phone.mode" }) {
  const real = greenwayBusiness.phone.numeric;
  const cls = selectClassName(modeKey, mode);
  if (!text || text === real || cls === "gw-ph-overlay") return <>{text || real}</>;
  return (
    <span className={`gw-ph ${cls}`}>
      <span className="gw-ph-o">{text}</span>
      <span className="gw-ph-r" aria-hidden="true">
        {real}
      </span>
    </span>
  );
}
