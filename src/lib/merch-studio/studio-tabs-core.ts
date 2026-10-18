/**
 * Merch Studio tab ids, in a PLAIN module (no "use client").
 *
 * The server page (src/app/admin/merch-studio/page.tsx) checks ?tab= against
 * this list. It used to import the list from MerchStudio.tsx, a "use client"
 * file; on the server every export of a client file is a stand-in reference,
 * so STUDIO_TAB_IDS.find(...) threw "Cannot access ... on the server" and the
 * whole page failed with "This page hit a snag" on every device.
 */
export type StudioTab = "garments" | "design" | "proof" | "check" | "fulfillment" | "publish";

export const STUDIO_TABS: readonly { id: StudioTab; label: string }[] = [
  { id: "garments", label: "\ud83d\udc55 Garments" },
  { id: "design", label: "\ud83c\udfa8 Design" },
  { id: "proof", label: "\ud83d\udda8\ufe0f Proof & Export" },
  { id: "check", label: "\ud83d\udd0e Artwork Check" },
  { id: "fulfillment", label: "\ud83d\udce6 Fulfillment & Pricing" },
  { id: "publish", label: "\ud83d\ude80 Publish & Ads" },
];

/** Tabs a ?tab= link may open directly (R71 S4: the Website-hub edit link opens Publish & Ads). */
export const STUDIO_TAB_IDS: readonly StudioTab[] = STUDIO_TABS.map((t) => t.id);

/** The tab named by ?tab=, or undefined when it isn't one of ours. */
export function studioTabFrom(raw: unknown): StudioTab | undefined {
  return STUDIO_TAB_IDS.find((t) => t === raw);
}
