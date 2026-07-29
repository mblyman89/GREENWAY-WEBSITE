/**
 * tests/compliance/vendor-directory-enrichment.test.ts  (SLICE 97 — owner: Michael)
 *
 * "After I added a logo to my vendor in their vendor detail page, it did not
 * update the vendors page on the customer facing website."
 *
 * ROOT CAUSE: the public /vendor-delivery page never read the vendors table —
 * the directory came only from live menu items (SLICE 48) and the card
 * hardcoded a placeholder logo. The back-office save was always correct.
 *
 * FIX under test: enrichVendorDirectory folds back-office profiles (logo URL
 * + about/mission copy) into the menu-derived entries via a pure matching
 * ladder (exact name → alias → normalized name), and the page/card/actions
 * are wired to it (incl. revalidatePath("/vendor-delivery") on profile save).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildVendorDirectory,
  enrichVendorDirectory,
  normalizedVendorKey,
  __runVendorDirectoryCoreTests,
  type VendorProfileSource,
} from "@/lib/menu/vendor-directory-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("vendor directory enrichment (SLICE 97)", () => {
  it("embedded self-tests pass (18 assertions incl. enrichment)", () => {
    expect(() => __runVendorDirectoryCoreTests()).not.toThrow();
  });

  it("the owner's exact scenario: logo saved in the back office reaches the public entry", () => {
    const entries = buildVendorDirectory([{ vendor: "CERES" }, { vendor: "CERES" }]);
    const profiles: VendorProfileSource[] = [
      {
        display_name: "Ceres",
        logoUrl: "https://proj.supabase.co/storage/v1/object/public/media/vendor-logo/ceres.png",
        about: "Craft topicals from Washington.",
      },
    ];
    const [ceres] = enrichVendorDirectory(entries, profiles);
    expect(ceres.logoUrl).toBe(
      "https://proj.supabase.co/storage/v1/object/public/media/vendor-logo/ceres.png",
    );
    expect(ceres.description).toBe("Craft topicals from Washington.");
    expect(ceres.productCount).toBe(2); // counts untouched
  });

  it("matching ladder: exact beats alias beats normalized; blanks never match", () => {
    const entries = [
      { name: "2727", slug: "2727", productCount: 1 },
      { name: "Fair-Winds, LLC.", slug: "fair-winds-llc", productCount: 1 },
      { name: "Nobody", slug: "nobody", productCount: 1 },
    ];
    const profiles: VendorProfileSource[] = [
      { display_name: "Twenty Seven", aliases: ["2727"], logoUrl: "https://x/alias.png" },
      { display_name: "Fairwinds", legal_name: "Fair Winds LLC", logoUrl: "https://x/norm.png" },
      { display_name: "", logoUrl: "https://x/blank.png" },
    ];
    const out = enrichVendorDirectory(entries, profiles);
    expect(out[0].logoUrl).toBe("https://x/alias.png");
    expect(out[1].logoUrl).toBe("https://x/norm.png");
    expect(out[2].logoUrl).toBeNull();
    expect(out[2].description).toBeNull();
  });

  it("normalizedVendorKey collapses punctuation/case/ampersand drift", () => {
    expect(normalizedVendorKey("  Fair-Winds, LLC. ")).toBe("fair winds llc");
    expect(normalizedVendorKey("B&B Farms")).toBe("b and b farms");
    expect(normalizedVendorKey("")).toBe("");
    expect(normalizedVendorKey(null)).toBe("");
  });

  it("page + card + store wiring persisted", () => {
    const page = read("src/app/vendor-delivery/page.tsx");
    expect(page).toContain("enrichVendorDirectory(buildVendorDirectory(menuItems), profiles)");
    expect(page).toContain("listPublicVendorProfiles()");
    const card = read("src/components/vendors/VendorDirectory.tsx");
    expect(card).toContain("vendor.logoUrl || PLACEHOLDER_LOGO");
    expect(card).toContain("vendor.description || PLACEHOLDER_DESCRIPTION");
    const store = read("src/lib/vendors/store.ts");
    expect(store).toContain("export async function listPublicVendorProfiles");
    expect(store).toContain("vendorLogoUrls(vendors)");
  });

  it("profile save + harvested-logo assign now revalidate the public page", () => {
    const actions = read("src/app/admin/vendors/actions.ts");
    // updateVendor's save path revalidates /vendor-delivery (the bug fix).
    const updateBlock = actions.slice(
      actions.indexOf("export async function updateVendor"),
      actions.indexOf("export async function updateBrand"),
    );
    expect(updateBlock).toContain('revalidatePath("/vendor-delivery")');
    expect(actions).toContain('if (assign && entityType === "vendor") revalidatePath("/vendor-delivery")');
  });
});
