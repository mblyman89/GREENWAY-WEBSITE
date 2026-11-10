/**
 * D212 — Vendor Menus "Fetch logo": find a vendor's logo on GrowFlow /
 * Cultivera / LeafLink, attach it to the vendor AND its brands, and publish it
 * so it shows on the customer-facing website in one click.
 * Vitest mirror of the pure self-tests plus structural locks on the store,
 * actions and page.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  __runVendorLogoCoreTests,
  cleanLogoUrl,
  planLogoWrite,
  logoPlatformOrder,
  missingLogoQueue,
  type LogoVendor,
} from "@/lib/purchasing/vendor-logo-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("vendor-logo-core (D212)", () => {
  it("passes its own pure self-tests", () => {
    const r = __runVendorLogoCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(110);
  });

  it("refuses relative / data / placeholder logo URLs instead of guessing", () => {
    expect(cleanLogoUrl("https://cdn.example.com/logo.png").url).toBe("https://cdn.example.com/logo.png");
    expect(cleanLogoUrl("//cdn.example.com/a.png").url).toBe("https://cdn.example.com/a.png");
    expect(cleanLogoUrl("/uploads/logo.png").url).toBeNull();
    expect(cleanLogoUrl("data:image/png;base64,AAAA").url).toBeNull();
    expect(cleanLogoUrl("").url).toBeNull();
  });

  it("publishes a draft vendor, never touches an archived one, and keeps an existing logo unless replace", () => {
    const brands = [
      { id: "b1", display_name: "B1", vendor_id: "v", status: "draft", logo_media_id: null },
      { id: "b2", display_name: "B2", vendor_id: "v", status: "published", logo_media_id: "own" },
      { id: "b3", display_name: "B3", vendor_id: "v", status: "archived", logo_media_id: null },
    ];
    const plan = planLogoWrite({ status: "draft", logo_media_id: null }, brands, "new", false);
    expect(plan.kind).toBe("apply");
    if (plan.kind === "apply") {
      expect(plan.vendorUpdate).toEqual({ logo_media_id: "new", status: "published" });
      const b1 = plan.brands.find((b) => b.brandId === "b1")!;
      expect(b1.setLogo && b1.publish).toBe(true);
      expect(plan.brands.find((b) => b.brandId === "b2")!.keptOwnLogo).toBe(true);
      expect(plan.brands.find((b) => b.brandId === "b3")!.archived).toBe(true);
    }
    expect(planLogoWrite({ status: "archived", logo_media_id: null }, [], "new", true)).toEqual({ kind: "skip", reason: "archived" });
    expect(planLogoWrite({ status: "published", logo_media_id: "old" }, [], "new", false)).toEqual({ kind: "skip", reason: "has_logo" });
    expect(planLogoWrite({ status: "published", logo_media_id: "old" }, [], "new", true).kind).toBe("apply");
  });

  it("searches the remembered platform first", () => {
    expect(logoPlatformOrder("leaflink")).toEqual(["leaflink", "growflow", "cultivera"]);
    expect(logoPlatformOrder(null)).toEqual(["growflow", "cultivera", "leaflink"]);
  });

  it("bulk queue only takes carried, active, non-archived vendors with no logo", () => {
    const base = {
      slug: null, dba: null, legal_name: null, license_number: null, email: null, phone: null, website: null,
      total_accepted_ytd_cents: null, last_accepted_at: null,
    };
    const vs: LogoVendor[] = [
      { ...base, id: "a", display_name: "A", is_active: true, status: "published", logo_media_id: null },
      { ...base, id: "b", display_name: "B", is_active: true, status: "published", logo_media_id: "x" },
      { ...base, id: "c", display_name: "C", is_active: true, status: "archived", logo_media_id: null },
      { ...base, id: "d", display_name: "D", is_active: true, status: "draft", logo_media_id: null },
    ];
    const stock = new Map([
      ["a", { lotsInStock: 0, lotsTotal: 1, lastReceived: "2026-01-01" }],
      ["b", { lotsInStock: 1, lotsTotal: 1, lastReceived: "2026-01-01" }],
      ["c", { lotsInStock: 1, lotsTotal: 1, lastReceived: "2026-01-01" }],
      ["d", { lotsInStock: 2, lotsTotal: 2, lastReceived: "2026-01-02" }],
    ]);
    expect(missingLogoQueue(vs, stock, 10).map((v) => v.id)).toEqual(["d", "a"]);
  });
});

describe("D212 structural locks", () => {
  const store = read("src/lib/purchasing/vendor-logo-store.ts");
  const actions = read("src/app/admin/purchasing/menus/actions.ts");
  const page = read("src/app/admin/purchasing/menus/page.tsx");
  const coverage = read("src/lib/purchasing/vendor-menu-coverage-store.ts");

  it("store is server-only and selects named columns", () => {
    expect(store).toContain('import "server-only"');
    expect(store).not.toMatch(/select\(\s*["'`]\*["'`]\s*\)/);
    expect(coverage).not.toMatch(/select\(\s*["'`]\*["'`]\s*\)/);
  });

  it("publishes the asset, attaches to the vendor AND its brands, and records usages", () => {
    expect(store).toMatch(/from\("media_assets"\)[\s\S]*status: "published"/);
    expect(store).toContain('admin.from("vendors").update(plan.vendorUpdate)');
    expect(store).toContain('admin.from("brands").update(patch)');
    expect(store).toContain('recordUsage(assetId, "vendor"');
    expect(store).toContain('recordUsage(assetId, "brand"');
  });

  it("actions are permission-gated, audited, and revalidate the public site", () => {
    const tail = actions.slice(actions.indexOf("D212"));
    expect(tail).toMatch(/fetchVendorLogoAction[\s\S]*requirePermission\("inventory\.manage"\)/);
    expect(tail).toMatch(/fetchMissingLogosAction[\s\S]*requirePermission\("inventory\.manage"\)/);
    expect(tail).toContain('action: "vendor.logo_fetched"');
    expect(tail).toContain("revalidatePublicMenuSurfaces()");
  });

  it("page renders the buttons and allows a long-running fetch", () => {
    expect(page).toContain("<FetchLogoButton");
    expect(page).toContain("<FetchAllLogosButton");
    expect(page).toMatch(/export const maxDuration = \d+/);
  });
});

describe("D222 structural locks (logo fetch parity with the Vendor Menus page)", () => {
  const store = read("src/lib/purchasing/vendor-logo-store.ts");
  const core = read("src/lib/purchasing/vendor-logo-core.ts");

  it("matcher is built once with merged survivors and carried vendors", () => {
    expect(store).toContain("internal_notes");
    expect(store).toContain("mergedIntoFromNotes(");
    expect(store).toContain("buildSurvivorResolver(vendors)");
    expect(store).toMatch(/buildLogoMatcher\(vendors, aliases, brands, \{ carried \}\)/);
  });

  it("uses known platform profiles and the local prefilter, not the old memories lookup", () => {
    expect(store).toContain("knownProfilesFor(");
    expect(store).toContain("candidateMentions(");
    expect(store).not.toContain("getMemoriesForVendor");
  });

  it("LeafLink logo comes from the brands listing logo, never a product sample image", () => {
    const fn = core.slice(core.indexOf("export function leaflinkSearchCandidate"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain("rec.logo_url");
    expect(body).not.toContain("sample_image");
  });
});
