/**
 * tests/compliance/leafly-full-menu-push.test.ts  (TASK I)
 *
 * THE FIELD REPORT THIS EXISTS BECAUSE OF.
 *
 * The owner's first full-menu push to Leafly failed. Not partially — nothing
 * was sent at all. The report read:
 *
 *   "Leafly payload failed validation with 128 error(s):
 *    items[55].compounds[0].content: `content` is 1000 with unit "percent".
 *    A potency above 100% is impossible; this is almost always a mg value in
 *    a percent field. | … | items[101].variants: 2 sizes of this item are all
 *    described to Leafly as "1 each" … | …and 123 more"
 *
 * Two separate defects, and a third one hiding behind them:
 *
 *   1. A milligram figure saved against a product whose Leafly type reports
 *      potency as a PERCENTAGE. The builder parsed the digits and threw the
 *      word "mg" away, producing a claim of 1000% THC.
 *   2. Two sizes of one product that Leafly can only describe as "1 each",
 *      which Leafly would silently collapse into one. Genuine source-data
 *      ambiguity; correctly refused.
 *   3. ALL-OR-NOTHING. A handful of bad records kept the ENTIRE menu off
 *      Leafly, because the pre-send check throws rather than filters.
 *
 * Nothing wrong ever reached Leafly — our own pre-flight caught all of it,
 * which is the system working. But the owner was left with no menu and a wall
 * of 128 messages, which is the system failing him anyway.
 *
 * WHAT THESE TESTS PROTECT.
 *
 * Several are WIRING GUARDS: they read source and assert a call is present or
 * absent. A behavioural test cannot catch "somebody stopped calling this",
 * and every defect above was a wiring defect before it was a logic defect.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  POTENCY_EXAMPLE_LIMIT,
  __runLeaflyPotencyTests,
  describePotencyRefusal,
  describePotencySummary,
  describeRefusalRecord,
  firstNumberIn,
  readPotency,
  statedUnitOf,
  summarizePotencyRefusals,
  type PotencyRefusalRecord,
} from "@/lib/leafly/potency-core";
import {
  INVALID_ITEM_POLICIES,
  QUARANTINE_MAX_SHARE_PERCENT,
  __runLeaflyQuarantineTests,
  decideQuarantine,
  describeQuarantine,
  describeQuarantinedItems,
  isInvalidItemPolicy,
} from "@/lib/leafly/quarantine-core";
import {
  MAX_DELETE_IDS,
  MAX_DELETE_ID_LENGTH,
  __runLeaflyDeleteRequestTests,
  describeDeleteOutcome,
  describeDeleteProblems,
  describeUnknownDeleteIds,
  parseDeleteIds,
  reconcileDeleteRequest,
} from "@/lib/leafly/delete-request-core";
import { collectPotencyRefusals, toCompound } from "@/lib/leafly/payload-core";
import { DEFAULT_LEAFLY_SETTINGS, resolveLeaflySettings } from "@/lib/syndication/sync-settings-core";
import type { SyndicationItem } from "@/lib/syndication/menu-feed-core";

const ROOT = process.cwd();
const POTENCY = join(ROOT, "src/lib/leafly/potency-core.ts");
const QUARANTINE = join(ROOT, "src/lib/leafly/quarantine-core.ts");
const DELETE_CORE = join(ROOT, "src/lib/leafly/delete-request-core.ts");
const PAYLOAD = join(ROOT, "src/lib/leafly/payload-core.ts");
const PUSH = join(ROOT, "src/lib/leafly/push.ts");
const ACTIONS = join(ROOT, "src/app/admin/integrations/leafly/actions.ts");
const CLIENT = join(ROOT, "src/app/admin/integrations/leafly/leafly-client.tsx");
const PAGE = join(ROOT, "src/app/admin/integrations/leafly/page.tsx");
const SETTINGS_PANEL = join(ROOT, "src/components/admin/syndication/SyncSettingsPanel.tsx");
const SELFTEST_RUNNER = join(ROOT, "scripts/compliance/run-pure-selftests.ts");

const read = (p: string) => readFileSync(p, "utf8");

/**
 * Source with comments stripped.
 *
 * Every wiring guard below must use this. The comments in these files quote
 * the failure they prevent — including the literal strings being searched for
 * — so a guard reading raw text would pass or fail on prose rather than code.
 */
function readCode(p: string): string {
  return read(p)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(?<!:)\/\/[^\n]*/g, " ");
}

function item(over: Partial<SyndicationItem> & { id: string }): SyndicationItem {
  return {
    id: over.id,
    name: over.name ?? `Item ${over.id}`,
    brand: over.brand ?? "Acme",
    category: over.category ?? "flower",
    strainType: over.strainType ?? "hybrid",
    strainName: over.strainName ?? null,
    thc: over.thc ?? "20%",
    cbd: over.cbd ?? null,
    description: over.description ?? "Text.",
    priceMinorUnits: over.priceMinorUnits ?? 3500,
    inStock: over.inStock ?? true,
    variants: over.variants ?? [
      { id: `${over.id}-v`, label: "3.5g", priceMinorUnits: 3500, inStock: true, inventoryLevel: 3 },
    ],
    imageUrl: over.imageUrl,
    dohCategory: over.dohCategory,
  };
}

// ===========================================================================
// 1. THE REPORTED BUG, REPRODUCED AND FIXED
// ===========================================================================

describe("TASK I — the 1000% THC bug", () => {
  it("REGRESSION: a mg value on a percent-unit type no longer becomes a percentage", () => {
    // This is the exact shape of the owner's items[55]. Before the fix this
    // returned { content: 1000, unit: "percent" } — a 1000% THC claim next to
    // a regulated product.
    const c = toCompound("thc", "1000mg", "Flower");
    expect(c).not.toBeNull();
    expect(c?.content).toBeNull();
    expect(c?.unit).toBe("percent");
  });

  it("REGRESSION: every spelling of the same mistake is caught, not just the one reported", () => {
    // The owner's data had one spelling. Fixing only that spelling would be
    // fixing the report rather than the bug.
    for (const raw of ["1000mg", "1000 mg", "1000MG", "1000 MG", "1,000mg", "1000mg THC", "THC 1000mg"]) {
      const c = toCompound("thc", raw, "Flower");
      expect(c?.content, `${raw} must not publish a number`).toBeNull();
    }
  });

  it("does NOT refuse legitimate percentages — the fix must not cost real data", () => {
    // The failure mode of an over-eager fix is a menu with no potency on it at
    // all, which is worse than the bug for every product that was fine.
    for (const [raw, expected] of [["22%", 22], ["22", 22], ["0%", 0], ["0", 0], ["30.5%", 30.5], ["100%", 100]] as const) {
      const c = toCompound("thc", raw, "Flower");
      expect(c?.content, `${raw} must survive`).toBe(expected);
      expect(c?.unit).toBe("percent");
    }
  });

  it("does NOT refuse legitimate milligrams on an edible", () => {
    for (const [raw, expected] of [["1000mg", 1000], ["100mg", 100], ["10 mg", 10], ["5", 5]] as const) {
      const c = toCompound("thc", raw, "Edible");
      expect(c?.content, `${raw} on an edible must survive`).toBe(expected);
      expect(c?.unit).toBe("mg");
    }
  });

  it("catches the MIRROR of the reported bug — a percentage on an mg type", () => {
    // Nobody reported this one. It is the same defect with the units swapped,
    // and an edible labelled "22%" would have published as 22mg: a real
    // number, plausible-looking, and wrong by a factor of forty.
    const c = toCompound("thc", "22%", "Edible");
    expect(c?.content).toBeNull();
    expect(c?.unit).toBe("mg");
  });

  it("sends null rather than 0 for an unusable reading — Leafly asks for exactly this", () => {
    // Leafly's spec: "If cannabinoid information is absent the value null
    // should be submitted rather than 0. Transmitting 0 results in a display
    // of '0mg' to shoppers rather than the preferable 'unknown'." A 0 here
    // would tell every shopper the product has no THC in it.
    const c = toCompound("thc", "1000mg", "Flower");
    expect(c?.content).not.toBe(0);
    expect(c?.content).toBeNull();
  });

  it("REGRESSION: a thousands comma is not silently truncated", () => {
    // Found by the core's own self-test, not by review. The first version used
    // a \b lookahead, which does not match between "0" and "m" because both
    // are word characters — so "1,000mg" parsed as 1. On an edible, where mg
    // is legitimate, a 1000mg product would have published as 1mg.
    expect(firstNumberIn("1,000mg")).toBe(1000);
    expect(firstNumberIn("1,000")).toBe(1000);
    expect(firstNumberIn("12,345")).toBe(12345);
    // And the other direction must still hold: "1,5" is not 15.
    expect(firstNumberIn("1,5")).toBe(1);
  });

  it("reads the stated unit out of the text instead of assuming the type is right", () => {
    expect(statedUnitOf("1000mg")).toBe("mg");
    expect(statedUnitOf("22%")).toBe("percent");
    expect(statedUnitOf("22")).toBe("none");
  });

  it("a bare number is trusted to the type, but still cannot exceed 100%", () => {
    // "1000" with no unit on a Flower item is not evidence of a mg value, so
    // we cannot call it a unit mismatch. It is still impossible as a
    // percentage, and must be refused on that ground instead.
    const r = readPotency("1000", "percent");
    expect(r.content).toBeNull();
    expect(r.refusal).toBe("percent_above_100");
  });

  it("refuses negatives", () => {
    expect(readPotency("-5", "percent").content).toBeNull();
    expect(readPotency("-5", "mg").content).toBeNull();
  });

  it("treats absent and blank as honestly unknown, NOT as an error", () => {
    // A product that was never lab-tested is not a data defect, and reporting
    // it as one would bury the real defects in noise.
    for (const raw of [null, undefined, "", "   "]) {
      const r = readPotency(raw, "percent");
      expect(r.content).toBeNull();
      expect(r.refusal).toBeNull();
    }
  });
});

describe("TASK I — telling the owner which products are wrong", () => {
  it("names the product, the field and the exact saved text", () => {
    // A count is not actionable. "Blue Dream 1g says 1000mg" is.
    const refusals = collectPotencyRefusals(
      item({ id: "p1", name: "Blue Dream 1g", category: "flower", thc: "1000mg", cbd: "1000mg" }),
    );
    expect(refusals).toHaveLength(2);
    expect(refusals.map((r) => r.field).sort()).toEqual(["cbd", "thc"]);
    for (const r of refusals) {
      expect(r.productName).toBe("Blue Dream 1g");
      expect(r.raw).toBe("1000mg");
      expect(r.refusal).toBe("unit_mismatch");
      expect(r.expected).toBe("percent");
      expect(r.stated).toBe("mg");
    }
  });

  it("says nothing about a clean product", () => {
    expect(collectPotencyRefusals(item({ id: "ok", thc: "22%", cbd: "1%" }))).toEqual([]);
  });

  it("the record carries the unit LEAFLY expects for that product type, not a constant", () => {
    // MUTATION-FOUND (M14 SURVIVED). Hard-coding `expected: "percent"` in the
    // collector passed every test in this file, because every case tested
    // happened to be a percent type. The consequence is not cosmetic: the
    // record's unit is what the on-screen sentence is built from, so an edible
    // with a bad reading would have been explained to the owner in percentage
    // terms and he would have "fixed" correct data.
    const edible = collectPotencyRefusals(
      item({ id: "e1", name: "Gummies 100mg", category: "edible-solid", thc: "22%" }),
    );
    expect(edible).toHaveLength(1);
    expect(edible[0].expected).toBe("mg");
    expect(edible[0].stated).toBe("percent");
    // …and the sentence the owner reads must follow from it.
    expect(describeRefusalRecord(edible[0])).toContain("milligrams");

    const flower = collectPotencyRefusals(
      item({ id: "f1", name: "Blue Dream", category: "flower", thc: "1000mg" }),
    );
    expect(flower[0].expected).toBe("percent");
    expect(describeRefusalRecord(flower[0])).toContain("percentage");

    // The two must not produce the same words, which is the assertion a
    // hard-coded unit fails.
    expect(describeRefusalRecord(edible[0])).not.toBe(describeRefusalRecord(flower[0]));
  });

  it("says nothing about product types where Leafly ignores cannabinoids", () => {
    // Accessories have no potency. Flagging them would be noise the owner
    // cannot act on, and noise is how a real warning gets ignored.
    expect(collectPotencyRefusals(item({ id: "a", category: "accessories", thc: "1000mg" }))).toEqual([]);
  });

  it("the sentence shown on screen matches the sentence the payload logic produced", () => {
    // Two code paths producing two different explanations of one decision is
    // how a screen ends up contradicting the data it describes.
    const record: PotencyRefusalRecord = {
      productId: "p1",
      productName: "Blue Dream 1g",
      field: "thc",
      raw: "1000mg",
      refusal: "unit_mismatch",
      expected: "percent",
      stated: "mg",
    };
    expect(describeRefusalRecord(record)).toBe(
      describePotencyRefusal(
        { content: null, unit: "percent", refusal: "unit_mismatch", stated: "mg" },
        { productName: "Blue Dream 1g", raw: "1000mg" },
      ),
    );
  });

  it("the sentence never renders the word null to a human", () => {
    for (const refusal of ["unit_mismatch", "percent_above_100", "negative", "unreadable"] as const) {
      const text = describeRefusalRecord({
        productId: "p",
        productName: "Thing",
        field: "thc",
        raw: "x",
        refusal,
        expected: "percent",
        stated: "none",
      });
      expect(text.toLowerCase()).not.toContain("null");
      expect(text.length).toBeGreaterThan(20);
    }
  });

  it("the summary counts DISTINCT products, because that is what has to be fixed", () => {
    const rec = (id: string): PotencyRefusalRecord => ({
      productId: id,
      productName: `P${id}`,
      field: "thc",
      raw: "1000mg",
      refusal: "unit_mismatch",
      expected: "percent",
      stated: "mg",
    });
    // Same product, both fields wrong = one product to go and edit.
    const s = summarizePotencyRefusals([rec("a"), rec("a"), rec("b")]);
    expect(s.total).toBe(3);
    expect(s.productCount).toBe(2);
  });

  it("the summary stays silent when there is nothing wrong", () => {
    expect(describePotencySummary(summarizePotencyRefusals([]))).toBeNull();
  });

  it("examples are bounded so a log line stays readable", () => {
    const many = summarizePotencyRefusals(
      Array.from({ length: 200 }, (_, i) => ({
        productId: `p${i}`,
        productName: `P${i}`,
        field: "thc",
        raw: "1000mg",
        refusal: "unit_mismatch" as const,
        expected: "percent" as const,
        stated: "mg" as const,
      })),
    );
    expect(many.examples).toHaveLength(POTENCY_EXAMPLE_LIMIT);
    expect(many.total).toBe(200);
  });
});

// ===========================================================================
// 2. NOT LOSING THE WHOLE MENU OVER A FEW BAD RECORDS
// ===========================================================================

describe("TASK I — quarantine instead of all-or-nothing", () => {
  const issue = (itemId: string | null) => ({
    code: "content_percent_over_100",
    message: "`content` is 1000 with unit \"percent\".",
    path: itemId === null ? "items" : `items[0].compounds[0].content`,
    itemId,
    severity: "error" as const,
  });
  const items = Array.from({ length: 100 }, (_, i) => ({ id: `i${i}`, name: `Item ${i}` }));

  it("blocks by default — an owner who has never seen the setting gets the old behaviour", () => {
    // A partial menu that nobody asked for is worse than a visible failure.
    expect(DEFAULT_LEAFLY_SETTINGS.invalidItemPolicy).toBe("block");
    const d = decideQuarantine({ items, issues: [issue("i0")], policy: "block" });
    expect(d.proceed).toBe(false);
    expect(d.blockedReason).toBe("policy_block");
  });

  it("with quarantine on, 2 bad items no longer cost 98 good ones", () => {
    // This is the owner's actual situation, scaled down.
    const d = decideQuarantine({ items, issues: [issue("i0"), issue("i1")], policy: "quarantine" });
    expect(d.proceed).toBe(true);
    expect(d.keptItemIds).toHaveLength(98);
    expect(d.keptItemIds).not.toContain("i0");
    expect(d.keptItemIds).not.toContain("i1");
  });

  it("still refuses when the failure rate says the fault is OURS, not the data's", () => {
    // The original all-or-nothing comment was right about one thing: a broken
    // BUILDER fails across many items at once, and quietly skipping them would
    // hide it. That protection has to survive the feature that relaxes it.
    const manyBad = Array.from({ length: 30 }, (_, i) => issue(`i${i}`));
    const d = decideQuarantine({ items, issues: manyBad, policy: "quarantine" });
    expect(d.proceed).toBe(false);
    expect(d.blockedReason).toBe("too_widespread");
  });

  it("the systematic-failure ceiling is a real threshold, tested on both sides", () => {
    // Just under: proceed. At the line: refuse. A ceiling nobody tests at the
    // boundary is a ceiling that can drift by one and never be noticed.
    const under = Array.from({ length: QUARANTINE_MAX_SHARE_PERCENT - 1 }, (_, i) => issue(`i${i}`));
    expect(decideQuarantine({ items, issues: under, policy: "quarantine" }).proceed).toBe(true);
    const at = Array.from({ length: QUARANTINE_MAX_SHARE_PERCENT }, (_, i) => issue(`i${i}`));
    expect(decideQuarantine({ items, issues: at, policy: "quarantine" }).proceed).toBe(false);
  });

  it("refuses when an error cannot be pinned to any item", () => {
    // If we cannot say WHICH item is at fault we cannot remove it, and
    // proceeding would send a payload we know is invalid.
    const d = decideQuarantine({ items, issues: [issue(null)], policy: "quarantine" });
    expect(d.proceed).toBe(false);
    expect(d.blockedReason).toBe("too_widespread");
  });

  it("refuses when nothing would be left to send", () => {
    const d = decideQuarantine({
      items: [{ id: "a", name: "A" }],
      issues: [issue("a")],
      policy: "quarantine",
    });
    expect(d.proceed).toBe(false);
    expect(d.blockedReason).toBe("nothing_left");
  });

  it("a clean payload proceeds untouched under BOTH policies", () => {
    for (const policy of INVALID_ITEM_POLICIES) {
      const d = decideQuarantine({ items, issues: [], policy });
      expect(d.proceed).toBe(true);
      expect(d.keptItemIds).toHaveLength(100);
      // And says nothing, so a clean sync reads exactly as it always has.
      expect(describeQuarantine(d)).toBeNull();
    }
  });

  it("a quarantine is always REPORTED — a silent one is the failure mode itself", () => {
    // Items quietly missing from a live menu for months, with every sync
    // reporting success, is strictly worse than the bug this feature fixes.
    const d = decideQuarantine({ items, issues: [issue("i0")], policy: "quarantine" });
    const note = describeQuarantine(d);
    expect(note).not.toBeNull();
    expect(note).toContain("99 products were sent");
    expect(note).toContain("held back");
  });

  it("the held-back products are NAMED, not just counted", () => {
    // TEST-FOUND DEFECT. The headline ends "fix the few BELOW", and for a
    // while there was no below: describeQuarantinedItems existed with no
    // caller anywhere, so the push message pointed at a list that was never
    // rendered. A report that says "some products were held back" without
    // saying which is not a report.
    const d = decideQuarantine({ items, issues: [issue("i0")], policy: "quarantine" });
    const lines = describeQuarantinedItems(d);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Item 0");
    expect(lines[0]).toContain("i0");
    // And the reason, so the owner knows what to change.
    expect(lines[0]).toContain("percent");
  });

  it("WIRING: the push message carries the named list, not only the headline", () => {
    // The guard for the defect above. Without this, removing the list from
    // the message passes every behavioural test in this file.
    const src = readCode(PUSH);
    expect(src).toMatch(/describeQuarantinedItems\(/);
  });

  it("the policy setting fails CLOSED on junk", () => {
    for (const junk of ["", "Quarantine", "QUARANTINE", "yes", "true", "1", null, undefined, {}, []]) {
      expect(isInvalidItemPolicy(junk)).toBe(false);
      expect(resolveLeaflySettings({ invalidItemPolicy: junk }).invalidItemPolicy).toBe("block");
    }
  });

  it("the policy setting round-trips a valid value", () => {
    expect(resolveLeaflySettings({ invalidItemPolicy: "quarantine" }).invalidItemPolicy).toBe("quarantine");
    expect(resolveLeaflySettings({ invalidItemPolicy: "block" }).invalidItemPolicy).toBe("block");
  });
});

// ===========================================================================
// 3. REMOVING PRODUCTS FROM THE MENU
// ===========================================================================

describe("TASK I — deleting items from the Leafly menu", () => {
  it("accepts whatever separator the owner happens to paste", () => {
    // Newlines from a list, commas from a spreadsheet, semicolons from a log.
    // Making him normalise it by hand is an invitation to mangle an id.
    for (const raw of ["a\nb\nc", "a,b,c", "a, b, c", "a;b;c", "a b c", "a,\n b;\tc"]) {
      expect(parseDeleteIds(raw).ids, raw).toEqual(["a", "b", "c"]);
    }
  });

  it("strips quotes a spreadsheet paste brings along", () => {
    expect(parseDeleteIds('"a","b"').ids).toEqual(["a", "b"]);
    expect(parseDeleteIds("'a' `b`").ids).toEqual(["a", "b"]);
  });

  it("de-duplicates while preserving the order the owner typed", () => {
    const p = parseDeleteIds("b,a,b,c,a");
    expect(p.ids).toEqual(["b", "a", "c"]);
    expect(p.duplicates).toEqual(["b", "a"]);
  });

  it("refuses an empty request rather than sending a delete for nothing", () => {
    for (const raw of ["", "   ", "\n\n", ",,,", null, undefined]) {
      const p = parseDeleteIds(raw);
      expect(p.ok).toBe(false);
      expect(p.problems).toContain("empty");
      expect(describeDeleteProblems(p)).toBeTruthy();
    }
  });

  it("caps a bulk paste — removal cannot be undone", () => {
    const p = parseDeleteIds(Array.from({ length: MAX_DELETE_IDS + 1 }, (_, i) => `id${i}`).join("\n"));
    expect(p.ok).toBe(false);
    expect(p.problems).toContain("too_many");
  });

  it("the cap counts UNIQUE ids, so duplicates cannot fake a breach", () => {
    // Pasting the same id 300 times is one removal, not 300, and refusing it
    // would be refusing a legitimate request on a technicality.
    const p = parseDeleteIds(Array.from({ length: 300 }, () => "same").join("\n"));
    expect(p.ids).toEqual(["same"]);
    expect(p.ok).toBe(true);
  });

  it("rejects an entry too long to be an id — that is a pasted line, not an id", () => {
    const p = parseDeleteIds("good\n" + "x".repeat(MAX_DELETE_ID_LENGTH + 1));
    expect(p.ok).toBe(false);
    expect(p.problems).toContain("id_too_long");
    expect(p.rejected).toHaveLength(1);
  });

  it("warns about ids we have no record of — Leafly reports success for those", () => {
    // Leafly answers a DELETE for an unknown id with a success, because the
    // end state it was asked for is already true. Without this check a typo
    // and a real removal are indistinguishable from the response.
    const r = reconcileDeleteRequest(["known", "typo"], new Set(["known"]));
    expect(r.checked).toBe(true);
    expect(r.unknown).toEqual(["typo"]);
    expect(r.recognised).toEqual(["known"]);
    const warning = describeUnknownDeleteIds(r);
    expect(warning).toContain("typo");
    expect(warning).toContain("typo");
  });

  it("says NOTHING when it has no record to check against, rather than guessing", () => {
    // A confident-sounding guess is worse than silence. `checked: false` is an
    // honest answer and the UI can tell the difference.
    const r = reconcileDeleteRequest(["a", "b"], null);
    expect(r.checked).toBe(false);
    expect(r.unknown).toEqual([]);
    expect(describeUnknownDeleteIds(r)).toBeNull();
  });

  it("stays quiet when every id is recognised", () => {
    const r = reconcileDeleteRequest(["a"], new Set(["a"]));
    expect(describeUnknownDeleteIds(r)).toBeNull();
  });

  it("the confirmation tells the owner how to VERIFY the removal", () => {
    // "Done" is not verification. The propagation delay is real and the
    // read-back is the only proof.
    for (const n of [1, 5]) {
      const text = describeDeleteOutcome(n);
      expect(text).toMatch(/minute/i);
      expect(text.toLowerCase()).toContain("read");
    }
    expect(describeDeleteOutcome(1)).toContain("1 product was");
    expect(describeDeleteOutcome(3)).toContain("3 products were");
  });
});

// ===========================================================================
// 4. WIRING GUARDS — the defects were wiring defects first
// ===========================================================================

describe("TASK I — wiring guards", () => {
  it("the payload builder actually calls readPotency", () => {
    // Before the fix, toCompound did its own parse. If someone reinstates that
    // parse, every behavioural test above still passes against the core while
    // the payload goes back to publishing 1000%.
    expect(readCode(PAYLOAD)).toMatch(/readPotency\(/);
  });

  it("the payload builder no longer strips units with a blanket digit filter", () => {
    // This is the exact expression that caused the bug: it turned "1000mg"
    // into 1000 and discarded the only evidence of the unit.
    expect(readCode(PAYLOAD)).not.toMatch(/replace\(\s*\/\[\^0-9\.\]\/g/);
  });

  it("the live push calls the quarantine decision rather than throwing unconditionally", () => {
    const src = readCode(PUSH);
    expect(src).toMatch(/decideQuarantine\(/);
    expect(src).toMatch(/validateLeaflyPayload\(/);
  });

  it("the throwing validator is out of scope in the full push, but kept for the TARGETED push", () => {
    // Two different jobs. The full menu push must be able to hold back a few
    // bad items; the targeted push must not, because the operator hand-picked
    // a handful and silently dropping one defeats the entire point of picking.
    // Leaving the throwing helper importable in push.ts is an invitation to
    // reinstate all-or-nothing by accident.
    expect(readCode(PUSH)).not.toMatch(/assertLeaflyPayloadValid/);
    const selection = readCode(join(ROOT, "src/lib/leafly/selection-server.ts"));
    expect(selection).toMatch(/assertLeaflyPayloadValid\(/);
  });

  it("the live push still THROWS when quarantine declines", () => {
    // The relaxation must not become "always proceed". If decideQuarantine
    // says no, nothing may be sent.
    const src = readCode(PUSH);
    expect(src).toMatch(/if\s*\(!decision\.proceed\)\s*(\{\s*)?throw new LeaflyPayloadInvalidError/);
  });

  it("the live push reports the quarantine on the SUCCESS message", () => {
    // A quarantine attached only to failures would never be seen, because a
    // quarantined push succeeds.
    expect(readCode(PUSH)).toMatch(/withQuarantineNote\(/);
  });

  it("the live push surfaces refused potency readings", () => {
    // collectPotencyRefusals existed with no caller for exactly as long as it
    // was useless. This is the guard that keeps it wired.
    const src = readCode(PUSH);
    expect(src).toMatch(/potencyRefusalsFor\(/);
    expect(src).toMatch(/describePotencySummary\(/);
  });

  it("the potency note is ASSIGNED from the summary, not merely computed nearby", () => {
    // MUTATION-FOUND (M33 SURVIVED). Replacing the assignment with
    //   `const potencyNote: string | null = null; const _unused = describePotencySummary(…)`
    // kept both greps above satisfied while the owner's message went silent.
    // The call being present is not the property that matters; the RESULT
    // reaching the variable that reaches the message is.
    const src = readCode(PUSH);
    expect(src).toMatch(/const\s+potencyNote\s*=\s*describePotencySummary\(/);
    // And nothing may re-bind it to a constant afterwards.
    expect(src).not.toMatch(/potencyNote\s*(:[^=]*)?=\s*null\s*;/);
  });

  it("every push outcome carries the notes — including the SKIPPED one", () => {
    // A quarantine or a potency refusal attached only to the POST arm would
    // vanish the moment the owner's menu was unchanged, which is most pushes.
    const src = readCode(PUSH);
    // Count CALL SITES, not the declaration. The first version of this matched
    // the `function withQuarantineNote(` line too and demanded one more
    // argument pair than there are calls — a test failing on correct code.
    const calls = src.match(/(?<!function\s)withQuarantineNote\(/g) ?? [];
    // Three arms: skipped, POST, PUT. All three are outcomes the owner sees.
    expect(calls.length).toBe(3);
    // Every one of them must pass BOTH notes.
    const passes = src.match(/quarantineNote,\s*potencyNote,/g) ?? [];
    expect(passes.length).toBe(calls.length);
  });

  it("the admin page renders the refused-potency report", () => {
    const src = readCode(PAGE);
    expect(src).toMatch(/preview\.potency/);
    expect(src).toMatch(/describeRefusalRecord\(/);
  });

  it("DELETE HAS A DOOR — an admin action calls deleteLeaflyItems", () => {
    // THE WHOLE POINT. deleteLeaflyItems sat in push.ts issuing a correct
    // DELETE with NO CALLER ANYWHERE. The owner could not remove a product he
    // had published, and Leafly's certification checklist expects to see
    // DELETE traffic. If this guard ever fails, that capability has been
    // orphaned again.
    const src = readCode(ACTIONS);
    expect(src).toMatch(/deleteLeaflyItems\(/);
    expect(src).toMatch(/export async function deleteLeaflyItemsAction/);
  });

  it("the delete action is permission-gated and requires explicit confirmation", () => {
    // MUTATION-FOUND (M34 SURVIVED). The first version asserted only that the
    // word "confirm" appeared in the function. Neutering the gate to
    // `if (false)` left the word in place — in the now-dead branch — and the
    // test passed while an unconfirmed POST would delete live products.
    //
    // A test that greps for a word cannot tell a guard from its corpse. These
    // assert the guard's SHAPE: the flag is read from the form, the refusal is
    // conditioned on that flag being false, and confirmation is passed on to
    // the transport rather than assumed there.
    const src = readCode(ACTIONS);
    const fn = src.slice(src.indexOf("export async function deleteLeaflyItemsAction"));
    expect(fn).toMatch(/requirePermission\("settings\.manage"\)/);
    expect(fn).toMatch(/const confirm = formData\.get\("confirm"\) === "true"/);
    expect(fn).toMatch(/if\s*\(!confirm\)\s*\{/);
    // The literal `if (false)` / `if (true)` short-circuit, in either polarity.
    expect(fn).not.toMatch(/if\s*\(\s*(false|true)\s*\)/);
    // And the transport is told, so its own guard is armed too.
    expect(fn).toMatch(/deleteLeaflyItems\(\{[^}]*confirm:\s*true/);
  });

  it("the transport refuses an unconfirmed delete on its own account", () => {
    // Defence in depth. The action's gate is the one a person sees; this is
    // the one that holds if a future caller forgets.
    const push = readCode(PUSH);
    const fn = push.slice(push.indexOf("export async function deleteLeaflyItems"));
    expect(fn).toMatch(/if\s*\(!opts\.confirm\)\s*\{/);
    expect(fn).toMatch(/throw new Error/);
  });

  it("the delete action parses ids through the pure core, not by hand", () => {
    // A second, hand-rolled split in the action is a second set of rules, and
    // the client and server would disagree about what the owner asked for.
    const fn = readCode(ACTIONS).slice(
      readCode(ACTIONS).indexOf("export async function deleteLeaflyItemsAction"),
    );
    expect(fn).toMatch(/parseDeleteIds\(/);
    expect(fn).not.toMatch(/\.split\(/);
  });

  it("the delete action audits what it removed", () => {
    const fn = readCode(ACTIONS).slice(
      readCode(ACTIONS).indexOf("export async function deleteLeaflyItemsAction"),
    );
    expect(fn).toMatch(/recordAudit\(/);
    expect(fn).toMatch(/recordSyndicationLog\(/);
  });

  it("the delete UI exists and is wired to the action", () => {
    const src = readCode(CLIENT);
    expect(src).toMatch(/deleteLeaflyItemsAction\(/);
    // Two-step arm/confirm, same as the push card. A one-click irreversible
    // bulk removal is not acceptable.
    expect(src).toMatch(/armed/);
  });

  it("the settings panel renders the invalid-item policy control", () => {
    expect(readCode(SETTINGS_PANEL)).toMatch(/name="invalidItemPolicy"/);
  });

  it("the save action carries invalidItemPolicy, or the control would silently revert", () => {
    // saveSyncSettings upserts the WHOLE blob from an allowlist. A rendered
    // control missing from that list resets itself on every unrelated save and
    // the owner is never told.
    expect(readCode(ACTIONS)).toMatch(/"invalidItemPolicy"/);
  });

  it("the new cores are pure — no imports, no I/O, no framework", () => {
    for (const p of [POTENCY, QUARANTINE, DELETE_CORE]) {
      const src = readCode(p);
      expect(src, p).not.toMatch(/^\s*import\s/m);
      expect(src, p).not.toMatch(/require\(/);
      expect(src, p).not.toMatch(/fetch\(/);
      expect(src, p).not.toMatch(/server-only/);
      expect(src, p).not.toMatch(/process\.env/);
    }
  });

  it("the new cores are registered in the pure self-test runner with floors", () => {
    // A self-test nobody runs is a comment.
    // NB the pattern allows for the `()` of the test-runner call itself —
    // an earlier [^)]* version could never match and failed on correct code.
    const src = readCode(SELFTEST_RUNNER);
    for (const name of ["leafly-potency-core", "leafly-quarantine-core", "leafly-delete-request-core"]) {
      const m = src.match(new RegExp(`assertRan\\("${name}",[^;]*?,\\s*(\\d+)\\s*\\)`));
      expect(m, `${name} must be registered with a floor`).not.toBeNull();
      // A floor of 0 is a registration that protects nothing.
      expect(Number(m?.[1]), `${name} floor`).toBeGreaterThan(0);
    }
  });

  it("the sync-settings floor was raised with the assertion count", () => {
    // A floor left at its old value stops protecting the assertions added
    // since. It was 64; the count is now 81.
    const m = readCode(SELFTEST_RUNNER).match(/assertRan\("sync-settings-core",[^,]*,\s*(\d+)\)/);
    expect(m).not.toBeNull();
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(78);
  });
});

// ===========================================================================
// 5. THE SELF-TESTS THEMSELVES
// ===========================================================================

describe("TASK I — embedded self-tests run under vitest too", () => {
  it("potency-core self-tests pass", () => {
    const r = __runLeaflyPotencyTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(120);
  });

  it("quarantine-core self-tests pass", () => {
    const r = __runLeaflyQuarantineTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(75);
  });

  it("delete-request-core self-tests pass", () => {
    const r = __runLeaflyDeleteRequestTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(80);
  });
});
