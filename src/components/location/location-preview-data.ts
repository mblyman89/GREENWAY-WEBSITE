import { greenwayBusiness } from "@/content/business";

export type StoreHourRow = {
  day: string;
  value: string;
  isVerified: boolean;
};

export type StoreStatus = "open" | "closed" | "delayed";

export type LocationPreviewRecord = {
  name: string;
  market: string;
  status: string;
  addressLine: string;
  phoneLine: string;
  mapLine: string;
  pickupLine: string;
  hours: StoreHourRow[];
  /** Computed or declared store status for the open/closed badge. */
  storeStatus: StoreStatus;
  /** Short human-readable label next to the status badge, e.g. "Open now" or "Closed — confirm hours". */
  statusLabel: string;
  /** Today's hours summary, e.g. "9 AM – 9 PM" or "Confirm before visiting". */
  todayHoursSummary: string;
  /** Formatted phone number for the store card. */
  phoneNumber: string;
  /** Machine-readable click-to-call value for tel links. */
  phoneTel: string;
  /** Formatted street address for the store card. */
  streetAddress: string;
  /** Public contact email for the store card. */
  email: string;
  /** Mail app link for the public contact email. */
  emailHref: string;
  /** External map/directions URL for the store. */
  directionsUrl: string;
};

export const greenwayLocationPreview: LocationPreviewRecord = {
  name: greenwayBusiness.name,
  market: `${greenwayBusiness.address.city}, ${greenwayBusiness.address.state}`,
  status: "Single-store Port Orchard profile",
  addressLine: greenwayBusiness.address.full,
  phoneLine: greenwayBusiness.phone.formatted,
  mapLine: "Directions open in Google Maps using Greenway's verified Port Orchard address.",
  pickupLine: "Pickup instructions are preview-only until approved store procedures and live ordering workflows are ready.",
  hours: greenwayBusiness.hours.weekly.map((row) => ({ ...row, isVerified: true })),
  storeStatus: "open",
  statusLabel: "Open daily",
  todayHoursSummary: greenwayBusiness.hours.display,
  phoneNumber: greenwayBusiness.phone.formatted,
  phoneTel: greenwayBusiness.phone.tel,
  streetAddress: greenwayBusiness.address.full,
  email: greenwayBusiness.email,
  emailHref: greenwayBusiness.emailHref,
  directionsUrl: greenwayBusiness.address.directionsUrl,
};

export const locationReadinessItems = [
  "Greenway's public address, phone number, email, and daily store hours now come from the centralized business settings file.",
  "Map and directions links should continue to use the canonical Port Orchard address from the global business profile.",
  "Confirm pickup rules, accepted payment guidance, purchase-limit messaging, and ID-check language before launch.",
  "Keep inventory and order-status expectations clear until Leafly/POS workflows are certified and production ready.",
];

export const locationSafetyNotes = [
  "Adults 21+ only with valid government-issued photo ID.",
  "Website menu and cart are preview-only and do not reserve products.",
  "Final prices, discounts, taxes, limits, and availability must be confirmed through approved store systems.",
];
