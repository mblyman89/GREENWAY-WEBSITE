/**
 * src/lib/menu/product-facts-overlay-core.ts  (R33, T-329)
 *
 * WHY THIS EXISTS. Since R30 every onboarded product carries its OWN lab
 * terpenes (catalog_product_drafts.attached_facts.terpenes, read off the
 * certificate - "limonene 0.51%", strongest first), and the admin shows them
 * on Product Onboarding and the lot page. The customer website never read
 * them: its terpene chips came ONLY from the strain library, matched by
 * strain NAME (strain-terpenes.ts). A product whose strain is in the library
 * showed pills; one whose strain is not showed none - even with a full lab
 * panel attached. That is the "some have the pills, others don't" report.
 *
 * Second job: a card whose strain type a PERSON set (menu_items
 * .fact_provenance.strain_type = "reviewer", stamped by the lot page's
 * correction and by onboarding approval) must not be overwritten at render
 * time by the library's type for the strain name. The menu read drops
 * fact_provenance (MENU_ITEM_DROPPED_COLUMNS), so the server overlay reads
 * the stamped ids separately and this core marks those items
 * strainTypeSource = "reviewer" (respected by attachStrainProfile).
 *
 * Rules, never guesses:
 *   - only a COUNTED attached fact (golden-record-core countedAttachedFact:
 *     record sources, or a banded source at >= 90%) may reach a customer;
 *   - a terpene entry is reduced to its NAME (the percent is dropped - the
 *     chips and the menu's terpene filter match plain lower-case names); a
 *     name the knowledge base knows is written as its KB slug (so lab
 *     "beta-myrcene" and the library's "myrcene" are ONE filter option);
 *     an unknown name is kept as the lab wrote it (it is real data);
 *   - de-duplicated, strongest first, at most TERPENE_PREVIEW_MAX;
 *   - newest approved draft wins per product key;
 *   - an item that already carries terpenes keeps them (explicit data wins);
 *   - an item matches by its id (= pos_product_key) or, for a mastered card,
 *     by one of its "<key>-onboarded" variants (variant-lot-core).
 *
 * Pure: plain data in, plain data out; self-tests run in the pure runner.
 */
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { countedAttachedFact } from "@/lib/catalog/golden-record-core";
import { kbTerpeneSlug } from "@/lib/inventory/coa-facts-core";
import { TERPENE_PREVIEW_MAX } from "@/lib/catalog/fact-chips-core";
import { lotKeyFromVariantId } from "@/lib/pos/variant-lot-core";

/** One approved draft's terpene fact, as the server read it. */
export type OverlayDraftRow = {
  pos_product_key: string | null;
  /** The draft's attached_facts (or just `{ terpenes }` when selected narrowly). */
  attached_facts: unknown;
  updated_at: string | null;
};

/** JSON-safe overlay (stored in the data cache as plain arrays). */
export type ProductFactsOverlay = {
  /** [pos_product_key, terpene names strongest first] */
  terpenes: [string, string[]][];
  /** menu item ids (source_item_id) whose strain type a person set. */
  reviewerStrain: string[];
};

export const EMPTY_PRODUCT_FACTS_OVERLAY: ProductFactsOverlay = { terpenes: [], reviewerStrain: [] };

/**
 * "limonene 0.51%" / "Beta-Myrcene" / "β-caryophyllene 1.2 %" -> the name a
 * chip shows and the filter matches. null when nothing usable is left.
 */
export function terpeneNameFromFact(entry: unknown): string | null {
  if (typeof entry !== "string") return null;
  const name = entry
    .replace(/\(?\s*[<>~]?\s*\d+(?:[.,]\d+)?\s*(?:%|ppm|mg\/g)\s*\)?/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!name || name.length > 60 || !/[a-zα-ω]/i.test(name)) return null;
  const slug = kbTerpeneSlug(name);
  return slug ?? name;
}

/** The counted lab terpenes of one draft's attached facts (names, strongest first). */
export function countedTerpeneNames(attachedFacts: unknown): string[] {
  const fact = countedAttachedFact(attachedFacts, "terpenes");
  if (!fact) return [];
  const raw = Array.isArray(fact.value)
    ? fact.value
    : typeof fact.value === "string"
      ? fact.value.split(/[,;]/)
      : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const name = terpeneNameFromFact(entry);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= TERPENE_PREVIEW_MAX) break;
  }
  return out;
}

/** Build the overlay from approved drafts + reviewer-stamped card ids. */
export function buildProductFactsOverlay(
  drafts: readonly OverlayDraftRow[],
  reviewerStrainIds: readonly (string | null | undefined)[],
): ProductFactsOverlay {
  // Newest first, so the first draft seen for a key is the one that wins.
  const sorted = [...drafts].sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
  const terps = new Map<string, string[]>();
  for (const d of sorted) {
    const key = String(d.pos_product_key ?? "").trim();
    if (!key || terps.has(key)) continue;
    const names = countedTerpeneNames(d.attached_facts);
    if (names.length > 0) terps.set(key, names);
  }
  const reviewer = [...new Set(reviewerStrainIds.map((s) => String(s ?? "").trim()).filter(Boolean))];
  return { terpenes: [...terps.entries()], reviewerStrain: reviewer };
}

/** Product key candidates for an item: its own id, then its onboarded variants' lot keys. */
function itemKeys(item: GreenwayMenuItem): string[] {
  const keys = [item.id];
  for (const v of item.variants ?? []) {
    const k = lotKeyFromVariantId(v.id);
    if (k && !keys.includes(k)) keys.push(k);
  }
  return keys;
}

/**
 * Apply the overlay. Returns a NEW array; untouched items are referentially
 * identical. Never removes data: terpenes only fill an EMPTY list.
 */
export function applyProductFactsOverlay(
  items: GreenwayMenuItem[],
  overlay: ProductFactsOverlay | null | undefined,
): GreenwayMenuItem[] {
  if (!overlay || (overlay.terpenes.length === 0 && overlay.reviewerStrain.length === 0)) return items;
  const terps = new Map(overlay.terpenes);
  const reviewer = new Set(overlay.reviewerStrain);
  return items.map((item) => {
    let next: GreenwayMenuItem | null = null;
    if (!(item.terpenes && item.terpenes.length > 0) && terps.size > 0) {
      for (const k of itemKeys(item)) {
        const t = terps.get(k);
        if (t && t.length > 0) {
          next = { ...item, terpenes: [...t] };
          break;
        }
      }
    }
    if (reviewer.has(item.id) && item.strainTypeSource !== "reviewer") {
      next = { ...(next ?? item), strainTypeSource: "reviewer" };
    }
    return next ?? item;
  });
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------
export function __runProductFactsOverlayCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL product-facts-overlay-core: " + msg);
    }
  };
  const eq = (a: unknown, b: unknown, msg: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`);

  // terpeneNameFromFact
  eq(terpeneNameFromFact("limonene 0.51%"), "limonene", "percent dropped");
  eq(terpeneNameFromFact("Beta-Myrcene 1.2 %"), "myrcene", "KB slug for beta-myrcene");
  eq(terpeneNameFromFact("β-caryophyllene"), "caryophyllene", "greek beta -> KB slug");
  eq(terpeneNameFromFact("alpha-pinene 0.1%"), "pinene", "alpha-pinene -> pinene");
  eq(terpeneNameFromFact("guaiol 0.05%"), "guaiol", "unknown name kept as written (real data)");
  eq(terpeneNameFromFact("Linalool (850 ppm)"), "linalool", "ppm form handled");
  eq(terpeneNameFromFact("0.5%"), null, "a bare number is not a terpene");
  eq(terpeneNameFromFact(""), null, "empty -> null");
  eq(terpeneNameFromFact(42), null, "non-string -> null");
  eq(terpeneNameFromFact("x".repeat(80)), null, "absurdly long -> null");

  // countedTerpeneNames - golden-record gate
  const coa = { terpenes: { value: ["limonene 0.51%", "beta-myrcene 0.4%", "d-limonene 0.1%"], source: "coa", confidence: null } };
  eq(countedTerpeneNames(coa), ["limonene", "myrcene"], "COA counted; d-limonene folds into limonene (dedupe)");
  const human = { terpenes: { value: "Terpinolene, Ocimene", source: "human", confidence: null } };
  eq(countedTerpeneNames(human), ["terpinolene", "ocimene"], "human comma string counted");
  const lowGem = { terpenes: { value: ["myrcene"], source: "gemini", confidence: 0.6 } };
  eq(countedTerpeneNames(lowGem), [], "banded source below 90% never reaches a customer");
  const hiGem = { terpenes: { value: ["myrcene"], source: "gemini", confidence: 0.95 } };
  eq(countedTerpeneNames(hiGem), ["myrcene"], "banded source at >= 90% counts");
  const remembered = { terpenes: { value: ["myrcene"], source: "remembered", confidence: null } };
  eq(countedTerpeneNames(remembered), [], "remembered is pre-fill only");
  eq(countedTerpeneNames(null), [], "no facts -> []");
  eq(countedTerpeneNames({ potency: { value: "20%", source: "coa", confidence: null } }), [], "no terpene fact -> []");
  const many = { terpenes: { value: ["myrcene", "limonene", "caryophyllene", "linalool", "humulene", "pinene", "terpinolene", "ocimene"], source: "coa", confidence: null } };
  eq(countedTerpeneNames(many).length, TERPENE_PREVIEW_MAX, "capped at TERPENE_PREVIEW_MAX");

  // buildProductFactsOverlay
  const ov = buildProductFactsOverlay(
    [
      { pos_product_key: "K1", attached_facts: { terpenes: { value: ["limonene"], source: "coa", confidence: null } }, updated_at: "2026-01-01" },
      { pos_product_key: "K1", attached_facts: { terpenes: { value: ["myrcene"], source: "coa", confidence: null } }, updated_at: "2026-03-01" },
      { pos_product_key: " ", attached_facts: coa, updated_at: "2026-03-01" },
      { pos_product_key: "K2", attached_facts: lowGem, updated_at: "2026-03-01" },
      { pos_product_key: "K3", attached_facts: coa, updated_at: null },
    ],
    ["C1", "C1", null, " "],
  );
  eq(ov.terpenes, [["K1", ["myrcene"]], ["K3", ["limonene", "myrcene"]]], "newest draft wins; blank key + uncounted skipped");
  eq(ov.reviewerStrain, ["C1"], "reviewer ids de-duplicated, blanks dropped");
  const ovNewerEmpty = buildProductFactsOverlay(
    [
      { pos_product_key: "K1", attached_facts: { terpenes: { value: ["limonene"], source: "coa", confidence: null } }, updated_at: "2026-01-01" },
      { pos_product_key: "K1", attached_facts: null, updated_at: "2026-05-01" },
    ],
    [],
  );
  eq(ovNewerEmpty.terpenes, [["K1", ["limonene"]]], "a newer draft WITHOUT terpenes does not hide an older counted panel");

  // applyProductFactsOverlay
  const base = { id: "K1", name: "A", variants: [{ id: "K1" }] } as unknown as GreenwayMenuItem;
  const items = [base];
  ok(applyProductFactsOverlay(items, EMPTY_PRODUCT_FACTS_OVERLAY) === items, "empty overlay -> identity");
  ok(applyProductFactsOverlay(items, null) === items, "null overlay -> identity");
  const filled = applyProductFactsOverlay(items, ov);
  eq(filled[0].terpenes, ["myrcene"], "own lab terpenes attached");
  ok(filled[0] !== base && base.terpenes === undefined, "input never mutated");
  const has = { ...base, terpenes: ["pinene"] } as GreenwayMenuItem;
  ok(applyProductFactsOverlay([has], ov)[0] === has, "existing terpenes win (explicit data)");
  const mastered = { id: "MASTER", name: "M", variants: [{ id: "MASTER" }, { id: "K3-onboarded" }] } as unknown as GreenwayMenuItem;
  eq(applyProductFactsOverlay([mastered], ov)[0].terpenes, ["limonene", "myrcene"], "mastered card matched by its onboarded variant");
  const other = { id: "ZZ", name: "Z", variants: [{ id: "ZZ" }] } as unknown as GreenwayMenuItem;
  ok(applyProductFactsOverlay([other], ov)[0] === other, "unrelated item untouched");
  const rev = { id: "C1", name: "C", variants: [] } as unknown as GreenwayMenuItem;
  eq(applyProductFactsOverlay([rev], ov)[0].strainTypeSource, "reviewer", "reviewer stamp marks the item");
  const revAlready = { ...rev, strainTypeSource: "reviewer" } as GreenwayMenuItem;
  ok(applyProductFactsOverlay([revAlready], ov)[0] === revAlready, "already marked -> identity");
  const both = applyProductFactsOverlay(
    [{ id: "K1", name: "A", variants: [] } as unknown as GreenwayMenuItem],
    { terpenes: [["K1", ["myrcene"]]], reviewerStrain: ["K1"] },
  )[0];
  ok(both.strainTypeSource === "reviewer" && both.terpenes?.[0] === "myrcene", "terpenes + reviewer on one item");
  const shared = applyProductFactsOverlay([base], ov)[0];
  shared.terpenes?.push("mutated");
  eq(buildProductFactsOverlay([{ pos_product_key: "K1", attached_facts: { terpenes: { value: ["myrcene"], source: "coa", confidence: null } }, updated_at: "1" }], []).terpenes[0][1], ["myrcene"], "fresh arrays (no shared mutation)");
  eq(ov.terpenes[0][1], ["myrcene"], "overlay arrays not aliased into items");

  console.log(`product-facts-overlay-core self-tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
