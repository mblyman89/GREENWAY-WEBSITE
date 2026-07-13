/**
 * src/lib/syndication/apply-settings-core.ts  (Task X)
 *
 * PURE application of the owner's transmission toggles (sync-settings-core)
 * to the ALREADY-BUILT channel payload items. No DB, no network — the
 * builders stay verified-schema-exact, and this layer only ever REMOVES
 * optional enrichment fields the owner turned off. It never invents data and
 * never touches required fields (ids, names, prices, variants, categories,
 * published, inventory).
 *
 * Verified nullability rules honored:
 *  - Leafly: strain/cannabinoid absent => null, NEVER "NA"/0 — so disabling
 *    strains sets strainName to null and disabling cannabinoids empties
 *    compounds + nulls totalThc/totalCbd.
 *  - Weedmaps: optional keys are OMITTED entirely (the builder already omits
 *    absent ones), so disabling a toggle deletes the key.
 */
import type { LeaflyItem } from "@/lib/leafly/payload-core";
import type { WmMenuItem } from "@/lib/weedmaps/payload-core";
import type { ChannelSyncSettings } from "./sync-settings-core";

/** Toggle subset both channels share. */
type FieldToggles = Pick<
  ChannelSyncSettings,
  "sendDescriptions" | "sendCannabinoids" | "sendImages" | "sendStrains"
>;

/** Apply the owner's field toggles to Leafly v2 items (returns new objects). */
export function applyLeaflySettings(items: LeaflyItem[], toggles: FieldToggles): LeaflyItem[] {
  return items.map((item) => {
    const out: LeaflyItem = { ...item };
    if (!toggles.sendDescriptions) out.description = null;
    if (!toggles.sendStrains) out.strainName = null;
    if (!toggles.sendCannabinoids) {
      out.compounds = [];
      out.totalThc = null;
      out.totalCbd = null;
    }
    // Leafly v2 items have no image field — sendImages is a no-op here by design.
    return out;
  });
}

/** Apply the owner's field toggles to Weedmaps Request_MenuItem items (returns new objects). */
export function applyWeedmapsSettings(items: WmMenuItem[], toggles: FieldToggles): WmMenuItem[] {
  return items.map((item) => {
    const out: WmMenuItem = { ...item };
    if (!toggles.sendDescriptions) delete out.description;
    if (!toggles.sendStrains) {
      delete out.strain_name;
      delete out.genetics;
    }
    if (!toggles.sendCannabinoids) delete out.cannabinoids;
    if (!toggles.sendImages) delete out.image_url;
    return out;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
export function __runApplySettingsTests(): void {
  let passed = 0;
  let failed = 0;
  const ok = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL: ${label}`);
    }
  };

  const allOn: FieldToggles = {
    sendDescriptions: true,
    sendCannabinoids: true,
    sendImages: true,
    sendStrains: true,
  };
  const allOff: FieldToggles = {
    sendDescriptions: false,
    sendCannabinoids: false,
    sendImages: false,
    sendStrains: false,
  };

  const leaflyItem: LeaflyItem = {
    id: "p1",
    name: "Blue Dream 3.5g",
    brandName: "Acme",
    type: "flower",
    strainName: "Blue Dream",
    description: "Nice.",
    compounds: [{ type: "thc", unit: "%", value: 21.4 }],
    totalThc: { type: "thc", unit: "%", value: 21.4 },
    totalCbd: null,
    variants: [{ id: "v1", price: 3500, inventoryLevel: 4, medical: false, label: "3.5g" }],
  };

  // All-on: unchanged content, new object.
  const lOn = applyLeaflySettings([leaflyItem], allOn);
  ok("leafly all-on unchanged", JSON.stringify(lOn[0]) === JSON.stringify(leaflyItem));
  ok("leafly returns new objects", lOn[0] !== leaflyItem);

  // All-off: enrichment nulled per verified nullability, required fields intact.
  const lOff = applyLeaflySettings([leaflyItem], allOff)[0];
  ok("leafly desc nulled", lOff.description === null);
  ok("leafly strain nulled (never 'NA')", lOff.strainName === null);
  ok("leafly compounds emptied", lOff.compounds.length === 0);
  ok("leafly totals nulled", lOff.totalThc === null && lOff.totalCbd === null);
  ok("leafly brand untouched", lOff.brandName === "Acme");
  ok(
    "leafly required fields intact",
    lOff.id === "p1" && lOff.name === "Blue Dream 3.5g" && lOff.variants.length === 1,
  );
  ok("leafly source not mutated", leaflyItem.description === "Nice." && leaflyItem.compounds.length === 1);

  const wmItem: WmMenuItem = {
    external_id: "p1",
    name: "Blue Dream 3.5g",
    description: "Nice.",
    category_names: ["Flower"],
    brand_name: "Acme",
    strain_name: "Blue Dream",
    genetics: "hybrid",
    cannabinoids: [{ slug: "thc", percentage: { min: 21.4, max: 21.4 } }],
    image_url: "https://cdn.example.com/p1.jpg",
    published: true,
    variants: [
      {
        external_id: "v1",
        price: { amount: "35.00", currency: "USD" },
        weight: { unit: "g", value: 3.5 },
        inventory_quantity: 4,
      },
    ],
  };

  const wOn = applyWeedmapsSettings([wmItem], allOn);
  ok("wm all-on unchanged", JSON.stringify(wOn[0]) === JSON.stringify(wmItem));

  const wOff = applyWeedmapsSettings([wmItem], allOff)[0];
  ok("wm desc key omitted", !("description" in wOff));
  ok("wm strain key omitted", !("strain_name" in wOff));
  ok("wm genetics key omitted with strains", !("genetics" in wOff));
  ok("wm cannabinoids key omitted", !("cannabinoids" in wOff));
  ok("wm image key omitted", !("image_url" in wOff));
  ok("wm brand untouched", wOff.brand_name === "Acme");
  ok(
    "wm required fields intact",
    wOff.external_id === "p1" &&
      wOff.published === true &&
      wOff.category_names[0] === "Flower" &&
      wOff.variants[0].inventory_quantity === 4,
  );
  ok("wm source not mutated", "image_url" in wmItem && wmItem.description === "Nice.");

  // Single toggle: only images off keeps everything else.
  const wImgOff = applyWeedmapsSettings([wmItem], { ...allOn, sendImages: false })[0];
  ok("wm only image removed", !("image_url" in wImgOff) && wImgOff.strain_name === "Blue Dream");

  console.log(`apply-settings: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} apply-settings test(s) failed`);
}
