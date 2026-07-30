/**
 * SLICE 99 — vendor-relations contact channels for the PUBLIC vendors page.
 *
 * Michael created two dedicated Google Workspace accounts and confirmed he
 * will be "using them going forward":
 *
 *   - vendor_intake@greenwaymarijuana.com — the vendor-relations mailbox.
 *     Address-map forwarding to the intake.greenwaymarijuana.com receiving
 *     subdomain is LIVE (confirmed end-to-end), so transfer/manifest emails
 *     sent here are also parsed automatically into the Receiving queue
 *     (/admin/inventory/intake). Human emails (samples, vendor days,
 *     promotions) simply land in the mailbox — the webhook logs them as
 *     "no manifest" and never invents a manifest from them.
 *
 *   - vendor_menu@greenwaymarijuana.com — the emailed-menus mailbox. Menus
 *     sent here (body text, HTML tables, CSV/TXT, PDFs) are parsed into the
 *     back office Vendor Menus page (/admin/purchasing/menus, SLICE 83);
 *     spam is classified out and never shown.
 *
 * PURE module: no imports, no side effects. The public VendorDirectory maps
 * over VENDOR_CONTACT_CHANNELS so every card stays consistent with the real
 * mailboxes above, and the mailto builder keeps the email BODY BLANK — the
 * same explicit owner rule as the existing outreach button ("the email body
 * must be BLANK so it opens an empty draft").
 */

/** Public vendor-relations mailbox (humans + automated manifest intake). */
export const VENDOR_INTAKE_EMAIL = "vendor_intake@greenwaymarijuana.com";

/** Public emailed-menus mailbox (parsed into /admin/purchasing/menus). */
export const VENDOR_MENU_EMAIL = "vendor_menu@greenwaymarijuana.com";

export type VendorContactChannel = {
  /** Stable key (also the React list key). */
  key: string;
  /** Card title shown to vendors. */
  title: string;
  /** One-sentence plain-English description of when to use this channel. */
  blurb: string;
  /** The real mailbox this channel writes to. */
  email: string;
  /** Prefilled subject line (body stays blank per owner rule). */
  subject: string;
  /**
   * True when the mailbox feeds an automated back-office pipeline (menus /
   * manifests) so the card can honestly say "parsed automatically".
   */
  automated: boolean;
};

/**
 * mailto: link with a prefilled subject and a BLANK body (owner rule — the
 * existing outreach button intentionally opens an empty draft). PURE.
 */
export function vendorMailtoHref(email: string, subject: string): string {
  const addr = email.trim();
  const subj = subject.trim();
  if (!addr) return "";
  return subj ? `mailto:${addr}?subject=${encodeURIComponent(subj)}` : `mailto:${addr}`;
}

/**
 * The channels rendered on the public vendors page, in display order.
 * Samples / vendor days / promotions are HUMAN conversations -> the
 * vendor_intake@ mailbox Michael reads. Menus -> vendor_menu@ (auto-parsed).
 * Manifests -> vendor_intake@ (auto-parsed by the inbound webhook).
 */
export const VENDOR_CONTACT_CHANNELS: VendorContactChannel[] = [
  {
    key: "samples",
    title: "Sample Drops",
    blurb:
      "Want our budtenders to try your line? Tell us what you'd like to drop off and when — we'll coordinate a time.",
    email: VENDOR_INTAKE_EMAIL,
    subject: "Sample drop — [your brand]",
    automated: false,
  },
  {
    key: "promotions",
    title: "Promotions & Deals",
    blurb:
      "Pitch a price drop, bundle, or co-marketing push. Include the products, the numbers, and the dates you have in mind.",
    email: VENDOR_INTAKE_EMAIL,
    subject: "Promotion or deal proposal — [your brand]",
    automated: false,
  },
  {
    key: "vendor-days",
    title: "Vendor Days",
    blurb:
      "Book an in-store vendor day to meet our customers face to face. Suggest a few dates and we'll get you on the calendar.",
    email: VENDOR_INTAKE_EMAIL,
    subject: "Vendor day request — [your brand]",
    automated: false,
  },
  {
    key: "menus",
    title: "Send Us Your Menu",
    blurb:
      "Email your current menu or price sheet — body text, spreadsheet, or PDF. It's parsed automatically and lands in front of our buying team.",
    email: VENDOR_MENU_EMAIL,
    subject: "Menu — [your brand]",
    automated: true,
  },
  {
    key: "manifests",
    title: "Transfer Manifests",
    blurb:
      "Already delivering to us? Send transfer data and manifests here at least 24 hours before transport — they're staged into receiving automatically.",
    email: VENDOR_INTAKE_EMAIL,
    subject: "Transfer manifest — [your brand]",
    automated: true,
  },
];

// ---------------------------------------------------------------------------
// SLICE 114 — editable channel overrides (content_blocks, NO migration)
//
// Michael asked to "change the email options so I can set them manually" and
// "modify the subject line too." Each channel's title / blurb / email / subject
// becomes an editable content block; the constants above stay the byte-identical
// DEFAULT so the live look never changes until he edits & publishes. PURE: the
// server page fetches the block values and passes them in as `overrides`.
// ---------------------------------------------------------------------------

/** The outreach ("Email Our Buying Team") prefilled subject line. */
export const VENDOR_OUTREACH_SUBJECT = "Vendor partnership inquiry — Greenway Marijuana";

/** Content-block key for the outreach button's subject line. */
export const VENDOR_OUTREACH_SUBJECT_KEY = "vendors.outreach.subject";

/** The four editable fields on each channel card. */
export type VendorChannelField = "title" | "blurb" | "email" | "subject";

/** content_blocks key for one channel field, e.g. `vendors.channel.samples.email`. */
export function vendorChannelBlockKey(channelKey: string, field: VendorChannelField): string {
  return `vendors.channel.${channelKey}.${field}`;
}

/** All channel content-block keys, in a stable order (title,blurb,email,subject × channels). */
export const VENDOR_CHANNEL_CONTENT_KEYS: string[] = VENDOR_CONTACT_CHANNELS.flatMap((c) =>
  (["title", "blurb", "email", "subject"] as VendorChannelField[]).map((f) =>
    vendorChannelBlockKey(c.key, f),
  ),
);

/** Every vendor content-block key this slice adds (channels + outreach subject). */
export const VENDOR_EDITABLE_CONTENT_KEYS: string[] = [
  VENDOR_OUTREACH_SUBJECT_KEY,
  ...VENDOR_CHANNEL_CONTENT_KEYS,
];

/** True when a block key belongs to the editable vendor channel/subject set. */
export function isVendorChannelBlock(key: string): boolean {
  return VENDOR_EDITABLE_CONTENT_KEYS.includes(key);
}

/** Non-blank override wins over the byte-identical default (never blanks a field). */
function pick(override: string | null | undefined, fallback: string): string {
  const v = (override ?? "").trim();
  return v.length > 0 ? v : fallback;
}

/**
 * Overlay editable values onto the default channels. `overrides` maps a
 * content-block key (from vendorChannelBlockKey) to its resolved value; any
 * blank/whitespace/absent value falls back to the shipped default, so the
 * card copy is never emptied. `automated` is NOT editable (it reflects real
 * pipeline wiring, not copy). PURE.
 */
export function resolveVendorChannels(
  overrides: Record<string, string | null | undefined> = {},
): VendorContactChannel[] {
  return VENDOR_CONTACT_CHANNELS.map((c) => ({
    ...c,
    title: pick(overrides[vendorChannelBlockKey(c.key, "title")], c.title),
    blurb: pick(overrides[vendorChannelBlockKey(c.key, "blurb")], c.blurb),
    email: pick(overrides[vendorChannelBlockKey(c.key, "email")], c.email),
    subject: pick(overrides[vendorChannelBlockKey(c.key, "subject")], c.subject),
  }));
}

// ---------------------------------------------------------------------------
// Self-tests (wired into scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runVendorRelationsCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, label: string) => {
    if (!cond) throw new Error(`vendor-relations-core self-test failed: ${label}`);
    passed += 1;
  };

  // The two real mailboxes — exact addresses Michael set up.
  ok(VENDOR_INTAKE_EMAIL === "vendor_intake@greenwaymarijuana.com", "intake address exact");
  ok(VENDOR_MENU_EMAIL === "vendor_menu@greenwaymarijuana.com", "menu address exact");

  // mailto builder: subject encoded, body NEVER present (owner blank-body rule).
  const href = vendorMailtoHref(VENDOR_INTAKE_EMAIL, "Sample drop — [your brand]");
  ok(href.startsWith("mailto:vendor_intake@greenwaymarijuana.com?subject="), "mailto shape");
  ok(href.includes(encodeURIComponent("Sample drop — [your brand]")), "subject encoded");
  ok(!href.includes("body="), "body stays blank");
  ok(vendorMailtoHref("a@b.com", "") === "mailto:a@b.com", "empty subject -> bare mailto");
  ok(vendorMailtoHref("  a@b.com  ", " Hi ") === `mailto:a@b.com?subject=${encodeURIComponent("Hi")}`, "trims inputs");
  ok(vendorMailtoHref("", "Hi") === "", "blank address -> empty href (never a broken link)");

  // Channel list: five channels in display order, keys unique.
  ok(VENDOR_CONTACT_CHANNELS.length === 5, "five channels");
  ok(
    VENDOR_CONTACT_CHANNELS.map((c) => c.key).join(",") ===
      "samples,promotions,vendor-days,menus,manifests",
    "display order",
  );
  ok(
    new Set(VENDOR_CONTACT_CHANNELS.map((c) => c.key)).size === VENDOR_CONTACT_CHANNELS.length,
    "keys unique",
  );

  // Routing: humans -> vendor_intake@; menus -> vendor_menu@; manifests -> vendor_intake@.
  const byKey = new Map(VENDOR_CONTACT_CHANNELS.map((c) => [c.key, c]));
  ok(byKey.get("samples")?.email === VENDOR_INTAKE_EMAIL, "samples -> intake mailbox");
  ok(byKey.get("promotions")?.email === VENDOR_INTAKE_EMAIL, "promotions -> intake mailbox");
  ok(byKey.get("vendor-days")?.email === VENDOR_INTAKE_EMAIL, "vendor days -> intake mailbox");
  ok(byKey.get("menus")?.email === VENDOR_MENU_EMAIL, "menus -> menu mailbox");
  ok(byKey.get("manifests")?.email === VENDOR_INTAKE_EMAIL, "manifests -> intake mailbox");

  // Only the automated pipelines claim automation.
  ok(byKey.get("menus")?.automated === true, "menus card says automated");
  ok(byKey.get("manifests")?.automated === true, "manifests card says automated");
  ok(byKey.get("samples")?.automated === false, "samples card is human");
  ok(byKey.get("promotions")?.automated === false, "promotions card is human");
  ok(byKey.get("vendor-days")?.automated === false, "vendor days card is human");

  // Every channel has usable copy + a valid href.
  for (const c of VENDOR_CONTACT_CHANNELS) {
    ok(c.title.trim().length > 0 && c.blurb.trim().length > 0, `${c.key} has copy`);
    ok(c.subject.includes("[your brand]"), `${c.key} subject prompts for brand`);
    ok(vendorMailtoHref(c.email, c.subject).startsWith("mailto:"), `${c.key} href valid`);
  }

  // SLICE 114: editable channel overrides.
  ok(VENDOR_OUTREACH_SUBJECT === "Vendor partnership inquiry — Greenway Marijuana", "outreach subject default");
  ok(VENDOR_OUTREACH_SUBJECT_KEY === "vendors.outreach.subject", "outreach subject key");
  ok(vendorChannelBlockKey("samples", "email") === "vendors.channel.samples.email", "channel block key shape");
  // 5 channels × 4 fields = 20 channel keys; +1 outreach subject = 21 editable keys.
  ok(VENDOR_CHANNEL_CONTENT_KEYS.length === 20, "20 channel content keys");
  ok(VENDOR_EDITABLE_CONTENT_KEYS.length === 21, "21 editable vendor keys total");
  ok(new Set(VENDOR_EDITABLE_CONTENT_KEYS).size === 21, "editable keys unique");
  ok(isVendorChannelBlock("vendors.channel.menus.subject"), "channel block recognized");
  ok(isVendorChannelBlock(VENDOR_OUTREACH_SUBJECT_KEY), "outreach subject recognized");
  ok(!isVendorChannelBlock("vendors.outreach.body"), "non-channel block not recognized");

  // Empty overrides -> byte-identical defaults (live look unchanged).
  const def = resolveVendorChannels();
  ok(def.length === 5, "resolver returns five channels");
  ok(
    JSON.stringify(def) === JSON.stringify(VENDOR_CONTACT_CHANNELS),
    "no overrides -> byte-identical default channels",
  );

  // Overrides win; blank/whitespace overrides fall back; automated stays fixed.
  const resolved = resolveVendorChannels({
    "vendors.channel.samples.title": "Free Samples",
    "vendors.channel.samples.email": "  new_intake@greenwaymarijuana.com  ",
    "vendors.channel.menus.subject": "   ", // whitespace -> fallback
    "vendors.channel.menus.email": "", // empty -> fallback
  });
  const rByKey = new Map(resolved.map((c) => [c.key, c]));
  ok(rByKey.get("samples")?.title === "Free Samples", "override title wins");
  ok(rByKey.get("samples")?.email === "new_intake@greenwaymarijuana.com", "override email trimmed + wins");
  ok(rByKey.get("samples")?.blurb === byKey.get("samples")?.blurb, "un-overridden field keeps default");
  ok(rByKey.get("menus")?.subject === byKey.get("menus")?.subject, "whitespace override -> default subject");
  ok(rByKey.get("menus")?.email === VENDOR_MENU_EMAIL, "empty override -> default email");
  ok(rByKey.get("menus")?.automated === true, "automated flag not editable (stays true)");

  console.log(`vendor-relations-core self-tests: ${passed} passed`);
}
