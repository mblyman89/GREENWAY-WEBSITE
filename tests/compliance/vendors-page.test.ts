/**
 * SLICE 114 — Vendors page rework (/vendor-delivery).
 *
 * Michael: rework the vendors page — the card should be product-card style
 * (logo forward, slim name bar, GLOWING side border, NO colored background),
 * fix the description fallback, and make the whole page body + the channel
 * emails/subjects editable. Keep the themes/colors/styles/buttons consistent.
 *
 * NEVER GUESS contracts under test:
 *  - Description fallback is mission_statement → about → product_philosophy,
 *    each whitespace-normalized, first non-blank wins (was about||mission).
 *  - product_philosophy is threaded end-to-end (core type, store, page).
 *  - Channel title/blurb/email/subject are editable via content_blocks; blank
 *    overrides fall back to the byte-identical defaults, and the `automated`
 *    flag is NOT editable. The blank-body mailto rule is preserved.
 *  - The card uses the product-card glow recipe (#101010 + dual radial glows +
 *    boxShadow), NO ACCENTS gradient background.
 *  - The vendors page is UNLOCKED in the Site Content editor (removed from
 *    PAGE_BUILDER_PAGES) so the new editable text is reachable.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  enrichVendorDirectory,
  buildVendorDirectory,
  type VendorProfileSource,
} from "@/lib/menu/vendor-directory-core";
import {
  VENDOR_CONTACT_CHANNELS,
  VENDOR_CHANNEL_CONTENT_KEYS,
  VENDOR_EDITABLE_CONTENT_KEYS,
  VENDOR_MENU_EMAIL,
  VENDOR_OUTREACH_SUBJECT,
  VENDOR_OUTREACH_SUBJECT_KEY,
  isVendorChannelBlock,
  resolveVendorChannels,
  vendorChannelBlockKey,
  vendorMailtoHref,
} from "@/lib/vendors/vendor-relations-core";
import { CONTENT_BLOCK_SEEDS } from "@/lib/cms/content-blocks-seed";

const read = (p: string) => readFileSync(p, "utf8");

describe("SLICE 114 — description fallback order", () => {
  const entries = buildVendorDirectory([
    { vendor: "Alpha" },
    { vendor: "Beta" },
    { vendor: "Gamma" },
    { vendor: "Delta" },
  ]);

  it("mission_statement wins over about + product_philosophy", () => {
    const profiles: VendorProfileSource[] = [
      {
        display_name: "Alpha",
        mission_statement: "  Mission copy.  ",
        about: "About copy.",
        product_philosophy: "Philosophy copy.",
      },
    ];
    const out = enrichVendorDirectory(entries, profiles);
    expect(out.find((e) => e.name === "Alpha")?.description).toBe("Mission copy.");
  });

  it("about fills in when mission is blank", () => {
    const profiles: VendorProfileSource[] = [
      { display_name: "Beta", mission_statement: "   ", about: "  About copy.  ", product_philosophy: "Phil." },
    ];
    const out = enrichVendorDirectory(entries, profiles);
    expect(out.find((e) => e.name === "Beta")?.description).toBe("About copy.");
  });

  it("product_philosophy is the final fallback", () => {
    const profiles: VendorProfileSource[] = [
      { display_name: "Gamma", mission_statement: null, about: "  ", product_philosophy: "  Small-batch.  " },
    ];
    const out = enrichVendorDirectory(entries, profiles);
    expect(out.find((e) => e.name === "Gamma")?.description).toBe("Small-batch.");
  });

  it("no copy at all degrades to null (placeholder card)", () => {
    const profiles: VendorProfileSource[] = [{ display_name: "Delta" }];
    const out = enrichVendorDirectory(entries, profiles);
    expect(out.find((e) => e.name === "Delta")?.description).toBeNull();
  });

  it("core type + fallback line persisted", () => {
    const core = read("src/lib/menu/vendor-directory-core.ts");
    expect(core).toContain("product_philosophy?: string | null;");
    expect(core).toContain("normalizeWhitespace(profile.mission_statement) ||");
    expect(core).toContain("normalizeWhitespace(profile.about) ||");
    expect(core).toContain("normalizeWhitespace(profile.product_philosophy) ||");
  });

  it("store threads product_philosophy through the public profile", () => {
    const store = read("src/lib/vendors/store.ts");
    expect(store).toContain("product_philosophy: string | null;");
    expect(store).toContain("product_philosophy: v.product_philosophy ?? null,");
    const page = read("src/app/vendor-delivery/page.tsx");
    expect(page).toContain("listPublicVendorProfiles()");
  });
});

describe("SLICE 114 — editable channel overrides", () => {
  it("no overrides -> byte-identical default channels", () => {
    expect(JSON.stringify(resolveVendorChannels())).toBe(JSON.stringify(VENDOR_CONTACT_CHANNELS));
  });

  it("overrides win; blank overrides fall back; automated is not editable", () => {
    const resolved = resolveVendorChannels({
      [vendorChannelBlockKey("samples", "title")]: "Free Samples",
      [vendorChannelBlockKey("samples", "email")]: "  set_by_owner@greenwaymarijuana.com  ",
      [vendorChannelBlockKey("menus", "email")]: "   ", // whitespace -> fallback
    });
    const byKey = new Map(resolved.map((c) => [c.key, c]));
    expect(byKey.get("samples")?.title).toBe("Free Samples");
    expect(byKey.get("samples")?.email).toBe("set_by_owner@greenwaymarijuana.com");
    expect(byKey.get("menus")?.email).toBe(VENDOR_MENU_EMAIL); // fell back
    // automated flag reflects real pipeline wiring, never copy.
    expect(byKey.get("menus")?.automated).toBe(true);
  });

  it("blank-body mailto rule preserved for channels", () => {
    for (const c of resolveVendorChannels()) {
      const href = vendorMailtoHref(c.email, c.subject);
      expect(href.startsWith(`mailto:${c.email}?subject=`)).toBe(true);
      expect(href.includes("body=")).toBe(false);
    }
  });

  it("editable key set is exactly outreach subject + 20 channel fields", () => {
    expect(VENDOR_CHANNEL_CONTENT_KEYS.length).toBe(20);
    expect(VENDOR_EDITABLE_CONTENT_KEYS.length).toBe(21);
    expect(VENDOR_EDITABLE_CONTENT_KEYS[0]).toBe(VENDOR_OUTREACH_SUBJECT_KEY);
    expect(new Set(VENDOR_EDITABLE_CONTENT_KEYS).size).toBe(21);
    expect(isVendorChannelBlock("vendors.channel.menus.subject")).toBe(true);
    expect(isVendorChannelBlock("vendors.outreach.body")).toBe(false);
  });
});

describe("SLICE 114 — content seeds (byte-identical, no migration)", () => {
  const bySeedKey = new Map(CONTENT_BLOCK_SEEDS.map((s) => [s.block_key, s]));

  it("every editable vendor key is seeded", () => {
    for (const key of VENDOR_EDITABLE_CONTENT_KEYS) {
      expect(bySeedKey.has(key)).toBe(true);
    }
  });

  it("outreach subject seed default matches the const byte-for-byte", () => {
    expect(bySeedKey.get(VENDOR_OUTREACH_SUBJECT_KEY)?.defaultValue).toBe(VENDOR_OUTREACH_SUBJECT);
    expect(bySeedKey.get(VENDOR_OUTREACH_SUBJECT_KEY)?.field_type).toBe("plain");
  });

  it("each channel field seed default is byte-identical to the shipped channel", () => {
    for (const c of VENDOR_CONTACT_CHANNELS) {
      expect(bySeedKey.get(vendorChannelBlockKey(c.key, "title"))?.defaultValue).toBe(c.title);
      expect(bySeedKey.get(vendorChannelBlockKey(c.key, "blurb"))?.defaultValue).toBe(c.blurb);
      expect(bySeedKey.get(vendorChannelBlockKey(c.key, "email"))?.defaultValue).toBe(c.email);
      expect(bySeedKey.get(vendorChannelBlockKey(c.key, "subject"))?.defaultValue).toBe(c.subject);
      // Emails use the `email` field type so the owner can set the mailbox.
      expect(bySeedKey.get(vendorChannelBlockKey(c.key, "email"))?.field_type).toBe("email");
    }
  });

  it("all new vendor seeds live on the vendors page", () => {
    for (const key of VENDOR_EDITABLE_CONTENT_KEYS) {
      expect(bySeedKey.get(key)?.page).toBe("vendors");
    }
  });
});

describe("SLICE 114 — public card redesign (product-card glow, no colored bg)", () => {
  const card = read("src/components/vendors/VendorDirectory.tsx");

  it("uses the product-card glow recipe, not a colored gradient background", () => {
    expect(card).toContain('backgroundColor: "#101010"');
    expect(card).toContain("radial-gradient(ellipse 54% 72% at -9% 44%");
    expect(card).toContain("boxShadow:");
    // The old ACCENTS gradient palette is gone.
    expect(card).not.toContain("const ACCENTS");
    expect(card).not.toContain("bg-gradient-to-br ${ACCENTS");
  });

  it("logo is object-contain (fills the card, un-cropped) with a name bar on top", () => {
    expect(card).toContain("object-contain");
    expect(card).toContain("border-b border-white/10"); // slim name bar
  });

  it("channel cards render from the resolved prop with fallbacks to the defaults", () => {
    expect(card).toContain("channels.map((channel)");
    expect(card).toContain("content?.channels ?? VENDOR_CONTACT_CHANNELS");
    expect(card).toContain("content?.outreachSubject || VENDOR_OUTREACH_SUBJECT");
  });
});

describe("SLICE 114 — editor unlocked + preview parity", () => {
  it("vendors removed from PAGE_BUILDER_PAGES so the editable text is reachable", () => {
    const editor = read("src/app/admin/content/page.tsx");
    const setBlock = editor.slice(
      editor.indexOf("const PAGE_BUILDER_PAGES"),
      editor.indexOf("const PAGE_BUILDER_PAGES") + 260,
    );
    expect(setBlock).not.toContain('"vendors"');
    // The other builder pages remain excluded.
    expect(setBlock).toContain('"home"');
    expect(setBlock).toContain('"faq"');
  });

  it("admin preview card matches the public redesign (dark + glow + logo forward)", () => {
    const preview = read("src/components/admin/vendors/VendorCardPreview.tsx");
    expect(preview).toContain('backgroundColor: "#101010"');
    expect(preview).toContain("object-contain");
    // Same fallback order as the public card.
    expect(preview).toContain("vendor.mission_statement?.trim() ||");
    expect(preview).toContain("vendor.about?.trim() ||");
    expect(preview).toContain("vendor.product_philosophy?.trim() ||");
  });

  it("server page resolves channels + subject and fetches the editable keys", () => {
    const page = read("src/app/vendor-delivery/page.tsx");
    expect(page).toContain("resolveVendorChannels(copy)");
    expect(page).toContain("...VENDOR_EDITABLE_CONTENT_KEYS");
    expect(page).toContain("channels,");
    expect(page).toContain("outreachSubject,");
  });
});
