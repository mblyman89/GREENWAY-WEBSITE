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
 * Verified nullability rules honored (Leafly rules re-derived in slice L-2
 * directly from docs/leafly-specs/schemas/v2-items.json, because the previous
 * set was written against field names Leafly does not define):
 *  - Leafly `strain` and `imageUrl` are ["string","null"] => suppression is an
 *    explicit null. For `strain`, null is the documented "no strain" signal and
 *    is NEVER the string "NA". For `imageUrl`, the schema states that null or
 *    omission "will remove any existing image", so null is the correct way to
 *    honour the owner's images-off toggle.
 *  - Leafly `description` is a NON-nullable string, and `total_thc`/`total_cbd`
 *    are NON-nullable objects => suppression must OMIT the key. Nulling them is
 *    a schema violation, not a softer form of removal.
 *  - Leafly `compounds` is an array => suppression empties it.
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

/**
 * Apply the owner's field toggles to Leafly v2 items (returns new objects).
 *
 * SLICE L-2 REPAIR. Every line of the previous version was wrong, in four
 * distinct ways, all verified against `docs/leafly-specs/schemas/v2-items.json`:
 *
 *  1. WRONG FIELD NAMES. It wrote `strainName` and `totalThc`/`totalCbd`. The
 *     schema's properties are `strain`, `total_thc` and `total_cbd`. Toggling
 *     a field off therefore nulled a property Leafly has never heard of and
 *     left the real one transmitting at full strength -- the toggle did the
 *     exact opposite of nothing: it added junk AND failed to suppress.
 *
 *  2. NULL WHERE NULL IS ILLEGAL. `description` is declared `type: "string"`,
 *     with no `"null"` in the union, so `description: null` is a schema
 *     violation. The suppression has to OMIT the key, not null it. Same for
 *     `total_thc`/`total_cbd`, which are `type: "object"` with
 *     `required: ["content","unit"]` -- there is no legal null form of those
 *     either.
 *
 *  3. NULL WHERE NULL IS CORRECT. `strain` really is `["string","null"]`, and
 *     L-1 established that absent means null and never the string "NA". So
 *     `strain` is the one field the old code nulled for the right reason.
 *
 *  4. THE `sendImages` NO-OP. The old comment read "Leafly v2 items have no
 *     image field -- sendImages is a no-op here by design." That is false.
 *     `imageUrl` exists, and the schema is explicit about what suppression
 *     means: "If this field is omitted or null, any existing image will be
 *     removed." So the owner's image toggle was silently dead: turning images
 *     OFF kept publishing them. It is now honoured, and honoured as an
 *     explicit `null` rather than a bare omission, because null and omission
 *     mean the same thing to Leafly here and the explicit form makes the
 *     intent auditable in the payload we log.
 *
 * This layer still only ever REMOVES enrichment. It never invents a value and
 * never touches a required field (id, type, name, variants).
 */
export function applyLeaflySettings(items: LeaflyItem[], toggles: FieldToggles): LeaflyItem[] {
  return items.map((item) => {
    const out: LeaflyItem = { ...item };

    // `description` is a non-nullable string in the schema -> omit the key.
    if (!toggles.sendDescriptions) delete out.description;

    // `strain` IS nullable, and null is the documented "no strain" signal.
    if (!toggles.sendStrains) out.strain = null;

    if (!toggles.sendCannabinoids) {
      // An empty array is legal for `compounds` (it is `type: "array"`).
      out.compounds = [];
      // The totals are non-nullable objects -> omit, never null.
      delete out.total_thc;
      delete out.total_cbd;
    }

    // `imageUrl` is nullable and null means "remove the existing image",
    // which is precisely what the owner turning images off should mean.
    if (!toggles.sendImages) out.imageUrl = null;

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

  // SLICE L-2: this fixture is schema-shaped. The previous one used field
  // names (`brandName`, `strainName`, `totalThc`, variant `label`) and a
  // compound shape (`value` instead of `content`, unit "%") that Leafly does
  // not define, so the suite proved the toggles worked on an item that could
  // never have existed on the wire.
  const leaflyItem: LeaflyItem = {
    id: "p1",
    name: "Blue Dream 3.5g",
    type: "Flower",
    brand: "Acme",
    strain: "Blue Dream",
    description: "Nice.",
    compounds: [{ type: "thc", content: 21.4, unit: "percent" }],
    total_thc: { content: 21.4, unit: "percent" },
    total_cbd: { content: null, unit: "percent" },
    imageUrl: "https://cdn.example.com/p1.jpg",
    variants: [
      { id: "v1", medical: false, price: 3500, amount: 3.5, unit: "g", inventoryLevel: 4 },
    ],
  };

  // All-on: unchanged content, new object.
  const lOn = applyLeaflySettings([leaflyItem], allOn);
  ok("leafly all-on unchanged", JSON.stringify(lOn[0]) === JSON.stringify(leaflyItem));
  ok("leafly returns new objects", lOn[0] !== leaflyItem);

  // All-off: enrichment suppressed per VERIFIED nullability -- omit where the
  // schema forbids null, null where the schema defines null as the signal.
  const lOff = applyLeaflySettings([leaflyItem], allOff)[0];
  ok("leafly desc OMITTED (non-nullable string)", !("description" in lOff));
  ok("leafly strain nulled (nullable; never 'NA')", lOff.strain === null);
  ok("leafly compounds emptied", (lOff.compounds ?? []).length === 0);
  ok(
    "leafly totals OMITTED (non-nullable objects)",
    !("total_thc" in lOff) && !("total_cbd" in lOff),
  );
  ok("leafly imageUrl nulled (removes existing image)", lOff.imageUrl === null);
  ok("leafly brand untouched", lOff.brand === "Acme");
  ok(
    "leafly required fields intact",
    lOff.id === "p1" &&
      lOff.name === "Blue Dream 3.5g" &&
      lOff.type === "Flower" &&
      lOff.variants.length === 1,
  );
  ok(
    "leafly source not mutated",
    leaflyItem.description === "Nice." && (leaflyItem.compounds ?? []).length === 1,
  );

  // The toggles must be INDEPENDENT. The old images toggle was dead code, so
  // this asserts specifically that turning images off touches images ONLY.
  const lImgOff = applyLeaflySettings([leaflyItem], { ...allOn, sendImages: false })[0];
  ok(
    "leafly only image removed",
    lImgOff.imageUrl === null &&
      lImgOff.strain === "Blue Dream" &&
      lImgOff.description === "Nice." &&
      lImgOff.total_thc?.content === 21.4,
  );
  const lStrainOff = applyLeaflySettings([leaflyItem], { ...allOn, sendStrains: false })[0];
  ok(
    "leafly only strain removed",
    lStrainOff.strain === null && lStrainOff.imageUrl === "https://cdn.example.com/p1.jpg",
  );
  const lCannOff = applyLeaflySettings([leaflyItem], { ...allOn, sendCannabinoids: false })[0];
  ok(
    "leafly only cannabinoids removed",
    (lCannOff.compounds ?? []).length === 0 &&
      !("total_thc" in lCannOff) &&
      lCannOff.description === "Nice.",
  );

  // Fields Leafly does not define must NEVER appear, whatever the toggles.
  // This is the assertion that would have caught the original defect.
  for (const toggles of [allOn, allOff]) {
    const json = JSON.stringify(applyLeaflySettings([leaflyItem], toggles));
    for (const dead of ["strainName", "brandName", "totalThc", "totalCbd", "label", "value"]) {
      ok(`leafly output never contains "${dead}"`, !json.includes(`"${dead}"`));
    }
  }

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
