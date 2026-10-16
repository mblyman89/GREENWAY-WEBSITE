/**
 * R64 — full owner control of the Vendors page CENTER section (the outreach
 * container between the two banners): heading, paragraph, alignment, any
 * number of buttons (email or link, three styles), and the contact cards
 * (add / remove / reorder / hide, title, blurb, email, subject, accent) with a
 * column choice.
 *
 * One "richjson" content block. While it is BLANK the page keeps rendering the
 * older per-field blocks (vendors.outreach.* + vendors.channel.*) exactly as
 * before — so nothing changes until the owner publishes the new editor.
 */
import { greenwayBusiness } from "@/content/business";
import {
  VENDOR_CONTACT_CHANNELS,
  VENDOR_OUTREACH_SUBJECT,
  vendorMailtoHref,
  type VendorContactChannel,
} from "@/lib/vendors/vendor-relations-core";

export const VENDOR_CENTER_BLOCK = "vendors.center.layout";

export const VENDOR_DEFAULT_HEADING = "Let's Work Together";
export const VENDOR_DEFAULT_BODY =
  "Greenway Marijuana is an independent, locally owned cannabis shop in Port Orchard, Washington, proudly serving the Kitsap Peninsula. We're always looking to connect with licensed I-502 producers and processors who make exceptional product. If you'd like to send samples, schedule a vendor day, or explore getting your line on our shelves, reach out — our buying team would love to hear from you.";

export type CenterButtonStyle = "gradient" | "green" | "outline";
export type CenterAccent = "green" | "gold" | "orange" | "white";
export type CenterColumns = "auto" | "1" | "2" | "3" | "4" | "5";
export type CenterAlign = "center" | "left";

export type CenterButton = {
  id: string;
  label: string;
  kind: "email" | "link";
  email: string;
  subject: string;
  href: string;
  style: CenterButtonStyle;
  newTab: boolean;
  show: boolean;
};

export type CenterCard = {
  id: string;
  title: string;
  blurb: string;
  email: string;
  subject: string;
  accent: CenterAccent;
  show: boolean;
};

export type VendorCenter = {
  show: boolean;
  heading: string;
  body: string;
  align: CenterAlign;
  buttons: CenterButton[];
  /** The small email address line under the buttons. */
  showEmailLine: boolean;
  emailLine: string;
  cardsHeading: string;
  cards: CenterCard[];
  columns: CenterColumns;
};

export const CENTER_MAX_BUTTONS = 4;
export const CENTER_MAX_CARDS = 12;

export const CENTER_ACCENTS: { value: CenterAccent; label: string; className: string }[] = [
  { value: "green", label: "Greenway green", className: "text-[var(--greenway)]" },
  { value: "gold", label: "Gold", className: "text-[var(--gold)]" },
  { value: "orange", label: "Orange", className: "text-[var(--orange)]" },
  { value: "white", label: "White", className: "text-white" },
];

export const CENTER_BUTTON_STYLES: { value: CenterButtonStyle; label: string; className: string }[] = [
  {
    value: "gradient",
    label: "Orange → gold (default)",
    className: "bg-gradient-to-r from-[var(--orange)] to-[var(--gold)] text-black shadow-lg shadow-black/40 hover:brightness-110",
  },
  { value: "green", label: "Greenway green", className: "bg-[var(--greenway)] text-black shadow-lg shadow-black/40 hover:brightness-110" },
  { value: "outline", label: "Outline", className: "border border-white/40 text-white hover:border-white hover:bg-white/10" },
];

export const CENTER_COLUMN_CLASS: Record<CenterColumns, string> = {
  auto: "sm:grid-cols-2 lg:grid-cols-5",
  "1": "",
  "2": "sm:grid-cols-2",
  "3": "sm:grid-cols-2 lg:grid-cols-3",
  "4": "sm:grid-cols-2 lg:grid-cols-4",
  "5": "sm:grid-cols-2 lg:grid-cols-5",
};

export function accentClass(a: CenterAccent): string {
  return (CENTER_ACCENTS.find((x) => x.value === a) ?? CENTER_ACCENTS[0]).className;
}
export function buttonStyleClass(s: CenterButtonStyle): string {
  return (CENTER_BUTTON_STYLES.find((x) => x.value === s) ?? CENTER_BUTTON_STYLES[0]).className;
}

const str = (v: unknown, max: number, fb = ""): string => (typeof v === "string" ? v.slice(0, max) : fb);
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const safeEmail = (v: unknown): string => {
  const s = typeof v === "string" ? v.trim() : "";
  return EMAIL_RE.test(s) ? s.slice(0, 200) : "";
};
const safeHref = (v: unknown): string => {
  const s = typeof v === "string" ? v.trim() : "";
  return /^(\/(?!\/)|https:\/\/|tel:|mailto:)/.test(s) ? s.slice(0, 500) : "";
};

let idSeq = 0;
export function newCenterId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSeq}`;
}

export function blankButton(): CenterButton {
  return { id: newCenterId("b"), label: "New button", kind: "email", email: greenwayBusiness.email, subject: "", href: "", style: "outline", newTab: false, show: true };
}
export function blankCard(): CenterCard {
  return { id: newCenterId("c"), title: "New card", blurb: "", email: greenwayBusiness.email, subject: "", accent: "green", show: true };
}

/**
 * The center exactly as the page shows it today, from the legacy blocks
 * (already resolved: heading/body may be blank → defaults).
 */
export function centerFromLegacy(input: {
  heading?: string;
  body?: string;
  outreachSubject?: string;
  channels?: VendorContactChannel[];
}): VendorCenter {
  return {
    show: true,
    heading: (input.heading ?? "").trim() || VENDOR_DEFAULT_HEADING,
    body: (input.body ?? "").trim() || VENDOR_DEFAULT_BODY,
    align: "center",
    buttons: [
      {
        id: "outreach",
        label: "Email Our Buying Team",
        kind: "email",
        email: greenwayBusiness.email,
        subject: (input.outreachSubject ?? "").trim() || VENDOR_OUTREACH_SUBJECT,
        href: "",
        style: "gradient",
        newTab: false,
        show: true,
      },
    ],
    showEmailLine: true,
    emailLine: greenwayBusiness.email,
    cardsHeading: "",
    cards: (input.channels ?? VENDOR_CONTACT_CHANNELS).map((c) => ({
      id: c.key,
      title: c.title,
      blurb: c.blurb,
      email: c.email,
      subject: c.subject,
      accent: "green" as const,
      show: true,
    })),
    columns: "auto",
  };
}

function normButton(raw: unknown, i: number): CenterButton | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  return {
    id: str(b.id, 60) || `b${i}`,
    label: str(b.label, 80).trim() || "Button",
    kind: b.kind === "link" ? "link" : "email",
    email: safeEmail(b.email),
    subject: str(b.subject, 200),
    href: safeHref(b.href),
    style: CENTER_BUTTON_STYLES.some((s) => s.value === b.style) ? (b.style as CenterButtonStyle) : "gradient",
    newTab: b.newTab === true,
    show: b.show !== false,
  };
}

function normCard(raw: unknown, i: number): CenterCard | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  return {
    id: str(c.id, 60) || `c${i}`,
    title: str(c.title, 120),
    blurb: str(c.blurb, 600),
    email: safeEmail(c.email),
    subject: str(c.subject, 200),
    accent: CENTER_ACCENTS.some((a) => a.value === c.accent) ? (c.accent as CenterAccent) : "green",
    show: c.show !== false,
  };
}

/** Parse the block. Blank / bad JSON → null (= keep the legacy rendering). */
export function parseVendorCenter(raw: string | null | undefined): VendorCenter | null {
  if (!raw || !raw.trim()) return null;
  let j: Record<string, unknown>;
  try {
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object" || Array.isArray(p)) return null;
    j = p as Record<string, unknown>;
  } catch {
    return null;
  }
  const buttons = (Array.isArray(j.buttons) ? j.buttons : []).map(normButton).filter((b): b is CenterButton => !!b).slice(0, CENTER_MAX_BUTTONS);
  const cards = (Array.isArray(j.cards) ? j.cards : []).map(normCard).filter((c): c is CenterCard => !!c).slice(0, CENTER_MAX_CARDS);
  const cols = typeof j.columns === "string" && j.columns in CENTER_COLUMN_CLASS ? (j.columns as CenterColumns) : "auto";
  return {
    show: j.show !== false,
    heading: str(j.heading, 160),
    body: str(j.body, 2000),
    align: j.align === "left" ? "left" : "center",
    buttons,
    showEmailLine: j.showEmailLine !== false,
    emailLine: str(j.emailLine, 200),
    cardsHeading: str(j.cardsHeading, 160),
    cards,
    columns: cols,
  };
}

export function serializeVendorCenter(c: VendorCenter): string {
  return JSON.stringify(c);
}

/** The href a button opens (blank → not rendered). Email bodies stay blank. */
export function centerButtonHref(b: CenterButton): string {
  return b.kind === "link" ? b.href : vendorMailtoHref(b.email, b.subject);
}

export function __runVendorCenterCoreTests(): { passed: number } {
  let passed = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error("vendor-center-core: " + m);
    passed += 1;
  };
  ok(parseVendorCenter("") === null && parseVendorCenter("{bad") === null, "blank/bad → legacy");
  const leg = centerFromLegacy({});
  ok(leg.heading === VENDOR_DEFAULT_HEADING && leg.cards.length === VENDOR_CONTACT_CHANNELS.length, "legacy defaults");
  ok(leg.buttons[0].subject === VENDOR_OUTREACH_SUBJECT && leg.buttons[0].style === "gradient", "legacy button");
  const round = parseVendorCenter(serializeVendorCenter(leg));
  ok(!!round && round.cards[3].email === VENDOR_CONTACT_CHANNELS[3].email, "round trip");
  const bad = parseVendorCenter(JSON.stringify({ buttons: [{ kind: "link", href: "javascript:x" }], cards: [{ email: "nope" }], columns: "9" }));
  ok(!!bad && bad.buttons[0].href === "" && bad.cards[0].email === "" && bad.columns === "auto", "unsafe rejected");
  ok(centerButtonHref(leg.buttons[0]).startsWith("mailto:") && !centerButtonHref(leg.buttons[0]).includes("body="), "mailto, blank body");
  return { passed };
}
