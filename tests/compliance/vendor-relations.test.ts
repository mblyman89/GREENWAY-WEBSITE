/**
 * SLICE 99 — vendor-relations contact channels on the public vendors page.
 *
 * Michael: enhance the public vendors page (connected to the back office and
 * page editor), use the new vendor_intake@ and vendor_menu@ accounts going
 * forward, and give vendors ways to contact us about samples, promotions,
 * vendor days, etc.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  VENDOR_CONTACT_CHANNELS,
  VENDOR_INTAKE_EMAIL,
  VENDOR_MENU_EMAIL,
  __runVendorRelationsCoreTests,
  vendorMailtoHref,
} from "@/lib/vendors/vendor-relations-core";

describe("vendor-relations core", () => {
  it("passes its own self-tests", () => {
    expect(() => __runVendorRelationsCoreTests()).not.toThrow();
  });

  it("uses the two real mailboxes Michael created — never a guessed address", () => {
    expect(VENDOR_INTAKE_EMAIL).toBe("vendor_intake@greenwaymarijuana.com");
    expect(VENDOR_MENU_EMAIL).toBe("vendor_menu@greenwaymarijuana.com");
    for (const channel of VENDOR_CONTACT_CHANNELS) {
      expect([VENDOR_INTAKE_EMAIL, VENDOR_MENU_EMAIL]).toContain(channel.email);
    }
  });

  it("routes human conversations to vendor_intake@ and menus to vendor_menu@", () => {
    const byKey = new Map(VENDOR_CONTACT_CHANNELS.map((c) => [c.key, c]));
    expect(byKey.get("samples")?.email).toBe(VENDOR_INTAKE_EMAIL);
    expect(byKey.get("promotions")?.email).toBe(VENDOR_INTAKE_EMAIL);
    expect(byKey.get("vendor-days")?.email).toBe(VENDOR_INTAKE_EMAIL);
    expect(byKey.get("menus")?.email).toBe(VENDOR_MENU_EMAIL);
    expect(byKey.get("manifests")?.email).toBe(VENDOR_INTAKE_EMAIL);
    // Only the parsed pipelines claim automation.
    expect(VENDOR_CONTACT_CHANNELS.filter((c) => c.automated).map((c) => c.key)).toEqual([
      "menus",
      "manifests",
    ]);
  });

  it("keeps the email body BLANK (owner rule) while prefilling the subject", () => {
    for (const channel of VENDOR_CONTACT_CHANNELS) {
      const href = vendorMailtoHref(channel.email, channel.subject);
      expect(href.startsWith(`mailto:${channel.email}?subject=`)).toBe(true);
      expect(href).not.toContain("body=");
    }
  });
});

describe("vendor-relations wiring (public vendors page)", () => {
  const directory = readFileSync("src/components/vendors/VendorDirectory.tsx", "utf8");
  const page = readFileSync("src/app/vendor-delivery/page.tsx", "utf8");
  const seeds = readFileSync("src/lib/cms/content-blocks-seed.ts", "utf8");

  it("VendorDirectory renders the channel cards from the shared core", () => {
    expect(directory).toContain('from "@/lib/vendors/vendor-relations-core"');
    // SLICE 114: the channel cards now render from the RESOLVED `channels`
    // prop (editable overrides overlaid on the byte-identical defaults).
    expect(directory).toContain("channels.map((channel)");
    expect(directory).toContain("VENDOR_CONTACT_CHANNELS");
    expect(directory).toContain("vendorMailtoHref(channel.email, channel.subject)");
    // T-307: the "Parsed automatically" footnote was removed from the cards at
    // the owner's request (cosmetic). The automated FLAG on the data model is
    // unchanged (still drives receiving intake); it just no longer prints on
    // the public card. Guard that the on-card footnote is gone.
    expect(directory).not.toContain("channel.automated ?");
    expect(directory).not.toContain("Parsed automatically");
  });

  it("outreach paragraph joined the page editor (vendors.outreach.body)", () => {
    // Seeded content block …
    expect(seeds).toContain('block_key: "vendors.outreach.body"');
    // … loaded by the server page alongside the heading …
    expect(page).toContain('"vendors.outreach.heading"');
    expect(page).toContain('"vendors.outreach.body"');
    expect(page).toContain('body: copy["vendors.outreach.body"]');
    // … and rendered with the in-place editor hook when preview is active.
    expect(directory).toContain('"data-gw-block": "vendors.outreach.body"');
    expect(directory).toContain("content?.body ||");
  });

  it("keeps the existing outreach button and SLICE 97 logo enrichment intact", () => {
    expect(directory).toContain("Email Our Buying Team");
    expect(directory).toContain("greenwayBusiness.emailHref");
    expect(page).toContain("enrichVendorDirectory(buildVendorDirectory(menuItems), profiles)");
  });
});
