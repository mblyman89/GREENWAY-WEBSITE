import { greenwayBusiness } from "@/content/business";
import { getContentValues } from "@/lib/cms/render-content";
import { selectClassName } from "@/lib/cms/content-select-core";
import { SecondaryBarView } from "./SecondaryBarView";

// Editable top-bar blocks (Admin -> Website -> Header & Footer):
//   header.hours.size    — a "select" size (normal/large/xl/xxl) for the hours
//   header.phone.display  — the phone BUTTON text overlay (the dialed number
//                           never changes; only what the customer sees).
//   header.phone.mode     — R64 desktop overlay / hover-reveal / real number.
const TOPBAR_BLOCKS = ["header.hours.size", "header.phone.display", "header.phone.mode"] as const;

export async function SecondaryBar() {
  // Resolve once (draft-aware). Seed defaults mirror the live values, so this
  // changes nothing until a staff member edits a block.
  const values = await getContentValues([...TOPBAR_BLOCKS]);

  // Hours text size -> safe CSS classes (blank/unknown -> "normal" default).
  const hoursSizeClass = selectClassName("header.hours.size", values["header.hours.size"]);

  // Phone button overlay text -> saved value else the live business.ts display.
  const phoneText =
    (values["header.phone.display"] ?? "").trim() || greenwayBusiness.phone.display;

  return <SecondaryBarView hoursSizeClass={hoursSizeClass} phoneText={phoneText} phoneMode={values["header.phone.mode"]} />;
}
